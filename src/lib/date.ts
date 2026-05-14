/**
 * Helpers de fecha.
 * Invariante: almacenamos UTC en DB, mostramos en hora Argentina.
 * Argentina = UTC-3, sin horario de verano desde 2009.
 */

export const AR_TZ = 'America/Argentina/Buenos_Aires';
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Medianoche de hoy en Argentina, expresada como UTC Date (03:00 UTC = 00:00 AR). */
export function startOfTodayAR(): Date {
  const now = new Date();
  const arView = new Date(now.getTime() - AR_OFFSET_MS);
  const arMidnightUTC = Date.UTC(arView.getUTCFullYear(), arView.getUTCMonth(), arView.getUTCDate());
  return new Date(arMidnightUTC + AR_OFFSET_MS);
}

/** 23:59:59.999 de hoy en Argentina, expresado como UTC Date. */
export function endOfTodayAR(): Date {
  return new Date(startOfTodayAR().getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Medianoche de ayer en Argentina, expresada como UTC Date. */
export function startOfYesterdayAR(): Date {
  return new Date(startOfTodayAR().getTime() - 24 * 60 * 60 * 1000);
}

// Alias de compatibilidad para call sites existentes
export const startOfToday = startOfTodayAR;
export const endOfToday = endOfTodayAR;

export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: AR_TZ }).format(date);
}

export function formatDateTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: AR_TZ }).format(date);
}

export function formatDateAR(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeZone: AR_TZ }).format(date);
}

export function relativeFromNow(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'recién';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `hace ${diffD} d`;
  return formatDateAR(date);
}
