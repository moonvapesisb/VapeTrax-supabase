import { supabase } from './supabase';
import { isNetworkError } from './errors';
import { sameInstant } from './dates';
import type { CreditTransactionType } from './credits';

// The customer's udhaar (creditBalance) on the server, changed safely from the app.

const roundMoney = (n: number) => Math.round(n * 100) / 100;
const BALANCE_ATTEMPTS = 4;

/** The customer as the server has it, with the udhaar exactly as the database stores it. */
export interface ServerCustomer {
  row: any;
  /**
   * creditBalance as the database's own text (null when empty). An older balance can
   * hold more digits than a JavaScript number keeps (300.29999999999995), so the
   * guarded update compares this text, never the rounded number.
   */
  balanceText: string | null;
}

const customerGone = () =>
  Object.assign(new Error('This customer was deleted on another device.'), { customerGone: true });

/** Reads the customer; undefined when the server no longer has it (deleted or archived). */
export const readServerCustomer = async (shopId: string, customerId: string): Promise<ServerCustomer | undefined> => {
  const { data, error } = await supabase
    .from('customers')
    .select('*, balanceText:creditBalance::text')
    .eq('id', customerId)
    .eq('shopId', shopId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const { balanceText, ...row } = data as any;
  return { row, balanceText: balanceText ?? null };
};

/**
 * This write's own updatedAt: now, with random microseconds (the database keeps them),
 * and never the same instant as the row's current updatedAt, so seeing it on the row
 * afterwards means this write went through.
 */
const uniqueMark = (currentUpdatedAt: unknown): string => {
  for (let shift = 0; ; shift++) {
    const iso = new Date(Date.now() + shift).toISOString(); // 2026-10-11T10:00:00.123Z
    const micro = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const mark = `${iso.slice(0, 23)}${micro}Z`;
    if (!sameInstant(mark, currentUpdatedAt)) return mark;
  }
};

/**
 * Adds `delta` to the customer's udhaar on the server and returns the saved row.
 *   - The write only goes through if the balance is still exactly the one just read,
 *     so a sale or a payment saved on another device at the same moment is never
 *     overwritten; it is then read again and retried.
 *   - If the answer is lost on the way back, the row is read again to learn whether
 *     the write went through (its updatedAt is this write's own mark), so the change
 *     is never applied twice. `unknown` is set when that cannot be told.
 */
export const addToCustomerBalance = async (shopId: string, customerId: string, delta: number, first?: ServerCustomer): Promise<any> => {
  let seen = first;
  for (let attempt = 0; attempt < BALANCE_ATTEMPTS; attempt++) {
    if (!seen) seen = await readServerCustomer(shopId, customerId);
    if (!seen) throw customerGone();
    const before = seen;
    const next = roundMoney((Number(before.balanceText) || 0) + delta);
    const mark = uniqueMark(before.row?.updatedAt);
    let update = supabase
      .from('customers')
      .update({ creditBalance: next, updatedAt: mark })
      .eq('id', customerId)
      .eq('shopId', shopId);
    update = before.balanceText === null
      ? update.is('creditBalance', null)
      : update.filter('creditBalance', 'eq', before.balanceText);
    let saved: any[] | null = null;
    let saveError: any = null;
    try {
      const res = await update.select('*');
      saved = res.data;
      saveError = res.error;
    } catch (err) {
      saveError = err;
    }
    if (!saveError) {
      if (saved && saved.length) return saved[0];
      seen = undefined; // changed on another device meanwhile (or deleted): read again
      continue;
    }
    if (!isNetworkError(saveError)) throw saveError;

    // The answer was lost. Did the write reach the server?
    let after: ServerCustomer | undefined;
    try {
      after = await readServerCustomer(shopId, customerId);
    } catch (err) {
      throw Object.assign(new Error('The balance could not be confirmed.'), { unknown: true, cause: err });
    }
    if (!after) throw customerGone();
    if (sameInstant(after.row.updatedAt, mark)) return after.row; // it did
    if (after.balanceText === before.balanceText) {
      seen = after; // it did not: try again
      continue;
    }
    // Changed by someone else in between: whether this write went through can't be told.
    throw Object.assign(new Error('The balance could not be confirmed.'), { unknown: true });
  }
  throw new Error('The balance kept changing on another device.');
};

/**
 * The amount that brings this balance exactly to zero on this tab, or null. Older
 * balances can hold paisa (imported prices); that one amount may hold paisa too, so
 * such an account can always be closed.
 */
export const settleAmountFor = (balance: unknown, tab: CreditTransactionType): number | null => {
  const b = roundMoney(Number(balance) || 0);
  if (tab === 'taken' && b > 0) return b;
  if (tab === 'given' && b < 0) return -b;
  return null;
};
