import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canEditPatientData } from '@/lib/permissions';
import { calculateAge } from '@/lib/utils';

export default async function PatientDashboard({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');

  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const patient = await prisma.patient.findUnique({
    where: { id: params.patientId },
    include: {
      _count: { select: { medications: { where: { status: 'ACTIVE' } }, users: true } },
    },
  });
  if (!patient) notFound();

  const isAdmin = canEditPatientData(access.patientRole);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            <Link href="/pacientes" className="hover:text-brand">← Pacientes</Link>
          </p>
          <h1 className="text-2xl font-bold mt-1">{patient.fullName}</h1>
          <p className="text-slate-600">{calculateAge(patient.birthDate)} años</p>
        </div>
      </div>

      {/* Resumen rápido */}
      <div className="grid sm:grid-cols-3 gap-3">
        <SummaryCard title="Medicación activa" value={`${patient._count.medications}`} href={`/pacientes/${patient.id}/medicacion`} />
        <SummaryCard title="Personas con acceso" value={`${patient._count.users}`} href={`/pacientes/${patient.id}/usuarios`} />
        <SummaryCard title="Obra social" value={patient.healthInsurance || '—'} />
      </div>

      {/* Acciones de cuidado del día */}
      <section>
        <h2 className="font-semibold mb-2">Registros de hoy</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <ActionCard emoji="💊" title="Medicación del día" href={`/pacientes/${patient.id}/medicacion`} />
          <ActionCard emoji="🩺" title="Cargar presión" href={`/pacientes/${patient.id}/presion`} />
          <ActionCard emoji="🍽️" title="Alimentación" href={`/pacientes/${patient.id}/alimentacion`} />
          <ActionCard emoji="😊" title="Estado general" href={`/pacientes/${patient.id}/estado`} />
        </div>
      </section>

      {isAdmin && (
        <section>
          <h2 className="font-semibold mb-2">Administración</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <ActionCard emoji="💊" title="Configurar medicación" href={`/pacientes/${patient.id}/medicacion/configurar`} />
            <ActionCard emoji="👥" title="Personas y permisos" href={`/pacientes/${patient.id}/usuarios`} />
            <ActionCard emoji="📋" title="Historial médico" href={`/pacientes/${patient.id}/historial`} />
            <ActionCard emoji="📎" title="Archivos médicos" href={`/pacientes/${patient.id}/archivos`} />
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ title, value, href }: { title: string; value: string; href?: string }) {
  const inner = (
    <div className="card">
      <p className="text-sm text-slate-600">{title}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionCard({ emoji, title, href }: { emoji: string; title: string; href: string }) {
  return (
    <Link href={href} className="card flex items-center gap-3 hover:border-brand hover:shadow-md transition">
      <span className="text-2xl">{emoji}</span>
      <span className="font-semibold">{title}</span>
    </Link>
  );
}
