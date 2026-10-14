// Shop rules for amounts. The database enforces the same rules (migration
// 20261011140000), so the UI and the server always agree.

/** Refills are sold in 0.5 ml steps: 0.5, 1, 1.5, 2 ... */
export const REFILL_STEP_ML = 0.5;

export const isValidRefillMl = (ml: number): boolean =>
  Number.isFinite(ml) && ml > 0 && Number.isInteger(ml * 2);

/** Snaps any typed amount to the nearest 0.5 ml step (minimum 0.5 ml). */
export const snapRefillMl = (ml: number): number => {
  if (!Number.isFinite(ml) || ml <= 0) return REFILL_STEP_ML;
  return Math.max(REFILL_STEP_ML, Math.round(ml * 2) / 2);
};

/** Prices are whole rupees: no paisa. */
export const roundRupees = (amount: number): number =>
  Number.isFinite(amount) ? Math.round(amount) : 0;
