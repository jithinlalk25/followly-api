import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface ResendSendMailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  /** Reply-To header; replies from the recipient will go to this address. */
  replyTo?: string | string[];
}

/**
 * Sends an email via Resend.
 * Requires RESEND_API_KEY in env. Use RESEND_FROM for default "from" (e.g. "Followly <onboarding@resend.dev>").
 * Optional RESEND_REPLY_TO_DOMAIN builds per-campaign-lead Reply-To (campaignlead-{campaignLeadId}@domain); else RESEND_REPLY_TO as global reply-to.
 * @throws Error if Resend API key is missing or Resend returns an error
 */
export async function sendMail(options: ResendSendMailOptions): Promise<void> {
  const { from, to, subject, html, replyTo } = options;
  const payload: Parameters<Resend['emails']['send']>[0] = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo !== undefined) {
    payload.replyTo = Array.isArray(replyTo) ? replyTo : [replyTo];
  }
  const { error } = await resend.emails.send(payload);
  if (error) {
    throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
  }
}

export interface VerifyWebhookParams {
  payload: string;
  headers: { id: string; timestamp: string; signature: string };
  webhookSecret: string;
}

/**
 * Verifies a Resend webhook (Svix signature). Use the raw request body as payload.
 * Requires RESEND_API_KEY (used to construct the client; verification uses webhookSecret only) and webhookSecret.
 * @throws Error if verification fails (invalid signature, missing env, etc.)
 */
export function verifyWebhook(params: VerifyWebhookParams): import('resend').WebhookEventPayload {
  return resend.webhooks.verify({
    payload: params.payload,
    headers: params.headers,
    webhookSecret: params.webhookSecret,
  });
}

/**
 * Fetches a received (inbound) email by id from Resend.
 * Used when handling email.received webhooks to get full content (html, text, headers, to, subject).
 */
export async function getReceivedEmail(
  emailId: string,
): Promise<{
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  to: string[];
  subject: string;
}> {
  const { data, error } = await resend.emails.receiving.get(emailId);
  if (error) {
    throw new Error(`Resend get received email failed: ${JSON.stringify(error)}`);
  }
  return {
    html: data.html ?? null,
    text: data.text ?? null,
    headers: data.headers ?? {},
    to: data.to ?? [],
    subject: data.subject ?? '',
  };
}
