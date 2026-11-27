import { supabase } from './supabase';
import { db, type SyncOperation } from './db';
import type { LocalTable } from './sync';
import { beginRead, endRead, freshTicket, mayWrite, recordWrite } from './freshness';

// The device keeps a local copy of products, bottles and customers (Dexie) for the
// POS. These helpers keep that copy in step with the server: right after this
// device writes something (write-through), and when another device's change
// arrives live (liveSync.ts). Sales made on this device that have not reached the
// server yet are always respected, with the same rules as the full refresh
// (sync.ts):
//   products:  server stock minus what this device's queued sales still take off
//              (never below zero);
//   customers: server udhaar plus what those sales still add;
//   bottles:   a bottle a queued sale sets keeps its local level.
// Every queued item counts, waiting or failed: the device copy already shows them all.
//
// Order matters. Which queued sales the server already has is asked BEFORE the rows
// are read (reads, and writes whose answer is stored): a sale that reaches the server
// in between is then counted on both sides, which shows a little less stock (a little
// more udhaar) for a moment, never more. Only a live row from another device cannot be
// read "after" that question (it was saved before it arrived); see applyServerRows.

const LIVE_TIMEOUT_MS = 3500;
const ID_CHUNK = 100; // keeps the request URL short
const PRODUCT_CHUNK = 50;
const ON_SERVER_TIMEOUT_MS = 5000;

export interface LiveStock {
  id: string;
  name: string;
  serverStock: number;
  /** Stock still to be deducted by this device's unsynced sales (waiting or failed). */
  pending: number;
  /** What can still be sold: server stock minus pending, never below zero. */
  available: number;
}

// ---------------------------------------------------------------------------
// Server rows into the device copy (write-through and live updates)
// ---------------------------------------------------------------------------

/** What this device's queue still changes on the server. */
export interface QueueEffects {
  /** Stock still to come off each product (queued sales the server does not have yet). */
  stock: Map<string, number>;
  /** Udhaar those sales still add to each customer. */
  credit: Map<string, number>;
  /** Bottles whose level a queued item sets: they keep their local version. */
  bottles: Set<string>;
  /** Products a queued stock adjustment changes: they and their bottles stay local. */
  adjusted: Set<string>;
}

type LocalRow = Record<string, unknown>;

const asArray = (v: unknown): LocalRow[] => (Array.isArray(v) ? (v as LocalRow[]) : []);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const roundMoney = (n: number) => Math.round(n * 100) / 100;
const hasKey = (row: LocalRow | undefined | null, key: string) =>
  !!row && Object.prototype.hasOwnProperty.call(row, key);

/**
 * The queue's effects (pure; the same rules as sync.ts). A checkout whose sale id is
 * in `onServer` is already on the server and is not counted again. Every item counts,
 * waiting or failed: the device copy already shows all of them.
 */
export const queueEffects = (items: SyncOperation[], onServer: ReadonlySet<string>): QueueEffects => {
  const eff: QueueEffects = { stock: new Map(), credit: new Map(), bottles: new Set(), adjusted: new Set() };
  for (const op of items) {
    if (op?.localRollback?.rolledBack) continue;
    const p = op?.payload || {};
    for (const b of [...asArray(p.p_bottle_updates), ...asArray(p.p_bottle_inserts)]) {
      if (b?.id) eff.bottles.add(String(b.id));
    }
    if (p.p_product_id) eff.adjusted.add(String(p.p_product_id));
    if (op?.type === 'record_credit_payment') {
      const creditId = p.p_credit_id ? String(p.p_credit_id) : '';
      const amt = Number(p.p_amount);
      if (creditId && !onServer.has(creditId) && p.p_customer_id && Number.isFinite(amt) && amt > 0) {
        const cid = String(p.p_customer_id);
        eff.credit.set(cid, (eff.credit.get(cid) || 0) - amt);
      }
      continue;
    }
    if (op?.type !== 'process_checkout') continue;
    const saleId = (p.p_sale_data as { id?: unknown } | undefined)?.id;
    if (saleId && onServer.has(String(saleId))) continue;
    for (const up of asArray(p.p_product_updates)) {
      const d = Number(up?.deduction);
      if (up?.id && Number.isFinite(d)) eff.stock.set(String(up.id), (eff.stock.get(String(up.id)) || 0) + d);
    }
    const inc = Number(p.p_credit_increment);
    if (p.p_customer_id && Number.isFinite(inc) && inc !== 0) {
      eff.credit.set(String(p.p_customer_id), (eff.credit.get(String(p.p_customer_id)) || 0) + inc);
    }
  }
  return eff;
};

/** A row the server has archived (since step 0.3 a delete from the app archives). */
export const isArchivedRow = (table: LocalTable, row: LocalRow | undefined | null): boolean =>
  table === 'bottles' ? row?.archivedAt != null : row?.deletedAt != null;

export interface RowPlan {
  puts: LocalRow[];
  deletes: string[];
}

/**
 * How server rows go into the device copy (pure). `local[i]` is the device's copy of
 * `rows[i]`, or undefined. Columns a row does not carry keep their local value, so a
 * partial live update never blanks a column.
 */
export const planServerRows = (
  table: LocalTable,
  rows: LocalRow[],
  local: Array<LocalRow | undefined>,
  eff: QueueEffects,
): RowPlan => {
  const plan: RowPlan = { puts: [], deletes: [] };
  rows.forEach((row, i) => {
    const id = String(row.id);
    const mine = local[i];
    if (isArchivedRow(table, row)) {
      if (mine) plan.deletes.push(id);
      return;
    }
    if (table === 'products') {
      if (mine && eff.adjusted.has(id)) return;
      const merged = { ...(mine || {}), ...row };
      if (hasKey(row, 'stockQuantity')) {
        merged.stockQuantity = Math.max(0, num(row.stockQuantity) - (eff.stock.get(id) || 0));
      }
      plan.puts.push(merged);
      return;
    }
    if (table === 'bottles') {
      const productId = String(row.productId ?? mine?.productId ?? '');
      if (mine && (eff.bottles.has(id) || eff.adjusted.has(productId))) return;
      plan.puts.push({ ...(mine || {}), ...row });
      return;
    }
    const merged = { ...(mine || {}), ...row };
    if (hasKey(row, 'creditBalance')) {
      merged.creditBalance = Math.max(0, roundMoney(num(row.creditBalance) + (eff.credit.get(id) || 0)));
    }
    plan.puts.push(merged);
  });
  return plan;
};

const tableOf = (table: LocalTable) => db.table<LocalRow, string>(table);

const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;

/**
 * Which queued sales touching these rows the server already has. Asked only when the
 * queue touches them; ask it BEFORE reading the rows (see the note at the top).
 * null when the server can't be asked: callers then count none as sent, so the device
 * shows a little less stock (a little more udhaar) until the sale goes, never more.
 */
const salesOnServerFor = async (
  shopId: string,
  table: LocalTable,
  ids: string[],
  signal?: AbortSignal,
): Promise<Set<string> | null> => {
  if (table === 'bottles') return new Set();
  const wanted = new Set(ids.map(String));
  const saleIds = new Set<string>();
  const creditIds = new Set<string>();
  for (const op of await db.syncQueue.toArray()) {
    if (op.localRollback?.rolledBack) continue;
    const p = op.payload || {};
    if (op.type === 'record_credit_payment' && table === 'customers') {
      if (wanted.has(String(p.p_customer_id)) && p.p_credit_id) {
        creditIds.add(String(p.p_credit_id));
      }
      continue;
    }
    if (op.type !== 'process_checkout') continue;
    const touches = table === 'products'
      ? asArray(p.p_product_updates).some(up => wanted.has(String(up?.id)))
      : wanted.has(String(p.p_customer_id));
    const saleId = (p.p_sale_data as { id?: unknown } | undefined)?.id;
    if (touches && saleId) saleIds.add(String(saleId));
  }
  const onServer = new Set<string>();
  const list = [...saleIds];
  for (let i = 0; i < list.length; i += ID_CHUNK) {
    try {
      let query = supabase.from('sales').select('id').eq('shopId', shopId).in('id', list.slice(i, i + ID_CHUNK)).retry(false);
      const abort = signal ?? timeoutSignal(ON_SERVER_TIMEOUT_MS);
      if (abort) query = query.abortSignal(abort);
      const { data, error } = await query;
      if (error) return null;
      (data || []).forEach((s: { id: string }) => onServer.add(String(s.id)));
    } catch {
      return null;
    }
  }
  const creditList = [...creditIds];
  for (let i = 0; i < creditList.length; i += ID_CHUNK) {
    try {
      let query = supabase.from('credits').select('id').eq('shopId', shopId).in('id', creditList.slice(i, i + ID_CHUNK)).retry(false);
      const abort = signal ?? timeoutSignal(ON_SERVER_TIMEOUT_MS);
      if (abort) query = query.abortSignal(abort);
      const { data, error } = await query;
      if (error) return null;
      (data || []).forEach((c: { id: string }) => onServer.add(String(c.id)));
    } catch {
      return null;
    }
  }
  return onServer;
};

const unique = (ids: string[]): string[] => [...new Set((ids || []).filter(Boolean).map(String))];

/** How fresh each row's data is (freshness.ts): one ticket for all, or one per id. */
export type Tickets = number | ReadonlyMap<string, number>;
const ticketFor = (tickets: Tickets, id: string): number =>
  typeof tickets === 'number' ? tickets : tickets.get(id) ?? 0;

/**
 * Puts rows the server has given into the device copy, respecting this device's
 * unsynced sales. The queue is read inside the same Dexie transaction, so a sale saved
 * a moment ago is never overwritten. Rows of another shop are ignored; archived rows
 * leave the device copy. A row that already holds newer data (a later read or live
 * update) is left alone.
 *
 * `tickets`: how fresh the rows are. A read takes its ticket (beginRead) before it
 * starts, a write before it is sent (writeThrough), a live update when it arrives.
 * `onServer`: the queued sales the server had BEFORE the rows were read (or the write
 * was sent); null when that could not be asked. Left out only for live rows from
 * another device: those were saved before they arrived, so it is asked now. A queued
 * sale that reaches the server between that row being saved and this question is then
 * counted on neither side, and the row shows a little more stock (a little less
 * udhaar) for a moment, until that sale's own change arrives live, or refreshRowsOf
 * reads the row again once the sale leaves the queue.
 */
export async function applyServerRows(
  shopId: string,
  table: LocalTable,
  rows: LocalRow[],
  tickets: Tickets,
  onServer?: ReadonlySet<string> | null,
): Promise<void> {
  const mine = (rows || []).filter(r => r && r.id != null && String(r.shopId) === shopId);
  if (!mine.length) return;
  const sent = onServer === undefined ? await salesOnServerFor(shopId, table, mine.map(r => String(r.id))) : onServer;
  const local = tableOf(table);
  await db.transaction('rw', local, db.syncQueue, async () => {
    const fresh = mine.filter(r => mayWrite(table, String(r.id), ticketFor(tickets, String(r.id))));
    if (!fresh.length) return;
    const ids = fresh.map(r => String(r.id));
    const eff = queueEffects(await db.syncQueue.toArray(), sent ?? new Set());
    const plan = planServerRows(table, fresh, await local.bulkGet(ids), eff);
    if (plan.puts.length) await local.bulkPut(plan.puts);
    if (plan.deletes.length) await local.bulkDelete(plan.deletes);
    for (const id of ids) recordWrite(table, [id], ticketFor(tickets, id));
  });
}

/**
 * Removes rows the server no longer has (deleted or archived) from the device copy.
 * A bottle that a queued sale on this device sets or adds stays until that sale has
 * gone (the server may not have it yet), as in the full refresh.
 */
export async function removeLocalRows(table: LocalTable, ids: string[], tickets: Tickets = freshTicket()): Promise<void> {
  const wanted = unique(ids).filter(id => mayWrite(table, id, ticketFor(tickets, id)));
  if (!wanted.length) return;
  const local = tableOf(table);
  await db.transaction('rw', local, db.syncQueue, async () => {
    let gone = wanted;
    if (table === 'bottles') {
      const eff = queueEffects(await db.syncQueue.toArray(), new Set());
      const rows = await local.bulkGet(gone);
      gone = gone.filter((id, i) => !eff.bottles.has(id) && !(rows[i] && eff.adjusted.has(String(rows[i].productId))));
    }
    if (!gone.length) return;
    await local.bulkDelete(gone);
    for (const id of gone) recordWrite(table, [id], ticketFor(tickets, id));
  });
}

/**
 * Re-reads these rows by id into the device copy. A row the server no longer returns
 * (deleted, archived, or never saved) leaves it. Returns false if the server could not
 * be read; the device copy is then left as it was.
 */
export async function refreshLocalRows(shopId: string, table: LocalTable, ids: string[]): Promise<boolean> {
  const wanted = unique(ids);
  if (!wanted.length || !shopId) return true;
  const ticket = beginRead();
  try {
    // Before the rows are read (see the note at the top).
    const onServer = await salesOnServerFor(shopId, table, wanted);
    const rows: LocalRow[] = [];
    try {
      for (let i = 0; i < wanted.length; i += ID_CHUNK) {
        const { data, error } = await supabase.from(table).select('*').eq('shopId', shopId).in('id', wanted.slice(i, i + ID_CHUNK));
        if (error) return false;
        rows.push(...((data || []) as LocalRow[]));
      }
    } catch {
      return false;
    }
    await applyServerRows(shopId, table, rows, ticket, onServer);
    const returned = new Set(rows.filter(r => !isArchivedRow(table, r)).map(r => String(r.id)));
    await removeLocalRows(table, wanted.filter(id => !returned.has(id)), ticket);
    return true;
  } finally {
    endRead(ticket);
  }
}

/**
 * Write-through for a write whose answer (the saved rows) goes straight into the
 * device copy. Its ticket is taken BEFORE the write is sent, so a live update that
 * lands while the write is in flight (another device's newer change) wins over this
 * answer; and the queued sales the server already has are asked first, as for a read.
 * `write` gets `store(rows)`, which never throws: the write itself has succeeded, and
 * the next live update or refresh brings the row if storing it fails.
 */
export async function writeThrough<T>(
  shopId: string,
  table: LocalTable,
  ids: string[],
  write: (store: (rows: LocalRow[] | null | undefined) => Promise<void>) => Promise<T>,
): Promise<T> {
  const ticket = beginRead();
  try {
    const onServer = await salesOnServerFor(shopId, table, unique(ids)).catch(() => null);
    const store = (rows: LocalRow[] | null | undefined) =>
      applyServerRows(shopId, table, rows || [], ticket, onServer)
        .catch(err => console.warn(`[WriteThrough] ${table}: the device copy was not updated`, err));
    return await write(store);
  } finally {
    endRead(ticket);
  }
}

/**
 * Live stock for these products, answered within a few seconds or not at all.
 * Returns null when the server can't be reached quickly (for example Wi-Fi up but
 * internet down); the server still refuses to take stock below zero in that case.
 * A product the server no longer has (deleted on another device) is missing from the
 * result. With `store`, the rows also go into the device copy (through the same rules
 * as every other server row, so a newer live update is never overwritten) and products
 * the server no longer has leave it.
 */
export const fetchLiveStock = async (
  shopId: string,
  productIds: string[],
  options: { store?: boolean } = {},
): Promise<Map<string, LiveStock> | null> => {
  const ids = unique(productIds);
  if (!ids.length) return new Map();
  const signal = timeoutSignal(LIVE_TIMEOUT_MS);

  const work = (async (): Promise<Map<string, LiveStock> | null> => {
    const ticket = beginRead();
    try {
      const onServer = await salesOnServerFor(shopId, 'products', ids, signal);
      if (!onServer) return null;
      const rows: LocalRow[] = [];
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        let query = supabase.from('products').select('*').eq('shopId', shopId).in('id', ids.slice(i, i + ID_CHUNK)).retry(false);
        if (signal) query = query.abortSignal(signal);
        const { data, error } = await query;
        if (error || !data) return null;
        rows.push(...(data as LocalRow[]));
      }
      const current = rows.filter(r => !isArchivedRow('products', r));
      const eff = queueEffects(await db.syncQueue.toArray(), onServer);
      const live = new Map<string, LiveStock>(current.map(row => {
        const id = String(row.id);
        const serverStock = num(row.stockQuantity);
        const pending = eff.stock.get(id) || 0;
        return [id, { id, name: String(row.name ?? ''), serverStock, pending, available: Math.max(0, serverStock - pending) }];
      }));
      if (options.store) {
        try {
          await applyServerRows(shopId, 'products', rows, ticket, onServer);
          const returned = new Set(current.map(r => String(r.id)));
          await removeLocalRows('products', ids.filter(id => !returned.has(id)), ticket);
        } catch (err) {
          console.warn('[LiveStock] The device copy was not updated', err);
        }
      }
      return live;
    } finally {
      endRead(ticket);
    }
  })();

  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), LIVE_TIMEOUT_MS + 500));
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
};

/**
 * Re-reads whole product rows (including newly created ones) into the device copy,
 * with stock reduced by this device's unsynced sales. A product the server no longer
 * shows leaves the device copy. Returns false if the server could not be read.
 */
export const refreshLocalProducts = (shopId: string, productIds: string[]): Promise<boolean> =>
  refreshLocalRows(shopId, 'products', productIds);

/** Re-reads customers into the device copy, with this device's unsynced udhaar added. */
export const refreshLocalCustomers = (shopId: string, customerIds: string[]): Promise<boolean> =>
  refreshLocalRows(shopId, 'customers', customerIds);

/**
 * Re-reads every bottle of these products into the device copy, so the POS neither
 * invents nor misses bottles. A bottle a queued sale on this device sets keeps its
 * local level (sales carry bottle levels, so the local one is newer).
 */
export const refreshLocalBottles = async (shopId: string, productIds: string[]): Promise<boolean> => {
  const ids = [...new Set(productIds.filter(Boolean).map(String))];
  for (let i = 0; i < ids.length; i += PRODUCT_CHUNK) {
    const chunk = ids.slice(i, i + PRODUCT_CHUNK);
    const ticket = beginRead();
    try {
      const rows: LocalRow[] = [];
      try {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from('bottles').select('*').eq('shopId', shopId).in('productId', chunk)
            .order('id', { ascending: true }).range(from, from + 999);
          if (error) return false; // keep the old copy if the server can't be read
          rows.push(...((data || []) as LocalRow[]));
          if (!data || data.length < 1000) break;
        }
      } catch {
        return false;
      }
      const bottleTable = tableOf('bottles');
      await db.transaction('rw', db.bottles, db.syncQueue, async () => {
        const eff = queueEffects(await db.syncQueue.toArray(), new Set());
        const serverIds = new Set(rows.map(r => String(r.id)));
        const gone: string[] = (await db.bottles.where('productId').anyOf(chunk).toArray())
          .filter(b => String(b.shopId) === shopId && !serverIds.has(String(b.id)))
          .filter(b => !eff.bottles.has(String(b.id)) && !eff.adjusted.has(String(b.productId)))
          .map(b => String(b.id))
          .filter(id => mayWrite('bottles', id, ticket));
        const fresh = rows.filter(r => mayWrite('bottles', String(r.id), ticket));
        const plan = planServerRows('bottles', fresh, await bottleTable.bulkGet(fresh.map(r => String(r.id))), eff);
        if (gone.length) await bottleTable.bulkDelete(gone);
        if (plan.puts.length) await bottleTable.bulkPut(plan.puts);
        if (plan.deletes.length) await bottleTable.bulkDelete(plan.deletes);
        recordWrite('bottles', [...gone, ...fresh.map(r => String(r.id))], ticket);
      });
    } finally {
      endRead(ticket);
    }
  }
  return true;
};

/**
 * After a sale was deleted (or edited) on the server: its products, bottles and
 * customer are read again, so the restored stock and udhaar show at once.
 */
export async function refreshAfterSaleReversal(
  shopId: string,
  sale: { customerId?: unknown; items?: unknown } | null | undefined,
): Promise<void> {
  const items = asArray(sale?.items);
  const productIds = [...new Set(items.map(i => i?.productId).filter(Boolean).map(String))];
  const eLiquidIds = [...new Set(items
    .filter(i => i?.productId && (i.saleType === 'refill' || i.saleType === 'full_bottle' || i.category === 'e-liquid'))
    .map(i => String(i.productId)))];
  await Promise.all([
    refreshLocalProducts(shopId, productIds),
    eLiquidIds.length ? refreshLocalBottles(shopId, eLiquidIds) : Promise.resolve(true),
    sale?.customerId ? refreshLocalCustomers(shopId, [String(sale.customerId)]) : Promise.resolve(true),
  ]);
}
