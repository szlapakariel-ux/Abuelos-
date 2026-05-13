import { prisma } from './prisma';
import { PatientRole, GlobalRole } from '@prisma/client';

/**
 * Devuelve el PatientUser si el usuario tiene acceso al paciente.
 * Los AGENCY_ADMIN tienen acceso implícito a todos los pacientes de su organización.
 */
export async function getPatientAccess(userId: string, patientId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return null;

  // Agency admin: acceso implícito a su organización
  if (user.globalRole === GlobalRole.AGENCY_ADMIN && patient.organizationId === user.organizationId) {
    return {
      patientRole: PatientRole.ADMIN,
      canUploadFiles: true,
      canEditMedical: true,
      receivesEmailReports: true,
      implicit: true as const,
    };
  }

  const access = await prisma.patientUser.findUnique({
    where: { patientId_userId: { patientId, userId } },
  });
  if (!access) return null;
  return { ...access, implicit: false as const };
}

export function canEditPatientData(role: PatientRole) {
  return role === PatientRole.ADMIN;
}

export function canRegisterDailyCare(role: PatientRole) {
  return role === PatientRole.ADMIN || role === PatientRole.CAREGIVER;
}

export function canViewMedicalHistory(role: PatientRole) {
  return role === PatientRole.ADMIN || role === PatientRole.FAMILY;
}

export function canManageUsers(globalRole: GlobalRole, patientRole?: PatientRole) {
  if (globalRole === GlobalRole.AGENCY_ADMIN) return true;
  return patientRole === PatientRole.ADMIN;
}

/**
 * Si el usuario puede subir archivos médicos para este paciente.
 * - Admin del paciente o de la agencia: siempre.
 * - Otros (cuidadora/familiar): solo si su PatientUser.canUploadFiles está habilitado.
 */
export function canUploadFilesFor(access: {
  patientRole: PatientRole;
  canUploadFiles: boolean;
}): boolean {
  if (access.patientRole === PatientRole.ADMIN) return true;
  return access.canUploadFiles;
}

/**
 * Borrar historial médico: solo administrador del paciente o agency admin.
 */
export function canDeleteMedicalRecords(access: { patientRole: PatientRole }): boolean {
  return access.patientRole === PatientRole.ADMIN;
}
