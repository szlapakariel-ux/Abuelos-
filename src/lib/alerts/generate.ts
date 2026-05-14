/**
 * Motor de alertas. Idempotente: si ya existe una alerta abierta con la misma
 * (patientId, type, sourceId), no se crea de nuevo.
 *
 * Diseñado para correrse cada N minutos vía /api/jobs/generate-alerts.
 */
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getDaySchedule, SLOT_LABEL, type MedicationWithRel } from '@/lib/medication-day';
import { startOfTodayAR, endOfTodayAR, startOfYesterdayAR, formatDateAR } from '@/lib/date';
import { ALERT_TYPE_LABEL, severityFor } from './types';
import type { AlertType, Prisma } from '@prisma/client';

type CreateAlertInput = {
  patientId: string;
  type: AlertType;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Crea una alerta si no existe una abierta idéntica (mismo patientId+type+sourceId).
 * Devuelve true si se creó, false si ya existía.
 */
async function ensureAlert(input: CreateAlertInput): Promise<boolean> {
  const where = {
    patientId: input.patientId,
    type: input.type,
    sourceId: input.sourceId ?? null,
    status: 'OPEN' as const,
  };
  const existing = await prisma.alert.findFirst({ where });
  if (existing) return false;
  await prisma.alert.create({
    data: {
      patientId: input.patientId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: severityFor(input.type),
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata,
    },
  });
  return true;
}

export type GenerateResult = {
  patientsScanned: number;
  alertsCreated: number;
  alertsAutoResolved: number;
  byType: Partial<Record<AlertType, number>>;
};

/**
 * Marca una alerta como auto-resuelta. Se invoca desde autoResolveAlerts.
 */
async function autoResolve(alertId: string, reason: string) {
  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: 'RESOLVED',
      isResolved: true,
      resolvedAt: new Date(),
      resolutionReason: reason,
    },
  });
  await logAudit({
    userId: 'system',
    action: 'alert.resolved.auto',
    entityType: 'Alert',
    entityId: alertId,
    metadata: { reason },
  });
}

/**
 * Recorre alertas OPEN y resuelve automáticamente las que ya no aplican.
 * Las decisiones por tipo están documentadas inline.
 */
export async function autoResolveAlerts(): Promise<number> {
  const open = await prisma.alert.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true, type: true, patientId: true, sourceId: true, createdAt: true,
      metadata: true,
    },
  });

  let resolved = 0;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const a of open) {
    switch (a.type) {
      case 'MED_NOT_REGISTERED': {
        // sourceId = `${medId}|${slot}|${day}`
        if (!a.sourceId) break;
        const [medId, slot, day] = a.sourceId.split('|');
        if (!medId || !slot || !day) break;
        const start = new Date(`${day}T00:00:00.000Z`);
        const end = new Date(`${day}T23:59:59.999Z`);
        const log = await prisma.medicationLog.findFirst({
          where: {
            medicationId: medId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            scheduleSlot: slot as any,
            scheduledFor: { gte: start, lte: end },
          },
        });
        if (log) { await autoResolve(a.id, 'Dosis fue registrada'); resolved++; }
        break;
      }
      case 'DAILY_LOG_MISSING': {
        if (!a.sourceId) break;
        const start = new Date(`${a.sourceId}T00:00:00.000Z`);
        const end = new Date(`${a.sourceId}T23:59:59.999Z`);
        const [m, v, ml, ds] = await Promise.all([
          prisma.medicationLog.count({ where: { medication: { patientId: a.patientId }, recordedAt: { gte: start, lte: end } } }),
          prisma.vitalSign.count({ where: { patientId: a.patientId, recordedAt: { gte: start, lte: end } } }),
          prisma.mealLog.count({ where: { patientId: a.patientId, date: { gte: start, lte: end } } }),
          prisma.dailyStatus.count({ where: { patientId: a.patientId, date: { gte: start, lte: end } } }),
        ]);
        if (m + v + ml + ds > 0) {
          await autoResolve(a.id, 'Apareció al menos un registro del día');
          resolved++;
        }
        break;
      }
      case 'VITAL_REVIEW':
      case 'VITAL_OUT_OF_RANGE': {
        // Auto-resolver SOLO si hay una presión NORMAL posterior a la registrada en la alerta.
        if (!a.sourceId) break;
        const sourceVital = await prisma.vitalSign.findUnique({ where: { id: a.sourceId } });
        if (!sourceVital) {
          await autoResolve(a.id, 'Registro de presión origen ya no existe');
          resolved++;
          break;
        }
        const laterNormal = await prisma.vitalSign.findFirst({
          where: { patientId: a.patientId, status: 'NORMAL', recordedAt: { gt: sourceVital.recordedAt } },
        });
        if (laterNormal) {
          await autoResolve(a.id, 'Presión posterior dentro de rango normal');
          resolved++;
        }
        break;
      }
      case 'PRESCRIPTION_EXPIRY': {
        if (!a.sourceId) break;
        const [medId] = a.sourceId.split('|');
        if (!medId) break;
        const med = await prisma.medication.findUnique({ where: { id: medId } });
        if (!med || med.status !== 'ACTIVE') {
          await autoResolve(a.id, 'Medicación ya no está activa');
          resolved++;
          break;
        }
        if (!med.prescriptionExpiry) {
          await autoResolve(a.id, 'Se quitó la fecha de vencimiento de la receta');
          resolved++;
          break;
        }
        // Si la fecha quedó renovada (más de 7 días por delante), resolvemos.
        const in7 = new Date(now + sevenDaysMs);
        if (med.prescriptionExpiry > in7) {
          await autoResolve(a.id, 'Receta renovada (vencimiento >7 días)');
          resolved++;
        }
        break;
      }
      case 'MED_NOT_TAKEN':
      case 'MED_REFUSED': {
        // Si el log origen ya no existe (fue borrado), resolvemos.
        if (!a.sourceId) break;
        const log = await prisma.medicationLog.findUnique({ where: { id: a.sourceId } });
        if (!log) { await autoResolve(a.id, 'Registro de toma origen ya no existe'); resolved++; }
        break;
      }
      case 'NEW_FILE_UPLOADED':
      case 'NEW_MEDICAL_EVENT': {
        // Informativas: auto-resolvemos después de 7 días para que no queden en abiertas indefinidamente.
        if (now - a.createdAt.getTime() > sevenDaysMs) {
          await autoResolve(a.id, 'Más de 7 días: pasa a info histórica');
          resolved++;
        }
        break;
      }
    }
  }
  return resolved;
}

export async function generateAlerts(opts: { systemUserId?: string } = {}): Promise<GenerateResult> {
  // 1) Auto-resolver primero, para no estar viendo dosis "pendientes" que ya se registraron.
  const alertsAutoResolved = await autoResolveAlerts();

  const patients = await prisma.patient.findMany({ where: { isActive: true } });
  const result: GenerateResult = {
    patientsScanned: patients.length,
    alertsCreated: 0,
    alertsAutoResolved,
    byType: {},
  };

  const now = new Date();
  const startOfToday = startOfTodayAR();
  const endOfToday = endOfTodayAR();
  const startOfYesterday = startOfYesterdayAR();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const bump = (t: AlertType) => {
    result.alertsCreated++;
    result.byType[t] = (result.byType[t] ?? 0) + 1;
  };

  for (const patient of patients) {
    // 1) y 2) y 3) Medicación: pendientes, no tomadas y rechazadas (del día)
    const meds = (await prisma.medication.findMany({
      where: { patientId: patient.id },
      include: {
        schedules: true,
        logs: { where: { scheduledFor: { gte: startOfToday, lte: endOfToday } } },
      },
    })) as MedicationWithRel[];

    const slots = getDaySchedule(meds, startOfToday);
    for (const s of slots) {
      // 1) Tomas pendientes cuya hora programada ya pasó hace > 30 min
      if (!s.log && s.scheduledAt.getTime() + 30 * 60 * 1000 < now.getTime()) {
        const sourceId = `${s.medication.id}|${s.schedule.timeSlot}|${s.scheduledAt.toISOString().slice(0, 10)}`;
        const created = await ensureAlert({
          patientId: patient.id,
          type: 'MED_NOT_REGISTERED',
          title: ALERT_TYPE_LABEL.MED_NOT_REGISTERED,
          message: `${s.medication.name} ${s.medication.dose} (${SLOT_LABEL[s.schedule.timeSlot]}) sin registrar.`,
          sourceType: 'MedicationSchedule',
          sourceId,
          metadata: { medicationId: s.medication.id, slot: s.schedule.timeSlot },
        });
        if (created) bump('MED_NOT_REGISTERED');
      }

      // 2) Tomas registradas como NOT_TAKEN
      if (s.log?.status === 'NOT_TAKEN') {
        const created = await ensureAlert({
          patientId: patient.id,
          type: 'MED_NOT_TAKEN',
          title: ALERT_TYPE_LABEL.MED_NOT_TAKEN,
          message: `${s.medication.name} ${s.medication.dose}: marcada como NO TOMÓ.`,
          sourceType: 'MedicationLog',
          sourceId: s.log.id,
          metadata: { medicationId: s.medication.id },
        });
        if (created) bump('MED_NOT_TAKEN');
      }

      // 3) Tomas registradas como REFUSED
      if (s.log?.status === 'REFUSED') {
        const created = await ensureAlert({
          patientId: patient.id,
          type: 'MED_REFUSED',
          title: ALERT_TYPE_LABEL.MED_REFUSED,
          message: `${s.medication.name} ${s.medication.dose}: el paciente rechazó la toma.`,
          sourceType: 'MedicationLog',
          sourceId: s.log.id,
          metadata: { medicationId: s.medication.id },
        });
        if (created) bump('MED_REFUSED');
      }
    }

    // 4) Receta próxima a vencer (≤ 7 días, aún no vencida)
    const expiring = await prisma.medication.findMany({
      where: {
        patientId: patient.id,
        status: 'ACTIVE',
        prescriptionExpiry: { gte: now, lte: in7Days },
      },
    });
    for (const m of expiring) {
      const sourceId = `${m.id}|${m.prescriptionExpiry!.toISOString().slice(0, 10)}`;
      const created = await ensureAlert({
        patientId: patient.id,
        type: 'PRESCRIPTION_EXPIRY',
        title: ALERT_TYPE_LABEL.PRESCRIPTION_EXPIRY,
        message: `La receta de ${m.name} vence el ${formatDateAR(m.prescriptionExpiry!)}.`,
        sourceType: 'Medication',
        sourceId,
        metadata: { medicationId: m.id, expiry: m.prescriptionExpiry!.toISOString() },
      });
      if (created) bump('PRESCRIPTION_EXPIRY');
    }

    // 5) y 6) Presión fuera de rango / a revisar — últimas 24h
    const vitals = await prisma.vitalSign.findMany({
      where: { patientId: patient.id, recordedAt: { gte: last24h }, status: { in: ['ALERT', 'REVIEW'] } },
    });
    for (const v of vitals) {
      const isAlert = v.status === 'ALERT';
      const type: AlertType = isAlert ? 'VITAL_OUT_OF_RANGE' : 'VITAL_REVIEW';
      const created = await ensureAlert({
        patientId: patient.id,
        type,
        title: ALERT_TYPE_LABEL[type],
        message: `Presión ${v.systolic}/${v.diastolic} ${isAlert ? '— avisar al médico' : '— requiere revisión'}.`,
        sourceType: 'VitalSign',
        sourceId: v.id,
        metadata: { systolic: v.systolic, diastolic: v.diastolic, status: v.status },
      });
      if (created) bump(type);
    }

    // 7) Día sin registros (ayer): ningún medicationLog, vital, meal ni dailyStatus
    const yesterdayKey = startOfYesterday.toISOString().slice(0, 10);
    const [yMed, yVit, yMeal, yStat] = await Promise.all([
      prisma.medicationLog.count({
        where: {
          medication: { patientId: patient.id },
          recordedAt: { gte: startOfYesterday, lt: startOfToday },
        },
      }),
      prisma.vitalSign.count({
        where: { patientId: patient.id, recordedAt: { gte: startOfYesterday, lt: startOfToday } },
      }),
      prisma.mealLog.count({
        where: { patientId: patient.id, date: { gte: startOfYesterday, lt: startOfToday } },
      }),
      prisma.dailyStatus.count({
        where: { patientId: patient.id, date: { gte: startOfYesterday, lt: startOfToday } },
      }),
    ]);
    if (yMed + yVit + yMeal + yStat === 0) {
      const created = await ensureAlert({
        patientId: patient.id,
        type: 'DAILY_LOG_MISSING',
        title: ALERT_TYPE_LABEL.DAILY_LOG_MISSING,
        message: `No se registró ninguna actividad el ${formatDateAR(startOfYesterday)}.`,
        sourceType: 'Day',
        sourceId: yesterdayKey,
        metadata: { day: yesterdayKey },
      });
      if (created) bump('DAILY_LOG_MISSING');
    }

    // 8) Nuevo evento médico — últimas 24h
    const newEvents = await prisma.medicalEvent.findMany({
      where: { patientId: patient.id, createdAt: { gte: last24h } },
    });
    for (const ev of newEvents) {
      const created = await ensureAlert({
        patientId: patient.id,
        type: 'NEW_MEDICAL_EVENT',
        title: ALERT_TYPE_LABEL.NEW_MEDICAL_EVENT,
        message: `Se cargó un nuevo evento médico (${ev.type}) del ${formatDateAR(ev.date)}.`,
        sourceType: 'MedicalEvent',
        sourceId: ev.id,
        metadata: { eventType: ev.type, date: ev.date.toISOString() },
      });
      if (created) bump('NEW_MEDICAL_EVENT');
    }

    // 9) Nuevo archivo médico — últimas 24h
    const newFiles = await prisma.medicalFile.findMany({
      where: { patientId: patient.id, createdAt: { gte: last24h } },
    });
    for (const f of newFiles) {
      const created = await ensureAlert({
        patientId: patient.id,
        type: 'NEW_FILE_UPLOADED',
        title: ALERT_TYPE_LABEL.NEW_FILE_UPLOADED,
        message: `Se subió un archivo médico: ${f.name}.`,
        sourceType: 'MedicalFile',
        sourceId: f.id,
        metadata: { name: f.name },
      });
      if (created) bump('NEW_FILE_UPLOADED');
    }
  }

  if (opts.systemUserId) {
    await logAudit({
      userId: opts.systemUserId,
      action: 'alert.batch.created',
      metadata: {
        patientsScanned: result.patientsScanned,
        alertsCreated: result.alertsCreated,
        byType: result.byType as Prisma.InputJsonValue,
      },
    });
  }

  return result;
}
