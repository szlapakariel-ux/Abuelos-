import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculateAge } from '@/lib/utils';
import { startOfToday, endOfToday, relativeFromNow } from '@/lib/date';
import { getDaySchedule } from '@/lib/medication-day';
import { GlobalRole } from '@prisma/client';

export default async function PatientsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const orgId = session!.user.organizationId;
  const isAgency = session!.user.globalRole === GlobalRole.AGENCY_ADMIN;

  const patients = isAgency
    ? await prisma.patient.findMany({
        where: { organizationId: orgId, isActive: true },
        orderBy: { fullName: 'asc' },
        include: {
          medications: {
            include: {
              schedules: true,
              logs: { where: { scheduledFor: { gte: startOfToday(), lte: endOfToday() } } },
            },
          },
          alerts: { where: { status: 'OPEN' }, take: 1 },
          users: {
            where: { patientRole: 'CAREGIVER' },
            include: { user: { select: { name: true } } },
          },
        },
      })
    : await prisma.patient.findMany({
        where: { isActive: true, users: { some: { userId } } },
        orderBy: { fullName: 'asc' },
        include: {
          medications: {
            include: {
              schedules: true,
              logs: { where: { scheduledFor: { gte: startOfToday(), lte: endOfToday() } } },
            },
          },
          alerts: { where: { status: 'OPEN' }, take: 1 },
          users: {
            where: { patientRole: 'CAREGIVER' },
            include: { user: { select: { name: true } } },
          },
        },
      });

  // Última actividad por paciente
  const patientIds = patients.map((p) => p.id);
  const lastLogs = patientIds.length
    ? await prisma.medicationLog.findMany({
        where: { medication: { patientId: { in: patientIds } } },
        orderBy: { recordedAt: 'desc' },
        distinct: ['medicationId'],
        include: { medication: { select: { patientId: true } } },
      })
    : [];
  const lastActivityByPatient = new Map<string, Date>();
  for (const log of lastLogs) {
    const pid = log.medication.patientId;
    const prev = lastActivityByPatient.get(pid);
    if (!prev || prev < log.recordedAt) lastActivityByPatient.set(pid, log.recordedAt);
  }

  const canCreate =
    session!.user.globalRole === GlobalRole.AGENCY_ADMIN ||
    session!.user.globalRole === GlobalRole.FAMILY_ADMIN;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Pacientes</h1>
          <p className="text-slate-600 text-sm">Hola, {session!.user.name}</p>
        </div>
        {canCreate && (
          <Link href="/pacientes/nuevo" className="btn-primary">+ Nuevo paciente</Link>
        )}
      </div>

      {patients.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-slate-600">Todavía no hay pacientes.</p>
          {canCreate && (
            <Link href="/pacientes/nuevo" className="btn-primary mt-4 inline-flex">
              Crear primer paciente
            </Link>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {patients.map((p) => {
            const slots = getDaySchedule(p.medications, startOfToday());
            const pending = slots.filter((s) => !s.log).length;
            const caregivers = p.users.map((pu) => pu.user.name);
            const alertCount = p.alerts.length;
            const lastActivity = lastActivityByPatient.get(p.id);
            return (
              <Link
                key={p.id}
                href={`/pacientes/${p.id}`}
                className="card hover:border-brand hover:shadow-md transition"
              >
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-full bg-brand-100 text-brand flex items-center justify-center text-lg font-semibold shrink-0">
                    {p.fullName.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{p.fullName}</p>
                    <p className="text-sm text-slate-600">{calculateAge(p.birthDate)} años</p>
                  </div>
                  {alertCount > 0 && (
                    <span className="text-xs font-bold rounded-full px-2 py-1 bg-red-100 text-red-800">
                      {alertCount} ⚠
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>💊 {pending > 0 ? <strong className="text-amber-700">{pending} dosis pendientes</strong> : 'medicación al día'}</p>
                  {caregivers.length > 0 && (
                    <p className="truncate">👤 {caregivers.join(', ')}</p>
                  )}
                  {lastActivity && (
                    <p>🕒 Último registro: {relativeFromNow(lastActivity)}</p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
