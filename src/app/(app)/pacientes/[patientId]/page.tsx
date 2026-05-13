import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditPatientData, canRegisterDailyCare, getPatientAccess } from '@/lib/permissions';
import { calculateAge } from '@/lib/utils';
import { startOfToday, endOfToday, formatDateTime, formatTime, relativeFromNow } from '@/lib/date';
import { getDaySchedule, TAKE_STATUS_LABEL } from '@/lib/medication-day';
import { VITAL_STATUS_STYLE } from '@/lib/vitals';
import { MEDICAL_EVENT_EMOJI, MEDICAL_EVENT_LABEL } from '@/lib/files';

export default async function PatientDashboard({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');

  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const patient = await prisma.patient.findUnique({ where: { id: params.patientId } });
  if (!patient) notFound();

  const today = startOfToday();
  const end = endOfToday();

  const [meds, lastVital, lastMeal, lastStatus, openAlerts, lastCaregiverLog, lastEvent, filesCount] = await Promise.all([
    prisma.medication.findMany({
      where: { patientId: params.patientId },
      include: {
        schedules: true,
        logs: { where: { scheduledFor: { gte: today, lte: end } } },
      },
    }),
    prisma.vitalSign.findFirst({
      where: { patientId: params.patientId },
      orderBy: { recordedAt: 'desc' },
      include: { recordedBy: { select: { name: true } } },
    }),
    prisma.mealLog.findFirst({
      where: { patientId: params.patientId },
      orderBy: { date: 'desc' },
      include: { recordedBy: { select: { name: true } } },
    }),
    prisma.dailyStatus.findFirst({
      where: { patientId: params.patientId, date: { gte: today, lte: end } },
      orderBy: { date: 'desc' },
    }),
    prisma.alert.findMany({
      where: { patientId: params.patientId, isResolved: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.medicationLog.findFirst({
      where: { medication: { patientId: params.patientId }, recordedBy: { globalRole: 'CAREGIVER' } },
      orderBy: { recordedAt: 'desc' },
      include: { recordedBy: { select: { name: true } } },
    }),
    prisma.medicalEvent.findFirst({
      where: { patientId: params.patientId },
      orderBy: { date: 'desc' },
    }),
    prisma.medicalFile.count({ where: { patientId: params.patientId } }),
  ]);

  const slots = getDaySchedule(meds, today);
  const pendingDoses = slots.filter((s) => !s.log);
  const takenDoses = slots.filter((s) => s.log && s.log.status === 'TAKEN');
  const issueDoses = slots.filter((s) => s.log && s.log.status !== 'TAKEN');

  const isAdmin = canEditPatientData(access.patientRole);
  const canRegister = canRegisterDailyCare(access.patientRole);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href="/pacientes" className="hover:text-brand">← Pacientes</Link>
        </p>
        <h1 className="text-2xl font-bold mt-1">{patient.fullName}</h1>
        <p className="text-slate-600">{calculateAge(patient.birthDate)} años</p>
      </div>

      {patient.importantNotes && (
        <div className="card bg-amber-50 border-amber-300">
          <p className="text-sm font-semibold text-amber-900">Indicaciones importantes</p>
          <p className="text-sm text-amber-900 mt-1 whitespace-pre-line">{patient.importantNotes}</p>
        </div>
      )}

      {openAlerts.length > 0 && (
        <div className="card border-red-300">
          <p className="font-semibold text-red-900">Alertas activas ({openAlerts.length})</p>
          <ul className="mt-2 space-y-1">
            {openAlerts.map((a) => (
              <li key={a.id} className="text-sm text-red-800">• {a.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Resumen del día */}
      <section className="grid sm:grid-cols-2 gap-3">
        <MedSummaryCard
          pending={pendingDoses.length}
          taken={takenDoses.length}
          issues={issueDoses.length}
          href={`/pacientes/${patient.id}/medicacion`}
        />
        <VitalCard vital={lastVital} href={`/pacientes/${patient.id}/presion`} />
        <MealCard meal={lastMeal} href={`/pacientes/${patient.id}/alimentacion`} />
        <StatusTodayCard hasToday={!!lastStatus} href={`/pacientes/${patient.id}/estado`} />
        <MedicalHistoryCard
          lastEvent={lastEvent}
          filesCount={filesCount}
          href={`/pacientes/${patient.id}/historial`}
        />
      </section>

      {/* Acciones de cuidado */}
      {canRegister && (
        <section>
          <h2 className="font-semibold mb-2">Registrar ahora</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <BigAction emoji="💊" title="Medicación" href={`/pacientes/${patient.id}/medicacion`} />
            <BigAction emoji="🩺" title="Presión" href={`/pacientes/${patient.id}/presion`} />
            <BigAction emoji="🍽️" title="Comida" href={`/pacientes/${patient.id}/alimentacion`} />
            <BigAction emoji="😊" title="Estado" href={`/pacientes/${patient.id}/estado`} />
          </div>
        </section>
      )}

      {lastCaregiverLog && (
        <div className="card text-sm text-slate-600">
          Último registro de cuidadora: <strong>{lastCaregiverLog.recordedBy.name}</strong>,{' '}
          {relativeFromNow(lastCaregiverLog.recordedAt)} ·{' '}
          {TAKE_STATUS_LABEL[lastCaregiverLog.status]}
        </div>
      )}

      {isAdmin && (
        <section>
          <h2 className="font-semibold mb-2">Administración</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <ActionCard emoji="✏️" title="Editar datos del paciente" href={`/pacientes/${patient.id}/editar`} />
            <ActionCard emoji="🩺" title="Configurar rangos médicos" href={`/pacientes/${patient.id}/rangos`} />
            <ActionCard emoji="💊" title="Configurar medicación" href={`/pacientes/${patient.id}/medicacion/configurar`} />
            <ActionCard emoji="👥" title="Personas y permisos" href={`/pacientes/${patient.id}/usuarios`} />
            <ActionCard emoji="📋" title="Historial médico" href={`/pacientes/${patient.id}/historial`} />
            <ActionCard emoji="📎" title="Archivos médicos" href={`/pacientes/${patient.id}/archivos`} />
          </div>
        </section>
      )}
    </div>
  );
}

function MedSummaryCard({
  pending, taken, issues, href,
}: { pending: number; taken: number; issues: number; href: string }) {
  return (
    <Link href={href} className="card hover:border-brand hover:shadow-md transition">
      <p className="text-sm text-slate-600">Medicación de hoy</p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-3xl font-bold text-brand">{pending}</span>
        <span className="text-slate-600">pendientes</span>
      </div>
      <p className="text-sm text-slate-500 mt-1">
        {taken} tomadas{issues > 0 && ` · ${issues} con observación`}
      </p>
    </Link>
  );
}

function VitalCard({
  vital, href,
}: { vital: { systolic: number; diastolic: number; pulse: number | null; recordedAt: Date; status: keyof typeof VITAL_STATUS_STYLE; recordedBy: { name: string } } | null; href: string }) {
  if (!vital) {
    return (
      <Link href={href} className="card hover:border-brand hover:shadow-md transition">
        <p className="text-sm text-slate-600">Última presión</p>
        <p className="text-slate-500 mt-2">Sin registros aún</p>
      </Link>
    );
  }
  const style = VITAL_STATUS_STYLE[vital.status];
  return (
    <Link href={href} className="card hover:border-brand hover:shadow-md transition">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Última presión</p>
        <span className={`text-xs font-semibold rounded-full px-2 py-1 ${style.bg} ${style.text}`}>{style.label}</span>
      </div>
      <p className="text-2xl font-bold mt-2">
        {vital.systolic}<span className="text-slate-400">/</span>{vital.diastolic}
      </p>
      <p className="text-xs text-slate-500 mt-1">
        {formatDateTime(vital.recordedAt)} · {vital.recordedBy.name}
      </p>
    </Link>
  );
}

function MealCard({
  meal, href,
}: { meal: { mealType: string; date: Date; intake: string; recordedBy: { name: string } } | null; href: string }) {
  if (!meal) {
    return (
      <Link href={href} className="card hover:border-brand hover:shadow-md transition">
        <p className="text-sm text-slate-600">Última comida</p>
        <p className="text-slate-500 mt-2">Sin registros</p>
      </Link>
    );
  }
  return (
    <Link href={href} className="card hover:border-brand hover:shadow-md transition">
      <p className="text-sm text-slate-600">Última comida</p>
      <p className="font-semibold mt-2">{mealLabel(meal.mealType)}</p>
      <p className="text-xs text-slate-500 mt-1">
        {formatTime(meal.date)} · {meal.recordedBy.name}
      </p>
    </Link>
  );
}

function StatusTodayCard({ hasToday, href }: { hasToday: boolean; href: string }) {
  return (
    <Link href={href} className="card hover:border-brand hover:shadow-md transition">
      <p className="text-sm text-slate-600">Estado general</p>
      <p className="font-semibold mt-2">{hasToday ? 'Registrado hoy' : 'Sin registrar hoy'}</p>
    </Link>
  );
}

function MedicalHistoryCard({
  lastEvent, filesCount, href,
}: {
  lastEvent: { type: keyof typeof MEDICAL_EVENT_LABEL; date: Date } | null;
  filesCount: number;
  href: string;
}) {
  return (
    <Link href={href} className="card hover:border-brand hover:shadow-md transition">
      <p className="text-sm text-slate-600">Historial médico</p>
      {lastEvent ? (
        <>
          <p className="font-semibold mt-2">
            {MEDICAL_EVENT_EMOJI[lastEvent.type]} {MEDICAL_EVENT_LABEL[lastEvent.type]}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(lastEvent.date)}
            {' · '}{filesCount} archivo{filesCount === 1 ? '' : 's'}
          </p>
        </>
      ) : (
        <p className="text-slate-500 mt-2">Sin eventos cargados</p>
      )}
    </Link>
  );
}

function mealLabel(t: string) {
  switch (t) {
    case 'BREAKFAST': return 'Desayuno';
    case 'LUNCH': return 'Almuerzo';
    case 'SNACK': return 'Merienda';
    case 'DINNER': return 'Cena';
    default: return t;
  }
}

function BigAction({ emoji, title, href }: { emoji: string; title: string; href: string }) {
  return (
    <Link
      href={href}
      className="card flex flex-col items-center justify-center gap-2 hover:border-brand hover:shadow-md transition py-5"
    >
      <span className="text-3xl">{emoji}</span>
      <span className="font-semibold text-sm text-center">{title}</span>
    </Link>
  );
}

function ActionCard({ emoji, title, href }: { emoji: string; title: string; href: string }) {
  return (
    <Link href={href} className="card flex items-center gap-3 hover:border-brand hover:shadow-md transition">
      <span className="text-2xl">{emoji}</span>
      <span className="font-semibold">{title}</span>
    </Link>
  );
}
