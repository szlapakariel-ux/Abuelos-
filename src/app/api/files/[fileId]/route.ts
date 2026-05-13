import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess } from '@/lib/permissions';
import { getSignedDownloadUrl } from '@/lib/storage';
import { logAudit } from '@/lib/audit';

/**
 * GET /api/files/[fileId] → 302 a signed URL temporal (5 min).
 *
 * Valida que el usuario tenga acceso al paciente al que pertenece el archivo.
 * No expone storageKey ni metadata privada.
 */
export async function GET(
  req: Request,
  { params }: { params: { fileId: string } },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const file = await prisma.medicalFile.findUnique({
    where: { id: params.fileId },
    select: { id: true, patientId: true, storageKey: true, name: true, mimeType: true },
  });
  if (!file) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }

  const access = await getPatientAccess(session.user.id, file.patientId);
  if (!access) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  let signed: string;
  try {
    signed = await getSignedDownloadUrl(file.storageKey, 300);
  } catch (err) {
    console.error('[files] error generando signed URL', err);
    return NextResponse.json({ error: 'Error al obtener el archivo' }, { status: 502 });
  }

  await logAudit({
    userId: session.user.id,
    action: 'medicalFile.view',
    entityType: 'MedicalFile',
    entityId: file.id,
    metadata: { patientId: file.patientId },
  });

  return NextResponse.redirect(signed, { status: 302 });
}
