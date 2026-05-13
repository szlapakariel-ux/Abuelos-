import { redirect } from 'next/navigation';
import Link from 'next/link';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { auth, signIn } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GlobalRole, PatientRole } from '@prisma/client';

async function acceptForLoggedUser(formData: FormData) {
  'use server';
  const token = String(formData.get('token'));
  const session = await auth();
  if (!session) redirect('/login');
  const patientId = await consumeInvitation(token, session.user.id);
  redirect(`/pacientes/${patientId}`);
}

async function acceptAndCreateUser(formData: FormData) {
  'use server';
  const token = String(formData.get('token'));
  const name = String(formData.get('name') || '').trim();
  const password = String(formData.get('password') || '');

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { patient: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new Error('Invitación inválida o expirada');
  }

  if (!name || password.length < 8) throw new Error('Nombre y contraseña (8+ caracteres) requeridos');

  // Si ya existe el email, no crear; pedir login.
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing) throw new Error('Ese email ya tiene cuenta. Iniciá sesión primero.');

  const globalRole =
    invitation.patientRole === PatientRole.CAREGIVER
      ? GlobalRole.CAREGIVER
      : invitation.patientRole === PatientRole.ADMIN
      ? GlobalRole.FAMILY_ADMIN
      : GlobalRole.FAMILY_MEMBER;

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email: invitation.email,
      name,
      passwordHash,
      globalRole,
      organizationId: invitation.patient.organizationId,
    },
  });

  const patientId = await consumeInvitation(token, user.id);

  // Iniciamos sesión automáticamente y entramos al paciente asignado.
  await signIn('credentials', { email: invitation.email, password, redirectTo: `/pacientes/${patientId}` });
}

async function consumeInvitation(token: string, userId: string): Promise<string> {
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new Error('Invitación inválida o expirada');
  }
  await prisma.$transaction(async (tx) => {
    await tx.patientUser.upsert({
      where: { patientId_userId: { patientId: invitation.patientId, userId } },
      create: {
        patientId: invitation.patientId,
        userId,
        patientRole: invitation.patientRole,
        canUploadFiles: invitation.patientRole !== PatientRole.FAMILY,
      },
      update: { patientRole: invitation.patientRole },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  });
  revalidatePath('/pacientes');
  return invitation.patientId;
}

export default async function AcceptInvitationPage({ params }: { params: { token: string } }) {
  const invitation = await prisma.invitation.findUnique({
    where: { token: params.token },
    include: { patient: true, invitedBy: true },
  });

  if (!invitation) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Invitación inválida</h1>
        <p className="text-slate-600 mt-2">El enlace no es válido.</p>
        <Link href="/login" className="btn-primary mt-4 inline-flex">Ir al login</Link>
      </Centered>
    );
  }
  if (invitation.acceptedAt) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Invitación ya usada</h1>
        <p className="text-slate-600 mt-2">Esta invitación ya fue aceptada.</p>
        <Link href="/login" className="btn-primary mt-4 inline-flex">Ir al login</Link>
      </Centered>
    );
  }
  if (invitation.expiresAt < new Date()) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Invitación expirada</h1>
        <p className="text-slate-600 mt-2">Pedile a quien te invitó que te envíe una nueva.</p>
      </Centered>
    );
  }

  const session = await auth();
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });

  return (
    <Centered>
      <h1 className="text-xl font-bold">Invitación a Cuidado Mayor</h1>
      <p className="text-slate-700 mt-2">
        <strong>{invitation.invitedBy.name}</strong> te invitó a colaborar en el cuidado de{' '}
        <strong>{invitation.patient.fullName}</strong> como <strong>{roleLabel(invitation.patientRole)}</strong>.
      </p>

      {session ? (
        session.user.email.toLowerCase() === invitation.email.toLowerCase() ? (
          <form action={acceptForLoggedUser} className="mt-5">
            <input type="hidden" name="token" value={params.token} />
            <button type="submit" className="btn-primary btn-lg w-full">Aceptar invitación</button>
          </form>
        ) : (
          <p className="text-amber-700 mt-4">
            Estás logueado como {session.user.email}, pero esta invitación es para {invitation.email}.
            Salí de tu cuenta para aceptarla.
          </p>
        )
      ) : existingUser ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-slate-600">Ya tenés cuenta. Iniciá sesión para aceptar.</p>
          <Link
            href={`/login?callbackUrl=/aceptar-invitacion/${params.token}`}
            className="btn-primary btn-lg w-full inline-flex justify-center"
          >
            Iniciar sesión
          </Link>
        </div>
      ) : (
        <form action={acceptAndCreateUser} className="mt-5 space-y-3">
          <input type="hidden" name="token" value={params.token} />
          <div>
            <label className="label">Tu nombre</label>
            <input name="name" required className="input" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={invitation.email} readOnly />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input name="password" type="password" minLength={8} required className="input" />
          </div>
          <button type="submit" className="btn-primary btn-lg w-full">Crear cuenta y aceptar</button>
        </form>
      )}
    </Centered>
  );
}

function roleLabel(r: PatientRole) {
  return r === PatientRole.ADMIN ? 'Administrador' : r === PatientRole.CAREGIVER ? 'Cuidadora' : 'Familiar';
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
      <div className="card w-full max-w-md text-center">{children}</div>
    </main>
  );
}
