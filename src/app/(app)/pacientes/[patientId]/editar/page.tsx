import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditPatientData, getPatientAccess } from '@/lib/permissions';
import { diffFields, logAudit } from '@/lib/audit';
import { MobilityLevel, FallRisk } from '@prisma/client';

const EDITABLE_FIELDS = [
  'fullName',
  'birthDate',
  'dni',
  'phone',
  'address',
  'healthInsurance',
  'affiliateNumber',
  'primaryDoctor',
  'primaryDoctorPhone',
  'emergencyContactName',
  'emergencyContactPhone',
  'allergies',
  'relevantDiagnoses',
  'dietaryRestrictions',
  'mobilityLevel',
  'fallRisk',
  'importantNotes',
] as const;

async function updatePatient(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) throw new Error('No autorizado');

  const before = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!before) throw new Error('Paciente no encontrado');

  const fullName = String(formData.get('fullName') || '').trim();
  const birthDateRaw = String(formData.get('birthDate') || '');
  if (!fullName || !birthDateRaw) throw new Error('Nombre y fecha de nacimiento son obligatorios');

  const data = {
    fullName,
    birthDate: new Date(birthDateRaw),
    dni: optString(formData.get('dni')),
    phone: optString(formData.get('phone')),
    address: optString(formData.get('address')),
    healthInsurance: optString(formData.get('healthInsurance')),
    affiliateNumber: optString(formData.get('affiliateNumber')),
    primaryDoctor: optString(formData.get('primaryDoctor')),
    primaryDoctorPhone: optString(formData.get('primaryDoctorPhone')),
    emergencyContactName: optString(formData.get('emergencyContactName')),
    emergencyContactPhone: optString(formData.get('emergencyContactPhone')),
    allergies: optString(formData.get('allergies')),
    relevantDiagnoses: optString(formData.get('relevantDiagnoses')),
    dietaryRestrictions: optString(formData.get('dietaryRestrictions')),
    mobilityLevel: (formData.get('mobilityLevel') as MobilityLevel) || MobilityLevel.NORMAL,
    fallRisk: (formData.get('fallRisk') as FallRisk) || FallRisk.LOW,
    importantNotes: optString(formData.get('importantNotes')),
  };

  const after = await prisma.patient.update({ where: { id: patientId }, data });
  const changed = diffFields(before, after, [...EDITABLE_FIELDS]);

  if (Object.keys(changed).length > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'patient.update',
      entityType: 'Patient',
      entityId: patientId,
      metadata: { fields: Object.keys(changed), changes: changed },
    });
  }

  revalidatePath(`/pacientes/${patientId}`);
  redirect(`/pacientes/${patientId}`);
}

function optString(v: FormDataEntryValue | null) {
  const s = (v ?? '').toString().trim();
  return s.length ? s : null;
}

export default async function EditPatientPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canEditPatientData(access.patientRole)) redirect(`/pacientes/${params.patientId}`);

  const p = await prisma.patient.findUnique({ where: { id: params.patientId } });
  if (!p) notFound();

  const birthDate = p.birthDate.toISOString().slice(0, 10);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm text-slate-600">
            <Link href={`/pacientes/${p.id}`} className="hover:text-brand">← Volver al paciente</Link>
          </p>
          <h1 className="text-xl font-bold mt-1">Editar datos del paciente</h1>
        </div>
      </div>

      <form action={updatePatient} className="card space-y-5">
        <input type="hidden" name="patientId" value={p.id} />

        <Section title="Datos personales">
          <Field label="Nombre completo *">
            <input name="fullName" required defaultValue={p.fullName} className="input" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Fecha de nacimiento *">
              <input name="birthDate" type="date" required defaultValue={birthDate} className="input" />
            </Field>
            <Field label="DNI">
              <input name="dni" defaultValue={p.dni ?? ''} className="input" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Teléfono">
              <input name="phone" defaultValue={p.phone ?? ''} className="input" />
            </Field>
            <Field label="Dirección">
              <input name="address" defaultValue={p.address ?? ''} className="input" />
            </Field>
          </div>
        </Section>

        <Section title="Cobertura médica">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Obra social / PAMI">
              <input name="healthInsurance" defaultValue={p.healthInsurance ?? ''} className="input" />
            </Field>
            <Field label="Nº de afiliado">
              <input name="affiliateNumber" defaultValue={p.affiliateNumber ?? ''} className="input" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Médico de cabecera">
              <input name="primaryDoctor" defaultValue={p.primaryDoctor ?? ''} className="input" />
            </Field>
            <Field label="Teléfono del médico">
              <input name="primaryDoctorPhone" defaultValue={p.primaryDoctorPhone ?? ''} className="input" />
            </Field>
          </div>
        </Section>

        <Section title="Contacto de emergencia">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nombre">
              <input name="emergencyContactName" defaultValue={p.emergencyContactName ?? ''} className="input" />
            </Field>
            <Field label="Teléfono">
              <input name="emergencyContactPhone" defaultValue={p.emergencyContactPhone ?? ''} className="input" />
            </Field>
          </div>
        </Section>

        <Section title="Información clínica">
          <Field label="Alergias">
            <textarea name="allergies" rows={2} defaultValue={p.allergies ?? ''} className="input" />
          </Field>
          <Field label="Diagnósticos relevantes">
            <textarea name="relevantDiagnoses" rows={2} defaultValue={p.relevantDiagnoses ?? ''} className="input" />
          </Field>
          <Field label="Restricciones alimentarias">
            <textarea name="dietaryRestrictions" rows={2} defaultValue={p.dietaryRestrictions ?? ''} className="input" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nivel de movilidad">
              <select name="mobilityLevel" className="input" defaultValue={p.mobilityLevel}>
                <option value="NORMAL">Normal</option>
                <option value="WITH_HELP">Con ayuda</option>
                <option value="DIFFICULTY">Dificultad</option>
                <option value="BED_RIDDEN">Postrado</option>
              </select>
            </Field>
            <Field label="Riesgo de caída">
              <select name="fallRisk" className="input" defaultValue={p.fallRisk}>
                <option value="LOW">Bajo</option>
                <option value="MEDIUM">Medio</option>
                <option value="HIGH">Alto</option>
              </select>
            </Field>
          </div>
          <Field label="Indicaciones importantes">
            <textarea name="importantNotes" rows={3} defaultValue={p.importantNotes ?? ''} className="input" />
          </Field>
        </Section>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Guardar cambios</button>
          <Link href={`/pacientes/${p.id}`} className="btn-secondary btn-lg">Cancelar</Link>
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
