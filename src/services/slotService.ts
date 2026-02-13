import { loadAvailabilityConfig } from '../config/availability';
import { db } from '../db/database';
import { dayjs } from '../utils/time';
import { getBusyRanges } from './graphService';

export type Slot = {
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocal: string;
};

function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return dayjs.utc(aStart).isBefore(dayjs.utc(bEnd)) && dayjs.utc(bStart).isBefore(dayjs.utc(aEnd));
}

function localDateToUtc(date: string, time: string, tz: string): string {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', tz).utc().toISOString();
}

export async function getSlotsForDate(date: string) {
  const cfg = loadAvailabilityConfig();
  const dayLocal = dayjs.tz(date, 'YYYY-MM-DD', cfg.timezone);
  const now = dayjs();
  const earliest = now.add(cfg.minimumLeadTimeHours, 'hour');
  const latestDay = now.tz(cfg.timezone).add(cfg.maxDaysInAdvance, 'day').endOf('day');

  if (dayLocal.endOf('day').isBefore(earliest) || dayLocal.isAfter(latestDay)) {
    return [] as Slot[];
  }

  const windows = cfg.workingHours[String(dayLocal.day())] ?? [];
  const slots: Slot[] = [];

  for (const window of windows) {
    let cursor = dayjs.tz(`${date} ${window.start}`, 'YYYY-MM-DD HH:mm', cfg.timezone);
    const endWindow = dayjs.tz(`${date} ${window.end}`, 'YYYY-MM-DD HH:mm', cfg.timezone);

    while (cursor.add(cfg.slotLengthMinutes, 'minute').isSameOrBefore(endWindow)) {
      const slotStartUtc = cursor.utc().toISOString();
      const slotEndUtc = cursor.add(cfg.slotLengthMinutes, 'minute').utc().toISOString();
      if (dayjs.utc(slotStartUtc).isAfter(earliest)) {
        slots.push({
          startUtc: slotStartUtc,
          endUtc: slotEndUtc,
          startLocal: cursor.format(),
          endLocal: cursor.add(cfg.slotLengthMinutes, 'minute').format()
        });
      }
      cursor = cursor.add(cfg.slotLengthMinutes, 'minute');
    }
  }

  const dayStartUtc = localDateToUtc(date, '00:00', cfg.timezone);
  const dayEndUtc = localDateToUtc(date, '23:59', cfg.timezone);
  const busyExternal = await getBusyRanges(dayStartUtc, dayEndUtc);
  const busyLocal = db.prepare(`
    SELECT start_at_utc as start, end_at_utc as end
    FROM bookings
    WHERE status = 'CONFIRMED'
    AND start_at_utc < ?
    AND end_at_utc > ?
  `).all(dayEndUtc, dayStartUtc) as Array<{ start: string; end: string }>;

  const busy = [...busyExternal, ...busyLocal].map((b) => ({
    start: dayjs.utc(b.start).subtract(cfg.bufferBeforeMinutes, 'minute').toISOString(),
    end: dayjs.utc(b.end).add(cfg.bufferAfterMinutes, 'minute').toISOString()
  }));

  return slots.filter((slot) => !busy.some((b) => overlap(slot.startUtc, slot.endUtc, b.start, b.end)));
}

export async function isSlotAvailable(startUtc: string, endUtc: string): Promise<boolean> {
  const cfg = loadAvailabilityConfig();
  const local = dayjs.utc(startUtc).tz(cfg.timezone);
  const date = local.format('YYYY-MM-DD');
  const slots = await getSlotsForDate(date);
  return slots.some((s) => s.startUtc === startUtc && s.endUtc === endUtc);
}
