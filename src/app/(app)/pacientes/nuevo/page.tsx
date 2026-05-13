import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GlobalRole, MobilityLevel, FallRisk } from '@prisma/client';
import { revalidatePath } from 'next/cache';

async function createPatient(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session) redirect('/login');
  const role = session.user.globalRole;
  if (role !== GlobalRole.AGENCY_ADMIN && role !== GlobalRole.FAMILY_ADMIN) {
    throw new Error('No autorizado');
  }

  const fullName = String(formData.get('fullName') || '').trim();
  const birthDate = String(formData.get('birthDate') || '');
  if (!fullName || !birthDate) throw new Error('Faltan datos obligatorios');

  const patient = await prisma.patient.create({
    data: {
      organizationId: session.user.organizationId,
      fullName,
      birthDate: new Date(birthDate),
      dni: stringOrNull(formData.get('dni')),
      phone: stringOrNull(formData.get('phone')),
      address: stringOrNull(formData.get('address')),
      healthInsurance: stringOrNull(formData.get('healthInsurance')),
      affiliateNumber: stringOrNull(formData.get('affiliateNumber')),
      primaryDoctor: stringOrNull(formData.get('primaryDoctor')),
      primaryDoctorPhone: stringOrNull(formData.get('primaryDoctorPhone')),
      emergencyContactName: stringOrNull(formData.get('emergencyContactName')),
      emergencyContactPhone: stringOrNull(formData.get('emergencyContactPhone')),
      allergies: stringOrNull(formData.get('allergies')),
      relevantDiagnoses: stringOrNull(formData.get('relevantDiagnoses')),
      dietaryRestrictions: stringOrNull(formData.get('dietaryRestrictions')),
      mobilityLevel: (formData.get('mobilityLevel') as MobilityLevel) || MobilityLevel.NORMAL,
      fallRisk: (formData.get('fallRisk') as FallRisk) || FallRisk.LOW,
      importantNotes: stringOrNull(formData.get('importantNotes')),
    },
  });

  // El creador queda como ADMIN del paciente (incluso si es AGENCY_ADMIN, le dejamos PatientUser explícito).
  await prisma.patientUser.create({
    data: {
      patientId: patient.id,
      userId: session.user.id,
      patientRole: 'ADMIN',
      canUploadFiles: true,
      canEditMedical: true,
    },
  });

  revalidatePath('/pacientes');
  redirect(`/pacientes/${patient.id}`);
}

function stringOrNull(v: FormDataEntryValue | null) {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}

export default async function NewPatientPage() {
  const session = await auth();
  if (!session) redirect('/login');
  const role = session.user.globalRole;
  if (role !== GlobalRole.AGENCY_ADMIN && role !== GlobalRole.FAMILY_ADMIN) {
    redirect('/pacientes');
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Nuevo paciente</h1>
        <Link href="/pacientes" className="text-sm text-slate-600">Cancelar</Link>
      </div>

      <form action={createPatient} className="card space-y-5">
        <Section title="Datos personales">
          <Field label="Nombre completo *">
            <input name="fullName" required className="input" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Fecha de nacimiento *">
              <input name="birthDate" type="date" required className="input" />
            </Field>
            <Field label="DNI">
              <input name="dni" className="input" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Teléfono"><input name="phone" className="input" /></Field>
            <Field label="Dirección"><input name="address" className="input" /></Field>
          </div>
        </Section>

        <Section title="Cobertura médica">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Obra social / PAMI">
              <input name="healthInsurance" className="input" placeholder="PAMI, OSDE…" />
            </Field>
            <Field label="Nº de afiliado">
              <input name="affiliateNumber" className="input" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Médico de cabecera"><input name="primaryDoctor" className="input" /></Field>
            <Field label="Teléfono del médico"><input name="primaryDoctorPhone" className="input" /></Field>
          </div>
        </Section>

        <Section title="Contacto de emergencia">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nombre"><input name="emergencyContactName" className="input" /></Field>
            <Field label="Teléfono"><input name="emergencyContactPhone" className="input" /></Field>
          </div>
        </Section>

        <Section title="Información clínica">
          <Field label="Alergias">
            <textarea name="allergies" rows={2} className="input" />
          </Field>
          <Field label="Diagnósticos relevantes">
            <textarea name="relevantDiagnoses" rows={2} className="input" />
          </Field>
          <Field label="Restricciones alimentarias">
            <textarea name="dietaryRestrictions" rows={2} className="input" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nivel de movilidad">
              <select name="mobilityLevel" className="input" defaultValue="NORMAL">
                <option value="NORMAL">Normal</option>
                <option value="WITH_HELP">Con ayuda</option>
                <option value="DIFFICULTY">Dificultad</option>
                <option value="BED_RIDDEN">Postrado</option>
              </select>
            </Field>
            <Field label="Riesgo de caída">
              <select name="fallRisk" className="input" defaultValue="LOW">
                <option value="LOW">Bajo</option>
                <option value="MEDIUM">Medio</option>
                <option value="HIGH">Alto</option>
              </select>
            </Field>
          </div>
          <Field label="Indicaciones importantes">
            <textarea name="importantNotes" rows={3} className="input" />
          </Field>
        </Section>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Crear paciente</button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
