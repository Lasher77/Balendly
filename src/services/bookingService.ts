import { nanoid } from 'nanoid';
import { db } from '../db/database';
import { env } from '../config/env';
import { dayjs } from '../utils/time';
import { randomToken } from '../utils/security';
import { createEvent, deleteEvent, updateEvent } from './graphService';
import { isSlotAvailable } from './slotService';
import { sendWebhook } from './webhookService';

export type InviteeInput = {
  firstName: string;
  lastName: string;
  company: string;
  postalCode: string;
  email: string;
  phone: string;
};

export async function createBooking(input: {
  slotStartUtc: string;
  slotEndUtc: string;
  timezone: string;
  invitee: InviteeInput;
}) {
  const available = await isSlotAvailable(input.slotStartUtc, input.slotEndUtc);
  if (!available) throw new Error('Slot no longer available');

  const bookingId = nanoid(16);
  const now = dayjs.utc().toISOString();
  const rescheduleToken = randomToken(32);
  const cancelToken = randomToken(32);
  const rescheduleUrl = `${env.BASE_URL}/b/${bookingId}/reschedule?token=${rescheduleToken}`;
  const cancelUrl = `${env.BASE_URL}/b/${bookingId}/cancel?token=${cancelToken}`;

  db.prepare(`
    INSERT INTO bookings(
      id, status, timezone, first_name, last_name, company, postal_code,
      email, phone, start_at_utc, end_at_utc,
      reschedule_token, cancel_token, created_at, updated_at
    ) VALUES(@id, 'CONFIRMED', @timezone, @firstName, @lastName, @company, @postalCode,
      @email, @phone, @startAtUtc, @endAtUtc, @rescheduleToken, @cancelToken, @now, @now)
  `).run({
    id: bookingId,
    timezone: input.timezone,
    firstName: input.invitee.firstName,
    lastName: input.invitee.lastName,
    company: input.invitee.company,
    postalCode: input.invitee.postalCode,
    email: input.invitee.email,
    phone: input.invitee.phone,
    startAtUtc: input.slotStartUtc,
    endAtUtc: input.slotEndUtc,
    rescheduleToken,
    cancelToken,
    now
  });

  const eventBody = [
    `BookingId: ${bookingId}`,
    `Reschedule: ${rescheduleUrl}`,
    `Cancel: ${cancelUrl}`,
    `Contact: ${input.invitee.firstName} ${input.invitee.lastName} (${input.invitee.company})`,
    `Email: ${input.invitee.email}`,
    `Phone: ${input.invitee.phone}`,
    `PostalCode: ${input.invitee.postalCode}`
  ].join('\n');

  const outlookEventId = await createEvent({
    subject: `Termin – ${input.invitee.firstName} ${input.invitee.lastName} (${input.invitee.company})`,
    startUtc: input.slotStartUtc,
    endUtc: input.slotEndUtc,
    body: eventBody,
    attendeeEmail: input.invitee.email
  });

  db.prepare('UPDATE bookings SET outlook_event_id = ?, updated_at = ? WHERE id = ?')
    .run(outlookEventId, dayjs.utc().toISOString(), bookingId);

  await sendWebhook('BOOKING_CREATED', {
    bookingId,
    startAtUtc: input.slotStartUtc,
    endAtUtc: input.slotEndUtc,
    timezone: input.timezone,
    ...input.invitee,
    outlookEventId,
    rescheduleUrl,
    cancelUrl
  });

  return { bookingId, outlookEventId, rescheduleUrl, cancelUrl };
}

export function getBookingByToken(id: string, token: string, type: 'reschedule' | 'cancel') {
  const col = type === 'reschedule' ? 'reschedule_token' : 'cancel_token';
  return db.prepare(`SELECT * FROM bookings WHERE id = ? AND ${col} = ?`).get(id, token) as any;
}

export async function rescheduleBooking(bookingId: string, token: string, newStartUtc: string, newEndUtc: string) {
  const booking = getBookingByToken(bookingId, token, 'reschedule');
  if (!booking || booking.status !== 'CONFIRMED') throw new Error('Invalid booking token');
  if (!(await isSlotAvailable(newStartUtc, newEndUtc))) throw new Error('Requested slot unavailable');

  if (booking.outlook_event_id) {
    await updateEvent(booking.outlook_event_id, newStartUtc, newEndUtc);
  }

  db.prepare(`
    UPDATE bookings
    SET previous_start_at_utc = start_at_utc,
        previous_end_at_utc = end_at_utc,
        start_at_utc = ?,
        end_at_utc = ?,
        updated_at = ?
    WHERE id = ?
  `).run(newStartUtc, newEndUtc, dayjs.utc().toISOString(), bookingId);

  await sendWebhook('BOOKING_RESCHEDULED', {
    bookingId,
    oldStartAtUtc: booking.start_at_utc,
    oldEndAtUtc: booking.end_at_utc,
    newStartAtUtc: newStartUtc,
    newEndAtUtc: newEndUtc,
    timezone: booking.timezone,
    firstName: booking.first_name,
    lastName: booking.last_name,
    company: booking.company,
    postalCode: booking.postal_code,
    email: booking.email,
    phone: booking.phone,
    outlookEventId: booking.outlook_event_id
  });
}

export async function cancelBooking(bookingId: string, token: string) {
  const booking = getBookingByToken(bookingId, token, 'cancel');
  if (!booking || booking.status !== 'CONFIRMED') throw new Error('Invalid booking token');

  if (booking.outlook_event_id) {
    await deleteEvent(booking.outlook_event_id);
  }

  db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?')
    .run('CANCELLED', dayjs.utc().toISOString(), bookingId);

  await sendWebhook('BOOKING_CANCELLED', {
    bookingId,
    startAtUtc: booking.start_at_utc,
    endAtUtc: booking.end_at_utc,
    timezone: booking.timezone,
    outlookEventId: booking.outlook_event_id
  });
}
