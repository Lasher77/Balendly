import { Client } from '@microsoft/microsoft-graph-client';
import { env } from '../config/env';
import { db } from '../db/database';
import { dayjs } from '../utils/time';

const TOKEN_SCOPE = 'offline_access openid profile User.Read Calendars.Read Calendars.ReadWrite';

type TokenRow = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

async function requestToken(params: URLSearchParams) {
  const tenant = env.MICROSOFT_TENANT_ID;
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; token_type: string; scope: string }>;
}

function saveToken(data: { access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type?: string }) {
  const expiresAt = dayjs.utc().add(data.expires_in - 60, 'second').toISOString();
  db.prepare(`
    INSERT INTO oauth_tokens(id, access_token, refresh_token, expires_at, scope, token_type, updated_at)
    VALUES (1, @accessToken, @refreshToken, @expiresAt, @scope, @tokenType, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      access_token=excluded.access_token,
      refresh_token=COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
      expires_at=excluded.expires_at,
      scope=excluded.scope,
      token_type=excluded.token_type,
      updated_at=excluded.updated_at
  `).run({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    scope: data.scope ?? TOKEN_SCOPE,
    tokenType: data.token_type ?? 'Bearer',
    updatedAt: dayjs.utc().toISOString()
  });
}

function getStoredToken(): TokenRow | null {
  return db.prepare('SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE id = 1').get() as TokenRow | null;
}

export function getAuthorizationUrl(): string {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_REDIRECT_URI) return '#';
  const tenant = env.MICROSOFT_TENANT_ID;
  const query = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: env.MICROSOFT_REDIRECT_URI,
    response_mode: 'query',
    scope: TOKEN_SCOPE
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${query.toString()}`;
}

export async function exchangeCodeForToken(code: string) {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.MICROSOFT_REDIRECT_URI) {
    throw new Error('Missing Microsoft OAuth settings');
  }
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.MICROSOFT_REDIRECT_URI
  });
  const token = await requestToken(params);
  saveToken(token);
}

async function ensureAccessToken(): Promise<string> {
  const token = getStoredToken();
  if (token?.access_token && token.expires_at && dayjs.utc(token.expires_at).isAfter(dayjs.utc())) {
    return token.access_token;
  }
  if (!token?.refresh_token || !env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error('No valid OAuth token. Connect Microsoft account in admin.');
  }

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    scope: TOKEN_SCOPE
  });
  const refreshed = await requestToken(params);
  saveToken(refreshed);
  return refreshed.access_token;
}

async function graphClient() {
  const accessToken = await ensureAccessToken();
  return Client.init({
    authProvider: (done) => done(null, accessToken)
  });
}

export async function getBusyRanges(startUtc: string, endUtc: string) {
  if (!env.MICROSOFT_ORGANIZER_EMAIL) {
    return [] as Array<{ start: string; end: string }>;
  }
  const client = await graphClient();
  const response = await client.api('/me/calendar/getSchedule').post({
    schedules: [env.MICROSOFT_ORGANIZER_EMAIL],
    startTime: { dateTime: startUtc, timeZone: 'UTC' },
    endTime: { dateTime: endUtc, timeZone: 'UTC' },
    availabilityViewInterval: 15
  });

  const items = response.value?.[0]?.scheduleItems ?? [];
  return items.map((item: any) => ({
    start: dayjs.tz(item.start.dateTime, item.start.timeZone).utc().toISOString(),
    end: dayjs.tz(item.end.dateTime, item.end.timeZone).utc().toISOString()
  }));
}

export async function createEvent(payload: {
  subject: string;
  startUtc: string;
  endUtc: string;
  body: string;
  attendeeEmail?: string;
}) {
  const client = await graphClient();
  const event = await client.api('/me/events').post({
    subject: payload.subject,
    start: { dateTime: payload.startUtc, timeZone: 'UTC' },
    end: { dateTime: payload.endUtc, timeZone: 'UTC' },
    body: { contentType: 'text', content: payload.body },
    attendees: payload.attendeeEmail
      ? [{ emailAddress: { address: payload.attendeeEmail }, type: 'required' }]
      : []
  });
  return event.id as string;
}

export async function updateEvent(eventId: string, startUtc: string, endUtc: string) {
  const client = await graphClient();
  await client.api(`/me/events/${eventId}`).patch({
    start: { dateTime: startUtc, timeZone: 'UTC' },
    end: { dateTime: endUtc, timeZone: 'UTC' }
  });
}

export async function deleteEvent(eventId: string) {
  const client = await graphClient();
  await client.api(`/me/events/${eventId}`).delete();
}
