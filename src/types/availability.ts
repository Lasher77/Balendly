export type TimeWindow = { start: string; end: string };

export type AvailabilityConfig = {
  timezone: string;
  slotLengthMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumLeadTimeHours: number;
  maxDaysInAdvance: number;
  workingHours: Record<string, TimeWindow[]>;
};
