import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GlobalRole } from '@prisma/client';
import { startOfToday, endOfToday, relativeFromNow, formatDateTime, formatDateAR } from '@/lib/date';
import { logAudit } from '@/lib/audit';

export default async function CuidadorasPage() {
  const session = await auth();
  if (!session) redirect('/login');
  if (session.user.globalRole !== GlobalRole.AGENCY_ADMIN) redirect('/pacientes');

  const orgId = session.user.organizationId;
  const today = startOfToday();
  const end = endOfToday();

  const caregivers = await prisma.user.findMany({
    where: { organizationId: orgId, globalRole: GlobalRole.CAREGIVER, isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      lastLoginAt: true,
      patientAccess: {
        where: { patientRole: 'CAREGIVER' },
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
              isActive: true,
              alerts: { where: { status: 'OPEN', severity: { in: ['CRITICAL', 'WARNING'] } }, select: { id: true, severity: true } },
            },
          },
        },
      },
    },
  });

  const caregiverIds = caregivers.map((c) => c.id);

  const todayLogs = caregiverIds.length
    ? await prisma.medicationLog.findMany({
        where: { recordedById: { in: caregiverIds }, recordedAt: { gte: today, lte: end } },
        select: { recordedById: true, recordedAt: true },
      })
    : [];

  const logsByCaregiver = new Map<string, { count: number; last: Date | null }>();
  for (const cg of caregivers) {
    logsByCaregiver.set(cg.id, { count: 0, last: null });
  }
  for (const log of todayLogs) {
    const entry = logsByCaregiver.get(log.recordedById);
    if (!entry) continue;
    entry.count++;
    if (!entry.last || log.recordedAt > entry.last) entry.last = log.recordedAt;
  }

  await logAudit({
    userId: session.user.id,
    action: 'agency.dashboard.view',
    metadata: { orgId, view: 'cuidadoras' },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href="/agencia/dashboard" className="hover:text-brand">← Panel de agencia</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Cuidadoras ({caregivers.length})</h1>
        <p className="text-slate-600 text-sm">Vista de actividad · hoy {formatDateAR(new Date())}</p>
      </div>

      {caregivers.length === 0 ? (
        <div className="card text-center py-8 text-slate-600">No hay cuidadoras activas en esta agencia.</div>
      ) : (
        <div className="space-y-3">
          {caregivers.map((cg) => {
            const activity = logsByCaregiver.get(cg.id)!;
            const activePatients = cg.patientAccess.filter((pu) => pu.patient.isActive);
            const criticalCount = activePatients.reduce(
              (acc, pu) => acc + pu.patient.alerts.filter((a) => a.severity === 'CRITICAL').length,
              0,
            );

            return (
              <div key={cg.id} className={`card space-y-3 ${criticalCount > 0 ? 'border-red-300' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{cg.name}</p>
                    <p className="text-sm text-slate-500">{cg.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-2xl font-bold ${activity.count > 0 ? 'text-brand' : 'text-slate-400'}`}>
                      {activity.count}
                    </p>
                    <p className="text-xs text-slate-500">registros hoy</p>
                  </div>
                </div>

                <div className="text-sm text-slate-600 space-y-1">
                  {activity.last && (
                    <p>🕒 Último registro: <strong>{relativeFromNow(activity.last)}</strong></p>
                  )}
                  {cg.lastLoginAt && (
                    <p>🔑 Último acceso: {relativeFromNow(cg.lastLoginAt)}</p>
                  )}
                  {!cg.lastLoginAt && (
                    <p className="text-slate-400">Nunca inició sesión</p>
                  )}
                </div>

                {activePatients.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin pacientes asignados.</p>
                ) : (
                  <div className="border-t border-slate-100 pt-3 space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Pacientes asignados ({activePatients.length})
                    </p>
                    {activePatients.map((pu) => {
                      const alertCount = pu.patient.alerts.length;
                      const hasCritical = pu.patient.alerts.some((a) => a.severity === 'CRITICAL');
                      return (
                        <div key={pu.patient.id} className="flex items-center justify-between gap-2">
                          <Link
                            href={`/pacientes/${pu.patient.id}`}
                            className="text-sm font-medium hover:text-brand flex-1 truncate"
                          >
                            {pu.patient.fullName}
                          </Link>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasCritical && (
                              <span className="text-xs font-bold rounded-full px-1.5 py-0.5 bg-red-100 text-red-800">🚨</span>
                            )}
                            {alertCount > 0 && !hasCritical && (
                              <span className="text-xs font-medium rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-800">
                                {alertCount} ⚠️
                              </span>
                            )}
                            <Link
                              href={`/pacientes/${pu.patient.id}`}
                              className="text-xs text-slate-500 hover:text-brand"
                            >
                              Ver →
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
