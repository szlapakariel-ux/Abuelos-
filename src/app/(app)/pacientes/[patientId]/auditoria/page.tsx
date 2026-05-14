import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canEditPatientData } from '@/lib/permissions';
import { formatDateTime } from '@/lib/date';
import { logAudit } from '@/lib/audit';

const ACTION_LABEL: Record<string, string> = {
  'patient.update': 'Datos del paciente editados',
  'patient.create': 'Paciente creado',
  'patientRanges.update': 'Rangos médicos actualizados',
  'medication.create': 'Medicación creada',
  'medication.update': 'Medicación editada',
  'medication.delete': 'Medicación eliminada',
  'medication.suspend': 'Medicación suspendida',
  'vital.record': 'Presión registrada',
  'vital.delete': 'Presión eliminada',
  'meal.record': 'Comida registrada',
  'meal.delete': 'Comida eliminada',
  'meal.photo.uploaded': 'Foto de comida adjunta',
  'dailyStatus.record': 'Estado general registrado',
  'medicalEvent.create': 'Evento médico creado',
  'medicalEvent.update': 'Evento médico editado',
  'medicalEvent.delete': 'Evento médico eliminado',
  'medicalEvent.delete.blocked': 'Borrado de evento bloqueado (tiene archivos)',
  'medicalFile.create': 'Archivo médico subido',
  'medicalFile.update': 'Archivo médico editado',
  'medicalFile.delete': 'Archivo médico eliminado',
  'medicalFile.delete.partial': 'Error parcial al borrar archivo',
  'medicalFile.view': 'Archivo médico visualizado',
  'alert.resolved.manual': 'Alerta resuelta manualmente',
  'alert.ignored': 'Alerta ignorada',
  'alert.reopened': 'Alerta reabierta',
  'alert.resolved.auto': 'Alerta resuelta automáticamente',
  'alert.batch.created': 'Alertas generadas (sistema)',
  'dailyReport.sent': 'Reporte diario enviado',
  'dailyReport.skipped': 'Reporte diario omitido (sin datos)',
  'dailyReport.failed': 'Error al enviar reporte diario',
  'invitation.created': 'Invitación enviada',
  'invitation.accepted': 'Invitación aceptada',
  'agency.dashboard.view': 'Vista del panel de agencia',
  'shift.created': 'Turno creado',
  'shift.started': 'Turno iniciado',
  'shift.completed': 'Turno completado',
  'shift.cancelled': 'Turno cancelado',
  'shift.missed': 'Turno marcado como ausente',
  'shift.corrected': 'Turno corregido',
  'auditLog.view': 'Vista de auditoría',
};

const ENTITY_LABEL: Record<string, string> = {
  Patient: 'Paciente',
  Medication: 'Medicación',
  VitalSign: 'Presión',
  MealLog: 'Comida',
  DailyStatus: 'Estado general',
  MedicalEvent: 'Evento médico',
  MedicalFile: 'Archivo médico',
  Alert: 'Alerta',
  CaregiverShift: 'Turno de cuidado',
};

const ACTION_GROUPS: Record<string, string[]> = {
  patient: ['patient.update', 'patient.create', 'patientRanges.update'],
  medication: ['medication.create', 'medication.update', 'medication.delete', 'medication.suspend'],
  vital: ['vital.record', 'vital.delete'],
  meal: ['meal.record', 'meal.delete', 'meal.photo.uploaded'],
  history: ['medicalEvent.create', 'medicalEvent.update', 'medicalEvent.delete', 'medicalFile.create', 'medicalFile.update', 'medicalFile.delete', 'medicalFile.view'],
  alerts: ['alert.resolved.manual', 'alert.ignored', 'alert.reopened', 'alert.resolved.auto', 'alert.batch.created'],
  reports: ['dailyReport.sent', 'dailyReport.skipped', 'dailyReport.failed'],
  shifts: ['shift.created', 'shift.started', 'shift.completed', 'shift.cancelled', 'shift.missed', 'shift.corrected'],
};

const GROUP_LABEL: Record<string, string> = {
  patient: 'Datos del paciente',
  medication: 'Medicación',
  vital: 'Presión arterial',
  meal: 'Alimentación',
  history: 'Historial médico',
  alerts: 'Alertas',
  reports: 'Reportes',
  shifts: 'Turnos de cuidado',
};

export default async function AuditoriaPage({
  params,
  searchParams,
}: {
  params: { patientId: string };
  searchParams: { grupo?: string; usuario?: string; desde?: string; hasta?: string; pagina?: string };
}) {
  const session = await auth();
  if (!session) redirect('/login');

  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canEditPatientData(access.patientRole)) redirect(`/pacientes/${params.patientId}`);

  const patient = await prisma.patient.findUnique({
    where: { id: params.patientId },
    select: { fullName: true },
  });
  if (!patient) notFound();

  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(searchParams.pagina ?? '1', 10));
  const skip = (page - 1) * PAGE_SIZE;

  const selectedGroup = searchParams.grupo ?? '';
  const selectedUser = searchParams.usuario ?? '';
  const desde = searchParams.desde ? new Date(`${searchParams.desde}T00:00:00`) : null;
  const hasta = searchParams.hasta ? new Date(`${searchParams.hasta}T23:59:59`) : null;

  const actionFilter = selectedGroup && ACTION_GROUPS[selectedGroup]
    ? { in: ACTION_GROUPS[selectedGroup] }
    : undefined;

  const dateFilter =
    desde || hasta
      ? { gte: desde ?? undefined, lte: hasta ?? undefined }
      : undefined;

  const baseWhere = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(selectedUser ? { userId: selectedUser } : {}),
    ...(dateFilter ? { createdAt: dateFilter } : {}),
  };

  const [logs, total, patientUsers] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        AND: [
          baseWhere,
          {
            OR: [
              { entityType: 'Patient', entityId: params.patientId },
              {
                metadata: {
                  path: ['patientId'],
                  equals: params.patientId,
                },
              },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip,
    }),
    prisma.auditLog.count({
      where: {
        AND: [
          baseWhere,
          {
            OR: [
              { entityType: 'Patient', entityId: params.patientId },
              {
                metadata: {
                  path: ['patientId'],
                  equals: params.patientId,
                },
              },
            ],
          },
        ],
      },
    }),
    prisma.patientUser.findMany({
      where: { patientId: params.patientId },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  const userIds = [...new Set(logs.map((l) => l.userId).filter((id) => id !== 'system'))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  await logAudit({
    userId: session.user.id,
    action: 'auditLog.view',
    entityType: 'Patient',
    entityId: params.patientId,
  });

  function buildHref(overrides: Record<string, string | undefined>) {
    const base: Record<string, string> = {
      ...(selectedGroup ? { grupo: selectedGroup } : {}),
      ...(selectedUser ? { usuario: selectedUser } : {}),
      ...(searchParams.desde ? { desde: searchParams.desde } : {}),
      ...(searchParams.hasta ? { hasta: searchParams.hasta } : {}),
      ...overrides,
    };
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>,
    ).toString();
    return `/pacientes/${params.patientId}/auditoria${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← {patient.fullName}</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Auditoría</h1>
        <p className="text-sm text-slate-600">{total} registro{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Filters */}
      <form method="GET" className="card space-y-3">
        <p className="text-sm font-semibold text-slate-700">Filtros</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Grupo de acción</label>
            <select name="grupo" defaultValue={selectedGroup} className="input">
              <option value="">Todos</option>
              {Object.entries(GROUP_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Usuario</label>
            <select name="usuario" defaultValue={selectedUser} className="input">
              <option value="">Todos</option>
              <option value="system">Sistema (automático)</option>
              {patientUsers.map((pu) => (
                <option key={pu.user.id} value={pu.user.id}>{pu.user.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Desde</label>
            <input type="date" name="desde" defaultValue={searchParams.desde ?? ''} className="input" />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Hasta</label>
            <input type="date" name="hasta" defaultValue={searchParams.hasta ?? ''} className="input" />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-sm">Filtrar</button>
          <Link href={`/pacientes/${params.patientId}/auditoria`} className="btn-secondary text-sm">Limpiar</Link>
        </div>
      </form>

      {/* Log table */}
      {logs.length === 0 ? (
        <div className="card text-center py-8 text-slate-600">No hay registros con estos filtros.</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const label = ACTION_LABEL[log.action] ?? log.action;
            const userName = log.userId === 'system' ? 'Sistema' : (userMap.get(log.userId) ?? log.userId);
            const entityLabel = log.entityType ? (ENTITY_LABEL[log.entityType] ?? log.entityType) : null;
            const meta = log.metadata as Record<string, unknown> | null;

            return (
              <article key={log.id} className="card text-sm space-y-1">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="font-semibold">{label}</p>
                  <p className="text-slate-500 shrink-0 text-xs">{formatDateTime(log.createdAt)}</p>
                </div>
                <p className="text-slate-600">
                  <span className="font-medium">{userName}</span>
                  {entityLabel && (
                    <span className="text-slate-400"> · {entityLabel}</span>
                  )}
                </p>
                {meta && Object.keys(meta).length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                      Ver detalle técnico
                    </summary>
                    <pre className="mt-1 text-xs bg-slate-50 rounded p-2 overflow-x-auto text-slate-700 whitespace-pre-wrap break-all">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={buildHref({ pagina: String(page - 1) })} className="btn-secondary">← Anterior</Link>
          )}
          <span className="text-slate-600">Página {page} de {totalPages}</span>
          {page < totalPages && (
            <Link href={buildHref({ pagina: String(page + 1) })} className="btn-secondary">Siguiente →</Link>
          )}
        </div>
      )}
    </div>
  );
}
