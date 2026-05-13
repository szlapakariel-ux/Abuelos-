import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculateAge } from '@/lib/utils';
import { GlobalRole } from '@prisma/client';

export default async function PatientsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const isAgency = session!.user.globalRole === GlobalRole.AGENCY_ADMIN;

  // Agency admin ve todos los pacientes de su organización.
  // Resto ve solo aquellos en los que tiene PatientUser.
  const patients = isAgency
    ? await prisma.patient.findMany({
        where: { organizationId: session!.user.organizationId, isActive: true },
        orderBy: { fullName: 'asc' },
      })
    : await prisma.patient.findMany({
        where: { isActive: true, users: { some: { userId } } },
        orderBy: { fullName: 'asc' },
      });

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
          {patients.map((p) => (
            <Link
              key={p.id}
              href={`/pacientes/${p.id}`}
              className="card hover:border-brand hover:shadow-md transition"
            >
              <div className="flex items-center gap-3">
                <div className="size-12 rounded-full bg-brand-100 text-brand flex items-center justify-center text-lg font-semibold">
                  {p.fullName.slice(0, 1)}
                </div>
                <div>
                  <p className="font-semibold">{p.fullName}</p>
                  <p className="text-sm text-slate-600">{calculateAge(p.birthDate)} años</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
