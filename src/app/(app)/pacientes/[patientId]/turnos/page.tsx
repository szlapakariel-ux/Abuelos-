'use server';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canEditPatientData, canManageShifts } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { formatDateTime } from '@/lib/date';
import { SHIFT_TYPE_LABEL, SHIFT_STATUS_LABEL, SHIFT_STATUS_STYLE, diffMinutes } from '@/lib/shifts';

async function startShift(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');
  const shiftId = formData.get('shiftId') as string;
  const patientId = formData.get('patientId') as string;

  const shift = await prisma.caregiverShift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.patientId !== patientId) return;

  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canManageShifts(access)) return;

  // Cuidadora solo puede iniciar su propio turno
  if (access.patientRole === 'CAREGIVER' && shift.caregiverId !== session.user.id) return;
  if (shift.status !== 'SCHEDULED') return;

  const now = new Date();
  await prisma.caregiverShift.update({
    where: { id: shiftId },
    data: {
      status: 'ACTIVE',
      startedAt: now,
      startedById: session.user.id,
      startDiffMinutes: diffMinutes(shift.startPlannedAt, now),
    },
  });
  await logAudit({ userId: session.user.id, action: 'shift.started', entityType: 'CaregiverShift', entityId: shiftId, metadata: { patientId } });
  revalidatePath(`/pacientes/${patientId}/turnos`);
}

async function endShift(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');
  const shiftId = formData.get('shiftId') as string;
  const patientId = formData.get('patientId') as string;

  const shift = await prisma.caregiverShift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.patientId !== patientId) return;

  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canManageShifts(access)) return;
  if (access.patientRole === 'CAREGIVER' && shift.caregiverId !== session.user.id) return;
  if (shift.status !== 'ACTIVE') return;

  const now = new Date();
  await prisma.caregiverShift.update({
    where: { id: shiftId },
    data: {
      status: 'COMPLETED',
      endedAt: now,
      endedById: session.user.id,
      endDiffMinutes: diffMinutes(shift.endPlannedAt, now),
    },
  });
  await logAudit({ userId: session.user.id, action: 'shift.completed', entityType: 'CaregiverShift', entityId: shiftId, metadata: { patientId } });
  revalidatePath(`/pacientes/${patientId}/turnos`);
}

async function cancelShift(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');
  const shiftId = formData.get('shiftId') as string;
  const patientId = formData.get('patientId') as string;

  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) return;

  const shift = await prisma.caregiverShift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.patientId !== patientId) return;
  if (!['SCHEDULED', 'ACTIVE'].includes(shift.status)) return;

  await prisma.caregiverShift.update({ where: { id: shiftId }, data: { status: 'CANCELLED' } });
  await logAudit({ userId: session.user.id, action: 'shift.cancelled', entityType: 'CaregiverShift', entityId: shiftId, metadata: { patientId } });
  revalidatePath(`/pacientes/${patientId}/turnos`);
}

async function markMissed(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');
  const shiftId = formData.get('shiftId') as string;
  const patientId = formData.get('patientId') as string;

  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) return;

  const shift = await prisma.caregiverShift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.patientId !== patientId) return;
  if (shift.status !== 'SCHEDULED') return;

  await prisma.caregiverShift.update({ where: { id: shiftId }, data: { status: 'MISSED' } });
  await logAudit({ userId: session.user.id, action: 'shift.missed', entityType: 'CaregiverShift', entityId: shiftId, metadata: { patientId } });
  revalidatePath(`/pacientes/${patientId}/turnos`);
}

async function correctShift(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');
  const shiftId = formData.get('shiftId') as string;
  const patientId = formData.get('patientId') as string;
  const correctionNote = (formData.get('correctionNote') as string | null)?.trim();

  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) return;

  const shift = await prisma.caregiverShift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.patientId !== patientId) return;

  const startedAtRaw = formData.get('startedAt') as string | null;
  const endedAtRaw = formData.get('endedAt') as string | null;

  await prisma.caregiverShift.update({
    where: { id: shiftId },
    data: {
      ...(startedAtRaw ? { startedAt: new Date(startedAtRaw), startDiffMinutes: diffMinutes(shift.startPlannedAt, new Date(startedAtRaw)) } : {}),
      ...(endedAtRaw ? { endedAt: new Date(endedAtRaw), endDiffMinutes: diffMinutes(shift.endPlannedAt, new Date(endedAtRaw)) } : {}),
      ...(correctionNote ? { correctionNote } : {}),
      correctedById: session.user.id,
      correctedAt: new Date(),
    },
  });
  await logAudit({ userId: session.user.id, action: 'shift.corrected', entityType: 'CaregiverShift', entityId: shiftId, metadata: { patientId, correctionNote } });
  revalidatePath(`/pacientes/${patientId}/turnos`);
}

export default async function TurnosPage({
  params,
  searchParams,
}: {
  params: { patientId: string };
  searchParams: { estado?: string; pagina?: string };
}) {
  const session = await auth();
  if (!session) redirect('/login');

  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const patient = await prisma.patient.findUnique({
    where: { id: params.patientId },
    select: { fullName: true },
  });
  if (!patient) notFound();

  const isAdmin = canEditPatientData(access.patientRole);
  const canAct = canManageShifts(access);

  const PAGE_SIZE = 30;
  const page = Math.max(1, parseInt(searchParams.pagina ?? '1', 10));
  const skip = (page - 1) * PAGE_SIZE;

  const statusFilter = searchParams.estado &&
    ['SCHEDULED', 'ACTIVE', 'COMPLETED', 'MISSED', 'CANCELLED'].includes(searchParams.estado)
    ? { status: searchParams.estado as 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'MISSED' | 'CANCELLED' }
    : {};

  const where = { patientId: params.patientId, ...statusFilter };

  const [shifts, total] = await Promise.all([
    prisma.caregiverShift.findMany({
      where,
      orderBy: { startPlannedAt: 'desc' },
      take: PAGE_SIZE,
      skip,
      include: {
        caregiver: { select: { name: true } },
        startedBy: { select: { name: true } },
        endedBy: { select: { name: true } },
        correctedBy: { select: { name: true } },
      },
    }),
    prisma.caregiverShift.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildHref(overrides: Record<string, string | undefined>) {
    const base: Record<string, string> = {
      ...(searchParams.estado ? { estado: searchParams.estado } : {}),
      ...overrides,
    };
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>,
    ).toString();
    return `/pacientes/${params.patientId}/turnos${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← {patient.fullName}</Link>
        </p>
        <div className="flex items-center justify-between gap-3 mt-1">
          <div>
            <h1 className="text-xl font-bold">Turnos de cuidado</h1>
            <p className="text-sm text-slate-600">{total} turno{total !== 1 ? 's' : ''}</p>
          </div>
          {isAdmin && (
            <Link href={`/pacientes/${params.patientId}/turnos/nuevo`} className="btn-primary text-sm">
              + Nuevo turno
            </Link>
          )}
        </div>
      </div>

      {/* Filtro */}
      <form method="GET" className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-600 mb-1">Estado</label>
          <select name="estado" defaultValue={searchParams.estado ?? ''} className="input text-sm py-1.5">
            <option value="">Todos</option>
            <option value="SCHEDULED">Programado</option>
            <option value="ACTIVE">En curso</option>
            <option value="COMPLETED">Completado</option>
            <option value="MISSED">No se presentó</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-sm py-1.5">Filtrar</button>
          <Link href={`/pacientes/${params.patientId}/turnos`} className="btn-secondary text-sm py-1.5">Limpiar</Link>
        </div>
      </form>

      {/* Lista */}
      {shifts.length === 0 ? (
        <div className="card text-center py-8 text-slate-600">No hay turnos con estos filtros.</div>
      ) : (
        <div className="space-y-3">
          {shifts.map((s) => {
            const style = SHIFT_STATUS_STYLE[s.status];
            return (
              <article key={s.id} className={`card border ${style.border}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${style.bg} ${style.text}`}>
                        {SHIFT_STATUS_LABEL[s.status]}
                      </span>
                      <span className="text-sm font-semibold">{SHIFT_TYPE_LABEL[s.shiftType]}</span>
                    </div>
                    <p className="font-medium mt-1">{s.caregiver.name}</p>
                    <p className="text-sm text-slate-500">
                      Planificado: {formatDateTime(s.startPlannedAt)} — {formatDateTime(s.endPlannedAt)}
                    </p>
                    {s.startedAt && (
                      <p className="text-sm text-slate-500">
                        Ingreso real: {formatDateTime(s.startedAt)}
                        {s.startDiffMinutes !== null && s.startDiffMinutes !== undefined && (
                          <span className={s.startDiffMinutes > 10 ? ' text-amber-600 font-medium' : ' text-green-700'}>
                            {' '}({s.startDiffMinutes > 0 ? `+${s.startDiffMinutes}` : s.startDiffMinutes} min)
                          </span>
                        )}
                        {s.startedBy && <span className="text-slate-400"> · {s.startedBy.name}</span>}
                      </p>
                    )}
                    {s.endedAt && (
                      <p className="text-sm text-slate-500">
                        Egreso real: {formatDateTime(s.endedAt)}
                        {s.endDiffMinutes !== null && s.endDiffMinutes !== undefined && (
                          <span className={Math.abs(s.endDiffMinutes) > 30 ? ' text-amber-600 font-medium' : ' text-green-700'}>
                            {' '}({s.endDiffMinutes > 0 ? `+${s.endDiffMinutes}` : s.endDiffMinutes} min)
                          </span>
                        )}
                        {s.endedBy && <span className="text-slate-400"> · {s.endedBy.name}</span>}
                      </p>
                    )}
                    {s.notes && <p className="text-sm text-slate-600 mt-1 italic">{s.notes}</p>}
                    {s.correctionNote && (
                      <p className="text-xs text-amber-700 mt-1">
                        Corrección: {s.correctionNote}
                        {s.correctedBy && ` (${s.correctedBy.name})`}
                      </p>
                    )}
                  </div>

                  {/* Acciones */}
                  {canAct && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {s.status === 'SCHEDULED' && (
                        <form action={startShift}>
                          <input type="hidden" name="shiftId" value={s.id} />
                          <input type="hidden" name="patientId" value={params.patientId} />
                          <button type="submit" className="btn-primary text-xs py-1.5 px-3">Iniciar</button>
                        </form>
                      )}
                      {s.status === 'ACTIVE' && (
                        <form action={endShift}>
                          <input type="hidden" name="shiftId" value={s.id} />
                          <input type="hidden" name="patientId" value={params.patientId} />
                          <button type="submit" className="btn-primary text-xs py-1.5 px-3">Finalizar</button>
                        </form>
                      )}
                      {isAdmin && s.status === 'SCHEDULED' && (
                        <form action={markMissed}>
                          <input type="hidden" name="shiftId" value={s.id} />
                          <input type="hidden" name="patientId" value={params.patientId} />
                          <button type="submit" className="btn-secondary text-xs py-1.5 px-3 text-amber-700">No asistió</button>
                        </form>
                      )}
                      {isAdmin && ['SCHEDULED', 'ACTIVE'].includes(s.status) && (
                        <form action={cancelShift}>
                          <input type="hidden" name="shiftId" value={s.id} />
                          <input type="hidden" name="patientId" value={params.patientId} />
                          <button type="submit" className="btn-secondary text-xs py-1.5 px-3 text-red-600">Cancelar</button>
                        </form>
                      )}
                    </div>
                  )}
                </div>

                {/* Corrección (admin only, shift completado) */}
                {isAdmin && s.status === 'COMPLETED' && (
                  <details className="mt-3 border-t border-slate-100 pt-3">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                      Corregir horarios registrados
                    </summary>
                    <form action={correctShift} className="mt-2 space-y-2">
                      <input type="hidden" name="shiftId" value={s.id} />
                      <input type="hidden" name="patientId" value={params.patientId} />
                      <div className="grid sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Ingreso real</label>
                          <input
                            type="datetime-local"
                            name="startedAt"
                            defaultValue={s.startedAt ? toLocalInputValue(s.startedAt) : ''}
                            className="input text-sm py-1"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Egreso real</label>
                          <input
                            type="datetime-local"
                            name="endedAt"
                            defaultValue={s.endedAt ? toLocalInputValue(s.endedAt) : ''}
                            className="input text-sm py-1"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">Nota de corrección</label>
                        <input type="text" name="correctionNote" defaultValue={s.correctionNote ?? ''} className="input text-sm py-1" placeholder="Motivo de la corrección..." />
                      </div>
                      <button type="submit" className="btn-secondary text-xs py-1.5 px-3">Guardar corrección</button>
                    </form>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && <Link href={buildHref({ pagina: String(page - 1) })} className="btn-secondary">← Anterior</Link>}
          <span className="text-slate-600">Página {page} de {totalPages}</span>
          {page < totalPages && <Link href={buildHref({ pagina: String(page + 1) })} className="btn-secondary">Siguiente →</Link>}
        </div>
      )}
    </div>
  );
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
