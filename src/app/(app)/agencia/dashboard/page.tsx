import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GlobalRole } from '@prisma/client';
import { startOfToday, endOfToday, relativeFromNow } from '@/lib/date';
import { getDaySchedule } from '@/lib/medication-day';
import { ALERT_SEVERITY_STYLE, alertLinkHref } from '@/lib/alerts/types';
import { logAudit } from '@/lib/audit';

export default async function AgencyDashboard() {
  const session = await auth();
  if (!session) redirect('/login');
  if (session.user.globalRole !== GlobalRole.AGENCY_ADMIN) redirect('/pacientes');

  const orgId = session.user.organizationId;
  const today = startOfToday();
  const end = endOfToday();

  const [patients, caregiverCount] = await Promise.all([
    prisma.patient.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { fullName: 'asc' },
      include: {
        alerts: {
          where: { status: 'OPEN' },
          orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        },
        users: {
          where: { patientRole: 'CAREGIVER' },
          include: { user: { select: { name: true } } },
        },
        medications: {
          include: {
            schedules: true,
            logs: { where: { scheduledFor: { gte: today, lte: end } } },
          },
        },
      },
    }),
    prisma.user.count({
      where: { organizationId: orgId, globalRole: GlobalRole.CAREGIVER, isActive: true },
    }),
  ]);

  const patientIds = patients.map((p) => p.id);

  const [todayMedLogs, todayVitals, todayMeals, todayStatuses] = patientIds.length
    ? await Promise.all([
        prisma.medicationLog.findMany({
          where: {
            medication: { patientId: { in: patientIds } },
            recordedAt: { gte: today, lte: end },
          },
          select: { recordedAt: true, medication: { select: { patientId: true } } },
        }),
        prisma.vitalSign.findMany({
          where: { patientId: { in: patientIds }, recordedAt: { gte: today, lte: end } },
          select: { patientId: true, recordedAt: true },
        }),
        prisma.mealLog.findMany({
          where: { patientId: { in: patientIds }, date: { gte: today, lte: end } },
          select: { patientId: true, date: true },
        }),
        prisma.dailyStatus.findMany({
          where: { patientId: { in: patientIds }, date: { gte: today, lte: end } },
          select: { patientId: true, date: true },
        }),
      ])
    : [[], [], [], []];

  const hasActivityToday = new Set<string>();
  const lastActivityByPatient = new Map<string, Date>();

  const trackActivity = (patientId: string, date: Date) => {
    hasActivityToday.add(patientId);
    const prev = lastActivityByPatient.get(patientId);
    if (!prev || date > prev) lastActivityByPatient.set(patientId, date);
  };

  for (const log of todayMedLogs) trackActivity(log.medication.patientId, log.recordedAt);
  for (const v of todayVitals) trackActivity(v.patientId, v.recordedAt);
  for (const m of todayMeals) trackActivity(m.patientId, m.date);
  for (const s of todayStatuses) trackActivity(s.patientId, s.date);

  let openAlerts = 0;
  let criticalAlerts = 0;
  let totalPending = 0;

  const patientRows = patients.map((p) => {
    const slots = getDaySchedule(p.medications, today);
    const pending = slots.filter((s) => !s.log).length;
    const critCount = p.alerts.filter((a) => a.severity === 'CRITICAL').length;
    openAlerts += p.alerts.length;
    criticalAlerts += critCount;
    totalPending += pending;
    return {
      ...p,
      pending,
      criticalAlerts: critCount,
      hasActivityToday: hasActivityToday.has(p.id),
      lastActivity: lastActivityByPatient.get(p.id) ?? null,
    };
  });

  const sortedPatients = [...patientRows].sort((a, b) => {
    if (b.criticalAlerts !== a.criticalAlerts) return b.criticalAlerts - a.criticalAlerts;
    if (b.alerts.length !== a.alerts.length) return b.alerts.length - a.alerts.length;
    const noA = a.hasActivityToday ? 0 : 1;
    const noB = b.hasActivityToday ? 0 : 1;
    if (noB !== noA) return noB - noA;
    if (b.pending !== a.pending) return b.pending - a.pending;
    return a.fullName.localeCompare(b.fullName);
  });

  const allAlerts = patients
    .flatMap((p) => p.alerts.map((a) => ({ ...a, patientName: p.fullName, patientId: p.id })))
    .sort((a, b) => {
      const order: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      const diff = (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
      return diff !== 0 ? diff : b.createdAt.getTime() - a.createdAt.getTime();
    });

  const patientsWithoutToday = patientRows.filter((p) => !p.hasActivityToday).length;

  await logAudit({
    userId: session.user.id,
    action: 'agency.dashboard.view',
    metadata: { orgId },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Panel de agencia</h1>
          <p className="text-slate-600 text-sm">
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link href="/agencia/cuidadoras" className="btn-secondary text-sm">
          Ver cuidadoras →
        </Link>
      </div>

      {/* Metrics */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard label="Pacientes activos" value={patients.length} variant="brand" />
        <MetricCard label="Cuidadoras activas" value={caregiverCount} variant="slate" />
        <MetricCard label="Alertas abiertas" value={openAlerts} variant={openAlerts > 0 ? 'amber' : 'slate'} />
        <MetricCard label="Alertas críticas" value={criticalAlerts} variant={criticalAlerts > 0 ? 'red' : 'slate'} />
        <MetricCard
          label="Sin registros hoy"
          value={patientsWithoutToday}
          variant={patientsWithoutToday > 0 ? 'amber' : 'slate'}
        />
      </section>

      {/* Centralized alerts */}
      {allAlerts.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">
            Alertas abiertas ({allAlerts.length})
            {criticalAlerts > 0 && (
              <span className="ml-2 text-sm font-normal text-red-700">{criticalAlerts} crítica{criticalAlerts > 1 ? 's' : ''}</span>
            )}
          </h2>
          <div className="space-y-2">
            {allAlerts.slice(0, 25).map((a) => {
              const style = ALERT_SEVERITY_STYLE[a.severity];
              const href = alertLinkHref({ patientId: a.patientId, type: a.type, sourceId: a.sourceId });
              return (
                <Link
                  key={a.id}
                  href={href}
                  className={`card flex items-start gap-3 ${style.bg} ${style.border} hover:shadow-md transition`}
                >
                  <span className="text-xl shrink-0" aria-hidden>{style.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className={`font-semibold ${style.text}`}>{a.title}</p>
                      <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${style.bg} ${style.text} shrink-0`}>
                        {style.label}
                      </span>
                    </div>
                    <p className={`text-sm ${style.text} opacity-90`}>{a.message}</p>
                    <p className="text-xs text-slate-600 mt-0.5 font-medium">{a.patientName}</p>
                  </div>
                </Link>
              );
            })}
            {allAlerts.length > 25 && (
              <p className="text-sm text-slate-500 text-center py-2">
                ... y {allAlerts.length - 25} alertas más. Revisá cada paciente para ver el detalle.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Patients overview */}
      <section>
        <h2 className="font-semibold mb-3">Estado por paciente ({sortedPatients.length})</h2>
        {sortedPatients.length === 0 ? (
          <div className="card text-center py-8 text-slate-600">No hay pacientes activos.</div>
        ) : (
          <div className="space-y-2">
            {sortedPatients.map((p) => {
              const caregivers = p.users.map((pu) => pu.user.name);
              const hasCritical = p.criticalAlerts > 0;
              return (
                <div
                  key={p.id}
                  className={`card flex items-center gap-3 ${hasCritical ? 'border-red-300 bg-red-50' : !p.hasActivityToday ? 'border-amber-200 bg-amber-50/50' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{p.fullName}</span>
                      {hasCritical && (
                        <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-800">🚨 Crítica</span>
                      )}
                      {!p.hasActivityToday && (
                        <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">Sin registros hoy</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {caregivers.length > 0
                        ? `👤 ${caregivers.join(', ')}`
                        : <span className="text-slate-400">Sin cuidadora asignada</span>}
                      {p.pending > 0 && (
                        <span className="ml-2 text-amber-700 font-medium">· 💊 {p.pending} pendiente{p.pending > 1 ? 's' : ''}</span>
                      )}
                      {p.alerts.length > 0 && (
                        <span className="ml-2 text-slate-500">· ⚠️ {p.alerts.length} alerta{p.alerts.length > 1 ? 's' : ''}</span>
                      )}
                      {p.lastActivity && (
                        <span className="ml-2 text-slate-400">· 🕒 {relativeFromNow(p.lastActivity)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.alerts.length > 0 && (
                      <Link
                        href={`/pacientes/${p.id}/alertas`}
                        className="text-xs text-slate-600 hover:text-brand hidden sm:inline"
                      >
                        Alertas
                      </Link>
                    )}
                    <Link href={`/pacientes/${p.id}`} className="btn-secondary text-xs py-1 px-3">
                      Ver →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const VARIANT_STYLES = {
  brand: 'text-brand',
  slate: 'text-slate-700',
  amber: 'text-amber-700',
  red: 'text-red-700',
} as const;

function MetricCard({ label, value, variant }: { label: string; value: number; variant: keyof typeof VARIANT_STYLES }) {
  return (
    <div className="card text-center py-4">
      <p className={`text-3xl font-bold ${VARIANT_STYLES[variant]}`}>{value}</p>
      <p className="text-xs text-slate-600 mt-1 leading-tight">{label}</p>
    </div>
  );
}
