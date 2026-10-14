import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAllPages';

// ---------------------------------------------------------------------------
// Date-range reads for reports. The server returns at most 1000 rows per
// request, and the shop has more than that, so every report reads its range
// page by page. Temporary until the repositories in step 4.4.
// ---------------------------------------------------------------------------

export interface DateRangeQuery {
  table: 'sales' | 'expenses' | 'credits';
  /** A timestamptz column: sales.saleDate, expenses.expenseDate, credits.createdAt. */
  dateColumn: 'saleDate' | 'expenseDate' | 'createdAt';
  /** Columns to read; must include id. Defaults to every column. */
  columns?: string;
  /** Extra equality filters, e.g. { creditType: 'customer' }. */
  eq?: Record<string, string>;
}

const asError = (err: any): Error =>
  err instanceof Error ? err : new Error(err?.message || err?.details || String(err));

/**
 * Every row of the table dated within [start, end], read in a stable order (date,
 * then id), de-duplicated by id and cross-checked against the server's count, so a
 * report is never silently short.
 */
export async function fetchDateRange<T = any>(
  shopId: string,
  q: DateRangeQuery,
  start: Date,
  end?: Date | null,
): Promise<T[]> {
  const filtered = (query: any) => {
    let f = query.eq('shopId', shopId).gte(q.dateColumn, start.toISOString());
    if (end) f = f.lte(q.dateColumn, end.toISOString());
    for (const [column, value] of Object.entries(q.eq || {})) f = f.eq(column, value);
    return f;
  };

  let shortBy = '';
  // Counted first: a row saved during the read can only make the read longer, so a
  // short read means a page went missing. That is read once more before giving up.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { count, error } = await filtered(supabase.from(q.table).select('id', { count: 'exact', head: true }));
    if (error) throw asError(error);

    const rows = await fetchAllPages<any>((from, to) =>
      filtered(supabase.from(q.table).select(q.columns || '*'))
        .order(q.dateColumn, { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    const unique = [...new Map(rows.map(r => [r.id, r])).values()];
    if (count === null || count === undefined || unique.length >= count) return unique as T[];
    shortBy = `${unique.length} of ${count}`;
  }
  throw new Error(`Only ${shortBy} ${q.table} rows arrived. Please refresh.`);
}

/** React wrapper for fetchDateRange. Pass null for q or start to skip loading. */
export function useDateRangeRows<T = any>(
  shopId: string | null | undefined,
  q: DateRangeQuery | null,
  start: Date | null,
  end: Date | null,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  // The request whose answer (rows or error) is showing. Loading is derived from it,
  // so a new range never shows the old range's rows as if they were current.
  const [doneKey, setDoneKey] = useState('');

  const queryKey = q ? JSON.stringify(q) : '';
  const startMs = start ? start.getTime() : null;
  const endMs = end ? end.getTime() : null;
  const requestKey = shopId && q && startMs !== null ? `${shopId}|${queryKey}|${startMs}|${endMs}|${fetchTrigger}` : '';

  useEffect(() => {
    if (!requestKey || !shopId || !q || startMs === null) {
      setRows([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setError(null);

    fetchDateRange<T>(shopId, q, new Date(startMs), endMs === null ? null : new Date(endMs))
      .then(result => { if (!cancelled) setRows(result); })
      .catch(err => {
        if (cancelled) return;
        console.error(`[useDateRangeRows] ${q.table} failed:`, err);
        setRows([]);
        setError(asError(err));
      })
      .finally(() => { if (!cancelled) setDoneKey(requestKey); });

    return () => { cancelled = true; };
    // q is compared by value through requestKey
  }, [requestKey]);

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  return { rows, loading: requestKey !== '' && doneKey !== requestKey, error, refetch };
}

// ---------------------------------------------------------------------------
// Dashboard: week, month and 30-day trend.
// ---------------------------------------------------------------------------

interface DashboardAggregations {
  weeklyRevenue: number;
  weeklyProfit: number;
  monthlyRevenue: number;
  monthlyProfit: number;
  weeklyExpenses: number;
  monthlyExpenses: number;
  trendData: Array<{ date: string; revenue: number; transactions: number }>;
}

export function useDashboardAggregations(
  shopId: string | null | undefined,
  currentBusinessDay: Date,
  thisWeekBusiness: Date,
  thisMonthBusiness: Date
) {
  const [data, setData] = useState<DashboardAggregations>({
    weeklyRevenue: 0,
    weeklyProfit: 0,
    monthlyRevenue: 0,
    monthlyProfit: 0,
    weeklyExpenses: 0,
    monthlyExpenses: 0,
    trendData: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    if (!shopId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchAggregations = async () => {
      try {
        const d30 = new Date(currentBusinessDay);
        d30.setDate(d30.getDate() - 29);
        d30.setHours(0, 0, 0, 0);

        // The month (or week) can start before the 30-day trend window, e.g. on the 31st.
        const from = new Date(Math.min(d30.getTime(), thisWeekBusiness.getTime(), thisMonthBusiness.getTime()));

        // saleDate is set on every sale; saleDateClient is Firestore JSON on old rows.
        const [sales, expenses] = await Promise.all([
          fetchDateRange<any>(shopId, { table: 'sales', dateColumn: 'saleDate', columns: 'id, totalAmount, totalProfit, saleDate' }, from),
          fetchDateRange<any>(shopId, { table: 'expenses', dateColumn: 'expenseDate', columns: 'id, amount, expenseDate' }, from),
        ]);
        if (cancelled) return;

        let weeklyRev = 0, weeklyProf = 0, weeklyExp = 0;
        let monthlyRev = 0, monthlyProf = 0, monthlyExp = 0;
        const trendMap = new Map<string, { revenue: number, transactions: number }>();

        for (let i = 29; i >= 0; i--) {
          const d = new Date(currentBusinessDay);
          d.setDate(d.getDate() - i);
          const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          trendMap.set(key, { revenue: 0, transactions: 0 });
        }

        const weekMs = thisWeekBusiness.getTime();
        const monthMs = thisMonthBusiness.getTime();
        const trendMs = d30.getTime();

        sales.forEach(sale => {
          const saleDate = new Date(sale.saleDate);
          const saleTime = saleDate.getTime();
          if (Number.isNaN(saleTime)) return;
          const amt = Number(sale.totalAmount) || 0;
          const prof = Number(sale.totalProfit) || 0;

          if (saleTime >= weekMs) {
            weeklyRev += amt;
            weeklyProf += prof;
          }
          if (saleTime >= monthMs) {
            monthlyRev += amt;
            monthlyProf += prof;
          }

          if (saleTime >= trendMs) {
            const trendKey = saleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const entry = trendMap.get(trendKey);
            if (entry) {
              entry.revenue += amt;
              entry.transactions += 1;
            }
          }
        });

        expenses.forEach(expense => {
          const expTime = new Date(expense.expenseDate).getTime();
          if (Number.isNaN(expTime)) return;
          const amt = Number(expense.amount) || 0;

          if (expTime >= weekMs) {
            weeklyExp += amt;
          }
          if (expTime >= monthMs) {
            monthlyExp += amt;
          }
        });

        const trendData = Array.from(trendMap.entries()).map(([date, stats]) => ({
          date,
          revenue: stats.revenue,
          transactions: stats.transactions
        }));

        setData({
          weeklyRevenue: weeklyRev,
          weeklyProfit: weeklyProf,
          monthlyRevenue: monthlyRev,
          monthlyProfit: monthlyProf,
          weeklyExpenses: weeklyExp,
          monthlyExpenses: monthlyExp,
          trendData
        });
        setLoading(false);

      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to fetch dashboard aggregations:', err);
          setError(asError(err));
          setLoading(false);
        }
      }
    };

    fetchAggregations();

    return () => { cancelled = true; };
  }, [shopId, fetchTrigger, currentBusinessDay.getTime(), thisWeekBusiness.getTime(), thisMonthBusiness.getTime()]);

  const refetch = useCallback(() => setFetchTrigger(t => t + 1), []);

  return { ...data, loading, error, refetch };
}
