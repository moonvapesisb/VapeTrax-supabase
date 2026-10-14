export type BottleStatus = 'closed' | 'opened' | 'empty' | 'sold';

export interface BottleDoc {
  id: string;
  bottleSize: number; // ml capacity
  remainingMl: number;
  status: BottleStatus;
  createdAt?: any; // ISO string (older data: a Firestore Timestamp)
  updatedAt?: any; // ISO string (older data: a Firestore Timestamp)
  openedDate?: any; // ISO string (older data: a Firestore Timestamp)
}

export type BottleStatusCounts = Record<BottleStatus, number>;

export function parseBottleSizeMl(input: string | number | null | undefined, fallback = 30): number {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) return input;
  const raw = String(input ?? '').trim().toLowerCase();
  const match = raw.match(/(\d+(\.\d+)?)/);
  const val = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(val) || val <= 0) return fallback;
  return val;
}

export function getAvailableMl(bottles: Pick<BottleDoc, 'remainingMl' | 'status'>[]): number {
  return bottles.reduce((acc, b) => (b.status === 'sold' ? acc : acc + (Number(b.remainingMl) || 0)), 0);
}

export function computeBottleStatusCounts(bottles: Pick<BottleDoc, 'status'>[]): BottleStatusCounts {
  return bottles.reduce<BottleStatusCounts>(
    (acc, b) => {
      const key = (b.status || 'closed') as BottleStatus;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    { closed: 0, opened: 0, empty: 0, sold: 0 }
  );
}

export function isLowStockByBottleCount(counts: BottleStatusCounts, threshold: number): boolean {
  const active = (counts.closed || 0) + (counts.opened || 0);
  return active <= threshold;
}

export interface BottleUpdatePlan {
  bottleId: string;
  before: {
    remainingMl: number;
    status: BottleStatus;
    openedDate?: any;
  };
  after: {
    remainingMl: number;
    status: BottleStatus;
    openedDate?: any;
  };
}

/**
 * A bottle date in milliseconds: an ISO string (Supabase and the device copy), a
 * Date, epoch milliseconds or an old Firestore Timestamp. A missing or unreadable
 * date is 0, so that bottle counts as the oldest.
 */
export function bottleDateMs(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  let ms: number;
  if (typeof v?.toMillis === 'function') ms = Number(v.toMillis());
  else if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v;
  else ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : 0;
}

const oldestFirst = (key: 'openedDate' | 'createdAt') =>
  (a: Pick<BottleDoc, 'id' | 'openedDate' | 'createdAt'>, b: Pick<BottleDoc, 'id' | 'openedDate' | 'createdAt'>): number =>
    bottleDateMs(a[key]) - bottleDateMs(b[key]) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

/** Closed bottles in the order they are used (full-bottle sales and refills alike): the oldest first, ties by id. */
export const compareClosedBottles = oldestFirst('createdAt');

/**
 * The order a refill draws from: opened bottles first (the one opened longest ago
 * first), then closed ones, the oldest first. Ties go by id. A shop transfer moves
 * the NEWEST sealed bottles (createdAt desc, then id desc), so a device that has not
 * yet heard about a transfer is unlikely to open a bottle that has left.
 */
export function orderBottlesForRefill(bottles: BottleDoc[]): BottleDoc[] {
  const opened = bottles.filter(b => b.status === 'opened').sort(oldestFirst('openedDate'));
  const closed = bottles.filter(b => b.status === 'closed').sort(compareClosedBottles);

  // We never allocate from empty/sold for refills.
  return [...opened, ...closed];
}

export function applyRefillToBottles(params: {
  orderedBottles: BottleDoc[];
  mlNeeded: number;
  openedDateValue: any; // serverTimestamp() passed from caller
}): { plans: BottleUpdatePlan[]; mlApplied: number } {
  let remaining = params.mlNeeded;
  const plans: BottleUpdatePlan[] = [];

  for (const bottle of params.orderedBottles) {
    if (remaining <= 0) break;
    if (bottle.status !== 'opened' && bottle.status !== 'closed') continue;
    const currentRemaining = Number(bottle.remainingMl) || 0;
    if (currentRemaining <= 0) continue;

    const deduction = Math.min(currentRemaining, remaining);
    const nextRemaining = currentRemaining - deduction;

    const nextStatus: BottleStatus = nextRemaining <= 0 ? 'empty' : 'opened';
    const nextOpenedDate = bottle.status === 'closed' ? params.openedDateValue : bottle.openedDate;

    plans.push({
      bottleId: bottle.id,
      before: { remainingMl: currentRemaining, status: bottle.status, openedDate: bottle.openedDate },
      after: { remainingMl: nextRemaining, status: nextStatus, openedDate: nextOpenedDate }
    });

    remaining -= deduction;
  }

  const mlApplied = params.mlNeeded - remaining;
  return { plans, mlApplied };
}

