import { useEffect, useRef } from 'react';
import { onTableChanged, type LiveTable, type TableChangedDetail } from '../lib/liveSync';

/** A burst of changes from other devices costs one read. */
const DEBOUNCE_MS = 400;

/**
 * Calls refresh() when one of these tables changes:
 *   - at once for this device's own writes;
 *   - about 400 ms after the last change from another device;
 *   - while the page is hidden, once it is shown again (a hidden tab reads nothing).
 * needsRefresh(detail) may skip changes that cannot affect this view, or apply a
 * change in place; it returns false when no read is needed.
 */
export function useTableChanged(
  tables: LiveTable | readonly LiveTable[] | null | false,
  refresh: () => void,
  needsRefresh?: (detail: TableChangedDetail) => boolean,
): void {
  const refreshRef = useRef(refresh);
  const needsRef = useRef(needsRefresh);
  useEffect(() => {
    refreshRef.current = refresh;
    needsRef.current = needsRefresh;
  });

  const key = !tables ? '' : typeof tables === 'string' ? tables : [...tables].sort().join(',');

  useEffect(() => {
    if (!key) return;
    const watched = new Set(key.split(','));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let missed = false;

    const run = () => {
      timer = null;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        missed = true;
        return;
      }
      missed = false;
      refreshRef.current();
    };

    const off = onTableChanged(detail => {
      if (!watched.has(detail.table)) return;
      if (needsRef.current && !needsRef.current(detail)) return;
      if (timer) clearTimeout(timer);
      if (detail.source === 'local') run();
      else timer = setTimeout(run, DEBOUNCE_MS);
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible' && missed) run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [key]);
}

/**
 * True when a row passes these list filters. Only equality filters ('eq', 'in') are
 * checked; any other filter counts as passing (the list then simply reads again).
 */
export const rowMatchesFilters = (row: any, filters: { column: string; operator: string; value: any }[]): boolean =>
  filters.every(f => {
    if (!row || !f.column) return true;
    if (!Object.prototype.hasOwnProperty.call(row, f.column)) return true;
    const value = row[f.column];
    if (f.operator === 'eq') return String(value) === String(f.value);
    if (f.operator === 'in') return Array.isArray(f.value) && f.value.map(String).includes(String(value));
    return true;
  });

/** For lists: a change from another device matters only if one of its rows passes the filters. */
export const changeMatchesFilters = (
  detail: TableChangedDetail,
  filters: { column: string; operator: string; value: any }[],
): boolean => {
  if (detail.source !== 'remote' || !detail.rows?.length) return true;
  return detail.rows.some(row => rowMatchesFilters(row, filters));
};
