import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteMedicalRecords, canUploadFilesFor, getPatientAccess } from '@/lib/permissions';
import { diffFields, logAudit } from '@/lib/audit';
import { buildMedicalFileSearchText, FILE_CATEGORY_LABEL, formatFileSize } from '@/lib/files';
import { deleteFile as r2Delete } from '@/lib/storage';
import { formatDateTime } from '@/lib/date';
import { FileCategory } from '@prisma/client';

const FILE_FIELDS = ['description', 'category'] as const;

async function updateFileMetadata(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const fileId = String(formData.get('fileId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canUploadFilesFor(access)) throw new Error('No autorizado');

  const before = await prisma.medicalFile.findUnique({ where: { id: fileId } });
  if (!before || before.patientId !== patientId) throw new Error('Archivo no encontrado');

  const description = optString(formData.get('description'));
  const category = String(formData.get('category')) as FileCategory;
  const searchText = buildMedicalFileSearchText({ name: before.name, description, category });

  const after = await prisma.medicalFile.update({
    where: { id: fileId },
    data: { description, category, searchText },
  });

  const changes = diffFields(before, after, [...FILE_FIELDS]);
  if (Object.keys(changes).length > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'medicalFile.metadata.update',
      entityType: 'MedicalFile',
      entityId: fileId,
      metadata: { patientId, changes },
    });
  }

  revalidatePath(`/pacientes/${patientId}/historial`);
  redirect(`/pacientes/${patientId}/historial`);
}

async function deleteFileAction(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const fileId = String(formData.get('fileId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canDeleteMedicalRecords(access)) throw new Error('No autorizado');

  const file = await prisma.medicalFile.findUnique({ where: { id: fileId } });
  if (!file || file.patientId !== patientId) throw new Error('Archivo no encontrado');

  // 1) Borrar de R2. Si falla, NO borrar la DB.
  try {
    await r2Delete(file.storageKey);
  } catch (err) {
    console.error('[medical-file] error borrando en R2', err);
    throw new Error('No pudimos borrar el archivo del almacenamiento. Probá de nuevo en un momento.');
  }

  // 2) Borrar de DB. Si falla acá, el objeto ya no está en R2; reportamos claramente.
  try {
    await prisma.medicalFile.delete({ where: { id: fileId } });
  } catch (err) {
    console.error('[medical-file] borrado parcial: R2 ok, DB falló', err);
    await logAudit({
      userId: session.user.id,
      action: 'medicalFile.delete.partial',
      entityType: 'MedicalFile',
      entityId: fileId,
      metadata: { patientId, name: file.name, storageKey: file.storageKey },
    });
    throw new Error('Borrado parcial: el archivo se quitó del almacenamiento pero no de la base. Avisá al administrador.');
  }

  await logAudit({
    userId: session.user.id,
    action: 'medicalFile.delete',
    entityType: 'MedicalFile',
    entityId: fileId,
    metadata: { patientId, name: file.name, medicalEventId: file.medicalEventId },
  });

  revalidatePath(`/pacientes/${patientId}/historial`);
  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/pacientes/${patientId}/historial`);
}

function optString(v: FormDataEntryValue | null): string | null {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}

export default async function EditFilePage({ params }: { params: { patientId: string; fileId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canUploadFilesFor(access)) redirect(`/pacientes/${params.patientId}/historial`);

  const file = await prisma.medicalFile.findUnique({
    where: { id: params.fileId },
    include: { uploadedBy: { select: { name: true } } },
  });
  if (!file || file.patientId !== params.patientId) notFound();

  const canDelete = canDeleteMedicalRecords(access);

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/historial`} className="hover:text-brand">
            ← Volver al historial
          </Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Editar archivo</h1>
      </div>

      <div className="card">
        <p className="font-semibold truncate">{file.name}</p>
        <p className="text-sm text-slate-600">
          {file.mimeType} · {formatFileSize(file.sizeBytes)}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Subido por {file.uploadedBy.name} · {formatDateTime(file.createdAt)}
        </p>
        <a
          href={`/api/files/${file.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand text-sm mt-3 inline-block hover:underline"
        >
          Ver archivo
        </a>
      </div>

      <form action={updateFileMetadata} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />
        <input type="hidden" name="fileId" value={file.id} />

        <div>
          <label className="label">Categoría</label>
          <select name="category" defaultValue={file.category} className="input">
            {(Object.keys(FILE_CATEGORY_LABEL) as FileCategory[]).map((c) => (
              <option key={c} value={c}>{FILE_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Descripción</label>
          <textarea name="description" rows={3} defaultValue={file.description ?? ''} className="input" />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Guardar cambios</button>
          <Link href={`/pacientes/${params.patientId}/historial`} className="btn-secondary btn-lg">
            Cancelar
          </Link>
        </div>
      </form>

      {canDelete && (
        <form action={deleteFileAction} className="card border-red-200 space-y-3">
          <input type="hidden" name="patientId" value={params.patientId} />
          <input type="hidden" name="fileId" value={file.id} />
          <p className="font-semibold text-red-900">Borrar archivo</p>
          <p className="text-sm text-slate-700">
            Se borrará del almacenamiento y de la base. Esta acción no se puede deshacer.
          </p>
          <button type="submit" className="btn-danger">Borrar definitivamente</button>
        </form>
      )}
    </div>
  );
}
