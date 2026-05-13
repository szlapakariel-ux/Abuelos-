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
  FILE_CATEGORY_LABEL,
  MAX_FILE_SIZE_LABEL,
  buildMedicalFileSearchText,
  validateFile,
} from '@/lib/files';
import { FileCategory } from '@prisma/client';

async function uploadStandalone(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canUploadFilesFor(access)) throw new Error('No autorizado');

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) throw new Error('Tenés que elegir un archivo.');

  const err = validateFile(file);
  if (err) throw new Error(err.message);

  const category = String(formData.get('category')) as FileCategory;
  const description = optString(formData.get('description'));

  // 1) Subir a R2
  const key = buildStorageKey({ patientId, filename: file.name });
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadFile({ key, body: buffer, contentType: file.type });
  } catch (e) {
    console.error('[file-standalone] upload R2 falló', e);
    throw new Error('No pudimos subir el archivo. Probá de nuevo.');
  }

  // 2) Crear metadata en DB; si falla, borrar de R2.
  let createdId: string;
  try {
    const created = await prisma.medicalFile.create({
      data: {
        patientId,
        name: file.name,
        description,
        mimeType: file.type,
        sizeBytes: file.size,
        storageKey: key,
        category,
        uploadedById: session.user.id,
        searchText: buildMedicalFileSearchText({ name: file.name, description, category }),
      },
      select: { id: true },
    });
    createdId = created.id;
  } catch (e) {
    await deleteFile(key).catch(() => {});
    console.error('[file-standalone] DB falló', e);
    throw new Error('No pudimos guardar el archivo. Intentá nuevamente.');
  }

  await logAudit({
    userId: session.user.id,
    action: 'medicalFile.upload.standalone',
    entityType: 'MedicalFile',
    entityId: createdId,
    metadata: { patientId, name: file.name, sizeBytes: file.size, category },
  });

  revalidatePath(`/pacientes/${patientId}/historial`);
  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/pacientes/${patientId}/historial`);
}

function optString(v: FormDataEntryValue | null): string | null {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}

export default async function NewStandaloneFilePage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canUploadFilesFor(access)) redirect(`/pacientes/${params.patientId}/historial`);

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/historial`} className="hover:text-brand">
            ← Volver al historial
          </Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Subir archivo suelto</h1>
        <p className="text-sm text-slate-600 mt-1">
          Para archivos médicos que no están asociados a un evento puntual.
        </p>
      </div>

      <form action={uploadStandalone} encType="multipart/form-data" className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />

        <div>
          <label className="label">Archivo *</label>
          <input
            name="file"
            type="file"
            required
            accept={ALLOWED_MIME_TYPES.join(',')}
            className="input"
          />
          <p className="text-xs text-slate-500 mt-1">
            Formatos: {ALLOWED_EXTENSIONS_LABEL}. Máximo {MAX_FILE_SIZE_LABEL}.
          </p>
        </div>

        <div>
          <label className="label">Categoría</label>
          <select name="category" defaultValue="OTHER" className="input">
            {(Object.keys(FILE_CATEGORY_LABEL) as FileCategory[]).map((c) => (
              <option key={c} value={c}>{FILE_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Descripción</label>
          <textarea name="description" rows={3} className="input" placeholder="opcional" />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Subir archivo</button>
          <Link href={`/pacientes/${params.patientId}/historial`} className="btn-secondary btn-lg">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
