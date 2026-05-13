import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditPatientData, getPatientAccess } from '@/lib/permissions';
import { diffFields, logAudit } from '@/lib/audit';
import { validateRangeTriple } from '@/lib/vitals';

const RANGE_FIELDS = [
  'sysNormalMin',
  'sysNormalMax',
  'sysReviewMax',
  'diaNormalMin',
  'diaNormalMax',
  'diaReviewMax',
] as const;

async function updateRanges(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canEditPatientData(access.patientRole)) throw new Error('No autorizado');

  const before = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!before) throw new Error('Paciente no encontrado');

  const values = {
    sysNormalMin: parseIntOrNull(formData.get('sysNormalMin')),
    sysNormalMax: parseIntOrNull(formData.get('sysNormalMax')),
    sysReviewMax: parseIntOrNull(formData.get('sysReviewMax')),
    diaNormalMin: parseIntOrNull(formData.get('diaNormalMin')),
    diaNormalMax: parseIntOrNull(formData.get('diaNormalMax')),
    diaReviewMax: parseIntOrNull(formData.get('diaReviewMax')),
  };

  const sysError = validateRangeTriple('Sistólica', values.sysNormalMin, values.sysNormalMax, values.sysReviewMax);
  const diaError = validateRangeTriple('Diastólica', values.diaNormalMin, values.diaNormalMax, values.diaReviewMax);
  if (sysError || diaError) throw new Error(sysError ?? diaError ?? 'Rangos inválidos');

  const after = await prisma.patient.update({ where: { id: patientId }, data: values });

  const changed = diffFields(before, after, [...RANGE_FIELDS]);
  if (Object.keys(changed).length > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'patient.vitalRanges.update',
      entityType: 'Patient',
      entityId: patientId,
      metadata: { changes: changed },
    });
  }

  revalidatePath(`/pacientes/${patientId}`);
  revalidatePath(`/pacientes/${patientId}/presion`);
  redirect(`/pacientes/${patientId}`);
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = (v ?? '').toString().trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export default async function VitalRangesPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();
  if (!canEditPatientData(access.patientRole)) redirect(`/pacientes/${params.patientId}`);

  const p = await prisma.patient.findUnique({ where: { id: params.patientId } });
  if (!p) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${p.id}`} className="hover:text-brand">← Volver al paciente</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Rangos médicos de presión</h1>
      </div>

      <div className="card bg-slate-50 border-slate-200 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">Importante</p>
        <p className="mt-1">
          Estos rangos los define el médico tratante de <strong>{p.fullName}</strong>. La app no diagnostica:
          solo clasifica cada toma de presión en <strong>Normal</strong>, <strong>Requiere revisión</strong>
          {' '}o <strong>Alerta</strong> según lo que cargues acá.
        </p>
        <p className="mt-2">Si dejás vacíos los campos, la presión se registra sin clasificar.</p>
      </div>

      <form action={updateRanges} className="card space-y-6">
        <input type="hidden" name="patientId" value={p.id} />

        <section className="space-y-3">
          <h2 className="font-semibold">Presión sistólica (la primera, la más alta)</h2>
          <div className="grid grid-cols-3 gap-3">
            <Range label="Normal mín." name="sysNormalMin" value={p.sysNormalMin} placeholder="110" />
            <Range label="Normal máx." name="sysNormalMax" value={p.sysNormalMax} placeholder="135" />
            <Range label="Revisar hasta" name="sysReviewMax" value={p.sysReviewMax} placeholder="150" />
          </div>
          <p className="text-xs text-slate-500">
            Lecturas por encima de "revisar hasta" se marcan como alerta.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Presión diastólica (la segunda, la más baja)</h2>
          <div className="grid grid-cols-3 gap-3">
            <Range label="Normal mín." name="diaNormalMin" value={p.diaNormalMin} placeholder="60" />
            <Range label="Normal máx." name="diaNormalMax" value={p.diaNormalMax} placeholder="85" />
            <Range label="Revisar hasta" name="diaReviewMax" value={p.diaReviewMax} placeholder="95" />
          </div>
        </section>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary btn-lg flex-1">Guardar rangos</button>
          <Link href={`/pacientes/${p.id}`} className="btn-secondary btn-lg">Cancelar</Link>
        </div>
      </form>
    </div>
  );
}

function Range({
  label, name, value, placeholder,
}: { label: string; name: string; value: number | null; placeholder: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={1}
        max={400}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className="input text-center text-lg font-semibold"
      />
    </div>
  );
}
