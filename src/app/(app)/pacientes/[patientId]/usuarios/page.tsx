import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import crypto from 'node:crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getPatientAccess, canManageUsers } from '@/lib/permissions';
import { sendEmail } from '@/lib/email';
import { PatientRole } from '@prisma/client';

async function invite(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canManageUsers(session.user.globalRole, access.patientRole)) {
    throw new Error('No autorizado');
  }

  const email = String(formData.get('email') || '').toLowerCase().trim();
  const patientRole = String(formData.get('patientRole')) as PatientRole;
  if (!email) throw new Error('Email requerido');

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

  await prisma.invitation.create({
    data: {
      email,
      patientId,
      patientRole,
      token,
      invitedById: session.user.id,
      expiresAt,
    },
  });

  const baseUrl = process.env.AUTH_URL || 'http://localhost:3000';
  const link = `${baseUrl}/aceptar-invitacion/${token}`;
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });

  await sendEmail({
    to: email,
    subject: `Invitación a Cuidado Mayor — ${patient?.fullName ?? ''}`,
    html: `
      <p>Hola,</p>
      <p>${session.user.name} te invitó a Cuidado Mayor para colaborar en el cuidado de <strong>${patient?.fullName ?? ''}</strong>.</p>
      <p>Hacé clic en este enlace para aceptar la invitación (válido 72 horas):</p>
      <p><a href="${link}">${link}</a></p>
    `,
  });

  revalidatePath(`/pacientes/${patientId}/usuarios`);
}

async function removeAccess(formData: FormData) {
  'use server';
  const patientUserId = String(formData.get('patientUserId'));
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canManageUsers(session.user.globalRole, access.patientRole)) {
    throw new Error('No autorizado');
  }
  await prisma.patientUser.delete({ where: { id: patientUserId } });
  revalidatePath(`/pacientes/${patientId}/usuarios`);
}

const ROLE_LABEL: Record<PatientRole, string> = {
  ADMIN: 'Administrador',
  CAREGIVER: 'Cuidadora',
  FAMILY: 'Familiar',
};

export default async function PatientUsersPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canManageUsers(session.user.globalRole, access.patientRole)) {
    redirect(`/pacientes/${params.patientId}`);
  }

  const [members, pendingInvitations] = await Promise.all([
    prisma.patientUser.findMany({
      where: { patientId: params.patientId },
      include: { user: true },
      orderBy: { assignedAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { patientId: params.patientId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver al paciente</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Personas y permisos</h1>
      </div>

      <form action={invite} className="card space-y-3">
        <input type="hidden" name="patientId" value={params.patientId} />
        <h2 className="font-semibold">Invitar persona</h2>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" required className="input" />
        </div>
        <div>
          <label className="label">¿Con qué rol?</label>
          <select name="patientRole" className="input" defaultValue="CAREGIVER">
            <option value="CAREGIVER">Cuidadora</option>
            <option value="FAMILY">Familiar</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </div>
        <button type="submit" className="btn-primary btn-lg w-full">Enviar invitación</button>
        <p className="text-xs text-slate-500">
          Le enviaremos un email con un enlace válido por 72 horas.
        </p>
      </form>

      <div>
        <h2 className="font-semibold mb-2">Con acceso ({members.length})</h2>
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="card flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{m.user.name}</p>
                <p className="text-sm text-slate-600">{m.user.email}</p>
                <p className="text-sm text-slate-600">{ROLE_LABEL[m.patientRole]}</p>
              </div>
              {m.userId !== session.user.id && (
                <form action={removeAccess}>
                  <input type="hidden" name="patientUserId" value={m.id} />
                  <input type="hidden" name="patientId" value={params.patientId} />
                  <button className="text-danger text-sm font-medium">Quitar</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      {pendingInvitations.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2">Invitaciones pendientes</h2>
          <div className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="card">
                <p className="font-semibold">{inv.email}</p>
                <p className="text-sm text-slate-600">{ROLE_LABEL[inv.patientRole]}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Expira: {new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(inv.expiresAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
