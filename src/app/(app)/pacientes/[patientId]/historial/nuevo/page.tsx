import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canUploadFilesFor, getPatientAccess } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { buildStorageKey, deleteFile, uploadFile } from '@/lib/storage';
import {
  ALLOWED_EXTENSIONS_LABEL,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_LABEL,
  MEDICAL_EVENT_LABEL,
  buildMedicalEventSearchText,
  buildMedicalFileSearchText,
  defaultFileCategoryForEvent,
  validateFile,
} from '@/lib/files';
import { MedicalEventType, type FileCategory } from '@prisma/client';
import { todayStringAR } from '@/lib/date';

async function createMedicalEvent(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canUploadFilesFor(access)) throw new Error('No autorizado');

  const type = String(formData.get('type')) as MedicalEventType;
  const dateRaw = String(formData.get('date') || '');
  if (!type || !dateRaw) throw new Error('Tipo de evento y fecha son obligatorios');

  const data = {
    patientId,
    type,
    date: new Date(dateRaw),
    professional: optString(formData.get('professional')),
    institution: optString(formData.get('institution')),
    reason: optString(formData.get('reason')),
    summary: optString(formData.get('summary')),
    indications: optString(formData.get('indications')),
    nextAppointment: optDate(formData.get('nextAppointment')),
    notes: optString(formData.get('notes')),
    uploadedById: session.user.id,
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

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  // Validar archivos ANTES de tocar R2 o DB.
  for (const file of files) {
    const err = validateFile(file);
    if (err) throw new Error(err.message);
  }

  // 1) Subir todos los archivos a R2. Si alguno falla, hacer rollback compensatorio.
  const uploadedKeys: string[] = [];
  const uploadedMeta: Array<{
    storageKey: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    category: FileCategory;
  }> = [];
  try {
    for (const file of files) {
      const key = buildStorageKey({ patientId, filename: file.name });
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadFile({ key, body: buffer, contentType: file.type });
      uploadedKeys.push(key);
      uploadedMeta.push({
        storageKey: key,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        category: defaultFileCategoryForEvent(type),
      });
    }
  } catch (err) {
    // Rollback: borrar lo subido para no dejar huérfanos.
    await Promise.allSettled(uploadedKeys.map((k) => deleteFile(k)));
    console.error('[medical-event] error al subir archivos', err);
    throw new Error('No pudimos subir los archivos. Probá de nuevo.');
  }

  // 2) Crear evento + archivos en DB. Si la DB falla, también borramos de R2.
  let createdEventId: string;
  try {
    const event = await prisma.medicalEvent.create({
      data: {
        ...data,
        searchText,
        files: {
          create: uploadedMeta.map((m) => ({
            patientId,
            name: m.name,
            mimeType: m.mimeType,
            sizeBytes: m.sizeBytes,
            storageKey: m.storageKey,
            category: m.category,
            uploadedById: session.user.id,
            searchText: buildMedicalFileSearchText({ name: m.name, description: null, category: m.category }),
          })),
        },
      },
      select: { id: true },
    });
    createdEventId = event.id;
  } catch (err) {
    await Promise.allSettled(uploadedKeys.map((k) => deleteFile(k)));
    console.error('[medical-event] error al guardar en DB', err);
    throw new Error('No pudimos guardar el evento. Intentá nuevamente.');
  }

  await logAudit({
    userId: session.user.id,
    action: 'medicalEvent.create',
    entityType: 'MedicalEvent',
    entityId: createdEventId,
    metadata: { patientId, type, filesCount: uploadedMeta.length },
  });
  for (const m of uploadedMeta) {
    await logAudit({
      userId: session.user.id,
      action: 'medicalFile.upload',
      entityType: 'MedicalFile',
      metadata: { patientId, medicalEventId: createdEventId, name: m.name, sizeBytes: m.sizeBytes },
    });
  }

  revalidatePath(`/pacientes/${patientId}/historial`);
  revalidatePath(`/pacientes/${patientId}`);
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

export default async function NewMedicalEventPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canUploadFilesFor(access)) redirect(`/pacientes/${params.patientId}/historial`);

  const today = todayStringAR();

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/historial`} className="hover:text-brand">
            ← Volver al historial
          </Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Nuevo evento médico</h1>
      </div>

      <form action={createMedicalEvent} encType="multipart/form-data" className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tipo de evento *">
            <select name="type" required defaultValue="CONSULTATION" className="input">
              {(Object.keys(MEDICAL_EVENT_LABEL) as MedicalEventType[]).map((t) => (
                <option key={t} value={t}>{MEDICAL_EVENT_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha *">
            <input type="date" name="date" required defaultValue={today} className="input" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Profesional">
            <input name="professional" className="input" placeholder="Dr/a..." />
          </Field>
          <Field label="Institución">
            <input name="institution" className="input" placeholder="Hospital, sanatorio..." />
          </Field>
        </div>

        <Field label="Motivo"><input name="reason" className="input" /></Field>
        <Field label="Resumen">
          <textarea name="summary" rows={3} className="input" />
        </Field>
        <Field label="Indicaciones">
          <textarea name="indications" rows={3} className="input" />
        </Field>
        <Field label="Próximo control">
          <input type="date" name="nextAppointment" className="input" />
        </Field>
        <Field label="Observaciones">
          <textarea name="notes" rows={2} className="input" />
        </Field>

        <div>
          <label className="label">Archivos adjuntos</label>
          <input
            name="files"
            type="file"
            multiple
            accept={ALLOWED_MIME_TYPES.join(',')}
            className="input"
          />
          <p className="text-xs text-slate-500 mt-1">
            Formatos: {ALLOWED_EXTENSIONS_LABEL}. Máximo {MAX_FILE_SIZE_LABEL} por archivo.
          </p>
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Guardar evento</button>
          <Link href={`/pacientes/${params.patientId}/historial`} className="btn-secondary btn-lg">
            Cancelar
          </Link>
        </div>
      </form>
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
