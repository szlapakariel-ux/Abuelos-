import { NextResponse } from 'next/server';
import { sendDailyReports } from '@/lib/email/daily-report';

/**
 * POST /api/jobs/send-daily-reports
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Pensado para correrse una vez por día desde Railway Cron.
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
    const result = await sendDailyReports();
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - started,
      ...result,
    });
  } catch (err) {
    console.error('[send-daily-reports] error', err);
    return NextResponse.json({ error: 'Job failed' }, { status: 500 });
  }
}
