import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canRegisterDailyCare, getPatientAccess } from '@/lib/permissions';
import { startOfToday, endOfToday, formatTime } from '@/lib/date';
import { MealType, IntakeLevel, LiquidLevel } from '@prisma/client';

async function recordMeal(formData: FormData) {
  'use server';
  const patientId = String(formData.get('patientId'));
  const mealType = String(formData.get('mealType')) as MealType;
  const intake = String(formData.get('intake')) as IntakeLevel;
  const liquidIntakeRaw = String(formData.get('liquidIntake') || '');
  const liquidIntake = liquidIntakeRaw ? (liquidIntakeRaw as LiquidLevel) : null;
  const notes = String(formData.get('notes') || '').trim() || null;

  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, patientId);
  if (!access || !canRegisterDailyCare(access.patientRole)) throw new Error('No autorizado');

  await prisma.mealLog.create({
    data: {
      patientId,
      date: new Date(),
      mealType,
      intake,
      liquidIntake,
      nausea: formData.get('nausea') === 'on',
      vomiting: formData.get('vomiting') === 'on',
      swallowingDifficulty: formData.get('swallowingDifficulty') === 'on',
      refusal: formData.get('refusal') === 'on',
      notes,
      recordedById: session.user.id,
    },
  });

  revalidatePath(`/pacientes/${patientId}/alimentacion`);
  revalidatePath(`/pacientes/${patientId}`);
}

const MEAL_LABEL: Record<MealType, string> = {
  BREAKFAST: 'Desayuno',
  LUNCH: 'Almuerzo',
  SNACK: 'Merienda',
  DINNER: 'Cena',
};

const INTAKE_LABEL: Record<IntakeLevel, string> = {
  GOOD: 'Comió bien',
  SOME: 'Comió poco',
  NONE: 'No comió',
};

const LIQUID_LABEL: Record<LiquidLevel, string> = {
  GOOD: 'Buenos',
  LOW: 'Pocos',
  NONE: 'Nada',
};

export default async function MealPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const today = await prisma.mealLog.findMany({
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
        <h1 className="text-xl font-bold mt-1">Alimentación de hoy</h1>
      </div>

      <form action={recordMeal} className="card space-y-4">
        <input type="hidden" name="patientId" value={params.patientId} />

        <div>
          <label className="label">¿Qué comida?</label>
          <div className="grid grid-cols-2 gap-2">
            {(['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'] as MealType[]).map((m, i) => (
              <label key={m} className="card cursor-pointer p-3 flex items-center gap-2 has-[:checked]:border-brand has-[:checked]:bg-brand-50">
                <input type="radio" name="mealType" value={m} required defaultChecked={i === 0} className="size-5" />
                <span className="font-semibold">{MEAL_LABEL[m]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">¿Cómo comió?</label>
          <div className="grid grid-cols-3 gap-2">
            {(['GOOD', 'SOME', 'NONE'] as IntakeLevel[]).map((v) => (
              <label key={v} className="card cursor-pointer p-3 text-center has-[:checked]:border-brand has-[:checked]:bg-brand-50">
                <input type="radio" name="intake" value={v} required className="sr-only" />
                <span className="font-semibold">{INTAKE_LABEL[v]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Líquidos</label>
          <div className="grid grid-cols-3 gap-2">
            {(['GOOD', 'LOW', 'NONE'] as LiquidLevel[]).map((v) => (
              <label key={v} className="card cursor-pointer p-3 text-center has-[:checked]:border-brand has-[:checked]:bg-brand-50">
                <input type="radio" name="liquidIntake" value={v} className="sr-only" />
                <span className="font-semibold">{LIQUID_LABEL[v]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="label">¿Hubo algo de esto?</p>
          <div className="space-y-2">
            {[
              ['nausea', 'Náuseas'],
              ['vomiting', 'Vómitos'],
              ['swallowingDifficulty', 'Dificultad para tragar'],
              ['refusal', 'Rechazó la comida'],
            ].map(([name, label]) => (
              <label key={name} className="card p-3 flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name={name} className="size-5" />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Observación (opcional)</label>
          <textarea name="notes" rows={2} className="input" />
        </div>

        <button type="submit" className="btn-primary btn-lg w-full">Guardar</button>
      </form>

      {today.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">Hoy ({today.length})</h2>
          <div className="space-y-2">
            {today.map((m) => (
              <div key={m.id} className="card">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{MEAL_LABEL[m.mealType]}</p>
                  <span className="text-sm text-slate-500">{formatTime(m.date)}</span>
                </div>
                <p className="text-sm text-slate-700 mt-1">{INTAKE_LABEL[m.intake]}</p>
                <FlagsList meal={m} />
                {m.notes && <p className="text-sm text-slate-600 mt-1">{m.notes}</p>}
                <p className="text-xs text-slate-500 mt-2">Registró: {m.recordedBy.name}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FlagsList({ meal }: { meal: { nausea: boolean; vomiting: boolean; swallowingDifficulty: boolean; refusal: boolean } }) {
  const flags: string[] = [];
  if (meal.nausea) flags.push('náuseas');
  if (meal.vomiting) flags.push('vómitos');
  if (meal.swallowingDifficulty) flags.push('dificultad para tragar');
  if (meal.refusal) flags.push('rechazó');
  if (flags.length === 0) return null;
  return <p className="text-sm text-amber-700 mt-1">⚠ {flags.join(', ')}</p>;
}
