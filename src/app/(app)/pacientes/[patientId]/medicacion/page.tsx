import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditPatientData, canRegisterDailyCare, getPatientAccess } from '@/lib/permissions';
import { getDaySchedule, TAKE_STATUS_LABEL } from '@/lib/medication-day';
import { formatTime, startOfToday, endOfToday } from '@/lib/date';
import { TakeStatus, TimeSlot } from '@prisma/client';

async function recordTake(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const medicationId = String(formData.get('medicationId'));
  const scheduleSlot = String(formData.get('scheduleSlot')) as TimeSlot;
  const scheduledFor = new Date(String(formData.get('scheduledFor')));
  const status = String(formData.get('status')) as TakeStatus;
  const notes = String(formData.get('notes') || '').trim() || null;
  const reason = String(formData.get('reason') || '').trim() || null;

  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canRegisterDailyCare(access.patientRole)) throw new Error('No autorizado');

  await prisma.medicationLog.create({
    data: {
      medicationId,
      scheduleSlot,
      scheduledFor,
      status,
      actualTime: new Date(),
      notes,
      reason,
      recordedById: session.user.id,
    },
  });

  revalidatePath(`/pacientes/${patientId}/medicacion`);
  revalidatePath(`/pacientes/${patientId}`);
}

export default async function MedicationTodayPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const today = startOfToday();
  const meds = await prisma.medication.findMany({
    where: { patientId: params.patientId },
    include: {
      schedules: true,
      logs: { where: { scheduledFor: { gte: today, lte: endOfToday() } } },
    },
  });

  const slots = getDaySchedule(meds, today);
  const pending = slots.filter((s) => !s.log);
  const done = slots.filter((s) => s.log);
  const canConfigure = canEditPatientData(access.patientRole);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver</Link>
          </p>
          <h1 className="text-xl font-bold mt-1">Medicación de hoy</h1>
        </div>
        {canConfigure && (
          <Link href={`/pacientes/${params.patientId}/medicacion/configurar`} className="btn-secondary text-sm">
            Configurar
          </Link>
        )}
      </div>

      {slots.length === 0 && (
        <div className="card text-center py-8 text-slate-600">No hay medicación configurada para hoy.</div>
      )}

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">Pendientes ({pending.length})</h2>
          {pending.map((s) => (
            <PendingDose
              key={`${s.medication.id}-${s.schedule.id}`}
              slot={s}
              patientId={params.patientId}
              action={recordTake}
            />
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Ya registradas ({done.length})</h2>
          {done.map((s) => (
            <div key={`${s.medication.id}-${s.schedule.id}`} className="card flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{s.medication.name} <span className="font-normal text-slate-600">— {s.medication.dose}</span></p>
                <p className="text-sm text-slate-600">
                  {s.slotLabel} · {s.log!.actualTime ? formatTime(s.log!.actualTime) : ''}
                </p>
              </div>
              <span className={`text-xs font-semibold rounded-full px-2 py-1 ${takeStatusStyle(s.log!.status)}`}>
                {TAKE_STATUS_LABEL[s.log!.status]}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function takeStatusStyle(status: TakeStatus) {
  switch (status) {
    case 'TAKEN': return 'bg-green-100 text-green-800';
    case 'NOT_TAKEN': return 'bg-red-100 text-red-800';
    case 'REFUSED': return 'bg-amber-100 text-amber-800';
    case 'DELAYED': return 'bg-blue-100 text-blue-800';
  }
}

function PendingDose({
  slot,
  patientId,
  action,
}: {
  slot: ReturnType<typeof getDaySchedule>[number];
  patientId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{slot.medication.name}</p>
          <p className="text-slate-700">{slot.medication.dose}</p>
          {slot.medication.instructions && (
            <p className="text-sm text-slate-500 mt-1">{slot.medication.instructions}</p>
          )}
        </div>
        <span className="rounded-full bg-brand-50 text-brand-700 font-semibold px-3 py-1 text-sm whitespace-nowrap">
          {slot.slotLabel}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['TAKEN', 'NOT_TAKEN', 'REFUSED', 'DELAYED'] as TakeStatus[]).map((status) => (
          <form key={status} action={action}>
            <input type="hidden" name="patientId" value={patientId} />
            <input type="hidden" name="medicationId" value={slot.medication.id} />
            <input type="hidden" name="scheduleSlot" value={slot.schedule.timeSlot} />
            <input type="hidden" name="scheduledFor" value={slot.scheduledAt.toISOString()} />
            <input type="hidden" name="status" value={status} />
            <button
              type="submit"
              className={`btn-lg w-full ${
                status === 'TAKEN' ? 'btn-success' :
                status === 'NOT_TAKEN' ? 'btn-danger' :
                'btn-secondary'
              }`}
            >
              {TAKE_STATUS_LABEL[status]}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
