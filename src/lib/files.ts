import type { FileCategory, MedicalEventType } from '@prisma/client';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILE_SIZE_LABEL = '10 MB';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const ALLOWED_EXTENSIONS_LABEL = 'PDF, JPG, PNG, WEBP o HEIC';

export type ValidationError = { field: string; message: string };

export function validateFile(file: File): ValidationError | null {
  if (!file || file.size === 0) {
    return { field: 'file', message: 'El archivo está vacío.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { field: 'file', message: `El archivo supera el máximo permitido (${MAX_FILE_SIZE_LABEL}).` };
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return {
      field: 'file',
      message: `Formato no permitido. Permitidos: ${ALLOWED_EXTENSIONS_LABEL}.`,
    };
  }
  return null;
}

export const MEDICAL_EVENT_LABEL: Record<MedicalEventType, string> = {
  CONSULTATION: 'Consulta médica',
  EMERGENCY: 'Guardia',
  HOSPITALIZATION: 'Internación',
  STUDY: 'Estudio',
  LAB: 'Laboratorio',
  IMAGING: 'Placa / imagen',
  PRESCRIPTION: 'Receta',
  MEDICAL_ORDER: 'Indicación médica',
  DIAGNOSIS: 'Diagnóstico',
  REPORT: 'Informe',
  OTHER: 'Otro',
};

export const MEDICAL_EVENT_EMOJI: Record<MedicalEventType, string> = {
  CONSULTATION: '🩺',
  EMERGENCY: '🚑',
  HOSPITALIZATION: '🏥',
  STUDY: '🔬',
  LAB: '🧪',
  IMAGING: '🩻',
  PRESCRIPTION: '📋',
  MEDICAL_ORDER: '📝',
  DIAGNOSIS: '🧠',
  REPORT: '📄',
  OTHER: '📌',
};

export const FILE_CATEGORY_LABEL: Record<FileCategory, string> = {
  PRESCRIPTION: 'Receta',
  LAB_RESULT: 'Laboratorio',
  IMAGING: 'Placa / imagen',
  REPORT: 'Informe',
  INSURANCE: 'Obra social',
  IDENTIFICATION: 'Identificación',
  OTHER: 'Otro',
};

/**
 * Sugiere una categoría inicial razonable a partir del tipo de evento médico,
 * para precargar el form de subida.
 */
export function defaultFileCategoryForEvent(type: MedicalEventType): FileCategory {
  switch (type) {
    case 'PRESCRIPTION': return 'PRESCRIPTION';
    case 'LAB': return 'LAB_RESULT';
    case 'IMAGING': return 'IMAGING';
    case 'STUDY': return 'LAB_RESULT';
    case 'REPORT': return 'REPORT';
    default: return 'OTHER';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Texto preindexado para búsqueda interna por paciente (futuro RAG).
 * Solo concatena campos textuales no sensibles del propio evento.
 */
export function buildMedicalEventSearchText(parts: {
  type: MedicalEventType;
  professional?: string | null;
  institution?: string | null;
  reason?: string | null;
  summary?: string | null;
  indications?: string | null;
  notes?: string | null;
}): string {
  return [
    MEDICAL_EVENT_LABEL[parts.type],
    parts.professional,
    parts.institution,
    parts.reason,
    parts.summary,
    parts.indications,
    parts.notes,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function buildMedicalFileSearchText(parts: {
  name: string;
  description?: string | null;
  category: FileCategory;
}): string {
  return [parts.name, parts.description, FILE_CATEGORY_LABEL[parts.category]]
    .filter(Boolean)
    .join(' · ');
}
