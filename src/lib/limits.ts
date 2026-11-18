// Caps how many videos can be processed per day, to protect your API bills.
// Resets at midnight UTC, and also when the server restarts.
const globalForLimits = globalThis as unknown as { __jobDays?: Map<string, number> };
const counts = globalForLimits.__jobDays ?? new Map<string, number>();
globalForLimits.__jobDays = counts;

export function takeJobSlot(): boolean {
  const max = Number(process.env.MAX_JOBS_PER_DAY ?? 20);
  const today = new Date().toISOString().slice(0, 10);
  const used = counts.get(today) ?? 0;
  if (used >= max) return false;
  counts.clear();
  counts.set(today, used + 1);
  return true;
}
