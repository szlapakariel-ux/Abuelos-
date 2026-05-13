import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canRegisterDailyCare, getPatientAccess } from '@/lib/permissions';
import { startOfToday, endOfToday, formatTime } from '@/lib/date';
import { Mood, SleepQuality, MobilityStatus, HygieneStatus, BowelStatus, PainLevel } from '@prisma/client';

async function recordStatus(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canRegisterDailyCare(access.patientRole)) throw new Error('No autorizado');

  await prisma.dailyStatus.create({
    data: {
      patientId,
      date: new Date(),
      mood: String(formData.get('mood')) as Mood,
      sleep: String(formData.get('sleep')) as SleepQuality,
      mobility: String(formData.get('mobility')) as MobilityStatus,
      hygiene: String(formData.get('hygiene')) as HygieneStatus,
      bowel: String(formData.get('bowel')) as BowelStatus,
      pain: String(formData.get('pain')) as PainLevel,
      notes: String(formData.get('notes') || '').trim() || null,
      recordedById: session.user.id,
    },
  });

  revalidatePath(`/pacientes/${patientId}/estado`);
  revalidatePath(`/pacientes/${patientId}`);
}

const MOOD_LABEL: Record<Mood, string> = {
  GOOD: 'Bien', FAIR: 'Regular', SAD: 'Triste', IRRITABLE: 'Irritable', CONFUSED: 'Confundido',
};
const SLEEP_LABEL: Record<SleepQuality, string> = { GOOD: 'Bien', FAIR: 'Regular', BAD: 'Mal' };
const MOB_LABEL: Record<MobilityStatus, string> = { NORMAL: 'Normal', WITH_HELP: 'Con ayuda', DIFFICULTY: 'Dificultad', BED: 'No se levantó' };
const HYG_LABEL: Record<HygieneStatus, string> = { DONE: 'Realizada', PARTIAL: 'Parcial', NOT_DONE: 'No realizada' };
const BOWEL_LABEL: Record<BowelStatus, string> = { NORMAL: 'Normal', CONSTIPATION: 'Constipación', DIARRHEA: 'Diarrea', NO_DATA: 'Sin datos' };
const PAIN_LABEL: Record<PainLevel, string> = { NONE: 'No', MILD: 'Leve', MODERATE: 'Moderado', SEVERE: 'Fuerte' };

export default async function StatusPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const today = await prisma.dailyStatus.findFirst({
    where: { patientId: params.patientId, date: { gte: startOfToday(), lte: endOfToday() } },
    orderBy: { date: 'desc' },
    include: { recordedBy: { select: { name: true } } },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-600">
          <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver</Link>
        </p>
        <h1 className="text-xl font-bold mt-1">Estado general</h1>
      </div>

      <form action={recordStatus} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />
        <ButtonGroup name="mood" label="Ánimo" options={MOOD_LABEL} defaultValue="GOOD" />
        <ButtonGroup name="sleep" label="Sueño" options={SLEEP_LABEL} defaultValue="GOOD" />
        <ButtonGroup name="mobility" label="Movilidad" options={MOB_LABEL} defaultValue="NORMAL" />
        <ButtonGroup name="hygiene" label="Higiene" options={HYG_LABEL} defaultValue="DONE" />
        <ButtonGroup name="bowel" label="Baño / deposiciones" options={BOWEL_LABEL} defaultValue="NORMAL" />
        <ButtonGroup name="pain" label="Dolor" options={PAIN_LABEL} defaultValue="NONE" />

        <div>
          <label className="label">Observación</label>
          <textarea name="notes" rows={3} className="input" placeholder="opcional" />
        </div>

        <button type="submit" className="btn-primary btn-lg w-full">Guardar</button>
      </form>

      {today && (
        <div className="card">
          <p className="font-semibold">Registro de hoy</p>
          <p className="text-sm text-slate-500">{formatTime(today.date)} · {today.recordedBy.name}</p>
          <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <Row label="Ánimo" value={MOOD_LABEL[today.mood]} />
            <Row label="Sueño" value={SLEEP_LABEL[today.sleep]} />
            <Row label="Movilidad" value={MOB_LABEL[today.mobility]} />
            <Row label="Higiene" value={HYG_LABEL[today.hygiene]} />
            <Row label="Deposiciones" value={BOWEL_LABEL[today.bowel]} />
            <Row label="Dolor" value={PAIN_LABEL[today.pain]} />
          </dl>
          {today.notes && <p className="text-sm text-slate-700 mt-3">{today.notes}</p>}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function ButtonGroup<T extends string>({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: Record<T, string>;
  defaultValue: T;
}) {
  const entries = Object.entries(options) as [T, string][];
  return (
    <div>
      <label className="label">{label}</label>
      <div className={`grid gap-2 ${entries.length > 3 ? 'grid-cols-3' : 'grid-cols-3'}`}>
        {entries.map(([value, lbl]) => (
          <label
            key={value}
            className="card cursor-pointer p-3 text-center has-[:checked]:border-brand has-[:checked]:bg-brand-50"
          >
            <input type="radio" name={name} value={value} defaultChecked={value === defaultValue} className="sr-only" />
            <span className="font-semibold text-sm">{lbl}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
