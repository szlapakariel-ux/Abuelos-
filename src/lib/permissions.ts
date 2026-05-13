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
