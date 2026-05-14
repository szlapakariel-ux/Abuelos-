import { prisma } from './prisma';
import { ShiftStatus } from '@prisma/client';

export const SHIFT_TYPE_LABEL: Record<string, string> = {
  DAY: 'Turno día',
  NIGHT: 'Turno noche',
  FULL_24H: '24 horas',
  REPLACEMENT: 'Reemplazo',
  CUSTOM: 'Personalizado',
};

export const SHIFT_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Programado',
  ACTIVE: 'En curso',
  COMPLETED: 'Completado',
  MISSED: 'No se presentó',
  CANCELLED: 'Cancelado',
};

export const SHIFT_STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  SCHEDULED: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  ACTIVE:    { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  COMPLETED: { bg: 'bg-blue-50',   text: 'text-blue-700',  border: 'border-blue-200' },
  MISSED:    { bg: 'bg-red-100',   text: 'text-red-800',   border: 'border-red-300' },
  CANCELLED: { bg: 'bg-slate-50',  text: 'text-slate-500', border: 'border-slate-200' },
};

export async function getActiveShiftAt(patientId: string, date: Date) {
  return prisma.caregiverShift.findFirst({
    where: {
      patientId,
      status: ShiftStatus.ACTIVE,
      startPlannedAt: { lte: date },
      endPlannedAt: { gte: date },
    },
    include: {
      caregiver: { select: { name: true } },
    },
    orderBy: { startPlannedAt: 'desc' },
  });
}

export async function getNextScheduledShift(patientId: string, after: Date) {
  return prisma.caregiverShift.findFirst({
    where: {
      patientId,
      status: ShiftStatus.SCHEDULED,
      startPlannedAt: { gte: after },
    },
    include: {
      caregiver: { select: { name: true } },
    },
    orderBy: { startPlannedAt: 'asc' },
  });
}

export function diffMinutes(planned: Date, actual: Date): number {
  return Math.round((actual.getTime() - planned.getTime()) / 60000);
}
