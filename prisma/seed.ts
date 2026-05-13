/**
 * Seed con datos FICTICIOS. No usar datos médicos reales.
 * Ejecutar con: npm run db:seed
 */
import { PrismaClient, OrgType, GlobalRole, PatientRole, TimeSlot, MedStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando datos ficticios...');

  // Limpieza idempotente
  await prisma.medicationSchedule.deleteMany();
  await prisma.medication.deleteMany();
  await prisma.patientUser.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Familia ficticia
  const family = await prisma.organization.create({
    data: { name: 'Familia García (demo)', type: OrgType.FAMILY },
  });

  const passwordHash = await bcrypt.hash('demo1234', 10);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@demo.local',
      name: 'Laura García',
      passwordHash,
      globalRole: GlobalRole.FAMILY_ADMIN,
      organizationId: family.id,
    },
  });

  const caregiver = await prisma.user.create({
    data: {
      email: 'cuidadora@demo.local',
      name: 'María López',
      passwordHash,
      globalRole: GlobalRole.CAREGIVER,
      organizationId: family.id,
    },
  });

  const patient = await prisma.patient.create({
    data: {
      organizationId: family.id,
      fullName: 'Roberto García',
      birthDate: new Date('1942-03-15'),
      healthInsurance: 'PAMI',
      affiliateNumber: '00000000-DEMO',
      allergies: 'Ninguna conocida',
      relevantDiagnoses: 'Hipertensión leve (datos ficticios)',
      mobilityLevel: 'WITH_HELP',
      fallRisk: 'MEDIUM',
      importantNotes: 'Datos de demostración — NO son datos reales.',
    },
  });

  await prisma.patientUser.createMany({
    data: [
      { patientId: patient.id, userId: admin.id, patientRole: PatientRole.ADMIN, canUploadFiles: true, canEditMedical: true },
      { patientId: patient.id, userId: caregiver.id, patientRole: PatientRole.CAREGIVER, canUploadFiles: true },
    ],
  });

  const med = await prisma.medication.create({
    data: {
      patientId: patient.id,
      name: 'Enalapril',
      dose: '10mg',
      instructions: 'Tomar con un vaso de agua',
      startDate: new Date(),
      status: MedStatus.ACTIVE,
      createdById: admin.id,
      schedules: { create: [{ timeSlot: TimeSlot.MORNING }, { timeSlot: TimeSlot.NIGHT }] },
    },
  });

  console.log(`✅ Familia: ${family.name}`);
  console.log(`✅ Admin:     admin@demo.local / demo1234`);
  console.log(`✅ Cuidadora: cuidadora@demo.local / demo1234`);
  console.log(`✅ Paciente:  ${patient.fullName}`);
  console.log(`✅ Medicación: ${med.name} ${med.dose}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
