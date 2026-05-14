import { Resend } from 'resend';

let resend: Resend | null = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

export type SendEmailResult =
  | { ok: true; messageId: string; skipped?: never }
  | { ok: false; skipped: true; messageId?: never }
  | { ok: false; skipped?: never; error: string; messageId?: never };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY no configurado; email omitido:', params.subject);
    return { ok: false, skipped: true };
  }
  const from =
    process.env.EMAIL_FROM ||
    process.env.RESEND_FROM ||
    'Cuidado Mayor <noreply@cuidadomayor.app>';
  try {
    const res = await client.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    if (res.error) {
      return { ok: false, error: res.error.message ?? String(res.error) };
    }
    return { ok: true, messageId: res.data?.id ?? '' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
