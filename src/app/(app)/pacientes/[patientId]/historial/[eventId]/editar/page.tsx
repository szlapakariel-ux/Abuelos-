import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteMedicalRecords, canUploadFilesFor, getPatientAccess } from '@/lib/permissions';
import { diffFields, logAudit } from '@/lib/audit';
import { buildMedicalEventSearchText, MEDICAL_EVENT_LABEL } from '@/lib/files';
import { MedicalEventType } from '@prisma/client';

const EVENT_FIELDS = [
  'type', 'date', 'professional', 'institution', 'reason',
  'summary', 'indications', 'nextAppointment', 'notes',
] as const;

async function updateEvent(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const eventId = String(formData.get('eventId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canUploadFilesFor(access)) throw new Error('No autorizado');

  const before = await prisma.medicalEvent.findUnique({ where: { id: eventId } });
  if (!before || before.patientId !== patientId) throw new Error('Evento no encontrado');

  const type = String(formData.get('type')) as MedicalEventType;
  const dateRaw = String(formData.get('date') || '');
  if (!type || !dateRaw) throw new Error('Tipo y fecha son obligatorios');

  const data = {
    type,
    date: new Date(dateRaw),
    professional: optString(formData.get('professional')),
    institution: optString(formData.get('institution')),
    reason: optString(formData.get('reason')),
    summary: optString(formData.get('summary')),
    indications: optString(formData.get('indications')),
    nextAppointment: optDate(formData.get('nextAppointment')),
    notes: optString(formData.get('notes')),
  };

  const searchText = buildMedicalEventSearchText({
    type,
    professional: data.professional,
    institution: data.institution,
    reason: data.reason,
    summary: data.summary,
    indications: data.indications,
    notes: data.notes,
  });

  const after = await prisma.medicalEvent.update({
    where: { id: eventId },
    data: { ...data, searchText },
  });

  const changes = diffFields(before, after, [...EVENT_FIELDS]);
  if (Object.keys(changes).length > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'medicalEvent.update',
      entityType: 'MedicalEvent',
      entityId: eventId,
      metadata: { patientId, fields: Object.keys(changes), changes },
    });
  }

  revalidatePath(`/pacientes/${patientId}/historial`);
  redirect(`/pacientes/${patientId}/historial`);
}

function optString(v: FormDataEntryValue | null): string | null {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}
function optDate(v: FormDataEntryValue | null): Date | null {
  const s = (v ?? '').toString().trim();
  return s ? new Date(s) : null;
}

export default async function EditEventPage({ params }: { params: { patientId: string; eventId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canUploadFilesFor(access)) redirect(`/pacientes/${params.patientId}/historial`);

  const ev = await prisma.medicalEvent.findUnique({
    where: { id: params.eventId },
    include: { _count: { select: { files: true } } },
  });
  if (!ev || ev.patientId !== params.patientId) notFound();

  const dateValue = ev.date.toISOString().slice(0, 10);
  const nextValue = ev.nextAppointment ? ev.nextAppointment.toISOString().slice(0, 10) : '';
  const canDelete = canDeleteMedicalRecords(access);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/historial`} className="hover:text-brand">
            ← Volver al historial
          </Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Editar evento médico</h1>
      </div>

      <form action={updateEvent} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />
        <input type="hidden" name="eventId" value={ev.id} />

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tipo de evento *">
            <select name="type" required defaultValue={ev.type} className="input">
              {(Object.keys(MEDICAL_EVENT_LABEL) as MedicalEventType[]).map((t) => (
                <option key={t} value={t}>{MEDICAL_EVENT_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha *">
            <input type="date" name="date" required defaultValue={dateValue} className="input" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Profesional">
            <input name="professional" defaultValue={ev.professional ?? ''} className="input" />
          </Field>
          <Field label="Institución">
            <input name="institution" defaultValue={ev.institution ?? ''} className="input" />
          </Field>
        </div>

        <Field label="Motivo"><input name="reason" defaultValue={ev.reason ?? ''} className="input" /></Field>
        <Field label="Resumen"><textarea name="summary" rows={3} defaultValue={ev.summary ?? ''} className="input" /></Field>
        <Field label="Indicaciones"><textarea name="indications" rows={3} defaultValue={ev.indications ?? ''} className="input" /></Field>
        <Field label="Próximo control"><input type="date" name="nextAppointment" defaultValue={nextValue} className="input" /></Field>
        <Field label="Observaciones"><textarea name="notes" rows={2} defaultValue={ev.notes ?? ''} className="input" /></Field>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Guardar cambios</button>
          <Link href={`/pacientes/${params.patientId}/historial`} className="btn-secondary btn-lg">
            Cancelar
          </Link>
        </div>
      </form>

      {canDelete && (
        <div className="card border-red-200">
          <p className="font-semibold text-red-900">Borrar evento</p>
          <p className="text-sm text-slate-700 mt-1">
            Los archivos adjuntos a este evento ({ev._count.files}) deben borrarse primero.
          </p>
          <Link
            href={`/pacientes/${params.patientId}/historial/${ev.id}/borrar`}
            className="btn-danger mt-3 inline-flex"
          >
            Continuar al borrado
          </Link>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
