import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { GlobalRole, OrgType } from '@prisma/client';

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(2),
  orgType: z.enum(['FAMILY', 'AGENCY']),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }
  const { name, email, password, orgName, orgType } = parsed.data;
  const lowerEmail = email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
  if (existing) {
    return NextResponse.json({ error: 'Ese email ya tiene una cuenta' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const globalRole = orgType === 'AGENCY' ? GlobalRole.AGENCY_ADMIN : GlobalRole.FAMILY_ADMIN;

  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: orgName, type: orgType as OrgType },
    });
    return tx.user.create({
      data: {
        name,
        email: lowerEmail,
        passwordHash,
        globalRole,
        organizationId: org.id,
      },
    });
  });

  return NextResponse.json({ id: user.id });
}
