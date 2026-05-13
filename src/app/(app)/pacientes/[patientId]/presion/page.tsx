import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditPatientData, canRegisterDailyCare, getPatientAccess } from '@/lib/permissions';
import { classifyBloodPressure, VITAL_STATUS_STYLE } from '@/lib/vitals';
import { formatDateTime } from '@/lib/date';

async function recordVital(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canRegisterDailyCare(access.patientRole)) throw new Error('No autorizado');

  const systolic = parseInt(String(formData.get('systolic')), 10);
  const diastolic = parseInt(String(formData.get('diastolic')), 10);
  const pulseRaw = String(formData.get('pulse') || '');
  const pulse = pulseRaw ? parseInt(pulseRaw, 10) : null;
  const notes = String(formData.get('notes') || '').trim() || null;

  if (!systolic || !diastolic) throw new Error('Presión sistólica y diastólica son obligatorias');

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new Error('Paciente no encontrado');
  const status = classifyBloodPressure(systolic, diastolic, patient);

  await prisma.vitalSign.create({
    data: {
      patientId,
      systolic,
      diastolic,
      pulse,
      notes,
      recordedAt: new Date(),
      status,
      recordedById: session.user.id,
    },
  });

  revalidatePath(`/pacientes/${patientId}/presion`);
  revalidatePath(`/pacientes/${patientId}`);
}

export default async function VitalsPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const patient = await prisma.patient.findUnique({ where: { id: params.patientId } });
  if (!patient) notFound();

  const recent = await prisma.vitalSign.findMany({
    where: { patientId: params.patientId },
    orderBy: { recordedAt: 'desc' },
    take: 5,
    include: { recordedBy: { select: { name: true } } },
  });

  const hasRanges =
    patient.sysNormalMin != null &&
    patient.sysNormalMax != null &&
    patient.diaNormalMin != null &&
    patient.diaNormalMax != null;

  const canEdit = canEditPatientData(access.patientRole);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Presión arterial</h1>
      </div>

      {!hasRanges && (
        <div className="card bg-amber-50 border-amber-300">
          <p className="text-amber-900 font-semibold">No hay rangos médicos configurados</p>
          <p className="text-sm text-amber-800 mt-1">
            Los valores se registran sin clasificar. {canEdit && (
              <Link href={`/pacientes/${params.patientId}/editar`} className="underline">
                Configurar rangos
              </Link>
            )}
          </p>
        </div>
      )}

      <form action={recordVital} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />
        <h2 className="font-semibold">Nuevo registro</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Sistólica *</label>
            <input
              name="systolic"
              type="number"
              inputMode="numeric"
              min={50}
              max={260}
              required
              className="input text-2xl text-center font-semibold"
              placeholder="120"
            />
          </div>
          <div>
            <label className="label">Diastólica *</label>
            <input
              name="diastolic"
              type="number"
              inputMode="numeric"
              min={30}
              max={180}
              required
              className="input text-2xl text-center font-semibold"
              placeholder="80"
            />
          </div>
        </div>

        <div>
          <label className="label">Pulso</label>
          <input
            name="pulse"
            type="number"
            inputMode="numeric"
            min={30}
            max={220}
            className="input"
            placeholder="opcional"
          />
        </div>

        <div>
          <label className="label">Observación</label>
          <textarea name="notes" rows={2} className="input" placeholder="opcional" />
        </div>

        <button type="submit" className="btn-primary btn-lg w-full">Guardar</button>
      </form>

      {recent.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">Últimos registros</h2>
          <div className="space-y-2">
            {recent.map((r) => {
              const style = VITAL_STATUS_STYLE[r.status];
              return (
                <div key={r.id} className="card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xl font-bold">
                        {r.systolic}<span className="text-slate-400">/</span>{r.diastolic}
                        {r.pulse && <span className="text-base font-normal text-slate-600"> · pulso {r.pulse}</span>}
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatDateTime(r.recordedAt)} · {r.recordedBy.name}
                      </p>
                      {r.notes && <p className="text-sm text-slate-600 mt-1">{r.notes}</p>}
                    </div>
                    <span className={`text-xs font-semibold rounded-full px-2 py-1 ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
