import { env } from '../config/env';
import { hmacSha256 } from '../utils/security';

export async function sendWebhook(eventType: string, payload: Record<string, unknown>) {
  if (!env.N8N_WEBHOOK_URL) return;
  const body = JSON.stringify({ eventType, ...payload });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.N8N_WEBHOOK_SECRET) {
    headers['X-Balendly-Signature'] = hmacSha256(env.N8N_WEBHOOK_SECRET, body);
  }
  await fetch(env.N8N_WEBHOOK_URL, { method: 'POST', headers, body });
}
