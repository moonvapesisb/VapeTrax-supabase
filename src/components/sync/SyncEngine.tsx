import { useEffect, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, SyncOperation } from '../../lib/db';
import type { Database, Json } from '../../types/supabase';
import { supabase } from '../../lib/supabase';
import { refreshRowsOf, syncFinanceFromCloud } from '../../lib/sync';
import {
  reapplyOptimisticLocalOp,
  revertOptimisticLocalOp,
} from '../../lib/financeAccounts';
import {
  createdTxIdsOf,
  isBlockedByDependency,
  isQueueItemDue as isDue,
  referencedAccountIds,
  sendableNow,
  TRANSIENT_CODES,
  TRANSIENT_HTTP,
  waitsForNetwork,
} from '../../lib/financeCore';
export { referencedAccountIds, sendableNow, waitsForNetwork };
import { notifyTableChanged } from '../../lib/liveSync';
import { useAuth } from '../../contexts/AuthContext';
import { CloudOff, RefreshCw, AlertTriangle, Trash2, Download, RotateCcw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { friendlyError } from '../../lib/errors';

/** Why an item has not reached the cloud, in plain words (codes are for the admin only). */
const itemProblem = (type: string, code: string | undefined, message: string | undefined): string => {
  if (code === 'unsupported') return `This app version cannot send "${type}" items. Update the app.`;
  return friendlyError({ code, message: message || '' }, 'The cloud did not accept it yet.');
};

// The queue is checked on this timer, when the device comes online, when the app
// comes back to the foreground and as soon as a new item is saved. Checking only
// reads the device database; the network is used only when an item is due.
//
// Order matters: a sale carries the bottle levels it leaves behind (not just the ml it
// used), so an older sale arriving after a newer one would roll the bottles back.
// Items go out strictly oldest first. One waiting for the network holds back every
// later item; only an item the server itself refused is passed over (it would
// otherwise block the shop forever), and the bottles later sales have already sent
// are then left out of it when it goes (see overtakenBottleIds).
const TICK_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_NETWORK_BACKOFF_MS = 60_000;
/** After this many refusals by the server an item stops retrying and waits for a person. */
const MAX_SERVER_FAILURES = 10;
/** "Busy" answers (timeouts, 503 ...) to one item before they count as refusals. */
const MAX_BUSY_ANSWERS = 20;
const RPC_TIMEOUT_MS = 45_000;

// One tab sends at a time: Web Locks where available, else a localStorage lease.
const LOCK_NAME = 'vapetrax-sync';
const LEASE_KEY = 'vapetrax_sync_lease';
const LEASE_MS = 2 * RPC_TIMEOUT_MS;
const TAB_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

// 5s, 10s, 20s ... capped, so a failing item can't hammer the server.
const backoffMs = (attempts: number, cap = MAX_BACKOFF_MS) =>
  Math.min(cap, 5_000 * 2 ** Math.min(Math.max(attempts, 1) - 1, 6));

type Outcome =
  | { kind: 'done' }
  | { kind: 'unreached'; message: string; code: string } // never reached the server, or it was busy: not counted
  | { kind: 'refused'; message: string; code: string } // the server refused this item: counted
  | { kind: 'unsupported'; message: string; code: string };

const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;

const errorText = (err: unknown): string => {
  if (typeof err === 'object' && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message) return rec.message;
    if (typeof rec.details === 'string' && rec.details) return rec.details;
    return JSON.stringify(err) || 'Unknown error';
  }
  return typeof err === 'string' && err ? err : 'Unknown error';
};

const asArray = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

/** Bottle ids whose levels this item sets on the server. */
const bottleIdsOf = (item: SyncOperation): string[] =>
  [...asArray(item.payload?.p_bottle_updates), ...asArray(item.payload?.p_bottle_inserts)]
    .map(b => b?.id)
    .filter(id => id !== undefined && id !== null && id !== '')
    .map(String);

/** The payload to send: bottles a later, already-sent sale has overtaken are left out. */
export const payloadToSend = (item: SyncOperation): Record<string, unknown> => {
  const skip = new Set(item.overtakenBottleIds || []);
  if (!skip.size || !Array.isArray(item.payload?.p_bottle_updates)) return item.payload;
  return {
    ...item.payload,
    p_bottle_updates: asArray(item.payload.p_bottle_updates).filter(
      (b) => !skip.has(String(b?.id)),
    ),
  };
};

/**
 * Removes a sent item. Older items still in the queue (refused, waiting or failed) are
 * told which bottles this one has set: its levels already include theirs.
 */
const markDone = async (item: SyncOperation): Promise<void> => {
  const bottleIds = bottleIdsOf(item);
  await db.transaction('rw', db.syncQueue, async () => {
    await db.syncQueue.delete(item.id!);
    if (!bottleIds.length) return;
    await db.syncQueue.toCollection()
      .filter(older => (older.id ?? Infinity) < item.id!)
      .modify(older => {
        older.overtakenBottleIds = [...new Set([...(older.overtakenBottleIds || []), ...bottleIds])];
      });
  });
};

/** Is this sale already stored on the server? null when that can't be told right now. */
const saleIsOnServer = async (shopId: string | undefined, saleId: string): Promise<boolean | null> => {
  let query = supabase.from('sales').select('id').eq('id', saleId);
  if (shopId) query = query.eq('shopId', shopId);
  const signal = timeoutSignal(15_000);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return !!data;
};

/** Checks whether this deterministic-id item already reached the server. */
const rowExistsOnServer = async (
  table: 'finance_accounts' | 'finance_transactions' | 'expenses' | 'credits',
  id: string,
  shopId?: string,
): Promise<boolean | null> => {
  let query = supabase.from(table).select('id').eq('id', id);
  if (shopId && table !== 'finance_accounts' && table !== 'finance_transactions') {
    query = query.eq('shopId', shopId);
  }
  const signal = timeoutSignal(15_000);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return !!data;
};

const itemIsAlreadyOnServer = async (item: SyncOperation): Promise<boolean | null> => {
  const p = item.payload || {};
  const shopId = p.p_shop_id ? String(p.p_shop_id) : undefined;
  switch (item.type) {
    case 'process_checkout': {
      const saleId = (p.p_sale_data as { id?: unknown } | undefined)?.id;
      return saleId ? saleIsOnServer(shopId, String(saleId)) : null;
    }
    case 'create_finance_account':
      return p.p_id ? rowExistsOnServer('finance_accounts', String(p.p_id)) : null;
    case 'record_opening_balance':
    case 'record_payout':
    case 'reverse_finance_transaction':
      return p.p_id ? rowExistsOnServer('finance_transactions', String(p.p_id)) : null;
    case 'transfer_funds':
      return p.p_out_tx_id ? rowExistsOnServer('finance_transactions', String(p.p_out_tx_id)) : null;
    case 'record_expense':
      return p.p_expense_id ? rowExistsOnServer('expenses', String(p.p_expense_id), shopId) : null;
    case 'record_credit_payment':
      return p.p_credit_id ? rowExistsOnServer('credits', String(p.p_credit_id), shopId) : null;
    default:
      return null;
  }
};

const SAFE_DUPLICATE_PK_RE =
  /\b(sales_pkey|finance_accounts_pkey|finance_transactions_pkey|expenses_pkey|credits_pkey|finance_transactions_transfer_leg_unique)\b/;

/** Calls the typed RPC matching `item.type`, returning the Supabase response or null if unsupported. */
const executeItemRpc = (item: SyncOperation) => {
  const p = item.payload || {};
  const str = (v: unknown, fallback = ''): string => (v == null ? fallback : String(v));
  const optStr = (v: unknown): string | null => (v == null ? null : String(v));
  const numVal = (v: unknown, fallback = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const rpcArgs = () => {
    switch (item.type) {
      case 'process_checkout': {
        const sent = payloadToSend(item);
        const args: Database['public']['Functions']['process_checkout']['Args'] = {
          p_bottle_updates: (sent.p_bottle_updates ?? []) as Json,
          p_credit_increment: numVal(sent.p_credit_increment, 0),
          p_customer_id: str(sent.p_customer_id),
          p_inventory_logs: (sent.p_inventory_logs ?? []) as Json,
          p_product_updates: (sent.p_product_updates ?? []) as Json,
          p_sale_data: (sent.p_sale_data ?? {}) as Json,
          p_shop_id: str(sent.p_shop_id),
        };
        return supabase.rpc('process_checkout', args);
      }
      case 'process_stock_adjustment': {
        const sent = payloadToSend(item);
        const args: Database['public']['Functions']['process_stock_adjustment']['Args'] = {
          p_bottle_inserts: (sent.p_bottle_inserts ?? []) as Json,
          p_bottle_updates: (sent.p_bottle_updates ?? []) as Json,
          p_inventory_logs: (sent.p_inventory_logs ?? []) as Json,
          p_product_id: str(sent.p_product_id),
          p_product_update: (sent.p_product_update ?? {}) as Json,
          p_shop_id: str(sent.p_shop_id),
        };
        return supabase.rpc('process_stock_adjustment', args);
      }
      case 'create_finance_account':
        return supabase.rpc('create_finance_account', {
          p_id: str(p.p_id),
          p_shop_id: str(p.p_shop_id),
          p_name: str(p.p_name),
          p_type: str(p.p_type),
          p_bank_name: optStr(p.p_bank_name),
          p_account_number: optStr(p.p_account_number),
          p_opening_balance: numVal(p.p_opening_balance, 0),
          p_opening_tx_id: optStr(p.p_opening_tx_id),
        });
      case 'update_finance_account':
        return supabase.rpc('update_finance_account', {
          p_id: str(p.p_id),
          p_name: str(p.p_name),
          p_bank_name: optStr(p.p_bank_name),
          p_account_number: optStr(p.p_account_number),
        });
      case 'archive_finance_account':
        return supabase.rpc('archive_finance_account', {
          p_id: str(p.p_id),
        });
      case 'record_opening_balance':
        return supabase.rpc('record_opening_balance', {
          p_id: str(p.p_id),
          p_shop_id: str(p.p_shop_id),
          p_account_id: str(p.p_account_id),
          p_amount: numVal(p.p_amount),
          p_notes: optStr(p.p_notes),
          p_occurred_at: optStr(p.p_occurred_at),
        });
      case 'transfer_funds':
        return supabase.rpc('transfer_funds', {
          p_transfer_id: str(p.p_transfer_id),
          p_out_tx_id: str(p.p_out_tx_id),
          p_in_tx_id: str(p.p_in_tx_id),
          p_shop_id: str(p.p_shop_id),
          p_from_account_id: str(p.p_from_account_id),
          p_to_account_id: str(p.p_to_account_id),
          p_amount: numVal(p.p_amount),
          p_description: optStr(p.p_description),
          p_notes: optStr(p.p_notes),
          p_occurred_at: optStr(p.p_occurred_at),
        });
      case 'record_payout':
        return supabase.rpc('record_payout', {
          p_id: str(p.p_id),
          p_shop_id: str(p.p_shop_id),
          p_account_id: str(p.p_account_id),
          p_amount: numVal(p.p_amount),
          p_paid_to: str(p.p_paid_to),
          p_category: str(p.p_category),
          p_description: optStr(p.p_description),
          p_notes: optStr(p.p_notes),
          p_occurred_at: optStr(p.p_occurred_at),
        });
      case 'record_expense':
        return supabase.rpc('record_expense', {
          p_expense_id: str(p.p_expense_id),
          p_tx_id: str(p.p_tx_id),
          p_shop_id: str(p.p_shop_id),
          p_category: str(p.p_category),
          p_description: str(p.p_description),
          p_amount: numVal(p.p_amount),
          p_expense_date: str(p.p_expense_date),
          p_account_id: str(p.p_account_id),
        });
      case 'update_expense':
        return supabase.rpc('update_expense', {
          p_expense_id: str(p.p_expense_id),
          p_shop_id: str(p.p_shop_id),
          p_category: str(p.p_category),
          p_description: str(p.p_description),
          p_amount: numVal(p.p_amount),
          p_expense_date: str(p.p_expense_date),
          p_account_id: optStr(p.p_account_id),
          p_rev_tx_id: optStr(p.p_rev_tx_id),
          p_new_tx_id: optStr(p.p_new_tx_id),
        });
      case 'delete_expense':
        return supabase.rpc('delete_expense', {
          p_expense_id: str(p.p_expense_id),
          p_shop_id: str(p.p_shop_id),
          p_rev_tx_id: optStr(p.p_rev_tx_id),
        });
      case 'record_credit_payment':
        return supabase.rpc('record_credit_payment', {
          p_credit_id: str(p.p_credit_id),
          p_tx_id: str(p.p_tx_id),
          p_shop_id: str(p.p_shop_id),
          p_customer_id: str(p.p_customer_id),
          p_amount: numVal(p.p_amount),
          p_payment_method: str(p.p_payment_method, 'cash'),
          p_description: optStr(p.p_description),
        });
      case 'reverse_finance_transaction':
        return supabase.rpc('reverse_finance_transaction', {
          p_id: str(p.p_id),
          p_shop_id: str(p.p_shop_id),
          p_original_tx_id: str(p.p_original_tx_id),
          p_reason: str(p.p_reason),
          p_occurred_at: optStr(p.p_occurred_at),
        });
      default:
        return null;
    }
  };

  let call = rpcArgs();
  if (!call) return null;
  const signal = timeoutSignal(RPC_TIMEOUT_MS);
  if (signal) call = call.abortSignal(signal);
  return call;
};

/** Sends one queue item and says how it went. Never throws. */
const sendItem = async (item: SyncOperation): Promise<Outcome> => {
  try {
    // An earlier attempt may have reached the server even though its answer was lost.
    if (item.retryCount > 0 || (item.attempts || 0) > 0) {
      if ((await itemIsAlreadyOnServer(item)) === true) return { kind: 'done' };
    }

    const call = executeItemRpc(item);
    if (!call) {
      return { kind: 'unsupported', message: `This app version cannot send "${item.type}" items.`, code: 'unsupported' };
    }
    const res = await call;

    if (!res.error) return { kind: 'done' };

    const err = res.error as { code?: unknown; message?: unknown; details?: unknown; constraint?: unknown };
    const status = Number(res.status) || 0;
    const message = errorText(err);
    const code = String(err.code || (status ? `http_${status}` : 'network'));

    if (String(err.code || '') === '23505') {
      // Only primary key / deterministic transfer-leg conflicts (or confirmed exact ID
      // already on server) are treated as idempotent done; business uniqueness violations
      // (e.g. single_ref_unique, duplicate cash/primary account) are genuine refusals.
      const constraintDetail = `${String(err.message || '')} ${String(err.details || '')} ${String(err.constraint || '')}`;
      if (SAFE_DUPLICATE_PK_RE.test(constraintDetail)) return { kind: 'done' };
      if ((await itemIsAlreadyOnServer(item)) === true) return { kind: 'done' };
    }

    if (TRANSIENT_HTTP.has(status) || TRANSIENT_CODES.has(String(err.code || ''))) {
      return { kind: 'unreached', message, code };
    }
    return { kind: 'refused', message, code };
  } catch (err: unknown) {
    return { kind: 'unreached', message: errorText(err), code: 'network' };
  }
};

const readLease = (): { owner: string; until: number } | null => {
  try {
    return JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
  } catch {
    return null;
  }
};

const writeLease = () => {
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: TAB_ID, until: Date.now() + LEASE_MS }));
  } catch {
    // storage blocked: this tab carries on alone
  }
};

/**
 * Runs fn only if no other tab is syncing right now; otherwise does nothing.
 * fn gets a renew() to call before each slow step (it keeps the fallback lease alive).
 */
interface NavigatorWithLocks {
  locks?: {
    request: (
      name: string,
      options: { ifAvailable: boolean },
      callback: (lock: unknown) => Promise<void>,
    ) => Promise<void>;
  };
}

interface DexieTxLike {
  parent?: DexieTxLike;
  on?: (event: string, listener: () => void) => void;
}

const withSyncLock = async (fn: (renew: () => void) => Promise<void>): Promise<boolean> => {
  const locks = typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithLocks).locks : undefined;
  if (locks && typeof locks.request === 'function') {
    let ran = false;
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock: unknown) => {
      if (!lock) return;
      ran = true;
      await fn(() => {});
    });
    return ran;
  }

  const lease = readLease();
  if (lease && lease.owner !== TAB_ID && lease.until > Date.now()) return false;
  writeLease();
  // Two tabs may have written at the same moment: the last write wins.
  await new Promise(resolve => setTimeout(resolve, 60));
  const mine = readLease();
  if (mine && mine.owner !== TAB_ID) return false;
  try {
    await fn(writeLease);
  } finally {
    if (readLease()?.owner === TAB_ID) {
      try { localStorage.removeItem(LEASE_KEY); } catch { /* ignore */ }
    }
  }
  return true;
};

// In-tab guard. Module level, not per component: SyncEngine is mounted inside each
// page's layout, so it remounts on navigation while a run may still be going.
let tabRunning = false;
// A run was asked for while one was going: do one more when it ends.
let rerunRequested = false;
// The mounted engine's runQueue, for the "new item saved" hook below.
let kickQueue: (() => void) | null = null;

// A new item goes out as soon as the sale that made it is committed, not on the next
// tick, so other devices' live stock checks see it within a moment. (A hook, not a
// liveQuery: it fires once per new item, not on every change to the queue.)
db.syncQueue.hook('creating', (_key, _obj, transaction) => {
  const kick = () => { setTimeout(() => kickQueue?.(), 0); };
  let root: DexieTxLike | undefined = transaction as unknown as DexieTxLike;
  while (root?.parent) root = root.parent;
  if (root?.on && typeof root.on === 'function') root.on('complete', kick);
  else setTimeout(() => kickQueue?.(), 500);
});

const downloadJson = (items: SyncOperation[], label: string) => {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vapetrax_${label}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const describeItem = (item: SyncOperation): string => {
  const p = item.payload || {};
  switch (item.type) {
    case 'process_checkout': {
      const sale = (p.p_sale_data as Record<string, unknown> | undefined) || {};
      const amount = Number(sale.totalAmount);
      const id = String(sale.id || '').slice(-6).toUpperCase();
      return `Sale #${id}${Number.isFinite(amount) ? ` · Rs ${Math.round(amount).toLocaleString()}` : ''}`;
    }
    case 'process_stock_adjustment':
      return 'Stock adjustment';
    case 'create_finance_account':
      return `New bank account · ${String(p.p_name || 'Bank')}`;
    case 'update_finance_account':
      return `Edit account · ${String(p.p_name || 'Account')}`;
    case 'archive_finance_account':
      return 'Archive bank account';
    case 'record_opening_balance':
      return `Opening balance · Rs ${Math.round(Number(p.p_amount) || 0).toLocaleString()}`;
    case 'transfer_funds':
      return `Transfer · Rs ${Math.round(Number(p.p_amount) || 0).toLocaleString()}`;
    case 'record_payout':
      return `Payout to ${String(p.p_paid_to || 'recipient')} · Rs ${Math.round(Number(p.p_amount) || 0).toLocaleString()}`;
    case 'record_expense':
      return `Expense · Rs ${Math.round(Number(p.p_amount) || 0).toLocaleString()}`;
    case 'update_expense':
      return `Edit expense · Rs ${Math.round(Number(p.p_amount) || 0).toLocaleString()}`;
    case 'delete_expense':
      return 'Delete expense';
    case 'record_credit_payment':
      return `Credit payment · Rs ${Math.round(Number(p.p_amount) || 0).toLocaleString()}`;
    case 'reverse_finance_transaction':
      return 'Finance adjustment';
    default:
      return item.type;
  }
};

const FINANCE_SYNC_TYPES = new Set<SyncOperation['type']>([
  'process_checkout',
  'create_finance_account',
  'update_finance_account',
  'archive_finance_account',
  'record_opening_balance',
  'transfer_funds',
  'record_payout',
  'record_expense',
  'update_expense',
  'delete_expense',
  'record_credit_payment',
  'reverse_finance_transaction',
]);

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Re-reads, from the server, the device rows these items changed (grouped by shop). */
const refreshSent = (items: SyncOperation[]) => {
  const byShop = new Map<string, SyncOperation[]>();
  let touchedExpenses = false;
  let touchedCredits = false;
  for (const item of items) {
    const shopId = item.payload?.p_shop_id ? String(item.payload.p_shop_id) : '';
    if (item.type === 'record_expense' || item.type === 'update_expense' || item.type === 'delete_expense') {
      touchedExpenses = true;
    }
    if (item.type === 'record_credit_payment') {
      touchedCredits = true;
    }
    if (!shopId) continue;
    byShop.set(shopId, [...(byShop.get(shopId) || []), item]);
  }
  for (const [shopId, group] of byShop) {
    refreshRowsOf(shopId, group).catch(err => console.warn('[SyncEngine] Refresh after sync failed', err));
    if (group.some(op => FINANCE_SYNC_TYPES.has(op.type))) {
      syncFinanceFromCloud(shopId).catch(err => console.warn('[SyncEngine] Finance refresh after sync failed', err));
    }
  }
  if (touchedExpenses) notifyTableChanged('expenses');
  if (touchedCredits) notifyTableChanged('credits');
};

/** Sends the queue, oldest first (see the note at the top). Runs under the sync lock. */
export const sendQueue = async (renew: () => void, setSyncing: (on: boolean) => void): Promise<void> => {
  // Every pending item, oldest first (ids grow in the order actions were saved).
  const allQueue = await db.syncQueue.orderBy('id').toArray();
  const pending = allQueue.filter((item) => item.status === 'pending');
  if (!sendableNow(pending, Date.now(), allQueue).length) return;

  const blockedAccounts = new Set<string>();
  const blockedTxs = new Set<string>();
  for (const op of allQueue) {
    if (op.status === 'failed') {
      if (op.type === 'create_finance_account' && op.payload?.p_id) {
        blockedAccounts.add(String(op.payload.p_id));
      }
      for (const txId of createdTxIdsOf(op)) blockedTxs.add(txId);
    }
  }

  const sent: SyncOperation[] = [];
  setSyncing(true);
  try {
    for (const queued of pending) {
      if (!navigator.onLine) break;

      // Read it again: it may have been discarded or changed since the list was read.
      const item = await db.syncQueue.get(queued.id!);
      if (!item || item.status !== 'pending') continue;
      if (!isDue(item, Date.now())) {
        if (item.type === 'create_finance_account' && item.payload?.p_id) {
          blockedAccounts.add(String(item.payload.p_id));
        }
        for (const txId of createdTxIdsOf(item)) blockedTxs.add(txId);
        if (waitsForNetwork(item)) break; // later items wait their turn
        continue; // refused earlier and resting: later items go ahead
      }

      if (isBlockedByDependency(item, blockedAccounts, blockedTxs)) {
        if (item.type === 'create_finance_account' && item.payload?.p_id) {
          blockedAccounts.add(String(item.payload.p_id));
        }
        for (const txId of createdTxIdsOf(item)) blockedTxs.add(txId);
        continue; // must wait until the earlier create_finance_account / tx lands
      }

      renew();
      const outcome = await sendItem(item);
      if (outcome.kind === 'done') {
        await markDone(item);
        sent.push(item);
        continue;
      }

      if (item.type === 'create_finance_account' && item.payload?.p_id) {
        blockedAccounts.add(String(item.payload.p_id));
      }
      for (const txId of createdTxIdsOf(item)) blockedTxs.add(txId);

      const attempts = (item.attempts || 0) + 1;
      console.error(`[SyncEngine] Item ${item.id} (${item.type}) not synced: ${outcome.code} ${outcome.message}`);

      // A server that answers "busy" to this one item every time (a statement timeout
      // on each try, say) must not hold back the whole queue for ever: past a limit
      // those answers count as refusals, so the item is eventually passed over.
      const busyAnswers = (item.busyAnswers || 0) + (outcome.kind === 'unreached' && outcome.code !== 'network' ? 1 : 0);
      if (outcome.kind === 'unreached' && busyAnswers <= MAX_BUSY_ANSWERS) {
        // The wait applies to the whole queue: this item is first in line and
        // nothing after it is sent before it.
        await db.syncQueue.update(item.id!, {
          attempts,
          busyAnswers,
          error: outcome.message,
          lastErrorCode: outcome.code,
          lastOutcome: 'unreached',
          nextAttemptAt: Date.now() + backoffMs(attempts, MAX_NETWORK_BACKOFF_MS),
        });
        break;
      }

      const retryCount = outcome.kind === 'unsupported' ? MAX_SERVER_FAILURES : item.retryCount + 1;
      const nowFailed = retryCount >= MAX_SERVER_FAILURES;
      await db.syncQueue.update(item.id!, {
        attempts,
        busyAnswers,
        retryCount,
        error: outcome.message,
        lastErrorCode: outcome.code,
        lastOutcome: 'refused',
        status: nowFailed ? 'failed' : 'pending',
        nextAttemptAt: Date.now() + backoffMs(retryCount),
      });

      if (nowFailed) {
        await revertOptimisticLocalOp(item);
        toast.error(`${describeItem(item)} could not be saved to the cloud. Local ledger changes were reverted; open the sync panel to export or retry it.`, { duration: 10000 });
      } else if (retryCount === 1) {
        toast.error(`${describeItem(item)} is not in the cloud yet: ${itemProblem(item.type, outcome.code, outcome.message)} It stays safe on this device and is tried again.`, { duration: 8000 });
      }
    }
  } finally {
    setSyncing(false);
    // The device copy of the rows these sales changed is read again from the server
    // (other devices' changes, and rows a refresh had to leave alone meanwhile).
    refreshSent(sent);
  }
};

export function SyncEngine() {
  const { userRole } = useAuth();
  const isAdmin = userRole === 'admin';
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // For display only: sending is driven by the timer, the online/visibility events and
  // the new-item hook.
  const queueItems = useLiveQuery(() => db.syncQueue.toArray());
  const pendingItems = (queueItems || []).filter(i => i.status === 'pending');
  const failedItems = (queueItems || []).filter(i => i.status === 'failed');
  const lastError = [...pendingItems].reverse().find(i => i.error)?.error || null;

  const drainQueue = useCallback((renew: () => void) => sendQueue(renew, setIsSyncing), []);

  const runQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    if (tabRunning) {
      rerunRequested = true;
      return;
    }
    tabRunning = true;
    rerunRequested = false;
    try {
      // Cheap local check first, so idle ticks don't touch the lock.
      const allQueue = await db.syncQueue.orderBy('id').toArray();
      const pending = allQueue.filter((item) => item.status === 'pending');
      if (!sendableNow(pending, Date.now(), allQueue).length) return;
      await withSyncLock(drainQueue);
    } catch (err) {
      console.error('[SyncEngine] Queue run failed', err);
    } finally {
      tabRunning = false;
      if (rerunRequested) {
        rerunRequested = false;
        setTimeout(() => kickQueue?.(), 0);
      }
    }
  }, [drainQueue]);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      // Items that waited only because the network was down go out straight away.
      try {
        await db.syncQueue.where('status').equals('pending')
          .filter(waitsForNetwork)
          .modify({ nextAttemptAt: 0 });
      } catch { /* the regular timer still picks them up */ }
      runQueue();
    };
    const handleOffline = () => setIsOnline(false);
    const handleVisible = () => { if (document.visibilityState === 'visible') runQueue(); };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisible);
    const timer = setInterval(runQueue, TICK_MS);
    kickQueue = runQueue;
    runQueue();

    return () => {
      if (kickQueue === runQueue) kickQueue = null;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisible);
      clearInterval(timer);
    };
  }, [runQueue]);

  const handleExport = () => {
    const items = queueItems || [];
    if (!items.length) return;
    downloadJson(items, 'unsynced');
    toast.success(`${items.length} unsynced item(s) exported.`);
  };

  // The item goes back in line in its original place (oldest first). Bottles that
  // later sales have already sent are left out of it (overtakenBottleIds), so a retry
  // never rolls a bottle back.
  const handleRetry = async (item: SyncOperation) => {
    await reapplyOptimisticLocalOp(item);
    await db.syncQueue.update(item.id!, {
      status: 'pending', retryCount: 0, attempts: 0, busyAnswers: 0, nextAttemptAt: 0, lastOutcome: undefined,
    });
    runQueue();
  };

  const handleDiscard = async (item: SyncOperation) => {
    if (!isAdmin) return;
    if (!navigator.onLine) {
      toast.error('Discard needs internet, so the cloud can be checked first.');
      return;
    }
    const onServer = await itemIsAlreadyOnServer(item);
    const warning = onServer
      ? `${describeItem(item)} is already saved in the cloud, so removing this copy loses nothing.`
      : `${describeItem(item)} has NOT reached the cloud. Discarding it loses it from your records for good.`;
    const answer = window.prompt(`${warning}\n\nA copy will be downloaded first. Type DELETE to discard this one item.`);
    if (answer?.trim() !== 'DELETE') return;

    // Never while this tab or another one is sending.
    let ran = false;
    if (!tabRunning) {
      tabRunning = true;
      try {
        ran = await withSyncLock(async () => {
          const current = await db.syncQueue.get(item.id!);
          if (!current) return;
          downloadJson([current], `discarded_item_${current.id}`);
          await revertOptimisticLocalOp(current, { deleteQueueRow: true });
          await db.syncQueue.delete(current.id!);
          toast.success('Item discarded. A copy was downloaded.');
          // The device copy still holds non-ledger item changes: read those rows again.
          refreshSent([current]);
        });
      } finally {
        tabRunning = false;
      }
    }
    if (!ran) toast.error('Sync is running. Try again in a moment.');
  };

  const total = (queueItems || []).length;

  // Don't render anything if online and nothing is waiting
  if (isOnline && total === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 max-w-[calc(100vw-2rem)]">
      {total > 0 && (
        <div className="flex flex-col items-end gap-1">
          {showDetails && (
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg w-80 max-w-full text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                <span className="font-bold text-slate-900">Waiting to sync</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold"
                  >
                    <Download size={12} /> Export unsynced (JSON)
                  </button>
                  <button onClick={() => setShowDetails(false)} aria-label="Close" className="p-1 rounded-lg hover:bg-slate-100">
                    <X size={12} />
                  </button>
                </div>
              </div>
              <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                {(queueItems || []).map(item => (
                  <li key={item.id} className="px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 truncate">{describeItem(item)}</span>
                      <span className={item.status === 'failed' ? 'font-bold text-red-600' : 'font-bold text-orange-600'}>
                        {item.status === 'failed' ? 'Failed' : 'Waiting'}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      {formatWhen(item.createdAt)}
                      {item.retryCount > 0 && ` · refused ${item.retryCount}x`}
                      {isAdmin && item.lastErrorCode && ` · ${item.lastErrorCode}`}
                    </div>
                    {item.error && (
                      <div className="text-red-700 break-words line-clamp-3">{itemProblem(item.type, item.lastErrorCode, item.error)}</div>
                    )}
                    {isAdmin && item.error && (
                      <div className="font-mono text-slate-400 break-all line-clamp-2" title={item.error}>{item.error}</div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      {item.status === 'failed' && (
                        <button
                          onClick={() => handleRetry(item)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 font-bold"
                        >
                          <RotateCcw size={12} /> Retry
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => handleDiscard(item)}
                          disabled={!isOnline || isSyncing}
                          title={!isOnline ? 'Needs internet' : 'Discard this item (admin only)'}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={12} /> Discard
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => setShowDetails(v => !v)}
            className={`${failedItems.length ? 'bg-red-600/90' : 'bg-orange-500/90'} backdrop-blur text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2`}
          >
            {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <CloudOff size={16} />}
            <span>
              {isSyncing
                ? 'Syncing data...'
                : [
                    pendingItems.length ? `${pendingItems.length} item(s) waiting to sync` : '',
                    failedItems.length ? `${failedItems.length} failed` : '',
                  ].filter(Boolean).join(' · ')}
            </span>
            {!isSyncing && (lastError || failedItems.length > 0) && (
              <AlertTriangle size={14} className="text-yellow-200" />
            )}
          </button>
        </div>
      )}
      {!isOnline && (
        <div className="bg-red-500/90 backdrop-blur text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CloudOff size={16} />
          You are offline. Working locally.
        </div>
      )}
    </div>
  );
}
