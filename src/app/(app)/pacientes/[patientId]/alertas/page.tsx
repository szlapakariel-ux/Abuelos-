import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageAlerts, canReopenAlerts, getPatientAccess } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ALERT_SEVERITY_STYLE, ALERT_TYPE_LABEL, alertLinkHref } from '@/lib/alerts/types';
import { formatDateTime, relativeFromNow } from '@/lib/date';
import { AlertStatus } from '@prisma/client';

async function resolveAlert(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const alertId = String(formData.get('alertId'));
  const reason = String(formData.get('reason') || '').trim() || null;
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canManageAlerts(access)) throw new Error('No autorizado');

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: 'RESOLVED',
      isResolved: true,
      resolvedAt: new Date(),
      resolvedById: session.user.id,
      resolutionReason: reason,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'alert.resolved.manual',
    entityType: 'Alert',
    entityId: alertId,
    metadata: { patientId, reason },
  });

  revalidatePath(`/pacientes/${patientId}/alertas`);
  revalidatePath(`/pacientes/${patientId}`);
}

async function ignoreAlert(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const alertId = String(formData.get('alertId'));
  const reason = String(formData.get('reason') || '').trim() || null;
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canManageAlerts(access)) throw new Error('No autorizado');

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: 'IGNORED',
      isResolved: true,
      ignoredAt: new Date(),
      ignoredById: session.user.id,
      resolutionReason: reason,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'alert.ignored',
    entityType: 'Alert',
    entityId: alertId,
    metadata: { patientId, reason },
  });

  revalidatePath(`/pacientes/${patientId}/alertas`);
  revalidatePath(`/pacientes/${patientId}`);
}

async function reopenAlert(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const alertId = String(formData.get('alertId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canReopenAlerts(access)) throw new Error('No autorizado');

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: 'OPEN',
      isResolved: false,
      reopenedAt: new Date(),
      reopenedById: session.user.id,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'alert.reopened',
    entityType: 'Alert',
    entityId: alertId,
    metadata: { patientId },
  });

  revalidatePath(`/pacientes/${patientId}/alertas`);
  revalidatePath(`/pacientes/${patientId}`);
}

export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: { patientId: string };
  searchParams: { estado?: string };
}) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const filter: AlertStatus | 'ALL' = ((): AlertStatus | 'ALL' => {
    const v = (searchParams.estado || 'OPEN').toUpperCase();
    if (v === 'OPEN' || v === 'RESOLVED' || v === 'IGNORED' || v === 'ALL') return v;
    return 'OPEN';
  })();

  const where = {
    patientId: params.patientId,
    ...(filter === 'ALL' ? {} : { status: filter }),
  };

  const alerts = await prisma.alert.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      resolvedBy: { select: { name: true } },
      ignoredBy: { select: { name: true } },
      reopenedBy: { select: { name: true } },
    },
  });

  const manage = canManageAlerts(access);
  const reopen = canReopenAlerts(access);

  const counts = await prisma.alert.groupBy({
    by: ['status'],
    where: { patientId: params.patientId },
    _count: { _all: true },
  });
  const countOf = (s: AlertStatus): number =>
    counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Alertas</h1>
      </div>

      <div className="flex gap-2 flex-wrap">
        <FilterTab patientId={params.patientId} value="OPEN" current={filter} label="Abiertas" count={countOf('OPEN')} />
        <FilterTab patientId={params.patientId} value="RESOLVED" current={filter} label="Resueltas" count={countOf('RESOLVED')} />
        <FilterTab patientId={params.patientId} value="IGNORED" current={filter} label="Ignoradas" count={countOf('IGNORED')} />
        <FilterTab patientId={params.patientId} value="ALL" current={filter} label="Todas" count={alerts.length} />
      </div>

      {alerts.length === 0 ? (
        <div className="card text-center py-8 text-slate-600">No hay alertas con este filtro.</div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const style = ALERT_SEVERITY_STYLE[a.severity];
            const href = alertLinkHref({ patientId: params.patientId, type: a.type, sourceId: a.sourceId });
            const isOpen = a.status === 'OPEN';
            return (
              <article key={a.id} className={`card ${style.bg} ${style.border}`}>
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0" aria-hidden>{style.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className={`font-semibold ${style.text}`}>{a.title}</p>
                      <span className={`text-xs font-semibold rounded-full px-2 py-1 ${style.bg} ${style.text}`}>
                        {a.status === 'OPEN' ? 'Abierta' : a.status === 'RESOLVED' ? 'Resuelta' : 'Ignorada'}
                      </span>
                    </div>
                    <p className={`text-sm ${style.text} opacity-90`}>{a.message}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {ALERT_TYPE_LABEL[a.type]} · {formatDateTime(a.createdAt)} ({relativeFromNow(a.createdAt)})
                    </p>

                    {a.status === 'RESOLVED' && (
                      <p className="text-xs text-slate-600 mt-1">
                        ✔ Resuelta {a.resolvedAt && formatDateTime(a.resolvedAt)}
                        {a.resolvedBy ? ` por ${a.resolvedBy.name}` : ' automáticamente'}
                        {a.resolutionReason ? ` — ${a.resolutionReason}` : ''}
                      </p>
                    )}
                    {a.status === 'IGNORED' && (
                      <p className="text-xs text-slate-600 mt-1">
                        🙈 Ignorada {a.ignoredAt && formatDateTime(a.ignoredAt)}
                        {a.ignoredBy ? ` por ${a.ignoredBy.name}` : ''}
                        {a.resolutionReason ? ` — ${a.resolutionReason}` : ''}
                      </p>
                    )}
                    {a.reopenedAt && (
                      <p className="text-xs text-slate-600 mt-1">
                        ↻ Reabierta {formatDateTime(a.reopenedAt)}{a.reopenedBy ? ` por ${a.reopenedBy.name}` : ''}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link href={href} className="text-sm text-brand hover:underline">Ver detalle</Link>

                  {isOpen && manage && (
                    <>
                      <ActionForm
                        action={resolveAlert}
                        patientId={params.patientId}
                        alertId={a.id}
                        label="Marcar como resuelta"
                        className="btn-secondary text-sm"
                        withReason
                      />
                      <ActionForm
                        action={ignoreAlert}
                        patientId={params.patientId}
                        alertId={a.id}
                        label="Ignorar"
                        className="btn-secondary text-sm"
                        withReason
                      />
                    </>
                  )}
                  {!isOpen && reopen && (
                    <ActionForm
                      action={reopenAlert}
                      patientId={params.patientId}
                      alertId={a.id}
                      label="Reabrir"
                      className="btn-secondary text-sm"
                      withReason={false}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  patientId, value, current, label, count,
}: { patientId: string; value: string; current: string; label: string; count: number }) {
  const active = current === value;
  return (
    <Link
      href={`/pacientes/${patientId}/alertas?estado=${value}`}
      className={`text-sm rounded-full px-3 py-1.5 font-medium border ${
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-white text-slate-700 border-slate-300 hover:border-brand'
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </Link>
  );
}

function ActionForm({
  action, patientId, alertId, label, className, withReason,
}: {
  action: (formData: FormData) => Promise<void>;
  patientId: string;
  alertId: string;
  label: string;
  className: string;
  withReason: boolean;
}) {
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="alertId" value={alertId} />
      {withReason && (
        <input
          name="reason"
          placeholder="Motivo (opcional)"
          className="input py-1.5 text-sm w-44"
        />
      )}
      <button type="submit" className={className}>{label}</button>
    </form>
  );
}
