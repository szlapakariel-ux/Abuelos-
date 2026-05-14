import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess } from '@/lib/permissions';
import { getSignedDownloadUrl } from '@/lib/storage';

export async function GET(
  _req: NextRequest,
  { params }: { params: { mealLogId: string } },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const mealLog = await prisma.mealLog.findUnique({
    where: { id: params.mealLogId },
    select: { patientId: true, photoUrl: true },
  });

  if (!mealLog) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  if (!mealLog.photoUrl) return NextResponse.json({ error: 'Sin foto' }, { status: 404 });

  const access = await getPatientAccess(session.user.id, mealLog.patientId);
  if (!access) return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });

  const url = await getSignedDownloadUrl(mealLog.photoUrl);
  return NextResponse.redirect(url);
}
