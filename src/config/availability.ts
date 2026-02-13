import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AvailabilityConfig } from '../types/availability';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const schema = z.object({
  timezone: z.string().default('Europe/Berlin'),
  slotLengthMinutes: z.number().int().positive(),
  bufferBeforeMinutes: z.number().int().nonnegative(),
  bufferAfterMinutes: z.number().int().nonnegative(),
  minimumLeadTimeHours: z.number().int().nonnegative(),
  maxDaysInAdvance: z.number().int().positive(),
  workingHours: z.record(z.array(z.object({
    start: z.string().regex(timePattern),
    end: z.string().regex(timePattern)
  })))
});

const filePath = path.resolve(process.cwd(), 'config/availability.json');

function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function validateWindows(config: AvailabilityConfig) {
  for (const [weekday, windows] of Object.entries(config.workingHours)) {
    const sorted = [...windows].sort((a, b) => minutes(a.start) - minutes(b.start));
    let lastEnd = -1;
    for (const window of sorted) {
      const start = minutes(window.start);
      const end = minutes(window.end);
      if (start >= end) throw new Error(`Invalid window on day ${weekday}: ${window.start}-${window.end}`);
      if (start < lastEnd) throw new Error(`Overlapping windows on day ${weekday}`);
      lastEnd = end;
    }
  }
}

export function loadAvailabilityConfig(): AvailabilityConfig {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = schema.parse(JSON.parse(raw)) as AvailabilityConfig;
  validateWindows(parsed);
  return parsed;
}
