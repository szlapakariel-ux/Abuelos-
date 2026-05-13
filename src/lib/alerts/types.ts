import type { AlertSeverity, AlertType } from '@prisma/client';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  MED_NOT_REGISTERED: 'Medicación sin registrar',
  MED_NOT_TAKEN: 'Medicación no tomada',
  MED_REFUSED: 'Medicación rechazada',
  PRESCRIPTION_EXPIRY: 'Receta próxima a vencer',
  VITAL_OUT_OF_RANGE: 'Presión fuera de rango (alerta)',
  VITAL_REVIEW: 'Presión a revisar',
  DAILY_LOG_MISSING: 'Día sin registros',
  NEW_FILE_UPLOADED: 'Nuevo archivo médico',
  NEW_MEDICAL_EVENT: 'Nuevo evento médico',
};

export const ALERT_SEVERITY_STYLE: Record<AlertSeverity, { bg: string; text: string; border: string; label: string; emoji: string }> = {
  INFO: { bg: 'bg-blue-50', text: 'text-blue-900', border: 'border-blue-200', label: 'Info', emoji: 'ℹ️' },
  WARNING: { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-300', label: 'Atención', emoji: '⚠️' },
  CRITICAL: { bg: 'bg-red-50', text: 'text-red-900', border: 'border-red-300', label: 'Urgente', emoji: '🚨' },
};

export function severityFor(type: AlertType): AlertSeverity {
  switch (type) {
    case 'VITAL_OUT_OF_RANGE':
      return 'CRITICAL';
    case 'MED_NOT_TAKEN':
    case 'MED_REFUSED':
    case 'VITAL_REVIEW':
    case 'PRESCRIPTION_EXPIRY':
    case 'DAILY_LOG_MISSING':
    case 'MED_NOT_REGISTERED':
      return 'WARNING';
    case 'NEW_FILE_UPLOADED':
    case 'NEW_MEDICAL_EVENT':
      return 'INFO';
  }
}

/**
 * Link sugerido en la app para ver el detalle del recurso origen.
 */
export function alertLinkHref(opts: { patientId: string; type: AlertType; sourceId?: string | null }): string {
  const base = `/pacientes/${opts.patientId}`;
  switch (opts.type) {
    case 'MED_NOT_REGISTERED':
    case 'MED_NOT_TAKEN':
    case 'MED_REFUSED':
    case 'PRESCRIPTION_EXPIRY':
      return `${base}/medicacion`;
    case 'VITAL_OUT_OF_RANGE':
    case 'VITAL_REVIEW':
      return `${base}/presion`;
    case 'DAILY_LOG_MISSING':
      return base;
    case 'NEW_FILE_UPLOADED':
    case 'NEW_MEDICAL_EVENT':
      return `${base}/historial`;
  }
}
