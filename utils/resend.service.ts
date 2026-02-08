import { Resend } from 'resend';

export interface ResendSendMailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Sends an email via Resend.
 * Requires RESEND_API_KEY in env. Use RESEND_FROM for default "from" (e.g. "Followly <onboarding@resend.dev>").
 * @throws Error if Resend API key is missing or Resend returns an error
 */
export async function sendMail(options: ResendSendMailOptions): Promise<void> {
  const { from, to, subject, html } = options;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
}
