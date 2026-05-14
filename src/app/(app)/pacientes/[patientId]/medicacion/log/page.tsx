import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canEditPatientData } from '@/lib/permissions';
import { formatDateTime } from '@/lib/date';
import { TAKE_STATUS_LABEL } from '@/lib/medication-day';

const STATUS_STYLE: Record<string, string> = {
  TAKEN: 'text-green-700 font-semibold',
  NOT_TAKEN: 'text-red-700 font-semibold',
  REFUSED: 'text-red-800 font-bold',
  DELAYED: 'text-amber-700 font-semibold',
};

const SLOT_LABEL: Record<string, string> = {
  MORNING: 'Mañana',
  NOON: 'Mediodía',
  AFTERNOON: 'Tarde',
  NIGHT: 'Noche',
  CUSTOM: 'Personalizado',
};

export default async function MedicationLogPage({
  params,
  searchParams,
}: {
  params: { patientId: string };
  searchParams: { estado?: string; med?: string; pagina?: string };
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

  const PAGE_SIZE = 60;
  const page = Math.max(1, parseInt(searchParams.pagina ?? '1', 10));
  const skip = (page - 1) * PAGE_SIZE;

  const statusFilter = searchParams.estado && ['TAKEN', 'NOT_TAKEN', 'REFUSED', 'DELAYED'].includes(searchParams.estado)
    ? { status: searchParams.estado as 'TAKEN' | 'NOT_TAKEN' | 'REFUSED' | 'DELAYED' }
    : {};

  const medFilter = searchParams.med ? { medicationId: searchParams.med } : {};

  const where = {
    medication: { patientId: params.patientId },
    ...statusFilter,
    ...medFilter,
  };

  const [logs, total, medications] = await Promise.all([
    prisma.medicationLog.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: PAGE_SIZE,
      skip,
      include: {
        medication: { select: { name: true, dose: true } },
        recordedBy: { select: { name: true, globalRole: true } },
      },
    }),
    prisma.medicationLog.count({ where }),
    prisma.medication.findMany({
      where: { patientId: params.patientId },
      select: { id: true, name: true, dose: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildHref(overrides: Record<string, string | undefined>) {
    const base: Record<string, string> = {
      ...(searchParams.estado ? { estado: searchParams.estado } : {}),
      ...(searchParams.med ? { med: searchParams.med } : {}),
      ...overrides,
    };
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>,
    ).toString();
    return `/pacientes/${params.patientId}/medicacion/log${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}/beta`} className="hover:text-brand">← Seguimiento beta</Link>
          {' · '}
          <Link href={`/pacientes/${params.patientId}/medicacion`} className="hover:text-brand">Medicación del día</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Log de medicación</h1>
        <p className="text-sm text-slate-600">{patient.fullName} · {total} registro{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Filtros */}
      <form method="GET" className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-600 mb-1">Estado</label>
          <select name="estado" defaultValue={searchParams.estado ?? ''} className="input text-sm py-1.5">
            <option value="">Todos</option>
            <option value="TAKEN">Tomó</option>
            <option value="NOT_TAKEN">No tomó</option>
            <option value="REFUSED">Rechazó</option>
            <option value="DELAYED">Demorado</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">Medicamento</label>
          <select name="med" defaultValue={searchParams.med ?? ''} className="input text-sm py-1.5">
            <option value="">Todos</option>
            {medications.map((m) => (
              <option key={m.id} value={m.id}>{m.name} {m.dose}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-sm py-1.5">Filtrar</button>
          <Link href={`/pacientes/${params.patientId}/medicacion/log`} className="btn-secondary text-sm py-1.5">Limpiar</Link>
        </div>
      </form>

      {/* Tabla */}
      {logs.length === 0 ? (
        <div className="card text-center py-8 text-slate-600">No hay registros con estos filtros.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="py-2 px-3">Medicamento</th>
                <th className="py-2 px-3">Estado</th>
                <th className="py-2 px-3">Turno</th>
                <th className="py-2 px-3">Hora indicada</th>
                <th className="py-2 px-3">Hora real</th>
                <th className="py-2 px-3">Registró</th>
                <th className="py-2 px-3">Observación</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3 font-medium">
                    {l.medication.name}
                    <span className="text-slate-400 ml-1">{l.medication.dose}</span>
                  </td>
                  <td className={`py-2 px-3 ${STATUS_STYLE[l.status] ?? ''}`}>
                    {TAKE_STATUS_LABEL[l.status]}
                  </td>
                  <td className="py-2 px-3 text-slate-500">{SLOT_LABEL[l.scheduleSlot] ?? l.scheduleSlot}</td>
                  <td className="py-2 px-3 text-slate-500">
                    {formatDateTime(l.scheduledFor)}
                  </td>
                  <td className="py-2 px-3 text-slate-500">
                    {l.actualTime ? formatDateTime(l.actualTime) : '—'}
                  </td>
                  <td className="py-2 px-3">
                    {l.recordedBy.name}
                    {l.recordedBy.globalRole === 'CAREGIVER' && (
                      <span className="text-xs text-slate-400 ml-1">(cuidadora)</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-slate-500 max-w-xs">
                    {l.notes && <span>{l.notes}</span>}
                    {l.reason && <span className="italic"> — {l.reason}</span>}
                    {!l.notes && !l.reason && '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
