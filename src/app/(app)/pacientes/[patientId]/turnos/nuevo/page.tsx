'use server';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canEditPatientData } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { ShiftType } from '@prisma/client';
import { SHIFT_TYPE_LABEL } from '@/lib/shifts';

async function createShift(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');

  const patientId = formData.get('patientId') as string;
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) return;

  const caregiverId = formData.get('caregiverId') as string;
  const shiftType = formData.get('shiftType') as ShiftType;
  const startPlannedAt = new Date(formData.get('startPlannedAt') as string);
  const endPlannedAt = new Date(formData.get('endPlannedAt') as string);
  const notes = (formData.get('notes') as string | null)?.trim() || null;

  if (!caregiverId || !shiftType || isNaN(startPlannedAt.getTime()) || isNaN(endPlannedAt.getTime())) return;
  if (endPlannedAt <= startPlannedAt) return;

  const shift = await prisma.caregiverShift.create({
    data: {
      patientId,
      caregiverId,
      shiftType,
      startPlannedAt,
      endPlannedAt,
      notes,
      status: 'SCHEDULED',
      createdById: session.user.id,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'shift.created',
    entityType: 'CaregiverShift',
    entityId: shift.id,
    metadata: { patientId, caregiverId, shiftType },
  });

  revalidatePath(`/pacientes/${patientId}/turnos`);
  redirect(`/pacientes/${patientId}/turnos`);
}

export default async function NuevoTurnoPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');

  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canEditPatientData(access.patientRole)) redirect(`/pacientes/${params.patientId}/turnos`);

  const patient = await prisma.patient.findUnique({
    where: { id: params.patientId },
    select: { fullName: true, organizationId: true },
  });
  if (!patient) notFound();

  // Cuidadoras de la misma organización
  const caregivers = await prisma.user.findMany({
    where: {
      organizationId: patient.organizationId,
      globalRole: { in: ['CAREGIVER', 'AGENCY_ADMIN'] },
      isActive: true,
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, globalRole: true },
  });

  // Precargar fecha de hoy a las 08:00
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultStart = `${todayStr}T08:00`;
  const defaultEnd = `${todayStr}T20:00`;

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/turnos`} className="hover:text-brand">← Turnos de cuidado</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Nuevo turno</h1>
        <p className="text-sm text-slate-600">{patient.fullName}</p>
      </div>

      <form action={createShift} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Cuidadora</label>
          <select name="caregiverId" required className="input">
            <option value="">Seleccionar cuidadora...</option>
            {caregivers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tipo de turno</label>
          <select name="shiftType" required className="input">
            {Object.entries(SHIFT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Inicio planificado</label>
            <input type="datetime-local" name="startPlannedAt" defaultValue={defaultStart} required className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fin planificado</label>
            <input type="datetime-local" name="endPlannedAt" defaultValue={defaultEnd} required className="input" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Notas (opcional)</label>
          <textarea name="notes" rows={3} className="input" placeholder="Indicaciones especiales para este turno..." />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary">Crear turno</button>
          <Link href={`/pacientes/${params.patientId}/turnos`} className="btn-secondary">Cancelar</Link>
        </div>
      </form>
    </div>
  );
}
