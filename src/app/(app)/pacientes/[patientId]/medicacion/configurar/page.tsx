import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditPatientData, getPatientAccess } from '@/lib/permissions';
import { MedStatus, TimeSlot } from '@prisma/client';
import { SLOT_LABEL } from '@/lib/medication-day';

async function createMedication(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) throw new Error('No autorizado');

  const name = String(formData.get('name') || '').trim();
  const dose = String(formData.get('dose') || '').trim();
  if (!name || !dose) throw new Error('Faltan datos');

  const slots = (formData.getAll('slots') as string[]) as TimeSlot[];
  const customTimesRaw = String(formData.get('customTimes') || '').trim();
  const customTimes = customTimesRaw
    ? customTimesRaw.split(',').map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s))
    : [];

  if (slots.length === 0 && customTimes.length === 0) {
    throw new Error('Configurá al menos un horario');
  }

  const startDate = String(formData.get('startDate') || '');
  const endDate = String(formData.get('endDate') || '');
  const prescriptionExpiry = String(formData.get('prescriptionExpiry') || '');

  await prisma.medication.create({
    data: {
      patientId,
      name,
      dose,
      frequencyText: optString(formData.get('frequencyText')),
      instructions: optString(formData.get('instructions')),
      prescribingDoctor: optString(formData.get('prescribingDoctor')),
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      prescriptionExpiry: prescriptionExpiry ? new Date(prescriptionExpiry) : null,
      status: MedStatus.ACTIVE,
      createdById: session.user.id,
      schedules: {
        create: [
          ...slots.map((s) => ({ timeSlot: s })),
          ...customTimes.map((t) => ({ timeSlot: TimeSlot.CUSTOM, customTime: t })),
        ],
      },
    },
  });

  revalidatePath(`/pacientes/${patientId}/medicacion/configurar`);
}

async function updateStatus(formData: FormData) {
  'use server';
  const medicationId = String(formData.get('medicationId'));
  const patientId = String(formData.get('patientId'));
  const status = String(formData.get('status')) as MedStatus;
  const suspendUntilRaw = String(formData.get('suspendedUntil') || '');
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) throw new Error('No autorizado');

  await prisma.medication.update({
    where: { id: medicationId },
    data: {
      status,
      suspendedUntil:
        status === MedStatus.SUSPENDED && suspendUntilRaw ? new Date(suspendUntilRaw) : null,
    },
  });
  revalidatePath(`/pacientes/${patientId}/medicacion/configurar`);
}

function optString(v: FormDataEntryValue | null) {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}

export default async function MedicationConfigPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canEditPatientData(access.patientRole)) redirect(`/pacientes/${params.patientId}`);

  const meds = await prisma.medication.findMany({
    where: { patientId: params.patientId },
    include: { schedules: true },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver al paciente</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Configurar medicación</h1>
      </div>

      <form action={createMedication} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />
        <h2 className="font-semibold">Nuevo medicamento</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre *</label>
            <input name="name" required className="input" placeholder="Enalapril" />
          </div>
          <div>
            <label className="label">Dosis *</label>
            <input name="dose" required className="input" placeholder="10 mg" />
          </div>
        </div>

        <div>
          <label className="label">Frecuencia (texto libre)</label>
          <input name="frequencyText" className="input" placeholder="ej.: cada 8 hs, 1 vez por día" />
        </div>

        <div>
          <label className="label">Indicaciones</label>
          <input name="instructions" className="input" placeholder="Con agua, después de comer…" />
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Inicio</label>
            <input name="startDate" type="date" className="input" />
          </div>
          <div>
            <label className="label">Fin (opcional)</label>
            <input name="endDate" type="date" className="input" />
          </div>
          <div>
            <label className="label">Vence receta</label>
            <input name="prescriptionExpiry" type="date" className="input" />
          </div>
        </div>

        <div>
          <label className="label">Horarios fijos</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['MORNING', 'NOON', 'AFTERNOON', 'NIGHT'] as TimeSlot[]).map((s) => (
              <label key={s} className="flex items-center gap-2 card cursor-pointer p-3 has-[:checked]:border-brand">
                <input type="checkbox" name="slots" value={s} className="size-5" />
                <span className="font-medium">{SLOT_LABEL[s]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Horarios personalizados (opcional)</label>
          <input
            name="customTimes"
            className="input"
            placeholder="ej.: 07:30, 14:00, 22:00"
          />
          <p className="text-xs text-slate-500 mt-1">Separá los horarios con coma. Formato HH:MM.</p>
        </div>

        <div>
          <label className="label">Médico que lo indicó</label>
          <input name="prescribingDoctor" className="input" />
        </div>

        <button type="submit" className="btn-primary btn-lg w-full">Agregar medicamento</button>
      </form>

      <div className="space-y-3">
        <h2 className="font-semibold">Medicación cargada</h2>
        {meds.length === 0 ? (
          <p className="text-slate-600 text-sm">Aún no hay medicamentos cargados.</p>
        ) : (
          meds.map((m) => (
            <div key={m.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{m.name} <span className="font-normal text-slate-600">— {m.dose}</span></p>
                  {m.frequencyText && <p className="text-sm text-slate-600">{m.frequencyText}</p>}
                  {m.instructions && <p className="text-sm text-slate-600 mt-1">{m.instructions}</p>}
                  <p className="text-sm text-slate-600 mt-1">
                    Horarios: {m.schedules.map((s) => s.timeSlot === 'CUSTOM' ? s.customTime : SLOT_LABEL[s.timeSlot]).join(', ') || '—'}
                  </p>
                  {m.prescriptionExpiry && (
                    <p className="text-sm text-slate-600">
                      Receta vence: {new Intl.DateTimeFormat('es-AR').format(m.prescriptionExpiry)}
                    </p>
                  )}
                  {m.status === 'SUSPENDED' && m.suspendedUntil && (
                    <p className="text-sm text-amber-700">
                      Suspendido hasta: {new Intl.DateTimeFormat('es-AR').format(m.suspendedUntil)}
                    </p>
                  )}
                </div>
                <span className={`text-xs font-semibold rounded-full px-2 py-1 ${
                  m.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                  m.status === 'SUSPENDED' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-200 text-slate-700'
                }`}>
                  {m.status === 'ACTIVE' ? 'Activo' : m.status === 'SUSPENDED' ? 'Suspendido' : 'Finalizado'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 items-center">
                {m.status !== 'ACTIVE' && (
                  <form action={updateStatus}>
                    <input type="hidden" name="medicationId" value={m.id} />
                    <input type="hidden" name="patientId" value={params.patientId} />
                    <input type="hidden" name="status" value="ACTIVE" />
                    <button className="btn-secondary text-sm">Activar</button>
                  </form>
                )}
                {m.status !== 'SUSPENDED' && (
                  <form action={updateStatus} className="flex items-center gap-2">
                    <input type="hidden" name="medicationId" value={m.id} />
                    <input type="hidden" name="patientId" value={params.patientId} />
                    <input type="hidden" name="status" value="SUSPENDED" />
                    <input type="date" name="suspendedUntil" className="input text-sm py-2" title="Suspender hasta" />
                    <button className="btn-secondary text-sm">Suspender</button>
                  </form>
                )}
                {m.status !== 'FINISHED' && (
                  <form action={updateStatus}>
                    <input type="hidden" name="medicationId" value={m.id} />
                    <input type="hidden" name="patientId" value={params.patientId} />
                    <input type="hidden" name="status" value="FINISHED" />
                    <button className="btn-secondary text-sm">Finalizar</button>
                  </form>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
