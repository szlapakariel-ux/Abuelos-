/**
 * Seed con datos FICTICIOS para demo MVP.
 * No contiene datos médicos reales.
 *
 * Ejecutar con: npm run db:seed
 * Requiere DATABASE_URL en el entorno.
 *
 * Usuarios creados (todos con contraseña: Demo1234!):
 *   Familia García (modo familiar):
 *     admin@familia-demo.local     — FAMILY_ADMIN (administradora)
 *     julian@familia-demo.local    — FAMILY_MEMBER (hijo observador)
 *     maria@familia-demo.local     — CAREGIVER (cuidadora)
 *
 *   Agencia Cuidados del Sol (modo agencia):
 *     admin@agencia-demo.local     — AGENCY_ADMIN
 *     ana@agencia-demo.local       — CAREGIVER (cuidadora paciente 1)
 *     beatriz@agencia-demo.local   — CAREGIVER (cuidadora paciente 2)
 *
 * Archivos médicos: los registros existen en DB pero el storageKey apunta
 * a objetos inexistentes en R2. La descarga fallará en demo; sirve para
 * mostrar la UI. Para demo real, subir archivos desde la app.
 */

import {
  PrismaClient,
  OrgType,
  GlobalRole,
  PatientRole,
  TimeSlot,
  MedStatus,
  TakeStatus,
  VitalStatus,
  MealType,
  IntakeLevel,
  LiquidLevel,
  Mood,
  SleepQuality,
  MobilityStatus,
  HygieneStatus,
  BowelStatus,
  PainLevel,
  MedicalEventType,
  AlertType,
  AlertSeverity,
  AlertStatus,
  FileCategory,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── helpers de fecha ────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function todayAt(hour: number, min = 0): Date {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return d;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Sembrando datos ficticios para demo MVP...\n');

  // ── limpieza idempotente ──────────────────────────────────────────────────
  await prisma.auditLog.deleteMany();
  await prisma.medicationLog.deleteMany();
  await prisma.medicalFile.deleteMany();
  await prisma.patientFile.deleteMany();
  await prisma.medicalEvent.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.dailyStatus.deleteMany();
  await prisma.mealLog.deleteMany();
  await prisma.vitalSign.deleteMany();
  await prisma.medicationSchedule.deleteMany();
  await prisma.medication.deleteMany();
  await prisma.patientUser.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const pw = await bcrypt.hash('Demo1234!', 10);

  // ══════════════════════════════════════════════════════════════════════════
  // ORGANIZACIÓN 1 — FAMILIAR
  // ══════════════════════════════════════════════════════════════════════════
  const orgFamilia = await prisma.organization.create({
    data: { name: 'Familia García (demo)', type: OrgType.FAMILY },
  });

  const [laura, julian, maria] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@familia-demo.local',
        name: 'Laura García',
        passwordHash: pw,
        globalRole: GlobalRole.FAMILY_ADMIN,
        organizationId: orgFamilia.id,
        lastLoginAt: daysAgo(0),
      },
    }),
    prisma.user.create({
      data: {
        email: 'julian@familia-demo.local',
        name: 'Julián García',
        passwordHash: pw,
        globalRole: GlobalRole.FAMILY_MEMBER,
        organizationId: orgFamilia.id,
        lastLoginAt: daysAgo(2),
      },
    }),
    prisma.user.create({
      data: {
        email: 'maria@familia-demo.local',
        name: 'María López',
        passwordHash: pw,
        globalRole: GlobalRole.CAREGIVER,
        organizationId: orgFamilia.id,
        lastLoginAt: daysAgo(0),
      },
    }),
  ]);

  // ── Paciente familiar: Rosa Martínez ─────────────────────────────────────
  const rosa = await prisma.patient.create({
    data: {
      organizationId: orgFamilia.id,
      fullName: 'Rosa Martínez',
      birthDate: new Date('1947-04-12'),
      dni: '12345678',
      phone: '011-4567-8901',
      healthInsurance: 'PAMI',
      affiliateNumber: '00-1234-5678-9',
      primaryDoctor: 'Dr. Rodolfo Sánchez',
      primaryDoctorPhone: '011-4444-5555',
      emergencyContactName: 'Laura García (hija)',
      emergencyContactPhone: '011-9999-0000',
      allergies: 'Ninguna conocida (ficticio)',
      relevantDiagnoses: 'Hipertensión arterial leve. Diabetes tipo 2 controlada. (Datos ficticios)',
      dietaryRestrictions: 'Dieta hiposódica (ficticio)',
      mobilityLevel: 'WITH_HELP',
      fallRisk: 'MEDIUM',
      importantNotes: 'Tomar la presión siempre en el brazo derecho. Tiene audífono en el oído izquierdo. DATOS DE DEMOSTRACIÓN.',
      sysNormalMin: 110,
      sysNormalMax: 135,
      sysReviewMax: 150,
      diaNormalMin: 60,
      diaNormalMax: 85,
      diaReviewMax: 95,
    },
  });

  await prisma.patientUser.createMany({
    data: [
      { patientId: rosa.id, userId: laura.id, patientRole: PatientRole.ADMIN, canUploadFiles: true, canEditMedical: true, receivesEmailReports: true },
      { patientId: rosa.id, userId: julian.id, patientRole: PatientRole.FAMILY, canUploadFiles: false, canEditMedical: false, receivesEmailReports: true },
      { patientId: rosa.id, userId: maria.id, patientRole: PatientRole.CAREGIVER, canUploadFiles: true, canEditMedical: false, receivesEmailReports: false },
    ],
  });

  // Medicaciones de Rosa
  const enalapril = await prisma.medication.create({
    data: {
      patientId: rosa.id,
      name: 'Enalapril',
      dose: '10 mg',
      frequencyText: 'Mañana y noche',
      instructions: 'Tomar con un vaso de agua. No saltear dosis.',
      prescribingDoctor: 'Dr. Rodolfo Sánchez',
      startDate: daysAgo(60),
      status: MedStatus.ACTIVE,
      createdById: laura.id,
      schedules: { create: [{ timeSlot: TimeSlot.MORNING }, { timeSlot: TimeSlot.NIGHT }] },
    },
  });

  const metformina = await prisma.medication.create({
    data: {
      patientId: rosa.id,
      name: 'Metformina',
      dose: '500 mg',
      frequencyText: '1 vez al mediodía',
      instructions: 'Tomar con la comida para evitar molestias gástricas.',
      prescribingDoctor: 'Dr. Rodolfo Sánchez',
      startDate: daysAgo(90),
      prescriptionExpiry: daysAgo(-20), // vence en 20 días
      status: MedStatus.ACTIVE,
      createdById: laura.id,
      schedules: { create: [{ timeSlot: TimeSlot.NOON }] },
    },
  });

  const aspirina = await prisma.medication.create({
    data: {
      patientId: rosa.id,
      name: 'Aspirina',
      dose: '100 mg',
      frequencyText: '1 vez a la mañana',
      instructions: 'Tomar con el desayuno.',
      prescribingDoctor: 'Dr. Rodolfo Sánchez',
      startDate: daysAgo(120),
      status: MedStatus.ACTIVE,
      createdById: laura.id,
      schedules: { create: [{ timeSlot: TimeSlot.MORNING }] },
    },
  });

  // Logs de medicación hoy: mañana tomadas, mediodía y noche pendientes
  const todayStart = startOfDay(new Date());
  await prisma.medicationLog.createMany({
    data: [
      {
        medicationId: enalapril.id,
        scheduleSlot: TimeSlot.MORNING,
        scheduledFor: todayAt(8),
        recordedAt: todayAt(8, 15),
        status: TakeStatus.TAKEN,
        recordedById: maria.id,
      },
      {
        medicationId: aspirina.id,
        scheduleSlot: TimeSlot.MORNING,
        scheduledFor: todayAt(8),
        recordedAt: todayAt(8, 15),
        status: TakeStatus.TAKEN,
        recordedById: maria.id,
      },
    ],
  });

  // Logs históricos (ayer) — metformina no tomada
  await prisma.medicationLog.createMany({
    data: [
      {
        medicationId: enalapril.id,
        scheduleSlot: TimeSlot.MORNING,
        scheduledFor: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000),
        recordedAt: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000 + 10 * 60 * 1000),
        status: TakeStatus.TAKEN,
        recordedById: maria.id,
      },
      {
        medicationId: metformina.id,
        scheduleSlot: TimeSlot.NOON,
        scheduledFor: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000),
        recordedAt: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000 + 5 * 60 * 1000),
        status: TakeStatus.NOT_TAKEN,
        notes: 'No quiso comer al mediodía',
        recordedById: maria.id,
      },
      {
        medicationId: enalapril.id,
        scheduleSlot: TimeSlot.NIGHT,
        scheduledFor: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 20 * 60 * 60 * 1000),
        recordedAt: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 20 * 60 * 60 * 1000 + 10 * 60 * 1000),
        status: TakeStatus.TAKEN,
        recordedById: maria.id,
      },
    ],
  });

  // Signos vitales de Rosa
  await prisma.vitalSign.createMany({
    data: [
      {
        patientId: rosa.id,
        systolic: 128,
        diastolic: 78,
        pulse: 72,
        oxygenSat: 97,
        recordedAt: todayAt(8, 30),
        status: VitalStatus.NORMAL,
        recordedById: maria.id,
      },
      {
        patientId: rosa.id,
        systolic: 145,
        diastolic: 88,
        pulse: 80,
        oxygenSat: 96,
        recordedAt: daysAgo(3),
        status: VitalStatus.REVIEW,
        notes: 'Había caminado bastante antes',
        recordedById: maria.id,
      },
      {
        patientId: rosa.id,
        systolic: 118,
        diastolic: 72,
        pulse: 68,
        oxygenSat: 98,
        recordedAt: daysAgo(7),
        status: VitalStatus.NORMAL,
        recordedById: maria.id,
      },
    ],
  });

  // Comidas de Rosa hoy
  await prisma.mealLog.createMany({
    data: [
      {
        patientId: rosa.id,
        date: todayAt(8, 0),
        mealType: MealType.BREAKFAST,
        intake: IntakeLevel.GOOD,
        liquidIntake: LiquidLevel.GOOD,
        notes: 'Comió muy bien, buen apetito.',
        recordedById: maria.id,
      },
      {
        patientId: rosa.id,
        date: daysAgo(1),
        mealType: MealType.LUNCH,
        intake: IntakeLevel.SOME,
        liquidIntake: LiquidLevel.LOW,
        notes: 'Comió la mitad, dijo que no tenía hambre.',
        recordedById: maria.id,
      },
    ],
  });

  // Estado general de Rosa hoy
  await prisma.dailyStatus.create({
    data: {
      patientId: rosa.id,
      date: todayAt(9, 0),
      mood: Mood.GOOD,
      sleep: SleepQuality.FAIR,
      mobility: MobilityStatus.WITH_HELP,
      hygiene: HygieneStatus.DONE,
      bowel: BowelStatus.NORMAL,
      pain: PainLevel.NONE,
      notes: 'Durmió algo inquieta, pero el día arrancó bien.',
      recordedById: maria.id,
    },
  });

  // Historial médico de Rosa
  const consultaRosa = await prisma.medicalEvent.create({
    data: {
      patientId: rosa.id,
      date: daysAgo(30),
      type: MedicalEventType.CONSULTATION,
      professional: 'Dr. Rodolfo Sánchez',
      institution: 'Consultorio particular',
      reason: 'Control mensual de presión arterial',
      summary: 'Presión bien controlada. Continúa con medicación habitual. Próximo control en 1 mes.',
      indications: 'Mantener dieta hiposódica. Caminata suave 20 min/día.',
      searchText: 'consulta cardiología dr sánchez presión arterial control mensual',
      uploadedById: laura.id,
    },
  });

  await prisma.medicalEvent.create({
    data: {
      patientId: rosa.id,
      date: daysAgo(90),
      type: MedicalEventType.LAB,
      professional: 'Laboratorio Central (demo)',
      reason: 'Análisis de control trimestral',
      summary: 'Glucemia 108 mg/dl. Creatinina 0.9. Hemograma normal. (Valores ficticios)',
      searchText: 'laboratorio análisis glucemia creatinina hemograma trimestral',
      uploadedById: laura.id,
    },
  });

  // Archivo médico ficticio adjunto a la consulta
  await prisma.medicalFile.create({
    data: {
      medicalEventId: consultaRosa.id,
      patientId: rosa.id,
      name: 'Informe consulta cardiología - enero 2025.pdf',
      description: 'Resumen de consulta mensual (archivo de demostración)',
      storageKey: 'demo/placeholder-informe-cardiologia.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 204800,
      category: FileCategory.REPORT,
      searchText: 'informe consulta cardiología enero 2025',
      uploadedById: laura.id,
    },
  });

  // Alertas de Rosa
  await prisma.alert.createMany({
    data: [
      // Alerta abierta: medicación no tomada ayer
      {
        patientId: rosa.id,
        type: AlertType.MED_NOT_TAKEN,
        title: 'Medicación no tomada',
        message: 'Metformina 500 mg: marcada como NO TOMÓ.',
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        isResolved: false,
        sourceType: 'MedicationLog',
        metadata: { medicationId: metformina.id },
      },
      // Alerta resuelta: presión a revisar (hace 3 días, ya normalizada)
      {
        patientId: rosa.id,
        type: AlertType.VITAL_REVIEW,
        title: 'Presión a revisar',
        message: 'Presión 145/88 — requiere revisión.',
        severity: AlertSeverity.WARNING,
        status: AlertStatus.RESOLVED,
        isResolved: true,
        resolvedAt: daysAgo(2),
        resolutionReason: 'Presión posterior fue normal. Se normalizó sola.',
        resolvedById: laura.id,
        sourceType: 'VitalSign',
        metadata: { systolic: 145, diastolic: 88 },
      },
    ],
  });

  // Audit logs de Rosa
  await prisma.auditLog.createMany({
    data: [
      {
        userId: laura.id,
        action: 'patient.create',
        entityType: 'Patient',
        entityId: rosa.id,
        metadata: { orgId: orgFamilia.id },
        createdAt: daysAgo(95),
      },
      {
        userId: laura.id,
        action: 'patientRanges.update',
        entityType: 'Patient',
        entityId: rosa.id,
        metadata: { patientId: rosa.id, fields: ['sysNormalMax', 'diaReviewMax'] },
        createdAt: daysAgo(30),
      },
      {
        userId: maria.id,
        action: 'vital.record',
        entityType: 'VitalSign',
        entityId: rosa.id,
        metadata: { patientId: rosa.id, systolic: 128, diastolic: 78 },
        createdAt: todayAt(8, 30),
      },
      {
        userId: maria.id,
        action: 'medicalEvent.create',
        entityType: 'MedicalEvent',
        entityId: consultaRosa.id,
        metadata: { patientId: rosa.id, type: 'CONSULTATION', filesCount: 1 },
        createdAt: daysAgo(30),
      },
      {
        userId: laura.id,
        action: 'alert.resolved.manual',
        entityType: 'Alert',
        entityId: rosa.id,
        metadata: { patientId: rosa.id, reason: 'Presión posterior fue normal.' },
        createdAt: daysAgo(2),
      },
    ],
  });

  console.log('✅ Organización familiar: Familia García (demo)');
  console.log(`   👤 admin@familia-demo.local     → FAMILY_ADMIN (Laura García)`);
  console.log(`   👤 julian@familia-demo.local    → FAMILY_MEMBER (Julián García)`);
  console.log(`   👤 maria@familia-demo.local     → CAREGIVER (María López)`);
  console.log(`   🏥 Paciente: Rosa Martínez (77 años)`);
  console.log(`      💊 Enalapril 10mg, Metformina 500mg, Aspirina 100mg`);
  console.log(`      📋 2 eventos médicos, 1 archivo adjunto (placeholder)`);
  console.log(`      🔔 1 alerta abierta, 1 resuelta`);

  // ══════════════════════════════════════════════════════════════════════════
  // ORGANIZACIÓN 2 — AGENCIA
  // ══════════════════════════════════════════════════════════════════════════
  const orgAgencia = await prisma.organization.create({
    data: { name: 'Agencia Cuidados del Sol (demo)', type: OrgType.AGENCY },
  });

  const [sergio, ana, beatriz] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@agencia-demo.local',
        name: 'Sergio Torres',
        passwordHash: pw,
        globalRole: GlobalRole.AGENCY_ADMIN,
        organizationId: orgAgencia.id,
        lastLoginAt: daysAgo(0),
      },
    }),
    prisma.user.create({
      data: {
        email: 'ana@agencia-demo.local',
        name: 'Ana Rodríguez',
        passwordHash: pw,
        globalRole: GlobalRole.CAREGIVER,
        organizationId: orgAgencia.id,
        lastLoginAt: daysAgo(0),
      },
    }),
    prisma.user.create({
      data: {
        email: 'beatriz@agencia-demo.local',
        name: 'Beatriz Fernández',
        passwordHash: pw,
        globalRole: GlobalRole.CAREGIVER,
        organizationId: orgAgencia.id,
        lastLoginAt: daysAgo(1),
      },
    }),
  ]);

  // ── Paciente agencia 1: Alberto Gómez (sin registros hoy = muestra alerta) ──
  const alberto = await prisma.patient.create({
    data: {
      organizationId: orgAgencia.id,
      fullName: 'Alberto Gómez',
      birthDate: new Date('1942-08-20'),
      dni: '8765432',
      phone: '011-3456-7890',
      healthInsurance: 'Swiss Medical (demo)',
      affiliateNumber: 'SM-987654',
      primaryDoctor: 'Dra. Cecilia Romero',
      primaryDoctorPhone: '011-3333-4444',
      emergencyContactName: 'Lucía Gómez (hija)',
      emergencyContactPhone: '011-8888-9999',
      allergies: 'Penicilina (dato ficticio)',
      relevantDiagnoses: 'Hipertensión arterial. Diabetes tipo 2. ACV isquémico leve (hace 2 años). (Datos ficticios)',
      mobilityLevel: 'WITH_HELP',
      fallRisk: 'HIGH',
      importantNotes: 'Riesgo de caídas alto. Caminar siempre con acompañante. No dejar solo en el baño. DATOS DE DEMOSTRACIÓN.',
      sysNormalMin: 115,
      sysNormalMax: 140,
      sysReviewMax: 160,
      diaNormalMin: 65,
      diaNormalMax: 90,
      diaReviewMax: 100,
    },
  });

  await prisma.patientUser.createMany({
    data: [
      { patientId: alberto.id, userId: sergio.id, patientRole: PatientRole.ADMIN, canUploadFiles: true, canEditMedical: true, receivesEmailReports: true },
      { patientId: alberto.id, userId: ana.id, patientRole: PatientRole.CAREGIVER, canUploadFiles: false, canEditMedical: false, receivesEmailReports: false },
    ],
  });

  const losartan = await prisma.medication.create({
    data: {
      patientId: alberto.id,
      name: 'Losartán',
      dose: '50 mg',
      frequencyText: 'Mañana y noche',
      instructions: 'Tomar con poca agua, nunca en ayunas.',
      prescribingDoctor: 'Dra. Cecilia Romero',
      startDate: daysAgo(180),
      prescriptionExpiry: daysAgo(-5), // vence en 5 días — genera alerta PRESCRIPTION_EXPIRY
      status: MedStatus.ACTIVE,
      createdById: sergio.id,
      schedules: { create: [{ timeSlot: TimeSlot.MORNING }, { timeSlot: TimeSlot.NIGHT }] },
    },
  });

  await prisma.medication.create({
    data: {
      patientId: alberto.id,
      name: 'Metformina',
      dose: '850 mg',
      frequencyText: '1 vez al mediodía',
      instructions: 'Con la comida. No tomar si come poco.',
      prescribingDoctor: 'Dra. Cecilia Romero',
      startDate: daysAgo(180),
      status: MedStatus.ACTIVE,
      createdById: sergio.id,
      schedules: { create: [{ timeSlot: TimeSlot.NOON }] },
    },
  });

  // Vital reciente con alerta crítica — hace 2 días
  const vitalAlbertoCrit = await prisma.vitalSign.create({
    data: {
      patientId: alberto.id,
      systolic: 172,
      diastolic: 104,
      pulse: 88,
      recordedAt: daysAgo(2),
      status: VitalStatus.ALERT,
      notes: 'Se quejó de dolor de cabeza.',
      recordedById: ana.id,
    },
  });

  // Vital histórico normal
  await prisma.vitalSign.create({
    data: {
      patientId: alberto.id,
      systolic: 135,
      diastolic: 82,
      pulse: 75,
      recordedAt: daysAgo(10),
      status: VitalStatus.NORMAL,
      recordedById: ana.id,
    },
  });

  // Sin registros HOY (intencional — genera "sin registros hoy" en panel agencia)

  // Historial de Alberto
  const eventAlberto = await prisma.medicalEvent.create({
    data: {
      patientId: alberto.id,
      date: daysAgo(14),
      type: MedicalEventType.CONSULTATION,
      professional: 'Dra. Cecilia Romero',
      institution: 'Centro Médico del Sur (demo)',
      reason: 'Control mensual + presión elevada',
      summary: 'Tensión elevada. Se ajusta dosis de Losartán. Próximo control en 2 semanas.',
      indications: 'Reposo relativo. Control diario de presión. Dieta estricta sin sal.',
      searchText: 'consulta dra romero presión elevada losartán ajuste dosis',
      uploadedById: sergio.id,
    },
  });

  await prisma.medicalFile.create({
    data: {
      medicalEventId: eventAlberto.id,
      patientId: alberto.id,
      name: 'Indicaciones médicas - control presión.pdf',
      description: 'Indicaciones post-consulta (archivo de demostración)',
      storageKey: 'demo/placeholder-indicaciones-alberto.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 102400,
      category: FileCategory.PRESCRIPTION,
      searchText: 'indicaciones médicas control presión',
      uploadedById: sergio.id,
    },
  });

  // Alertas de Alberto — dos abiertas críticas para el panel de agencia
  await prisma.alert.createMany({
    data: [
      {
        patientId: alberto.id,
        type: AlertType.VITAL_OUT_OF_RANGE,
        title: 'Presión fuera de rango (alerta)',
        message: 'Presión 172/104 — avisar al médico.',
        severity: AlertSeverity.CRITICAL,
        status: AlertStatus.OPEN,
        isResolved: false,
        sourceType: 'VitalSign',
        sourceId: vitalAlbertoCrit.id,
        metadata: { systolic: 172, diastolic: 104, status: 'ALERT' },
      },
      {
        patientId: alberto.id,
        type: AlertType.PRESCRIPTION_EXPIRY,
        title: 'Receta próxima a vencer',
        message: `La receta de Losartán vence el ${daysAgo(-5).toLocaleDateString('es-AR')}.`,
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        isResolved: false,
        sourceType: 'Medication',
        sourceId: `${losartan.id}|${daysAgo(-5).toISOString().slice(0, 10)}`,
        metadata: { medicationId: losartan.id },
      },
      {
        patientId: alberto.id,
        type: AlertType.DAILY_LOG_MISSING,
        title: 'Día sin registros',
        message: `No se registró ninguna actividad el ${daysAgo(1).toLocaleDateString('es-AR')}.`,
        severity: AlertSeverity.WARNING,
        status: AlertStatus.OPEN,
        isResolved: false,
        sourceType: 'Day',
        sourceId: daysAgo(1).toISOString().slice(0, 10),
        metadata: { day: daysAgo(1).toISOString().slice(0, 10) },
      },
    ],
  });

  console.log('\n✅ Organización agencia: Agencia Cuidados del Sol (demo)');
  console.log(`   👤 admin@agencia-demo.local     → AGENCY_ADMIN (Sergio Torres)`);
  console.log(`   👤 ana@agencia-demo.local        → CAREGIVER (Ana Rodríguez)`);
  console.log(`   👤 beatriz@agencia-demo.local    → CAREGIVER (Beatriz Fernández)`);
  console.log(`   🏥 Paciente 1: Alberto Gómez (82 años) — SIN registros hoy`);
  console.log(`      🚨 Alerta crítica: presión 172/104`);
  console.log(`      ⚠️  Receta Losartán vence pronto`);
  console.log(`      ⚠️  Día sin registros ayer`);

  // ── Paciente agencia 2: Carmen López (con todo al día) ───────────────────
  const carmen = await prisma.patient.create({
    data: {
      organizationId: orgAgencia.id,
      fullName: 'Carmen López',
      birthDate: new Date('1946-01-30'),
      dni: '5432198',
      phone: '011-2345-6789',
      healthInsurance: 'OSDE (demo)',
      affiliateNumber: 'OSDE-555444',
      primaryDoctor: 'Dra. Marta Villanueva',
      primaryDoctorPhone: '011-2222-3333',
      emergencyContactName: 'Roberto López (hijo)',
      emergencyContactPhone: '011-7777-8888',
      allergies: 'Ibuprofeno (dato ficticio)',
      relevantDiagnoses: 'Osteoporosis. Artrosis de rodilla. Hipotiroidismo controlado. (Datos ficticios)',
      mobilityLevel: 'WITH_HELP',
      fallRisk: 'MEDIUM',
      importantNotes: 'Caminar con andador. No levantar peso. Tomar Levotiroxina en ayunas, 30 min antes del desayuno. DATOS DE DEMOSTRACIÓN.',
      sysNormalMin: 100,
      sysNormalMax: 140,
      sysReviewMax: 160,
      diaNormalMin: 60,
      diaNormalMax: 90,
      diaReviewMax: 100,
    },
  });

  await prisma.patientUser.createMany({
    data: [
      { patientId: carmen.id, userId: sergio.id, patientRole: PatientRole.ADMIN, canUploadFiles: true, canEditMedical: true, receivesEmailReports: true },
      { patientId: carmen.id, userId: beatriz.id, patientRole: PatientRole.CAREGIVER, canUploadFiles: true, canEditMedical: false, receivesEmailReports: false },
    ],
  });

  const calcio = await prisma.medication.create({
    data: {
      patientId: carmen.id,
      name: 'Calcio + Vitamina D',
      dose: '500 mg / 400 UI',
      frequencyText: 'Mañana y noche',
      instructions: 'Tomar con el desayuno y la cena.',
      prescribingDoctor: 'Dra. Marta Villanueva',
      startDate: daysAgo(200),
      status: MedStatus.ACTIVE,
      createdById: sergio.id,
      schedules: { create: [{ timeSlot: TimeSlot.MORNING }, { timeSlot: TimeSlot.NIGHT }] },
    },
  });

  const levotiroxina = await prisma.medication.create({
    data: {
      patientId: carmen.id,
      name: 'Levotiroxina',
      dose: '75 mcg',
      frequencyText: '1 vez a la mañana, en ayunas',
      instructions: 'IMPORTANTE: tomar en ayunas, 30 minutos antes de cualquier alimento.',
      prescribingDoctor: 'Dra. Marta Villanueva',
      startDate: daysAgo(365),
      status: MedStatus.ACTIVE,
      createdById: sergio.id,
      schedules: { create: [{ timeSlot: TimeSlot.MORNING }] },
    },
  });

  // Registros completos de Carmen hoy
  await prisma.medicationLog.createMany({
    data: [
      {
        medicationId: calcio.id,
        scheduleSlot: TimeSlot.MORNING,
        scheduledFor: todayAt(8),
        recordedAt: todayAt(8, 20),
        status: TakeStatus.TAKEN,
        recordedById: beatriz.id,
      },
      {
        medicationId: levotiroxina.id,
        scheduleSlot: TimeSlot.MORNING,
        scheduledFor: todayAt(7, 30),
        recordedAt: todayAt(7, 35),
        status: TakeStatus.TAKEN,
        notes: 'Tomó en ayunas, luego desayunó.',
        recordedById: beatriz.id,
      },
    ],
  });

  await prisma.vitalSign.createMany({
    data: [
      {
        patientId: carmen.id,
        systolic: 122,
        diastolic: 74,
        pulse: 66,
        oxygenSat: 97,
        recordedAt: todayAt(9, 0),
        status: VitalStatus.NORMAL,
        recordedById: beatriz.id,
      },
      {
        patientId: carmen.id,
        systolic: 118,
        diastolic: 70,
        pulse: 64,
        recordedAt: daysAgo(3),
        status: VitalStatus.NORMAL,
        recordedById: beatriz.id,
      },
    ],
  });

  await prisma.mealLog.createMany({
    data: [
      {
        patientId: carmen.id,
        date: todayAt(8, 0),
        mealType: MealType.BREAKFAST,
        intake: IntakeLevel.GOOD,
        liquidIntake: LiquidLevel.GOOD,
        notes: 'Desayuno completo. Buena ingesta.',
        recordedById: beatriz.id,
      },
    ],
  });

  await prisma.dailyStatus.create({
    data: {
      patientId: carmen.id,
      date: todayAt(9, 30),
      mood: Mood.GOOD,
      sleep: SleepQuality.GOOD,
      mobility: MobilityStatus.WITH_HELP,
      hygiene: HygieneStatus.DONE,
      bowel: BowelStatus.NORMAL,
      pain: PainLevel.MILD,
      notes: 'Leve dolor articular en rodilla derecha, habitual.',
      recordedById: beatriz.id,
    },
  });

  // Historial de Carmen
  const eventCarmen = await prisma.medicalEvent.create({
    data: {
      patientId: carmen.id,
      date: daysAgo(45),
      type: MedicalEventType.STUDY,
      professional: 'Dra. Marta Villanueva',
      institution: 'Centro de diagnóstico (demo)',
      reason: 'Densitometría ósea de control',
      summary: 'Osteoporosis moderada en columna lumbar. T-score -2.8. Sin fracturas. (Valores ficticios)',
      indications: 'Continuar calcio + vit D. Ejercicios de bajo impacto. Control en 1 año.',
      searchText: 'densitometría ósea osteoporosis columna lumbar t-score control',
      uploadedById: sergio.id,
    },
  });

  await prisma.medicalFile.create({
    data: {
      medicalEventId: eventCarmen.id,
      patientId: carmen.id,
      name: 'Densitometría ósea - resultado.pdf',
      description: 'Resultado densitometría control anual (archivo de demostración)',
      storageKey: 'demo/placeholder-densitometria-carmen.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512000,
      category: FileCategory.IMAGING,
      searchText: 'densitometría ósea resultado',
      uploadedById: sergio.id,
    },
  });

  // Carmen sin alertas abiertas (todo al día)

  // Audit logs de agencia
  await prisma.auditLog.createMany({
    data: [
      {
        userId: sergio.id,
        action: 'patient.create',
        entityType: 'Patient',
        entityId: alberto.id,
        metadata: { orgId: orgAgencia.id },
        createdAt: daysAgo(200),
      },
      {
        userId: sergio.id,
        action: 'patient.create',
        entityType: 'Patient',
        entityId: carmen.id,
        metadata: { orgId: orgAgencia.id },
        createdAt: daysAgo(200),
      },
      {
        userId: ana.id,
        action: 'vital.record',
        entityType: 'VitalSign',
        entityId: vitalAlbertoCrit.id,
        metadata: { patientId: alberto.id, systolic: 172, diastolic: 104 },
        createdAt: daysAgo(2),
      },
      {
        userId: beatriz.id,
        action: 'vital.record',
        entityType: 'VitalSign',
        entityId: carmen.id,
        metadata: { patientId: carmen.id, systolic: 122, diastolic: 74 },
        createdAt: todayAt(9, 0),
      },
      {
        userId: sergio.id,
        action: 'medicalEvent.create',
        entityType: 'MedicalEvent',
        entityId: eventAlberto.id,
        metadata: { patientId: alberto.id, type: 'CONSULTATION', filesCount: 1 },
        createdAt: daysAgo(14),
      },
    ],
  });

  console.log(`   🏥 Paciente 2: Carmen López (79 años) — registros completos hoy`);
  console.log(`      💊 Calcio+VitD, Levotiroxina`);
  console.log(`      📋 1 evento médico (densitometría), 1 archivo adjunto (placeholder)`);
  console.log(`      ✅ Sin alertas abiertas`);

  console.log('\n' + '─'.repeat(60));
  console.log('📋 RESUMEN DE USUARIOS DEMO (contraseña: Demo1234!)');
  console.log('─'.repeat(60));
  console.log('FAMILIA GARCÍA:');
  console.log('  admin@familia-demo.local  → FAMILY_ADMIN');
  console.log('  julian@familia-demo.local → FAMILY_MEMBER (solo visualiza)');
  console.log('  maria@familia-demo.local  → CAREGIVER');
  console.log('AGENCIA CUIDADOS DEL SOL:');
  console.log('  admin@agencia-demo.local  → AGENCY_ADMIN');
  console.log('  ana@agencia-demo.local    → CAREGIVER (paciente: Alberto)');
  console.log('  beatriz@agencia-demo.local→ CAREGIVER (paciente: Carmen)');
  console.log('─'.repeat(60));
  console.log('⚠️  Los archivos médicos son PLACEHOLDER (storageKey demo/).');
  console.log('   La descarga fallará. Subir archivos reales desde la app.');
  console.log('─'.repeat(60));
  console.log('✅ Seed completado.\n');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
