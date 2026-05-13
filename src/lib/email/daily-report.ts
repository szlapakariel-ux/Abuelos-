/**
 * Armado y envío del reporte diario por email.
 * Solo links a la app — no se adjuntan archivos.
 */
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { logAudit } from '@/lib/audit';
import { getDaySchedule, type MedicationWithRel } from '@/lib/medication-day';
import { ALERT_TYPE_LABEL } from '@/lib/alerts/types';
import { MEDICAL_EVENT_LABEL } from '@/lib/files';
import type { AlertSeverity } from '@prisma/client';

export type ReportResult = {
  patientsScanned: number;
  emailsSent: number;
  emailsSkipped: number;
};

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || process.env.AUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = { INFO: 'ℹ️', WARNING: '⚠️', CRITICAL: '🚨' };

export async function sendDailyReports(opts: { systemUserId?: string } = {}): Promise<ReportResult> {
  const result: ReportResult = { patientsScanned: 0, emailsSent: 0, emailsSkipped: 0 };

  const patients = await prisma.patient.findMany({
    where: { isActive: true },
    include: {
      users: {
        where: { receivesEmailReports: true },
        include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
      },
    },
  });

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const patient of patients) {
    result.patientsScanned++;

    const recipients = patient.users
      .filter((pu) => pu.user.isActive && pu.user.email)
      .map((pu) => ({ id: pu.user.id, name: pu.user.name, email: pu.user.email }));

    if (recipients.length === 0) {
      result.emailsSkipped++;
      await logAudit({
        userId: opts.systemUserId ?? 'system',
        action: 'dailyReport.skipped',
        entityType: 'Patient',
        entityId: patient.id,
        metadata: { reason: 'no_recipients' },
      });
      continue;
    }

    const [meds, lastVital, meals, dailyStatus, openAlerts, newEvents, newFiles] = await Promise.all([
      prisma.medication.findMany({
        where: { patientId: patient.id },
        include: {
          schedules: true,
          logs: { where: { scheduledFor: { gte: startOfToday, lte: endOfToday } } },
        },
      }) as Promise<MedicationWithRel[]>,
      prisma.vitalSign.findFirst({
        where: { patientId: patient.id },
        orderBy: { recordedAt: 'desc' },
      }),
      prisma.mealLog.findMany({
        where: { patientId: patient.id, date: { gte: startOfToday, lte: endOfToday } },
        orderBy: { date: 'asc' },
      }),
      prisma.dailyStatus.findFirst({
        where: { patientId: patient.id, date: { gte: startOfToday, lte: endOfToday } },
      }),
      prisma.alert.findMany({
        where: { patientId: patient.id, isResolved: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.medicalEvent.findMany({
        where: { patientId: patient.id, createdAt: { gte: last24h } },
      }),
      prisma.medicalFile.findMany({
        where: { patientId: patient.id, createdAt: { gte: last24h } },
        select: { id: true, name: true, category: true },
      }),
    ]);

    const slots = getDaySchedule(meds, startOfToday);
    const taken = slots.filter((s) => s.log?.status === 'TAKEN').length;
    const issues = slots.filter((s) => s.log && s.log.status !== 'TAKEN').length;
    const pending = slots.filter((s) => !s.log).length;

    const hasMeaningfulData =
      slots.length > 0 ||
      lastVital != null ||
      meals.length > 0 ||
      dailyStatus != null ||
      openAlerts.length > 0 ||
      newEvents.length > 0 ||
      newFiles.length > 0;

    if (!hasMeaningfulData) {
      result.emailsSkipped++;
      await logAudit({
        userId: opts.systemUserId ?? 'system',
        action: 'dailyReport.skipped',
        entityType: 'Patient',
        entityId: patient.id,
        metadata: { reason: 'no_data' },
      });
      continue;
    }

    const patientUrl = `${appBaseUrl()}/pacientes/${patient.id}`;
    const subject = `Resumen diario — ${patient.fullName}`;
    const html = buildHtml({
      patientName: patient.fullName,
      patientUrl,
      meds: { pending, taken, issues, total: slots.length },
      lastVital,
      meals,
      dailyStatus,
      openAlerts,
      newEvents,
      newFiles,
    });

    for (const r of recipients) {
      if (!r.email) continue;
      try {
        await sendEmail({ to: r.email, subject, html });
        result.emailsSent++;
        await logAudit({
          userId: opts.systemUserId ?? 'system',
          action: 'dailyReport.sent',
          entityType: 'Patient',
          entityId: patient.id,
          metadata: { recipientUserId: r.id, recipientEmail: r.email },
        });
      } catch (err) {
        console.error('[daily-report] error enviando email', err);
        await logAudit({
          userId: opts.systemUserId ?? 'system',
          action: 'dailyReport.failed',
          entityType: 'Patient',
          entityId: patient.id,
          metadata: { recipientUserId: r.id, error: String(err) },
        });
      }
    }
  }

  return result;
}

function buildHtml(p: {
  patientName: string;
  patientUrl: string;
  meds: { pending: number; taken: number; issues: number; total: number };
  lastVital: { systolic: number; diastolic: number; pulse: number | null; recordedAt: Date; status: string } | null;
  meals: Array<{ mealType: string; intake: string; date: Date }>;
  dailyStatus: { mood: string; sleep: string; pain: string } | null;
  openAlerts: Array<{ id: string; type: keyof typeof ALERT_TYPE_LABEL; severity: AlertSeverity; title: string; message: string }>;
  newEvents: Array<{ type: keyof typeof MEDICAL_EVENT_LABEL; date: Date }>;
  newFiles: Array<{ name: string }>;
}): string {
  const sections: string[] = [];

  if (p.openAlerts.length > 0) {
    sections.push(`
      <h3 style="margin:24px 0 8px;color:#991B1B">Alertas abiertas (${p.openAlerts.length})</h3>
      <ul style="padding-left:18px;margin:0">
        ${p.openAlerts.map((a) => `
          <li style="margin-bottom:6px">
            ${SEVERITY_EMOJI[a.severity]} <strong>${escapeHtml(a.title)}</strong>: ${escapeHtml(a.message)}
          </li>
        `).join('')}
      </ul>
    `);
  }

  sections.push(`
    <h3 style="margin:24px 0 8px">Medicación de hoy</h3>
    <p style="margin:0">${p.meds.taken} tomadas, ${p.meds.pending} pendientes, ${p.meds.issues} con observación (sobre ${p.meds.total}).</p>
  `);

  if (p.lastVital) {
    sections.push(`
      <h3 style="margin:24px 0 8px">Última presión</h3>
      <p style="margin:0">
        <strong>${p.lastVital.systolic}/${p.lastVital.diastolic}</strong>
        ${p.lastVital.pulse ? ` · pulso ${p.lastVital.pulse}` : ''}
        — <em>${escapeHtml(p.lastVital.status)}</em>
        <br><span style="color:#64748B">${p.lastVital.recordedAt.toLocaleString('es-AR')}</span>
      </p>
    `);
  }

  if (p.meals.length > 0) {
    sections.push(`
      <h3 style="margin:24px 0 8px">Alimentación de hoy</h3>
      <ul style="padding-left:18px;margin:0">
        ${p.meals.map((m) => `<li>${escapeHtml(m.mealType)} — ${escapeHtml(m.intake)}</li>`).join('')}
      </ul>
    `);
  }

  if (p.dailyStatus) {
    sections.push(`
      <h3 style="margin:24px 0 8px">Estado general</h3>
      <p style="margin:0">Ánimo: ${escapeHtml(p.dailyStatus.mood)} · Sueño: ${escapeHtml(p.dailyStatus.sleep)} · Dolor: ${escapeHtml(p.dailyStatus.pain)}</p>
    `);
  }

  if (p.newEvents.length > 0) {
    sections.push(`
      <h3 style="margin:24px 0 8px">Nuevos eventos médicos (últimas 24h)</h3>
      <ul style="padding-left:18px;margin:0">
        ${p.newEvents.map((ev) => `<li>${escapeHtml(MEDICAL_EVENT_LABEL[ev.type])} — ${ev.date.toLocaleDateString('es-AR')}</li>`).join('')}
      </ul>
    `);
  }

  if (p.newFiles.length > 0) {
    sections.push(`
      <h3 style="margin:24px 0 8px">Nuevos archivos médicos (últimas 24h)</h3>
      <ul style="padding-left:18px;margin:0">
        ${p.newFiles.map((f) => `<li>${escapeHtml(f.name)}</li>`).join('')}
      </ul>
    `);
  }

  return `<!doctype html>
<html><body style="font-family:system-ui,Segoe UI,Roboto,Arial;color:#0F172A;line-height:1.5;padding:0;margin:0;background:#F8FAFC">
  <div style="max-width:560px;margin:0 auto;padding:24px;background:#FFFFFF">
    <h1 style="font-size:20px;margin:0 0 4px;color:#0F766E">Resumen diario</h1>
    <p style="margin:0 0 16px;color:#64748B">${escapeHtml(p.patientName)} · ${new Date().toLocaleDateString('es-AR')}</p>
    ${sections.join('\n')}
    <hr style="border:none;border-top:1px solid #E2E8F0;margin:32px 0 16px">
    <p style="margin:0">
      <a href="${escapeHtml(p.patientUrl)}" style="display:inline-block;background:#0F766E;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Ver detalles en la app</a>
    </p>
    <p style="color:#94A3B8;font-size:12px;margin:24px 0 0">
      Cuidado Mayor · este es un resumen automático con datos del paciente. Recibís este email porque tenés activadas las notificaciones por email para este paciente.
    </p>
  </div>
</body></html>`;
}
