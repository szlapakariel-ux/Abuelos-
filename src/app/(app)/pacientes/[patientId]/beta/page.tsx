import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canEditPatientData } from '@/lib/permissions';
import { startOfToday, endOfToday, formatDateTime, relativeFromNow } from '@/lib/date';
import { getDaySchedule } from '@/lib/medication-day';
import { TAKE_STATUS_LABEL } from '@/lib/medication-day';
import { ALERT_SEVERITY_STYLE } from '@/lib/alerts/types';
import { logAudit } from '@/lib/audit';
import { SHIFT_TYPE_LABEL, SHIFT_STATUS_LABEL, SHIFT_STATUS_STYLE } from '@/lib/shifts';

const EMAIL_STATUS_STYLE = {
  SENT: { label: 'Enviado', cls: 'bg-green-100 text-green-800' },
  FAILED: { label: 'Fallido', cls: 'bg-red-100 text-red-800' },
  SKIPPED: { label: 'Omitido', cls: 'bg-slate-100 text-slate-600' },
} as const;

const TAKE_STATUS_COLOR: Record<string, string> = {
  TAKEN: 'text-green-700 font-semibold',
  NOT_TAKEN: 'text-red-700 font-semibold',
  REFUSED: 'text-red-800 font-bold',
  DELAYED: 'text-amber-700 font-semibold',
};

export default async function BetaDashboardPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');

  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canEditPatientData(access.patientRole)) redirect(`/pacientes/${params.patientId}`);

  const patient = await prisma.patient.findUnique({
    where: { id: params.patientId },
    select: { fullName: true, id: true },
  });
  if (!patient) notFound();

  const today = startOfToday();
  const end = endOfToday();

  const [meds, todayVitals, todayMeals, todayStatus, openAlerts, lastEmailLogs, lastMedLogs, caregiverActivity, todayShifts] = await Promise.all([
    // Medicación del día
    prisma.medication.findMany({
      where: { patientId: params.patientId },
      include: {
        schedules: true,
        logs: { where: { scheduledFor: { gte: today, lte: end } } },
      },
    }),
    // Presiones de hoy
    prisma.vitalSign.findMany({
      where: { patientId: params.patientId, recordedAt: { gte: today, lte: end } },
      orderBy: { recordedAt: 'desc' },
      include: { recordedBy: { select: { name: true } } },
    }),
    // Comidas de hoy
    prisma.mealLog.findMany({
      where: { patientId: params.patientId, date: { gte: today, lte: end } },
      orderBy: { date: 'asc' },
      include: { recordedBy: { select: { name: true } } },
    }),
    // Estado hoy
    prisma.dailyStatus.findFirst({
      where: { patientId: params.patientId, date: { gte: today, lte: end } },
      include: { recordedBy: { select: { name: true } } },
    }),
    // Alertas abiertas
    prisma.alert.findMany({
      where: { patientId: params.patientId, status: 'OPEN' },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      take: 10,
    }),
    // Últimos emails (15)
    prisma.emailLog.findMany({
      where: { patientId: params.patientId },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    // Últimos logs de medicación (20) para trazabilidad
    prisma.medicationLog.findMany({
      where: { medication: { patientId: params.patientId } },
      orderBy: { recordedAt: 'desc' },
      take: 20,
      include: {
        medication: { select: { name: true, dose: true } },
        recordedBy: { select: { name: true } },
      },
    }),
    // Última actividad de cuidadora (medicationLog + vitalSign + mealLog hoy)
    prisma.medicationLog.findFirst({
      where: {
        medication: { patientId: params.patientId },
        recordedBy: { globalRole: 'CAREGIVER' },
      },
      orderBy: { recordedAt: 'desc' },
      include: {
        recordedBy: { select: { name: true } },
        medication: { select: { name: true, dose: true } },
      },
    }),
    // Turnos de hoy
    prisma.caregiverShift.findMany({
      where: {
        patientId: params.patientId,
        startPlannedAt: { lte: end },
        endPlannedAt: { gte: today },
      },
      orderBy: { startPlannedAt: 'asc' },
      include: { caregiver: { select: { name: true } } },
    }),
  ]);

  const slots = getDaySchedule(meds, today);
  const taken = slots.filter((s) => s.log?.status === 'TAKEN');
  const notTaken = slots.filter((s) => s.log && s.log.status !== 'TAKEN');
  const pending = slots.filter((s) => !s.log);

  await logAudit({
    userId: session.user.id,
    action: 'beta.dashboard.view',
    entityType: 'Patient',
    entityId: params.patientId,
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← {patient.fullName}</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Seguimiento beta</h1>
        <p className="text-slate-500 text-sm">
          {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Resumen del día */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center py-3">
          <p className="text-3xl font-bold text-green-700">{taken.length}</p>
          <p className="text-xs text-slate-600 mt-1">Tomadas</p>
        </div>
        <div className="card text-center py-3">
          <p className={`text-3xl font-bold ${pending.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{pending.length}</p>
          <p className="text-xs text-slate-600 mt-1">Pendientes</p>
        </div>
        <div className="card text-center py-3">
          <p className={`text-3xl font-bold ${notTaken.length > 0 ? 'text-red-600' : 'text-slate-400'}`}>{notTaken.length}</p>
          <p className="text-xs text-slate-600 mt-1">Con observación</p>
        </div>
        <div className="card text-center py-3">
          <p className={`text-3xl font-bold ${openAlerts.length > 0 ? 'text-red-700' : 'text-slate-400'}`}>{openAlerts.length}</p>
          <p className="text-xs text-slate-600 mt-1">Alertas abiertas</p>
        </div>
      </section>

      {/* Medicación del día */}
      <section>
        <h2 className="font-semibold mb-2">Medicación de hoy</h2>
        {slots.length === 0 ? (
          <p className="text-slate-500 text-sm">Sin medicación configurada.</p>
        ) : (
          <div className="space-y-2">
            {slots.map((s, i) => (
              <div key={i} className="card flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{s.medication.name} {s.medication.dose}</p>
                  <p className="text-slate-500 text-xs">{s.scheduledAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                {s.log ? (
                  <div className="text-right shrink-0">
                    <p className={TAKE_STATUS_COLOR[s.log.status] ?? ''}>{TAKE_STATUS_LABEL[s.log.status]}</p>
                    <p className="text-xs text-slate-500">{relativeFromNow(s.log.recordedAt)}</p>
                    {s.log.notes && <p className="text-xs text-slate-500 italic">{s.log.notes}</p>}
                  </div>
                ) : (
                  <span className="text-xs text-amber-600 font-medium shrink-0">Pendiente</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Registros de hoy */}
      <section>
        <h2 className="font-semibold mb-2">Registros de hoy</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="card text-sm">
            <p className="font-medium text-slate-700 mb-1">🩺 Presión</p>
            {todayVitals.length === 0 ? (
              <p className="text-slate-400">Sin registros</p>
            ) : todayVitals.map((v) => (
              <div key={v.id} className="mb-1">
                <p className="font-semibold">{v.systolic}/{v.diastolic} <span className="text-slate-400 font-normal text-xs">mmHg</span></p>
                <p className="text-xs text-slate-500">{formatDateTime(v.recordedAt)} · {v.recordedBy.name}</p>
              </div>
            ))}
          </div>
          <div className="card text-sm">
            <p className="font-medium text-slate-700 mb-1">🍽️ Alimentación</p>
            {todayMeals.length === 0 ? (
              <p className="text-slate-400">Sin registros</p>
            ) : todayMeals.map((m) => (
              <div key={m.id} className="mb-1">
                <p className="font-semibold">{mealLabel(m.mealType)} — {intakeLabel(m.intake)}</p>
                <p className="text-xs text-slate-500">
                  {m.recordedBy.name}
                  {m.photoUrl && <span className="text-brand ml-1">· 📷 foto</span>}
                </p>
              </div>
            ))}
          </div>
          <div className="card text-sm">
            <p className="font-medium text-slate-700 mb-1">😊 Estado general</p>
            {todayStatus ? (
              <>
                <p className="font-semibold">{moodLabel(todayStatus.mood)}</p>
                <p className="text-xs text-slate-500">
                  Sueño: {sleepLabel(todayStatus.sleep)} · Dolor: {painLabel(todayStatus.pain)}
                </p>
                <p className="text-xs text-slate-500">{todayStatus.recordedBy.name}</p>
              </>
            ) : (
              <p className="text-slate-400">Sin registrar hoy</p>
            )}
          </div>
        </div>
      </section>

      {/* Última actividad cuidadora */}
      {caregiverActivity && (
        <section className="card text-sm">
          <p className="font-semibold mb-1">👤 Última actividad de cuidadora</p>
          <p>
            <strong>{caregiverActivity.recordedBy.name}</strong>{' '}
            registró <em>{TAKE_STATUS_LABEL[caregiverActivity.status]}</em> — {caregiverActivity.medication.name}
          </p>
          <p className="text-slate-500 mt-0.5">{relativeFromNow(caregiverActivity.recordedAt)} ({formatDateTime(caregiverActivity.recordedAt)})</p>
        </section>
      )}

      {/* Alertas abiertas */}
      {openAlerts.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Alertas abiertas ({openAlerts.length})</h2>
            <Link href={`/pacientes/${params.patientId}/alertas`} className="text-sm text-brand hover:underline">
              Gestionar →
            </Link>
          </div>
          <div className="space-y-2">
            {openAlerts.map((a) => {
              const style = ALERT_SEVERITY_STYLE[a.severity];
              return (
                <div key={a.id} className={`card flex items-start gap-2 ${style.bg} ${style.border}`}>
                  <span className="text-lg shrink-0">{style.emoji}</span>
                  <div className="min-w-0">
                    <p className={`font-semibold text-sm ${style.text}`}>{a.title}</p>
                    <p className={`text-sm ${style.text} opacity-90`}>{a.message}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{relativeFromNow(a.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Cobertura de hoy */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Cobertura de cuidadoras hoy</h2>
          <Link href={`/pacientes/${params.patientId}/turnos`} className="text-sm text-brand hover:underline">
            Ver todos →
          </Link>
        </div>
        {todayShifts.length === 0 ? (
          <div className="card text-sm text-slate-500">Sin turnos asignados para hoy.</div>
        ) : (
          <div className="space-y-2">
            {todayShifts.map((s) => {
              const style = SHIFT_STATUS_STYLE[s.status];
              return (
                <div key={s.id} className={`card flex items-center gap-3 border ${style.border}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${style.bg} ${style.text}`}>
                        {SHIFT_STATUS_LABEL[s.status]}
                      </span>
                      <span className="text-sm font-medium">{s.caregiver.name}</span>
                      <span className="text-xs text-slate-400">{SHIFT_TYPE_LABEL[s.shiftType]}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatDateTime(s.startPlannedAt)} — {formatDateTime(s.endPlannedAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Log de emails */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Log de emails ({lastEmailLogs.length})</h2>
          <Link href={`/pacientes/${params.patientId}/beta/emails`} className="text-sm text-brand hover:underline">
            Ver completo →
          </Link>
        </div>
        {lastEmailLogs.length === 0 ? (
          <div className="card text-sm text-slate-500">No se enviaron emails aún.</div>
        ) : (
          <div className="space-y-2">
            {lastEmailLogs.map((e) => {
              const st = EMAIL_STATUS_STYLE[e.status];
              return (
                <div key={e.id} className="card text-sm flex items-start gap-3">
                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 shrink-0 ${st.cls}`}>{st.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{e.subject}</p>
                    <p className="text-xs text-slate-500">
                      → {e.recipientName ? `${e.recipientName} <${e.recipientEmail}>` : e.recipientEmail}
                    </p>
                    {e.summary && <p className="text-xs text-slate-500 mt-0.5">{e.summary}</p>}
                    {e.error && <p className="text-xs text-red-600 mt-0.5">Error: {e.error}</p>}
                    {e.messageId && <p className="text-xs text-slate-400">ID Resend: {e.messageId}</p>}
                  </div>
                  <p className="text-xs text-slate-400 shrink-0">{relativeFromNow(e.createdAt)}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Log de medicación reciente */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Log de medicación (últimos 20)</h2>
          <Link href={`/pacientes/${params.patientId}/medicacion/log`} className="text-sm text-brand hover:underline">
            Ver completo →
          </Link>
        </div>
        {lastMedLogs.length === 0 ? (
          <div className="card text-sm text-slate-500">Sin registros aún.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-3">Medicamento</th>
                  <th className="py-1.5 pr-3">Estado</th>
                  <th className="py-1.5 pr-3">Hora indicada</th>
                  <th className="py-1.5 pr-3">Hora real</th>
                  <th className="py-1.5 pr-3">Registró</th>
                  <th className="py-1.5">Nota</th>
                </tr>
              </thead>
              <tbody>
                {lastMedLogs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 pr-3 font-medium">{l.medication.name} {l.medication.dose}</td>
                    <td className={`py-1.5 pr-3 ${TAKE_STATUS_COLOR[l.status] ?? ''}`}>
                      {TAKE_STATUS_LABEL[l.status]}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">
                      {l.scheduledFor.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">
                      {l.actualTime
                        ? l.actualTime.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{l.recordedBy.name}</td>
                    <td className="py-1.5 text-slate-400 max-w-xs truncate">{l.notes ?? l.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function mealLabel(t: string) {
  const m: Record<string, string> = { BREAKFAST: 'Desayuno', LUNCH: 'Almuerzo', SNACK: 'Merienda', DINNER: 'Cena' };
  return m[t] ?? t;
}
function intakeLabel(t: string) {
  const m: Record<string, string> = { GOOD: 'Completa', SOME: 'Parcial', NONE: 'No comió' };
  return m[t] ?? t;
}
function moodLabel(t: string) {
  const m: Record<string, string> = { GOOD: '😊 Bien', FAIR: '😐 Regular', SAD: '😞 Triste', IRRITABLE: '😠 Irritable', CONFUSED: '😵 Confundida' };
  return m[t] ?? t;
}
function sleepLabel(t: string) {
  const m: Record<string, string> = { GOOD: 'Bien', FAIR: 'Regular', BAD: 'Mal' };
  return m[t] ?? t;
}
function painLabel(t: string) {
  const m: Record<string, string> = { NONE: 'Sin dolor', MILD: 'Leve', MODERATE: 'Moderado', SEVERE: 'Severo' };
  return m[t] ?? t;
}
