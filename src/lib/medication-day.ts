/**
 * Helpers para calcular qué tomas de medicación corresponden a un día dado.
 *
 * Reglas:
 * - Cada Medication.schedules define los momentos de toma.
 * - TimeSlot fijos se convierten a hora indicativa por defecto (MORNING=08, NOON=12, AFTERNOON=16, NIGHT=20).
 * - Para CUSTOM se usa schedule.customTime (formato "HH:MM").
 * - Una toma se considera "pendiente" si no hay un MedicationLog para ese (medicationId, slot, día).
 */
import type { Medication, MedicationLog, MedicationSchedule, TakeStatus, TimeSlot } from '@prisma/client';

export type MedicationWithRel = Medication & {
  schedules: MedicationSchedule[];
  logs: MedicationLog[];
};

export type DaySlot = {
  medication: Medication;
  schedule: MedicationSchedule;
  scheduledAt: Date;
  slotLabel: string;
  log: MedicationLog | null;
};

const SLOT_DEFAULT_HOUR: Record<TimeSlot, number> = {
  MORNING: 8,
  NOON: 12,
  AFTERNOON: 16,
  NIGHT: 20,
  CUSTOM: 0,
};

export const SLOT_LABEL: Record<TimeSlot, string> = {
  MORNING: 'Mañana',
  NOON: 'Mediodía',
  AFTERNOON: 'Tarde',
  NIGHT: 'Noche',
  CUSTOM: 'Personalizado',
};

export function isMedicationActiveOn(med: Medication, date: Date): boolean {
  if (med.status === 'FINISHED') return false;
  if (med.status === 'SUSPENDED') {
    // Suspensión temporal: si suspendedUntil pasó, igual la app mostrará como pendiente la próxima activación manual.
    if (!med.suspendedUntil || med.suspendedUntil > date) return false;
  }
  if (med.startDate && med.startDate > date) return false;
  if (med.endDate && med.endDate < date) return false;
  return true;
}

function scheduleToDate(schedule: MedicationSchedule, day: Date): Date {
  // day = medianoche argentina en UTC (ej. 03:00 UTC = 00:00 AR).
  // Sumamos horas en ms para que la hora AR quede correcta en servidor UTC.
  if (schedule.timeSlot === 'CUSTOM' && schedule.customTime) {
    const [h, m] = schedule.customTime.split(':').map((n) => parseInt(n, 10));
    return new Date(day.getTime() + ((h || 0) * 60 + (m || 0)) * 60 * 1000);
  }
  return new Date(day.getTime() + SLOT_DEFAULT_HOUR[schedule.timeSlot] * 60 * 60 * 1000);
}

export function getDaySchedule(meds: MedicationWithRel[], day: Date): DaySlot[] {
  const slots: DaySlot[] = [];
  for (const med of meds) {
    if (!isMedicationActiveOn(med, day)) continue;
    for (const sched of med.schedules) {
      const scheduledAt = scheduleToDate(sched, day);
      const log = med.logs.find(
        (l) => l.scheduleSlot === sched.timeSlot && l.scheduledFor.getTime() === scheduledAt.getTime(),
      ) || null;
      const label =
        sched.timeSlot === 'CUSTOM' && sched.customTime
          ? sched.customTime
          : SLOT_LABEL[sched.timeSlot];
      slots.push({ medication: med, schedule: sched, scheduledAt, slotLabel: label, log });
    }
  }
  slots.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  return slots;
}

export const TAKE_STATUS_LABEL: Record<TakeStatus, string> = {
  TAKEN: 'Tomó',
  NOT_TAKEN: 'No tomó',
  REFUSED: 'Rechazó',
  DELAYED: 'Demorado',
};
