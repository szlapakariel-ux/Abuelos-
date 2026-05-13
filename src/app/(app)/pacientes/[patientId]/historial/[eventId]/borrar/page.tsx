import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteMedicalRecords, getPatientAccess } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { MEDICAL_EVENT_LABEL } from '@/lib/files';
import { formatDate } from '@/lib/utils';

async function deleteEvent(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const eventId = String(formData.get('eventId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canDeleteMedicalRecords(access)) throw new Error('No autorizado');

  const ev = await prisma.medicalEvent.findUnique({
    where: { id: eventId },
    include: { _count: { select: { files: true } } },
  });
  if (!ev || ev.patientId !== patientId) throw new Error('Evento no encontrado');

  // Opción A: bloquear borrado si tiene archivos asociados.
  if (ev._count.files > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'medicalEvent.delete.blocked',
      entityType: 'MedicalEvent',
      entityId: eventId,
      metadata: { patientId, reason: 'has_files', filesCount: ev._count.files },
    });
    throw new Error('Borrá primero los archivos adjuntos para poder borrar el evento.');
  }

  await prisma.medicalEvent.delete({ where: { id: eventId } });
  await logAudit({
    userId: session.user.id,
    action: 'medicalEvent.delete',
    entityType: 'MedicalEvent',
    entityId: eventId,
    metadata: { patientId, type: ev.type, date: ev.date.toISOString() },
  });

  revalidatePath(`/pacientes/${patientId}/historial`);
  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/pacientes/${patientId}/historial`);
}

export default async function DeleteEventPage({ params }: { params: { patientId: string; eventId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canDeleteMedicalRecords(access)) redirect(`/pacientes/${params.patientId}/historial`);

  const ev = await prisma.medicalEvent.findUnique({
    where: { id: params.eventId },
    include: {
      _count: { select: { files: true } },
      files: { select: { id: true, name: true } },
    },
  });
  if (!ev || ev.patientId !== params.patientId) notFound();

  const blocked = ev._count.files > 0;

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/historial`} className="hover:text-brand">
            ← Volver al historial
          </Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Borrar evento médico</h1>
      </div>

      <div className="card">
        <p className="font-semibold">{MEDICAL_EVENT_LABEL[ev.type]}</p>
        <p className="text-sm text-slate-600">{formatDate(ev.date, { dateStyle: 'long' })}</p>
        {ev.professional && <p className="text-sm text-slate-700 mt-1">{ev.professional}</p>}
        {ev.summary && <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{ev.summary}</p>}
      </div>

      {blocked ? (
        <div className="card bg-amber-50 border-amber-300">
          <p className="font-semibold text-amber-900">
            No se puede borrar: el evento tiene {ev._count.files} archivo{ev._count.files === 1 ? '' : 's'} adjunto{ev._count.files === 1 ? '' : 's'}.
          </p>
          <p className="text-sm text-amber-900 mt-1">
            Borrá primero cada archivo desde su detalle, después podés borrar el evento.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {ev.files.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/pacientes/${params.patientId}/archivos/${f.id}/editar`}
                  className="text-brand hover:underline"
                >
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={`/pacientes/${params.patientId}/historial`} className="btn-secondary mt-4 inline-flex">
            Volver
          </Link>
        </div>
      ) : (
        <form action={deleteEvent} className="card space-y-3">
          <input type="hidden" name="patientId" value={params.patientId} />
          <input type="hidden" name="eventId" value={ev.id} />
          <p className="text-slate-700">
            Esta acción no se puede deshacer. ¿Confirmás el borrado de este evento?
          </p>
          <div className="flex gap-3">
            <button type="submit" className="btn-danger btn-lg flex-1">Sí, borrar</button>
            <Link href={`/pacientes/${params.patientId}/historial`} className="btn-secondary btn-lg">
              Cancelar
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
