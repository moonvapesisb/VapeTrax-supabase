import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  db,
  ExpenseRow,
  FinanceAccountRow,
  FinanceTransactionRow,
} from './db';
import {
  reconcileCloudToLocal,
  syncCloudToLocal,
  syncFinanceFromCloud,
  type LocalTable,
} from './sync';
import { fetchLinkedShopsFinanceSummary } from './financeAccounts';
import { applyServerRows, refreshLocalBottles, refreshLocalRows, removeLocalRows } from './liveStock';
import { freshTicket } from './freshness';

// Live updates from the shop's other devices.
//
// While this device is online with a live session, ONE realtime channel per shop
// listens to the shop's rows (Postgres changes, RLS-checked by the server for this
// user, and filtered to this shop):
//   - products, bottles, customers: written into the device copy (Dexie) at once,
//     with this device's unsynced sales respected (liveStock.ts), so every screen
//     that reads the device copy updates by itself;
//   - sales, credits, expenses, inventory_logs: a 'vapetrax:table-changed' event,
//     so the lists read from the server (useSupabaseOnce, Sales history) read again.
//
// Deletes: the server cannot send them to a filtered, RLS-protected listener, and
// since step 0.3 a delete from the app ARCHIVES products, customers and bottles (the
// row is then hidden, so no update arrives either). The device that deletes says so
// on the same channel (announceDeleted, acknowledged by the server and sent again
// until it is); the others never trust that message: they read those rows again by
// id, and only what the server no longer returns leaves. Anyone who knows the shop id
// could send such a message, so what they cost is capped: the rows they name are read
// again together at most every few seconds and only so many a minute, and each list
// reads again at most every 30 s because of them.
//
// Shop transfers: sealed bottles that move to another shop become that shop's rows,
// so no change for them reaches this shop's channel. The transfer's 'transfer_out'
// inventory log does (a change the server checked), and every device of the sending
// shop then reads that product's bottles again.
//
// Catching up: whenever the channel (re)connects, the device copy catches up with
// anything missed meanwhile, non-destructively (sync.ts). The first time, and every
// few hours, that is a full refresh; after a short disconnect (a phone that slept)
// only each row's id and updatedAt are read, and the rows that changed in full. A
// catch-up that fails is tried again until one succeeds. As a backstop, every few
// minutes the number of products and customers is compared with the server (a few
// bytes), which catches a delete message that never arrived; while the channel can't
// connect at all, the device copy catches up on that timer instead.

export type LiveTable = 'products' | 'bottles' | 'customers' | 'sales' | 'credits' | 'expenses' | 'inventory_logs';

export const LIVE_TABLES: readonly LiveTable[] = [
  'products', 'bottles', 'customers', 'sales', 'credits', 'expenses', 'inventory_logs',
];
const LOCAL_TABLES: readonly LocalTable[] = ['products', 'bottles', 'customers'];
const LIST_TABLES: readonly LiveTable[] = ['sales', 'credits', 'expenses', 'inventory_logs'];
/** Compared by row count on the backstop timer (bottles also change with offline sales). */
const COUNTED_TABLES: readonly LocalTable[] = ['products', 'customers'];

export const TABLE_CHANGED_EVENT = 'vapetrax:table-changed';

export interface TableChangedDetail {
  table: LiveTable;
  /**
   * local: this device just wrote it (lists read again at once);
   * remote: another device changed it (lists read again after a short pause);
   * catch-up: the live connection was (re)established, anything may have changed.
   */
  source: 'local' | 'remote' | 'catch-up';
  /** What happened, when it is one kind of change. */
  event?: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Complete rows as the server sent them (remote INSERT or UPDATE). */
  rows?: Array<Record<string, unknown> & { id: string }>;
  /** Ids that were deleted, when known. */
  ids?: string[];
}

const isLocalTable = (table: string): table is LocalTable => (LOCAL_TABLES as readonly string[]).includes(table);
const isLiveTable = (table: unknown): table is LiveTable =>
  typeof table === 'string' && (LIVE_TABLES as readonly string[]).includes(table);

const emit = (detail: TableChangedDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TableChangedDetail>(TABLE_CHANGED_EVENT, { detail }));
};

/** Tells this device's screens that it has just changed rows of `table`. */
export function notifyTableChanged(table: LiveTable, extra: Partial<Omit<TableChangedDetail, 'table'>> = {}): void {
  emit({ table, source: 'local', ...extra });
}

/** Listens to table changes (this device's own writes and other devices'). */
export function onTableChanged(handler: (detail: TableChangedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<TableChangedDetail>).detail;
    if (detail && isLiveTable(detail.table)) handler(detail);
  };
  window.addEventListener(TABLE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(TABLE_CHANGED_EVENT, listener);
}

// ---------------------------------------------------------------------------

const HINT_EVENT = 'rows-removed';
const MAX_HINT_IDS = 200;
/** Delete messages kept while the channel reconnects (the oldest go first). */
const MAX_WAITING_HINTS = 50;
/** A delete message the server did not acknowledge is sent again after this. */
const HINT_RETRY_MS = 5000;
/**
 * Delete messages are never trusted, and anyone who knows the shop id could send them,
 * so what they cost is capped. The rows they name are read again together, at most
 * this often ...
 */
const HINT_APPLY_GAP_MS = 5000;
/**
 * ... and at most this many a minute; the rest are dropped (the row-count check and
 * the next catch-up are the backstop) ...
 */
const HINT_REREADS_PER_MINUTE = 600;
/** ... and each list reads again at most this often because of them. */
const HINT_LIST_GAP_MS = 30_000;
/** Rows that arrive together are written in one go. */
const APPLY_DELAY_MS = 80;
/** Live changes that could not be written are tried again: 2 s, 4 s, 8 s, 16 s ... */
const APPLY_RETRY_MS = 2000;
/** ... and after this many failures in a row, a catch-up reads them instead. */
const MAX_APPLY_ATTEMPTS = 5;
/** If the channel is not connected by then, the device copy is refreshed anyway. */
const FALLBACK_REFRESH_MS = 4000;
/** Catch-ups are at least this far apart, however often the connection flaps. */
const MIN_CATCH_UP_GAP_MS = 15_000;
/** A failed catch-up is tried again after 15 s, 30 s, then every 60 s until one works. */
const CATCH_UP_RETRY_MS = [15_000, 30_000, 60_000] as const;
/** A full refresh (every row in full) at start and when the last one is this old. */
const FULL_REFRESH_EVERY_MS = 3 * 60 * 60 * 1000;
/** The backstop timer (row counts while connected; a catch-up while it can't connect). */
const CHECK_EVERY_MS = 3 * 60_000;
const POLL_WHILE_DOWN_MS = 5 * 60_000;
const LINKED_SUMMARY_POLL_MS = 45_000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60_000;

interface Batch {
  rows: Map<string, Record<string, unknown> & { id: string }>;
  /** id -> ticket of the live update that brought it (freshness.ts). */
  tickets: Map<string, number>;
  removed: Map<string, number>;
  /** Ids to read again from the server (a partial row, or a delete another device announced). */
  reread: Set<string>;
  /** bottles only: products whose bottles are all read again (a transfer moved some away). */
  products: Set<string>;
}

interface Hint {
  table: LiveTable;
  ids: string[];
}

interface LiveState {
  shopId: string;
  stopped: boolean;
  channel: RealtimeChannel | null;
  connecting: boolean;
  subscribed: boolean;
  /**
   * Changes may have been missed. Cleared only by a catch-up that succeeded while the
   * channel was connected from its start to its end.
   */
  stale: boolean;
  /** The fallback refresh ran during this outage (it runs once per outage). */
  fallbackDone: boolean;
  catchUp: {
    running: boolean;
    /** Asked again while one was running: one more follows it. */
    again: boolean;
    failures: number;
    lastAt: number;
    lastFullAt: number;
  };
  batches: Map<LocalTable, Batch>;
  /** Live changes that failed to apply, tried again with the next batch. */
  retry: Map<LocalTable, Batch>;
  applyFailures: number;
  applying: Promise<void>;
  timers: {
    fallback: ReturnType<typeof setTimeout> | null;
    catchUp: ReturnType<typeof setTimeout> | null;
    reconnect: ReturnType<typeof setTimeout> | null;
    apply: ReturnType<typeof setTimeout> | null;
    applyRetry: ReturnType<typeof setTimeout> | null;
    hints: ReturnType<typeof setTimeout> | null;
    hintApply: ReturnType<typeof setTimeout> | null;
    check: ReturnType<typeof setTimeout> | null;
  };
  reconnectDelay: number;
  /** Delete messages for the other devices, waiting for the channel (or an acknowledgement). */
  hints: Hint[];
  sendingHints: boolean;
  /** The last row-count difference that started a catch-up (not started twice for the same one). */
  lastMismatch: string;
  /** Rows other devices' delete messages named, waiting to be read again (HINT_APPLY_GAP_MS). */
  hintRereads: Map<LocalTable, Set<string>>;
  /** When those were last handed to the device copy. */
  hintApplyAt: number;
  /** Rows read again because of delete messages in the current minute (HINT_REREADS_PER_MINUTE). */
  hintBudget: { since: number; used: number; warned: boolean };
  /** When each list last read again because of a delete message, and the read waiting for its turn. */
  hintListAt: Map<LiveTable, number>;
  hintListTimers: Map<LiveTable, ReturnType<typeof setTimeout>>;
  financeChannel: RealtimeChannel | null;
  linkedFinanceChannels: Map<string, RealtimeChannel>;
  linkedSummaryTimer: ReturnType<typeof setTimeout> | null;
  isAdmin: boolean | null;
  cleanup: (() => void)[];
}

let current: LiveState | null = null;
/** Channels being removed; a new channel for the same shop waits for them. */
let removal: Promise<unknown> = Promise.resolve();

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

const removeChannelLater = (channel: RealtimeChannel) => {
  removal = removal.then(() => supabase.removeChannel(channel)).catch(() => undefined);
};

const keepNewestHints = (state: LiveState) => {
  if (state.hints.length > MAX_WAITING_HINTS) state.hints.splice(0, state.hints.length - MAX_WAITING_HINTS);
};

/**
 * Sends the waiting delete messages, if the channel is connected. The server
 * acknowledges each one; one it does not (a dead socket, a timeout) goes back in line
 * and is sent again shortly, or once the channel has reconnected.
 */
const sendHints = (state: LiveState) => {
  const channel = state.channel;
  if (state.stopped || !channel || !state.subscribed || state.sendingHints || !state.hints.length) return;
  const batch = state.hints.splice(0);
  state.sendingHints = true;
  void (async () => {
    const unsent: Hint[] = [];
    for (const hint of batch) {
      let status = 'error';
      try {
        status = await channel.send({ type: 'broadcast', event: HINT_EVENT, payload: hint });
      } catch {
        status = 'error';
      }
      if (status !== 'ok') unsent.push(hint);
    }
    state.sendingHints = false;
    if (state.stopped) return;
    if (unsent.length) {
      state.hints.unshift(...unsent);
      keepNewestHints(state);
      if (!state.timers.hints) {
        state.timers.hints = setTimeout(() => {
          state.timers.hints = null;
          sendHints(state);
        }, HINT_RETRY_MS);
      }
      return;
    }
    sendHints(state); // any that were added meanwhile
  })();
};

const scheduleCatchUp = (state: LiveState, delay: number) => {
  if (state.stopped || state.timers.catchUp) return;
  state.timers.catchUp = setTimeout(() => {
    state.timers.catchUp = null;
    catchUp(state);
  }, delay);
};

/** One non-destructive catch-up of the device copy; every list reads again too. */
const runCatchUp = async (state: LiveState): Promise<void> => {
  const cu = state.catchUp;
  cu.running = true;
  cu.again = false;
  cu.lastAt = Date.now();
  // Only a catch-up that runs while the channel is connected covers everything up to
  // now; one that runs while it is down (the fallback) leaves the copy stale for when
  // the channel connects.
  const connectedAtStart = state.subscribed;
  const full = !cu.lastFullAt || Date.now() - cu.lastFullAt > FULL_REFRESH_EVERY_MS;
  let ok = false;
  try {
    // Never without a session: signed out, the server would answer "no rows" and
    // the refresh would take that as the shop's rows being gone.
    const { data } = await supabase.auth.getSession();
    if (!state.stopped && data.session) {
      for (const table of LIST_TABLES) emit({ table, source: 'catch-up' });
      const stockOk = full ? await syncCloudToLocal(state.shopId) : await reconcileCloudToLocal(state.shopId);
      const financeOk = await syncFinanceFromCloud(state.shopId);
      ok = stockOk && financeOk;
      if (!state.stopped) await syncLinkedFinanceChannels(state);
      if (ok && full) cu.lastFullAt = Date.now();
      if (ok && !state.stopped) for (const table of LOCAL_TABLES) emit({ table, source: 'catch-up' });
    }
  } catch (err) {
    console.warn('[LiveSync] Catch-up failed', err);
    ok = false;
  } finally {
    cu.running = false;
  }
  if (state.stopped) return;
  if (!ok) {
    // Tried again until one succeeds: while the channel stays connected, nothing else
    // would bring what was missed.
    state.stale = true;
    cu.failures += 1;
    if (isOffline()) return; // coming back online asks again
    scheduleCatchUp(state, CATCH_UP_RETRY_MS[Math.min(cu.failures, CATCH_UP_RETRY_MS.length) - 1]);
    return;
  }
  cu.failures = 0;
  if (cu.again) {
    catchUp(state);
    return;
  }
  if (connectedAtStart && state.subscribed) state.stale = false;
};

/**
 * Asks for a catch-up: at most one runs at a time, at least MIN_CATCH_UP_GAP_MS apart.
 * `now` (the channel has just connected, the device came back online) does not wait
 * for a pending retry, only for the gap.
 */
const catchUp = (state: LiveState, now = false) => {
  if (state.stopped) return;
  state.stale = true;
  const cu = state.catchUp;
  if (cu.running) {
    cu.again = true;
    return;
  }
  if (state.timers.catchUp) {
    if (!now) return;
    clearTimeout(state.timers.catchUp);
    state.timers.catchUp = null;
  }
  const wait = cu.lastAt + MIN_CATCH_UP_GAP_MS - Date.now();
  if (wait > 0) {
    scheduleCatchUp(state, wait);
    return;
  }
  if (isOffline()) return; // coming back online asks again
  void runCatchUp(state);
};

/** If the channel does not connect soon, refresh the device copy anyway (once per outage). */
const scheduleFallback = (state: LiveState) => {
  if (state.stopped || state.fallbackDone || state.timers.fallback) return;
  state.timers.fallback = setTimeout(() => {
    state.timers.fallback = null;
    if (state.stopped || state.subscribed || isOffline()) return;
    state.fallbackDone = true;
    // A failed one is tried again by catchUp itself; the copy stays stale, so the
    // channel catches up again once it connects.
    catchUp(state, true);
  }, FALLBACK_REFRESH_MS);
};

const scheduleReconnect = (state: LiveState) => {
  if (state.stopped || state.timers.reconnect) return;
  const delay = state.reconnectDelay;
  state.reconnectDelay = Math.min(RECONNECT_MAX_MS, delay * 2);
  state.timers.reconnect = setTimeout(() => {
    state.timers.reconnect = null;
    void connect(state);
  }, delay);
};

const emptyBatch = (): Batch => ({
  rows: new Map(), tickets: new Map(), removed: new Map(), reread: new Set(), products: new Set(),
});

const batchIn = (batches: Map<LocalTable, Batch>, table: LocalTable): Batch => {
  let batch = batches.get(table);
  if (!batch) {
    batch = emptyBatch();
    batches.set(table, batch);
  }
  return batch;
};

const batchOf = (state: LiveState, table: LocalTable): Batch => batchIn(state.batches, table);

const batchSize = (batch: Batch) => batch.rows.size + batch.removed.size + batch.reread.size + batch.products.size;

/** Adds an older batch's work to `into`; what `into` already holds for a row is newer and wins. */
const mergeOlder = (into: Batch, older: Batch) => {
  const taken = new Set([...into.rows.keys(), ...into.removed.keys(), ...into.reread]);
  for (const [id, row] of older.rows) {
    if (taken.has(id)) continue;
    into.rows.set(id, row);
    const ticket = older.tickets.get(id);
    if (ticket !== undefined) into.tickets.set(id, ticket);
  }
  for (const [id, ticket] of older.removed) if (!taken.has(id)) into.removed.set(id, ticket);
  for (const id of older.reread) if (!taken.has(id)) into.reread.add(id);
  for (const id of older.products) into.products.add(id);
};

const scheduleApply = (state: LiveState) => {
  if (state.timers.apply || state.stopped) return;
  state.timers.apply = setTimeout(() => {
    state.timers.apply = null;
    state.applying = state.applying.then(() => flush(state)).catch(err => console.warn('[LiveSync] Apply failed', err));
  }, APPLY_DELAY_MS);
};

/**
 * Writes the waiting rows into the device copy, one table at a time. Work that fails
 * (a re-read on a brief network blip, a busy device database) is kept and tried again
 * with a growing pause; if it keeps failing, a catch-up reads everything again.
 */
const flush = async (state: LiveState) => {
  const batches = state.batches;
  state.batches = new Map();
  for (const [table, older] of state.retry) mergeOlder(batchIn(batches, table), older);
  state.retry = new Map();
  if (state.timers.applyRetry) {
    clearTimeout(state.timers.applyRetry);
    state.timers.applyRetry = null;
  }

  let failed = false;
  for (const table of LOCAL_TABLES) {
    const batch = batches.get(table);
    if (!batch || state.stopped) continue;
    const rows = [...batch.rows.values()];
    const removed = [...batch.removed.keys()];
    const reread = [...batch.reread];
    const products = [...batch.products];
    const unapplied = emptyBatch();
    let rowsApplied = false;
    let removedApplied = false;

    if (rows.length) {
      try {
        await applyServerRows(state.shopId, table, rows, batch.tickets);
        rowsApplied = true;
      } catch (err) {
        console.warn(`[LiveSync] Could not apply ${table} changes; trying again shortly.`, err);
        batch.rows.forEach((row, id) => unapplied.rows.set(id, row));
        batch.tickets.forEach((ticket, id) => unapplied.tickets.set(id, ticket));
      }
    }
    if (removed.length) {
      try {
        await removeLocalRows(table, removed, batch.removed);
        removedApplied = true;
      } catch (err) {
        console.warn(`[LiveSync] Could not remove ${table} rows; trying again shortly.`, err);
        batch.removed.forEach((ticket, id) => unapplied.removed.set(id, ticket));
      }
    }
    if (reread.length) {
      let ok = false;
      try {
        ok = await refreshLocalRows(state.shopId, table, reread);
      } catch (err) {
        console.warn(`[LiveSync] Could not read ${table} rows again; trying again shortly.`, err);
      }
      if (!ok) reread.forEach(id => unapplied.reread.add(id));
    }
    if (products.length) {
      let ok = false;
      try {
        ok = await refreshLocalBottles(state.shopId, products);
      } catch (err) {
        console.warn('[LiveSync] Could not read the bottles of transferred products again; trying again shortly.', err);
      }
      if (!ok) products.forEach(id => unapplied.products.add(id));
    }

    if (batchSize(unapplied)) {
      failed = true;
      mergeOlder(batchIn(state.retry, table), unapplied);
    }
    if (!state.stopped) {
      emit({
        table,
        source: 'remote',
        rows: rowsApplied && rows.length ? rows : undefined,
        ids: removedApplied && removed.length ? removed : undefined,
      });
    }
  }

  if (state.stopped) return;
  if (!failed) {
    state.applyFailures = 0;
    return;
  }
  state.applyFailures += 1;
  if (state.applyFailures >= MAX_APPLY_ATTEMPTS) {
    console.warn('[LiveSync] Live changes still could not be applied; catching up instead.');
    state.applyFailures = 0;
    state.retry = new Map();
    catchUp(state, true);
    return;
  }
  const delay = APPLY_RETRY_MS * 2 ** (state.applyFailures - 1);
  state.timers.applyRetry = setTimeout(() => {
    state.timers.applyRetry = null;
    scheduleApply(state);
  }, delay);
};

interface RealtimeRowPayload {
  eventType?: string;
  old?: Record<string, unknown>;
  new?: Record<string, unknown>;
  errors?: unknown[];
}

const onRowChange = (state: LiveState, table: LiveTable, payload: RealtimeRowPayload) => {
  if (state.stopped) return;
  const event = payload?.eventType as TableChangedDetail['event'];
  const row = event === 'DELETE' ? payload?.old : payload?.new;
  const id = row?.id != null ? String(row.id) : '';
  if (!event || !id) return;
  if (event !== 'DELETE' && row.shopId != null && String(row.shopId) !== state.shopId) return;
  // A row too large for a live message arrives cut down: it is read again instead.
  const partial = Array.isArray(payload?.errors) && payload.errors.length > 0;

  if (isLocalTable(table)) {
    // This change is newer than any read that started before it arrived.
    const ticket = freshTicket();
    const batch = batchOf(state, table);
    if (event === 'DELETE') {
      batch.rows.delete(id);
      batch.tickets.delete(id);
      batch.reread.delete(id);
      batch.removed.set(id, ticket);
    } else if (partial) {
      batch.rows.delete(id);
      batch.tickets.delete(id);
      batch.removed.delete(id);
      batch.reread.add(id);
    } else {
      batch.removed.delete(id);
      batch.reread.delete(id);
      batch.rows.set(id, { ...(batch.rows.get(id) || {}), ...row, id });
      batch.tickets.set(id, ticket);
    }
    scheduleApply(state);
    return;
  }

  // A transfer moved sealed bottles of this product to another shop (see the note at
  // the top): its bottles are read again.
  if (table === 'inventory_logs' && event === 'INSERT' && row.type === 'transfer_out' && row.productId != null) {
    batchOf(state, 'bottles').products.add(String(row.productId));
    scheduleApply(state);
  }

  if (table === 'expenses' && !partial) {
    void applyExpenseLiveEvent(state.shopId, event, row as ExpenseRow, id);
  }

  emit({
    table,
    source: 'remote',
    event,
    rows: event !== 'DELETE' && !partial && row ? [{ ...row, id }] : undefined,
    ids: event === 'DELETE' ? [id] : undefined,
  });
};

/** Lists read again because of a delete message: at once, then at most every HINT_LIST_GAP_MS. */
const hintListRefresh = (state: LiveState, table: LiveTable) => {
  if (state.hintListTimers.has(table)) return; // a read is already waiting for its turn
  const run = () => {
    state.hintListTimers.delete(table);
    if (state.stopped) return;
    state.hintListAt.set(table, Date.now());
    emit({ table, source: 'remote', event: 'DELETE' }); // lists read again from the server
  };
  const wait = (state.hintListAt.get(table) ?? 0) + HINT_LIST_GAP_MS - Date.now();
  if (wait <= 0) {
    run();
    return;
  }
  state.hintListTimers.set(table, setTimeout(run, wait));
};

/** Hands the rows that delete messages named to the device copy, at most every HINT_APPLY_GAP_MS. */
const scheduleHintRereads = (state: LiveState) => {
  if (state.stopped || state.timers.hintApply) return;
  const wait = Math.max(0, state.hintApplyAt + HINT_APPLY_GAP_MS - Date.now());
  state.timers.hintApply = setTimeout(() => {
    state.timers.hintApply = null;
    if (state.stopped) return;
    state.hintApplyAt = Date.now();
    const waiting = state.hintRereads;
    state.hintRereads = new Map();
    for (const [table, ids] of waiting) {
      // Read again now: newer than any change for these rows still waiting to be written.
      const batch = batchOf(state, table);
      for (const id of ids) {
        batch.rows.delete(id);
        batch.tickets.delete(id);
        batch.reread.add(id);
      }
    }
    scheduleApply(state);
  }, wait);
};

/**
 * Another device says it deleted rows. Nothing is removed on its word alone, and what
 * such messages cost is capped (see the note at the top).
 */
const onHint = (state: LiveState, rawPayload: unknown) => {
  if (state.stopped) return;
  const payload = (typeof rawPayload === 'object' && rawPayload !== null ? rawPayload : {}) as {
    table?: unknown;
    ids?: unknown;
  };
  if (!isLiveTable(payload.table)) return;
  const table: LiveTable = payload.table;
  if (!isLocalTable(table)) {
    hintListRefresh(state, table);
    return;
  }
  // Ids already waiting to be read again cost nothing more.
  const waiting = state.hintRereads.get(table);
  const ids: string[] = [...new Set<string>((Array.isArray(payload?.ids) ? payload.ids : [])
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)
    .slice(0, MAX_HINT_IDS))]
    .filter(id => !waiting?.has(id));
  if (!ids.length) return;
  const budget = state.hintBudget;
  const now = Date.now();
  if (now - budget.since >= 60_000) {
    budget.since = now;
    budget.used = 0;
    budget.warned = false;
  }
  const taken = ids.slice(0, Math.max(0, HINT_REREADS_PER_MINUTE - budget.used));
  budget.used += taken.length;
  if (taken.length < ids.length && !budget.warned) {
    budget.warned = true;
    console.warn('[LiveSync] Too many delete messages this minute; the rest are left to the regular checks.');
  }
  if (!taken.length) return;
  const set = waiting ?? new Set<string>();
  taken.forEach(id => set.add(id));
  state.hintRereads.set(table, set);
  scheduleHintRereads(state);
};

const onStatus = (state: LiveState, channel: RealtimeChannel, status: string, err?: Error) => {
  if (state.stopped || state.channel !== channel) return;
  if (status === 'SUBSCRIBED') {
    state.subscribed = true;
    state.reconnectDelay = RECONNECT_MIN_MS;
    state.fallbackDone = false;
    if (state.timers.fallback) {
      clearTimeout(state.timers.fallback);
      state.timers.fallback = null;
    }
    if (state.stale) catchUp(state, true);
    sendHints(state);
    void syncLinkedFinanceChannels(state);
    void refreshLinkedSummaryNow(state);
    return;
  }
  state.subscribed = false;
  state.stale = true;
  if (status === 'CLOSED') {
    // Closed from the other side: it does not rejoin by itself.
    state.channel = null;
    scheduleReconnect(state);
  } else if (err) {
    // CHANNEL_ERROR or TIMED_OUT: supabase-js rejoins by itself.
    console.warn(`[LiveSync] ${status}`, err);
  }
  scheduleFallback(state);
};

const localCount = (table: LocalTable, shopId: string): Promise<number> =>
  (table === 'products' ? db.products : db.customers).where('shopId').equals(shopId).count();

/**
 * The backstop, every few minutes while the page is shown and online:
 *   - connected: the number of products and customers is compared with the server's
 *     (a count, a few bytes). A delete message that never arrived, or a change missed
 *     some other way, shows up as a difference, and a catch-up fixes it;
 *   - not connected (realtime unavailable): the device copy catches up on this timer.
 */
const check = async (state: LiveState): Promise<void> => {
  if (state.stopped || isOffline() || isHidden() || state.catchUp.running) return;
  if (!state.subscribed) {
    if (Date.now() - state.catchUp.lastAt >= POLL_WHILE_DOWN_MS) catchUp(state, true);
    return;
  }
  if (state.stale) {
    // Changes may have been missed and no catch-up is waiting (one failed while the
    // device was offline, say): ask for one. Otherwise one is on its way already.
    if (!state.timers.catchUp) catchUp(state);
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (state.stopped || !data.session) return;
  for (const table of COUNTED_TABLES) {
    const [server, local] = await Promise.all([
      supabase.from(table).select('id', { count: 'exact', head: true }).eq('shopId', state.shopId),
      localCount(table, state.shopId),
    ]);
    if (state.stopped || server.error || typeof server.count !== 'number') return;
    if (server.count === local) continue;
    const mismatch = `${table}:${server.count}:${local}`;
    if (mismatch === state.lastMismatch) return; // a catch-up already ran for this one
    state.lastMismatch = mismatch;
    console.warn(`[LiveSync] ${table}: ${local} on this device, ${server.count} on the server; catching up.`);
    catchUp(state, true);
    return;
  }
  state.lastMismatch = '';
};

const scheduleCheck = (state: LiveState) => {
  if (state.stopped || state.timers.check) return;
  state.timers.check = setTimeout(() => {
    state.timers.check = null;
    void check(state)
      .catch(err => console.warn('[LiveSync] Check failed', err))
      .finally(() => scheduleCheck(state));
  }, CHECK_EVERY_MS);
};

const connect = async (state: LiveState): Promise<void> => {
  if (state.stopped || state.channel || state.connecting || isOffline()) return;
  state.connecting = true;
  try {
    await removal;
    if (state.stopped || state.channel) return;
    // Never without a session: the server checks every change against this user's rights.
    const { data } = await supabase.auth.getSession();
    if (state.stopped || state.channel || !data.session) return;

    const topic = `shop-live:${state.shopId}`;
    const leftover = supabase.getChannels().find(c => c.topic === `realtime:${topic}`);
    if (leftover) await supabase.removeChannel(leftover);
    if (state.stopped || state.channel) return;

    // ack: the server confirms each delete message, so a lost one is sent again.
    const channel = supabase.channel(topic, { config: { broadcast: { self: false, ack: true } } });
    for (const table of LIVE_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `shopId=eq.${state.shopId}` },
        payload => onRowChange(state, table, payload),
      );
    }
    channel.on('broadcast', { event: HINT_EVENT }, message => onHint(state, message?.payload));
    channel.on('system', {}, payload => {
      if (payload?.status === 'error') console.warn('[LiveSync] The server refused a live subscription', payload);
    });
    state.channel = channel;
    channel.subscribe((status, err) => onStatus(state, channel, status, err));
    await connectFinanceChannel(state);
  } catch (err) {
    console.warn('[LiveSync] Could not connect; trying again later.', err);
    scheduleReconnect(state);
  } finally {
    state.connecting = false;
  }
};

/**
 * Starts live updates for this shop (one channel; any earlier one is stopped first).
 * Also refreshes the device copy once connected, or after a short wait if the channel
 * can't connect. Returns the function that stops it.
 */
export function startLiveSync(shopId: string): () => void {
  stopLiveSync();
  const state: LiveState = {
    shopId,
    stopped: false,
    channel: null,
    connecting: false,
    subscribed: false,
    stale: true,
    fallbackDone: false,
    catchUp: { running: false, again: false, failures: 0, lastAt: 0, lastFullAt: 0 },
    batches: new Map(),
    retry: new Map(),
    applyFailures: 0,
    applying: Promise.resolve(),
    timers: {
      fallback: null, catchUp: null, reconnect: null, apply: null, applyRetry: null, hints: null, hintApply: null, check: null,
    },
    reconnectDelay: RECONNECT_MIN_MS,
    hints: [],
    sendingHints: false,
    lastMismatch: '',
    hintRereads: new Map(),
    hintApplyAt: 0,
    hintBudget: { since: 0, used: 0, warned: false },
    hintListAt: new Map(),
    hintListTimers: new Map(),
    financeChannel: null,
    linkedFinanceChannels: new Map(),
    linkedSummaryTimer: null,
    isAdmin: null,
    cleanup: [],
  };
  current = state;

  const onOnline = () => {
    state.fallbackDone = false;
    void refreshLinkedSummaryNow(state);
    if (state.subscribed) {
      // The connection may not have noticed the outage: catch up now.
      catchUp(state, true);
      return;
    }
    state.stale = true;
    if (!state.channel) void connect(state);
    else supabase.realtime.connect(); // reconnect now instead of waiting for the back-off
    scheduleFallback(state);
  };
  const onOffline = () => { state.stale = true; };
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || isOffline()) return;
    void refreshLinkedSummaryNow(state);
    if (state.subscribed) return;
    if (!state.channel) void connect(state);
    else supabase.realtime.connect();
  };
  const onFocus = () => {
    if (isOffline() || isHidden()) return;
    void refreshLinkedSummaryNow(state);
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  state.cleanup.push(() => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  });

  if (!isOffline()) {
    scheduleFallback(state);
    void syncFinanceFromCloud(shopId);
  }
  scheduleCheck(state);
  scheduleLinkedSummaryPoll(state);
  void connect(state);
  return () => {
    if (current === state) stopLiveSync();
  };
}

/** Stops live updates and removes the channel (logout, shop change). */
export function stopLiveSync(): void {
  const state = current;
  if (!state) return;
  current = null;
  state.stopped = true;
  for (const timer of Object.values(state.timers)) if (timer) clearTimeout(timer);
  for (const timer of state.hintListTimers.values()) clearTimeout(timer);
  state.hintListTimers.clear();
  if (state.linkedSummaryTimer) {
    clearTimeout(state.linkedSummaryTimer);
    state.linkedSummaryTimer = null;
  }
  state.cleanup.forEach(fn => fn());
  const channel = state.channel;
  state.channel = null;
  state.subscribed = false;
  if (channel) removeChannelLater(channel);
  const finChannel = state.financeChannel;
  state.financeChannel = null;
  if (finChannel) removeChannelLater(finChannel);
  for (const ch of state.linkedFinanceChannels.values()) removeChannelLater(ch);
  state.linkedFinanceChannels.clear();
}

// ---------------------------------------------------------------------------
// Finance & Linked-Shop Realtime + Periodic Summary Refresh
// ---------------------------------------------------------------------------

async function resolveAdminRole(state: LiveState): Promise<boolean> {
  if (state.isAdmin !== null) return state.isAdmin;
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role,shopId')
    .eq('id', uid)
    .maybeSingle();
  const isAdmin = profile?.role === 'admin' && profile?.shopId === state.shopId;
  state.isAdmin = isAdmin;
  return isAdmin;
}

async function applyFinanceAccountLiveEvent(
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  row: FinanceAccountRow,
  sharedBankOnly: boolean,
): Promise<void> {
  if (event === 'DELETE') {
    if (row?.id) await db.financeAccounts.delete(String(row.id));
    return;
  }
  if (!row?.id) return;
  if (sharedBankOnly && row.type !== 'secondaryBank') return;

  await db.transaction('rw', [db.financeAccounts, db.syncQueue], async () => {
    const ops = await db.syncQueue.where('status').equals('pending').toArray();
    const hasPendingTouch = ops.some((op) => {
      if (op.localRollback?.rolledBack) return false;
      if (op.localRollback?.addedAccount?.id === row.id) return true;
      if (op.localRollback?.accountBackup?.id === row.id) return true;
      return (op.localRollback?.txEffects ?? []).some((e) => e.accountId === row.id);
    });
    if (!hasPendingTouch) {
      await db.financeAccounts.put(row);
    }
  });
}

async function applyFinanceTxLiveEvent(
  state: LiveState,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  row: FinanceTransactionRow,
  sharedBankOnly: boolean,
): Promise<void> {
  if (event === 'DELETE' || !row?.id) return;
  if (sharedBankOnly) {
    const acc = await db.financeAccounts.get(row.accountId);
    if (acc && acc.type !== 'secondaryBank') return;
    if (!acc) {
      // A shared secondaryBank tx arrived before its account was cached locally.
      void syncFinanceFromCloud(state.shopId, { isAdmin: state.isAdmin ?? undefined });
    }
  }
  await db.financeTransactions.put(row);
}

async function applyExpenseLiveEvent(
  shopId: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  row: ExpenseRow,
  id: string,
): Promise<void> {
  await db.transaction('rw', [db.expenses, db.syncQueue], async () => {
    const ops = await db.syncQueue.where('status').equals('pending').toArray();
    const hasPendingTouch = ops.some((op) => {
      if (op.localRollback?.rolledBack) return false;
      return op.payload?.p_expense_id === id;
    });
    if (hasPendingTouch) return;
    if (event === 'DELETE') {
      await db.expenses.delete(id);
    } else if (row?.id && row.shopId === shopId) {
      await db.expenses.put(row);
    }
  });
}

async function fetchDirectLinkedShopIds(shopId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('shop_links')
    .select('shopA,shopB')
    .or(`shopA.eq.${shopId},shopB.eq.${shopId}`);
  if (error || !data) return [];
  const linked = new Set<string>();
  for (const row of data) {
    const other = row.shopA === shopId ? row.shopB : row.shopB === shopId ? row.shopA : '';
    if (other && other !== shopId) linked.add(other);
  }
  return [...linked];
}

async function syncLinkedFinanceChannels(state: LiveState): Promise<void> {
  if (state.stopped || isOffline()) return;
  const isAdmin = await resolveAdminRole(state);
  const linkedIds = isAdmin ? await fetchDirectLinkedShopIds(state.shopId) : [];
  if (state.stopped) return;

  const desired = new Set<string>(linkedIds);
  for (const [linkedId, ch] of state.linkedFinanceChannels) {
    if (!desired.has(linkedId)) {
      state.linkedFinanceChannels.delete(linkedId);
      removeChannelLater(ch);
    }
  }

  for (const linkedId of desired) {
    if (state.linkedFinanceChannels.has(linkedId) || state.stopped) continue;
    const topic = `shop-finance-link:${state.shopId}:${linkedId}`;
    const leftover = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (leftover) await supabase.removeChannel(leftover);
    if (state.stopped) return;

    const ch = supabase.channel(topic);
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'finance_accounts', filter: `ownerShopId=eq.${linkedId}` },
      (payload) => {
        const evt = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
        const row = (evt === 'DELETE' ? payload.old : payload.new) as FinanceAccountRow;
        void applyFinanceAccountLiveEvent(evt, row, true);
      },
    );
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'finance_transactions', filter: `ownerShopId=eq.${linkedId}` },
      (payload) => {
        void applyFinanceTxLiveEvent(state, 'INSERT', payload.new as FinanceTransactionRow, true);
      },
    );
    state.linkedFinanceChannels.set(linkedId, ch);
    ch.subscribe();
  }
}

async function connectFinanceChannel(state: LiveState): Promise<void> {
  if (state.stopped || state.financeChannel || isOffline()) return;
  const topic = `shop-finance:${state.shopId}`;
  const leftover = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
  if (leftover) await supabase.removeChannel(leftover);
  if (state.stopped) return;

  const channel = supabase.channel(topic);
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'finance_accounts', filter: `ownerShopId=eq.${state.shopId}` },
    (payload) => {
      const evt = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
      const row = (evt === 'DELETE' ? payload.old : payload.new) as FinanceAccountRow;
      void applyFinanceAccountLiveEvent(evt, row, false);
    },
  );
  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'finance_transactions', filter: `ownerShopId=eq.${state.shopId}` },
    (payload) => {
      void applyFinanceTxLiveEvent(state, 'INSERT', payload.new as FinanceTransactionRow, false);
    },
  );
  const onLinkChange = () => {
    if (state.stopped) return;
    void syncLinkedFinanceChannels(state);
    void syncFinanceFromCloud(state.shopId, { isAdmin: state.isAdmin ?? undefined });
  };
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'shop_links', filter: `shopA=eq.${state.shopId}` },
    onLinkChange,
  );
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'shop_links', filter: `shopB=eq.${state.shopId}` },
    onLinkChange,
  );

  state.financeChannel = channel;
  channel.subscribe((status) => {
    if (state.stopped || state.financeChannel !== channel) return;
    if (status === 'SUBSCRIBED') {
      void syncLinkedFinanceChannels(state);
    }
  });
}

async function refreshLinkedSummaryNow(state: LiveState): Promise<void> {
  if (state.stopped || isOffline()) return;
  const isAdmin = await resolveAdminRole(state);
  if (!isAdmin || state.stopped) return;
  const prevIds = [...state.linkedFinanceChannels.keys()].sort().join(',');
  await fetchLinkedShopsFinanceSummary(state.shopId, isAdmin);
  if (state.stopped) return;
  const linkedIds = (await db.linkedShopSummaries.toArray()).map((s) => s.shopId).sort().join(',');
  if (linkedIds !== prevIds) {
    await syncLinkedFinanceChannels(state);
    await syncFinanceFromCloud(state.shopId, { isAdmin });
  }
}

function scheduleLinkedSummaryPoll(state: LiveState): void {
  if (state.stopped || state.linkedSummaryTimer) return;
  state.linkedSummaryTimer = setTimeout(() => {
    state.linkedSummaryTimer = null;
    if (state.stopped) return;
    if (!isOffline() && !isHidden()) {
      void refreshLinkedSummaryNow(state);
    }
    scheduleLinkedSummaryPoll(state);
  }, LINKED_SUMMARY_POLL_MS);
}

/**
 * This device deleted (or archived) these rows. Its own screens update at once, and
 * the shop's other devices are told, so they read those rows again (see the note at
 * the top). While the channel is reconnecting the message waits and goes once it is
 * back; one the server does not acknowledge is sent again. The other devices' row
 * count check is the backstop if it never arrives.
 */
export function announceDeleted(table: LiveTable, ids: string[]): void {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return;
  notifyTableChanged(table, { event: 'DELETE', ids: unique });
  const state = current;
  if (!state) return;
  for (let i = 0; i < unique.length; i += MAX_HINT_IDS) {
    state.hints.push({ table, ids: unique.slice(i, i + MAX_HINT_IDS) });
  }
  keepNewestHints(state);
  sendHints(state);
}
