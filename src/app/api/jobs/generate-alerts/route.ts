import { NextResponse } from 'next/server';
import { generateAlerts } from '@/lib/alerts/generate';

/**
 * POST /api/jobs/generate-alerts
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Pensado para Railway Cron. Idempotente — se puede correr cada N minutos.
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 503 });
  }
  const provided = req.headers.get('x-cron-secret');
  if (provided !== expected) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const started = Date.now();
  try {
    const result = await generateAlerts();
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      ...result,
    });
  } catch (err) {
    console.error('[generate-alerts] error', err);
    return NextResponse.json({ error: 'Job failed' }, { status: 500 });
  }
}
