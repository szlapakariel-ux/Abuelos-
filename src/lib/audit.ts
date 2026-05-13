/**
 * Auditoría mínima: registra acciones del usuario sobre entidades.
 * No bloquea la operación si falla la escritura del log (best effort).
 */
import { prisma } from './prisma';

export async function logAudit(params: {
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata as never,
      },
    });
  } catch (err) {
    console.error('[audit] no se pudo registrar', err);
  }
}

/**
 * Calcula el diff entre dos objetos (antes/después).
 * Solo devuelve las claves cuyo valor cambió.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    // Normalizar fechas y null
    const aVal = a instanceof Date ? a.toISOString() : a;
    const bVal = b instanceof Date ? b.toISOString() : b;
    if (aVal !== bVal && !(aVal == null && bVal == null)) {
      diff[String(key)] = { from: aVal ?? null, to: bVal ?? null };
    }
  }
  return diff;
}
