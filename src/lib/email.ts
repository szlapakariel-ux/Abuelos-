import { Resend } from 'resend';

let resend: Resend | null = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY no configurado; email omitido:', params.subject);
    return;
  }
  const from = process.env.RESEND_FROM || 'Cuidado Mayor <noreply@cuidadomayor.app>';
  await client.emails.send({ from, to: params.to, subject: params.subject, html: params.html });
}
