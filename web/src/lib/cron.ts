// Minimal 5-field cron (minute hour day-of-month month day-of-week), UTC.
// Supports *, lists (1,2), ranges (1-5), steps (*/15, 1-10/2). Used to preview schedules.

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function field(expr: string, [lo, hi]: [number, number]): Set<number> | null {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1].split("-").map(Number);
      a = x;
      b = y ?? (m[2] ? hi : x);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v === 7 && hi === 6 ? 0 : v);
  }
  return out;
}

export function parseCron(expr: string): Set<number>[] | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => field(p, RANGES[i]));
  return sets.some((s) => !s) ? null : (sets as Set<number>[]);
}

/** Next `n` run times (UTC) after `from`. */
export function nextRuns(expr: string, n = 3, from = new Date()): Date[] {
  const c = parseCron(expr);
  if (!c) return [];
  const [min, hour, dom, mon, dow] = c;
  const domAny = expr.trim().split(/\s+/)[2] === "*";
  const dowAny = expr.trim().split(/\s+/)[4] === "*";
  const out: Date[] = [];
  const t = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let guard = 0; guard < 600000 && out.length < n; guard++) {
    const dayOk = domAny && dowAny ? true : domAny ? dow.has(t.getUTCDay()) : dowAny ? dom.has(t.getUTCDate()) : dom.has(t.getUTCDate()) || dow.has(t.getUTCDay());
    if (!mon.has(t.getUTCMonth() + 1) || !dayOk) {
      t.setUTCHours(0, 0, 0, 0);
      t.setUTCDate(t.getUTCDate() + 1);
      continue;
    }
    if (!hour.has(t.getUTCHours())) {
      t.setUTCMinutes(0, 0, 0);
      t.setUTCHours(t.getUTCHours() + 1);
      continue;
    }
    if (min.has(t.getUTCMinutes())) out.push(new Date(t));
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return out;
}

export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every day at 06:00", cron: "0 6 * * *" },
  { label: "Weekdays at 06:00", cron: "0 6 * * 1-5" },
  { label: "Every Monday at 06:00", cron: "0 6 * * 1" },
  { label: "First of the month at 06:00", cron: "0 6 1 * *" },
];
