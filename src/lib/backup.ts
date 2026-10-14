import { supabase } from './supabase';

// Every table that holds this shop's data, keyed by its shop column.
const SHOP_TABLES = [
  'products', 'bottles', 'customers', 'sales', 'expenses', 'personal_expenses',
  'inventory_logs', 'credits', 'settings',
];

const PAGE_SIZE = 1000;

// Supabase returns at most 1000 rows per request, so read each table page by page.
// Pages follow the id ("after the last id read"), not a row offset: a row saved or
// deleted while the table is being read can't shift the pages, so no row is read
// twice and none is skipped because others moved.
const fetchAllRows = async (table: string, shopId: string): Promise<any[]> => {
  const rows: any[] = [];
  if (table === 'settings') {
    // one row per shop and no id column
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from(table).select('*').eq('shopId', shopId)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Backup failed while reading ${table}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }
  let lastId: unknown = null;
  for (;;) {
    let query = supabase.from(table).select('*').eq('shopId', shopId);
    if (lastId !== null) query = query.gt('id', lastId);
    const { data, error } = await query.order('id', { ascending: true }).limit(PAGE_SIZE);
    if (error) throw new Error(`Backup failed while reading ${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
    lastId = (data[data.length - 1] as any).id;
  }
};

// How many rows the server says this shop has in the table.
const countRows = async (table: string, shopId: string): Promise<number> => {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('shopId', shopId);
  if (error) throw new Error(`Backup failed while counting ${table}: ${error.message}`);
  if (count === null || count === undefined) throw new Error(`Backup failed: the server gave no row count for ${table}.`);
  return count;
};

/**
 * Reads a table and checks the number of rows against the server's own count, so a
 * short read (a missed page, or rows the server silently left out) fails the export
 * instead of producing an incomplete file. Every id must also appear once only. A sale
 * saved while the table is being read can change the count, so a mismatch is read
 * once more before giving up.
 */
const fetchCheckedRows = async (table: string, shopId: string): Promise<any[]> => {
  let detail = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const rows = await fetchAllRows(table, shopId);
    const count = await countRows(table, shopId);
    const distinct = table === 'settings' ? rows.length : new Set(rows.map(r => String(r?.id))).size;
    if (rows.length === count && distinct === rows.length) return rows;
    detail = distinct !== rows.length
      ? `read ${rows.length} rows but only ${distinct} different ids`
      : `read ${rows.length} rows but the server counts ${count}`;
    console.warn(`[Backup] ${table}: ${detail} (attempt ${attempt})`);
  }
  throw new Error(`Backup stopped: ${table} ${detail}. Nothing was downloaded. Please try again.`);
};

export const exportBackup = async (shopId: string): Promise<void> => {
  if (!shopId) throw new Error('Shop not loaded');

  const backupData: Record<string, any> = {};
  const counts: Record<string, number> = {};

  for (const table of SHOP_TABLES) {
    backupData[table] = await fetchCheckedRows(table, shopId);
    counts[table] = backupData[table].length;
  }

  backupData._meta = {
    format: 'vapetrax-backup',
    version: 2,
    shopId,
    exportedAt: new Date().toISOString(),
    counts,
    countsVerified: true,
  };

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().split('T')[0];
  a.download = `vapetrax_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const { error } = await supabase
    .from('settings')
    .update({ lastBackupDate: new Date().toISOString() })
    .eq('shopId', shopId);
  if (error) console.warn('Failed to update last backup date', error);
};

// Restore is disabled: the old version deleted every row first and then
// re-inserted the file with errors ignored, so a short or broken file could
// wipe the shop. It will come back as a validated, server-side restore.
export const restoreBackup = async (_shopId: string, _file: File): Promise<void> => {
  throw new Error('Restore is temporarily disabled to protect your data.');
};
