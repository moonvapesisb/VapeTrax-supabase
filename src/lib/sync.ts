import { supabase } from './supabase';
import { db, SyncOperation } from './db';
import { fetchAllPages } from './fetchAllPages';
import { beginRead, endRead, mayWrite, recordWrite } from './freshness';
import { refreshLocalRows } from './liveStock';
import { sameInstant } from './dates';

// The device keeps a complete copy of the shop's products, bottles and customers
// (Dexie) so the POS works offline. This refreshes that copy from the server.
//
// - A full refresh reads every table in full, page by page (the server returns at
//   most 1000 rows per request). If any page fails, nothing on the device is touched.
// - Nothing is cleared. Server rows are written over the local ones, and a local
//   row is removed only when the server confirms, by id, that it is gone.
// - Unsynced items in the queue (pending or failed) are respected, the same way
//   liveStock.ts does it:
//     products:  server stock minus the stock still to come off for queued sales the
//                server does not have yet (never below zero);
//     customers: server udhaar plus the credit those sales still add;
//     bottles:   a bottle a queued sale sets keeps its local level (sales carry
//                bottle levels, not amounts, so they can't be merged).
//   A row that a sale queued while the refresh ran changes keeps its local version.
// - A row that received newer data while the refresh ran (a live update from another
//   device, or this device's own write) keeps it, and a row deleted meanwhile does not
//   come back (freshness.ts).
// - After the queue sends items, the rows they changed are read again by id
//   (refreshRowsOf), so nothing stays frozen once its sale is on the server.

export type LocalTable = 'products' | 'bottles' | 'customers';
const ALL_TABLES: LocalTable[] = ['products', 'bottles', 'customers'];
const ID_CHUNK = 100; // keeps the request URL short
const PRODUCT_CHUNK = 50;

/** What a refresh reads: a whole table, or some rows (by id; bottles by productId). */
type Scope = Map<LocalTable, 'all' | Set<string>>;

interface QueuedRefs {
  /** Products whose stock a queued sale takes off (p_product_updates). */
  products: Set<string>;
  /** Products a queued stock adjustment changes; they and their bottles stay local. */
  adjusted: Set<string>;
  /** Bottles whose level a queued item sets. */
  bottles: Set<string>;
  /** Products of those bottles (for re-reading them by product). */
  bottleProducts: Set<string>;
  customers: Set<string>;
}

interface QueueDeltas {
  /** Stock still to come off each product, from queued sales the server does not have. */
  stock: Map<string, number>;
  /** Udhaar those sales still add to each customer. */
  credit: Map<string, number>;
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

const emptyRefs = (): QueuedRefs => ({
  products: new Set(), adjusted: new Set(), bottles: new Set(), bottleProducts: new Set(), customers: new Set(),
});

const addRefs = (into: QueuedRefs, from: QueuedRefs) => {
  (Object.keys(into) as (keyof QueuedRefs)[]).forEach(k => from[k].forEach(id => into[k].add(id)));
};

/** The rows these queue items change on the server. */
const refsOf = (items: SyncOperation[]): QueuedRefs => {
  const refs = emptyRefs();
  for (const op of items) {
    const p = op?.payload || {};
    for (const up of asArray(p.p_product_updates)) if (up?.id) refs.products.add(String(up.id));
    if (p.p_product_id) refs.adjusted.add(String(p.p_product_id));
    for (const b of [...asArray(p.p_bottle_updates), ...asArray(p.p_bottle_inserts)]) {
      if (b?.id) refs.bottles.add(String(b.id));
      if (b?.productId) refs.bottleProducts.add(String(b.productId));
    }
    if (p.p_customer_id) refs.customers.add(String(p.p_customer_id));
  }
  return refs;
};

// Refs of queue items created while a refresh runs. A sale saved, sent and removed from
// the queue during the server read would otherwise be in neither queue read, and its
// rows would be overwritten with a server copy from before it.
const collectors = new Set<QueuedRefs>();
db.syncQueue.hook('creating', (_key, obj) => {
  if (!collectors.size) return;
  const refs = refsOf([obj]);
  collectors.forEach(c => addRefs(c, refs));
});

/**
 * What the queued sales still change that the server does not have yet. Read BEFORE
 * the tables: a sale that reaches the server in between is then counted on both
 * sides, which shows a little less stock until the next refresh, never more.
 * null when the server can't be asked (queued rows then keep their local version).
 */
const queueDeltas = async (shopId: string, items: SyncOperation[]): Promise<QueueDeltas | null> => {
  const checkouts = items.filter(op => op.type === 'process_checkout');
  const saleIds = [...new Set(checkouts.map(op => op.payload?.p_sale_data?.id).filter(Boolean).map(String))];
  const onServer = new Set<string>();
  for (let i = 0; i < saleIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase.from('sales').select('id').eq('shopId', shopId).in('id', saleIds.slice(i, i + ID_CHUNK));
    if (error) return null;
    (data || []).forEach((s: { id: string }) => onServer.add(String(s.id)));
  }

  const stock = new Map<string, number>();
  const credit = new Map<string, number>();
  for (const op of checkouts) {
    const p = op.payload || {};
    const saleId = p.p_sale_data?.id;
    if (saleId && onServer.has(String(saleId))) continue;
    for (const up of asArray(p.p_product_updates)) {
      const d = Number(up?.deduction);
      if (up?.id && Number.isFinite(d)) stock.set(String(up.id), (stock.get(String(up.id)) || 0) + d);
    }
    const inc = Number(p.p_credit_increment);
    if (p.p_customer_id && Number.isFinite(inc) && inc !== 0) {
      credit.set(String(p.p_customer_id), (credit.get(String(p.p_customer_id)) || 0) + inc);
    }
  }
  return { stock, credit };
};

const fetchTable = (table: LocalTable, shopId: string): Promise<any[]> =>
  fetchAllPages<any>((from, to) =>
    supabase.from(table).select('*').eq('shopId', shopId).order('id', { ascending: true }).range(from, to),
  );

/** Of these ids, the rows the server has. */
const fetchByIds = async (table: LocalTable, shopId: string, ids: string[]): Promise<any[]> => {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase.from(table).select('*').eq('shopId', shopId).in('id', chunk);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
};

/** Every bottle of these products. */
const fetchBottlesOf = async (shopId: string, productIds: string[]): Promise<any[]> => {
  const rows: any[] = [];
  for (let i = 0; i < productIds.length; i += PRODUCT_CHUNK) {
    const chunk = productIds.slice(i, i + PRODUCT_CHUNK);
    rows.push(...(await fetchAllPages<any>((from, to) =>
      supabase.from('bottles').select('*').eq('shopId', shopId).in('productId', chunk)
        .order('id', { ascending: true }).range(from, to),
    )));
  }
  return rows;
};

const fetchScope = (table: LocalTable, shopId: string, what: 'all' | Set<string>): Promise<any[]> => {
  if (what === 'all') return fetchTable(table, shopId);
  const ids = [...what];
  if (!ids.length) return Promise.resolve([]);
  return table === 'bottles' ? fetchBottlesOf(shopId, ids) : fetchByIds(table, shopId, ids);
};

const tableOf = (table: LocalTable) =>
  (table === 'products' ? db.products : table === 'bottles' ? db.bottles : db.customers) as any;

const roundMoney = (n: number) => Math.round(n * 100) / 100;

async function syncTables(shopId: string, scope: Scope): Promise<boolean> {
  const tables = ALL_TABLES.filter(t => scope.has(t));
  if (!navigator.onLine || !shopId || !tables.length) return false;

  const late = emptyRefs();
  collectors.add(late);
  // Everything this refresh reads is at least as old as this ticket.
  const ticket = beginRead();
  try {
    // 1. The queue, and which of its sales the server already has: before the tables.
    const startItems = await db.syncQueue.toArray();
    const startIds = new Set(startItems.map(i => i.id));
    const start = refsOf(startItems);
    const deltas = await queueDeltas(shopId, startItems);

    // 2. Read the server. Any page error ends here, before Dexie is touched.
    const fetched = await Promise.all(tables.map(t => fetchScope(t, shopId, scope.get(t)!)));

    // 3. Full reads only: local rows the server did not return are confirmed by id
    //    before any is removed.
    const plans: { table: LocalTable; rows: any[]; gone: string[] }[] = [];
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (scope.get(table) !== 'all') {
        plans.push({ table, rows: fetched[i], gone: [] });
        continue;
      }
      const serverIds = new Set(fetched[i].map(r => String(r.id)));
      const localIds: string[] = (await tableOf(table).where('shopId').equals(shopId).primaryKeys()).map(String);
      const missing = localIds.filter(id => !serverIds.has(id));
      const stillThere = missing.length ? await fetchByIds(table, shopId, missing) : [];
      const stillThereIds = new Set(stillThere.map(r => String(r.id)));
      plans.push({
        table,
        rows: [...fetched[i], ...stillThere],
        gone: missing.filter(id => !stillThereIds.has(id)),
      });
    }

    // 4. Write, one Dexie transaction per table. The queue is read again inside it, so
    //    a sale saved on this device (in any tab) a moment ago is never overwritten.
    for (const { table, rows, gone } of plans) {
      const local = tableOf(table);
      await db.transaction('rw', local, db.syncQueue, async () => {
        const nowItems = await db.syncQueue.toArray();
        // Items the deltas don't cover: created while this refresh ran.
        const fresh = refsOf(nowItems.filter(i => !startIds.has(i.id)));
        addRefs(fresh, late);
        const all = refsOf(nowItems);
        addRefs(all, start);
        addRefs(all, late);

        const keepLocal = (row: any): boolean => {
          const id = String(row?.id);
          if (table === 'bottles') return all.bottles.has(id) || all.adjusted.has(String(row?.productId));
          if (table === 'products') {
            return fresh.products.has(id) || all.adjusted.has(id) || (!deltas && start.products.has(id));
          }
          return fresh.customers.has(id) || (!deltas && start.customers.has(id));
        };

        const merged = (row: any): any => {
          if (!deltas) return row;
          const id = String(row.id);
          if (table === 'products' && deltas.stock.has(id)) {
            return { ...row, stockQuantity: Math.max(0, (Number(row.stockQuantity) || 0) - deltas.stock.get(id)!) };
          }
          if (table === 'customers' && deltas.credit.has(id)) {
            return { ...row, creditBalance: roundMoney((Number(row.creditBalance) || 0) + deltas.credit.get(id)!) };
          }
          return row;
        };

        const localRows: any[] = await local.bulkGet(rows.map(r => r.id));
        const toPut = rows
          .filter((_, k) => !(localRows[k] && keepLocal(localRows[k])))
          // Newer data arrived meanwhile (a live update, or a write's own answer).
          .filter(r => mayWrite(table, String(r.id), ticket))
          .map(merged);
        if (toPut.length) await local.bulkPut(toPut);

        let toDelete: string[] = [];
        if (gone.length) {
          const goneRows: any[] = await local.bulkGet(gone);
          toDelete = gone
            .filter((_, k) => goneRows[k] && !keepLocal(goneRows[k]))
            .filter(id => mayWrite(table, id, ticket));
          if (toDelete.length) await local.bulkDelete(toDelete);
        }
        recordWrite(table, [...toPut.map(r => String(r.id)), ...toDelete], ticket);
      });
    }

    console.log('[Sync] Cloud to Local sync completed', Object.fromEntries(plans.map(p => [p.table, p.rows.length])));
    return true;
  } catch (err) {
    console.error('[Sync] Cloud to Local sync failed; the device copy was left as it was', err);
    return false;
  } finally {
    collectors.delete(late);
    endRead(ticket);
  }
}

const mergeScope = (into: Scope, add: Scope) => {
  for (const [table, what] of add) {
    const cur = into.get(table);
    if (cur === 'all' || what === 'all') into.set(table, 'all');
    else into.set(table, new Set([...(cur || []), ...what]));
  }
};

// Runs one refresh at a time. Requests made while one runs are merged into a single
// follow-up run, so a burst of refetches costs one extra read, not one each.
let running: Promise<boolean> | null = null;
let queued: { shopId: string; scope: Scope; promise: Promise<boolean> } | null = null;

function requestRefresh(shopId: string, scope: Scope): Promise<boolean> {
  if (!scope.size) return Promise.resolve(true);
  if (!running) {
    running = syncTables(shopId, scope).finally(() => { running = null; });
    return running;
  }
  if (queued && queued.shopId === shopId) {
    mergeScope(queued.scope, scope);
    return queued.promise;
  }
  const next = { shopId, scope: new Map(scope) as Scope, promise: Promise.resolve(false) };
  next.promise = running.catch(() => false).then(() => {
    if (queued === next) queued = null;
    return requestRefresh(next.shopId, next.scope);
  });
  queued = next;
  return next.promise;
}

/**
 * Refreshes the device copy from the server. Returns false when offline or when the
 * server could not be read completely (the device copy is then left untouched).
 */
export function syncCloudToLocal(shopId: string, tables: LocalTable[] = ALL_TABLES): Promise<boolean> {
  return requestRefresh(shopId, new Map<LocalTable, 'all' | Set<string>>(tables.map(t => [t, 'all'] as const)));
}

/**
 * Re-reads, by id, the rows these queue items changed: called once they have reached
 * the server (or were discarded), so the device copy picks up the server's version.
 */
export function refreshRowsOf(shopId: string, items: SyncOperation[]): Promise<boolean> {
  const refs = refsOf(items);
  const scope: Scope = new Map();
  const products = new Set([...refs.products, ...refs.adjusted]);
  const bottleProducts = new Set([...refs.bottleProducts, ...refs.adjusted]);
  if (products.size) scope.set('products', products);
  if (bottleProducts.size) scope.set('bottles', bottleProducts);
  if (refs.customers.size) scope.set('customers', refs.customers);
  return requestRefresh(shopId, scope);
}

/**
 * A light catch-up, for after a short disconnect (a phone that slept, a socket that
 * dropped). It reads only each row's id and updatedAt, a small part of the full rows,
 * and reads in full only the rows that changed, appeared or went; those go through
 * the same rules as any other server row (liveStock.ts: this device's unsynced sales
 * kept, a row is removed only once the server confirms by id that it is gone, a newer
 * live update is never overwritten). Every write bumps updatedAt (the server's
 * functions and this app's own writes), so a row with the same updatedAt has not
 * changed. A full refresh (syncCloudToLocal) still runs at start and every few hours.
 * Returns false when the server could not be read completely.
 */
export async function reconcileCloudToLocal(shopId: string, tables: LocalTable[] = ALL_TABLES): Promise<boolean> {
  if (!navigator.onLine || !shopId) return false;
  try {
    for (const table of tables) {
      const local: any[] = await tableOf(table).where('shopId').equals(shopId).toArray();
      const server = await fetchAllPages<{ id: string; updatedAt: string | null }>((from, to) =>
        supabase.from(table).select('id,updatedAt').eq('shopId', shopId).order('id', { ascending: true }).range(from, to),
      );
      const localStamp = new Map<string, unknown>(local.map(r => [String(r.id), r.updatedAt]));
      const serverIds = new Set<string>();
      const changed: string[] = [];
      for (const row of server) {
        const id = String(row.id);
        serverIds.add(id);
        if (!localStamp.has(id) || !sameInstant(localStamp.get(id), row.updatedAt)) changed.push(id);
      }
      for (const id of localStamp.keys()) if (!serverIds.has(id)) changed.push(id);
      if (changed.length && !(await refreshLocalRows(shopId, table, changed))) return false;
      if (changed.length) console.log(`[Sync] Caught up ${changed.length} ${table} row(s)`);
    }
    return true;
  } catch (err) {
    console.warn('[Sync] Light catch-up failed; the device copy was left as it was', err);
    return false;
  }
}
