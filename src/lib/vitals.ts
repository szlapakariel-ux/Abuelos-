/**
 * Clasificación de presión arterial SEGÚN RANGOS configurados por el médico para CADA paciente.
 *
 * La app NO diagnostica. Solo clasifica lo registrado en:
 *   NORMAL  → dentro de rango normal definido por el médico
 *   REVIEW  → fuera de normal pero dentro de revisión
 *   ALERT   → fuera de revisión
 *
 * Si el paciente no tiene rangos configurados, se devuelve NORMAL (sin clasificación).
 */
import type { Patient, VitalStatus } from '@prisma/client';

export type VitalRanges = Pick<
  Patient,
  'sysNormalMin' | 'sysNormalMax' | 'sysReviewMax' | 'diaNormalMin' | 'diaNormalMax' | 'diaReviewMax'
>;

export function classifyBloodPressure(
  systolic: number,
  diastolic: number,
  ranges: VitalRanges,
): VitalStatus {
  const sysClass = classifyValue(systolic, ranges.sysNormalMin, ranges.sysNormalMax, ranges.sysReviewMax);
  const diaClass = classifyValue(diastolic, ranges.diaNormalMin, ranges.diaNormalMax, ranges.diaReviewMax);
  // Toma el peor de los dos.
  if (sysClass === 'ALERT' || diaClass === 'ALERT') return 'ALERT';
  if (sysClass === 'REVIEW' || diaClass === 'REVIEW') return 'REVIEW';
  return 'NORMAL';
}

function classifyValue(
  value: number,
  normalMin: number | null,
  normalMax: number | null,
  reviewMax: number | null,
): VitalStatus {
  if (normalMin == null || normalMax == null) return 'NORMAL';
  if (value >= normalMin && value <= normalMax) return 'NORMAL';
  if (reviewMax != null && value > normalMax && value <= reviewMax) return 'REVIEW';
  if (reviewMax != null && value > reviewMax) return 'ALERT';
  // Por debajo del mínimo: si hay reviewMax definido, lo tratamos como REVIEW; sin más datos, ALERT en valores muy bajos.
  if (value < normalMin) return 'REVIEW';
  return 'NORMAL';
}

export const VITAL_STATUS_STYLE: Record<VitalStatus, { bg: string; text: string; label: string }> = {
  NORMAL: { bg: 'bg-green-100', text: 'text-green-800', label: 'Normal' },
  REVIEW: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Requiere revisión' },
  ALERT: { bg: 'bg-red-100', text: 'text-red-800', label: 'Alerta — avisar al médico' },
};

/**
 * Valida coherencia de la terna (normalMin, normalMax, reviewMax) para un eje.
 * Reglas:
 * - Si están los tres: 0 < normalMin ≤ normalMax ≤ reviewMax
 * - Si faltan algunos, los presentes deben respetar el orden (≤ entre ellos).
 * - Si todos son null, OK (sin clasificar).
 * Devuelve mensaje de error o null si todo está bien.
 */
export function validateRangeTriple(
  label: string,
  normalMin: number | null,
  normalMax: number | null,
  reviewMax: number | null,
): string | null {
  const values = [normalMin, normalMax, reviewMax];
  if (values.every((v) => v == null)) return null;

  for (const v of values) {
    if (v != null && (!Number.isFinite(v) || v <= 0 || v > 400)) {
      return `${label}: los valores deben ser números positivos razonables.`;
    }
  }
  if (normalMin != null && normalMax != null && normalMin > normalMax) {
    return `${label}: el mínimo normal no puede ser mayor que el máximo normal.`;
  }
  if (normalMax != null && reviewMax != null && normalMax > reviewMax) {
    return `${label}: el máximo normal no puede ser mayor que el máximo de revisión.`;
  }
  return null;
}
