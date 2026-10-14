import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { FilterCondition, OrderCondition } from './useSupabase';
import { Database } from '../types/supabase';
import { LIVE_TABLES, type LiveTable } from '../lib/liveSync';
import { useTableChanged, changeMatchesFilters } from './useTableChanged';

type TableName = keyof Database['public']['Tables'];

const asLiveTable = (table: string | null | false): LiveTable | null =>
  table && (LIVE_TABLES as readonly string[]).includes(table) ? (table as LiveTable) : null;

/**
 * Reads a server list, and reads it again whenever its table changes: at once after
 * this device's own writes, about 400 ms after another device's (liveSync.ts). A
 * re-read keeps the list on screen (no spinner) until the new rows arrive.
 */
export function useSupabaseOnce<
  TName extends TableName,
  T = Database['public']['Tables'][TName]['Row']
>(
  tableName: TName | null | false,
  filters: FilterCondition[] = [],
  orderBy?: OrderCondition,
  limitCount?: number
) {
  const [documents, setDocuments] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(!!tableName);
  const [error, setError] = useState<Error | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  // The next read is a quiet re-read (a live update): the list stays on screen.
  const quietRef = useRef(false);

  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    const quiet = quietRef.current;
    quietRef.current = false;
    if (!tableName) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }

    let query = supabase.from(tableName).select('*');

    filters.forEach(f => {
      if (f.operator === 'eq') query = query.eq(f.column, f.value);
      if (f.operator === 'neq') query = query.neq(f.column, f.value);
      if (f.operator === 'gt') query = query.gt(f.column, f.value);
      if (f.operator === 'lt') query = query.lt(f.column, f.value);
      if (f.operator === 'gte') query = query.gte(f.column, f.value);
      if (f.operator === 'lte') query = query.lte(f.column, f.value);
      if (f.operator === 'in') query = query.in(f.column, f.value);
      if (f.operator === 'ilike') query = query.ilike(f.column, f.value);
      if (f.operator === 'or') query = query.or(f.value);
    });

    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }

    if (limitCount !== undefined) {
      query = query.limit(limitCount);
    }

    const fetchIt = async () => {
      try {
        const { data, error } = await query;
        if (cancelled) return;
        if (error) {
          console.error(`[useSupabaseOnce] Error on "${tableName}":`, error);
          // A failed quiet re-read keeps the rows on screen; the next change tries again.
          if (!quiet) setError(new Error(error.message));
        } else {
          setDocuments(data as T[]);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.error(`[useSupabaseOnce] Exception on "${tableName}":`, err);
        if (!quiet) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchIt();

    return () => {
      cancelled = true;
    };
  }, [tableName, filtersKey, orderBy?.column, orderBy?.ascending, limitCount, fetchTrigger]);

  const refetch = useCallback(() => {
    setFetchTrigger(t => t + 1);
  }, []);

  const quietRefetch = useCallback(() => {
    quietRef.current = true;
    setFetchTrigger(t => t + 1);
  }, []);

  // Live: read again when this table changes (only changes that can show in this list).
  useTableChanged(asLiveTable(tableName), quietRefetch, detail => changeMatchesFilters(detail, filters));

  return { documents, loading, error, refetch };
}

const globalQueryCache = new Map<string, any[]>();

export function useCachedSupabaseOnce<
  TName extends TableName,
  T = Database['public']['Tables'][TName]['Row']
>(
  tableName: TName | null | false,
  filters: FilterCondition[] = [],
  orderBy?: OrderCondition,
  limitCount?: number
) {
  const [documents, setDocuments] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(!!tableName);
  const [error, setError] = useState<Error | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const filtersKey = JSON.stringify(filters);
  const cacheKey = `${tableName}|${filtersKey}|${orderBy?.column}|${orderBy?.ascending}|${limitCount}`;

  useEffect(() => {
    if (!tableName) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    if (fetchTrigger === 0 && globalQueryCache.has(cacheKey)) {
      setDocuments(globalQueryCache.get(cacheKey)! as T[]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    let query = supabase.from(tableName).select('*');
    
    filters.forEach(f => {
      if (f.operator === 'eq') query = query.eq(f.column, f.value);
      if (f.operator === 'neq') query = query.neq(f.column, f.value);
      if (f.operator === 'gt') query = query.gt(f.column, f.value);
      if (f.operator === 'lt') query = query.lt(f.column, f.value);
      if (f.operator === 'gte') query = query.gte(f.column, f.value);
      if (f.operator === 'lte') query = query.lte(f.column, f.value);
      if (f.operator === 'in') query = query.in(f.column, f.value);
    });

    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }
    
    if (limitCount !== undefined) {
      query = query.limit(limitCount);
    }

    const fetchIt = async () => {
      try {
        const { data, error } = await query;
        if (cancelled) return;
        if (error) {
          console.error(`[useCachedSupabaseOnce] Error on "${tableName}":`, error);
          setError(new Error(error.message));
        } else {
          globalQueryCache.set(cacheKey, data as T[]);
          setDocuments(data as T[]);
        }
      } catch (err) {
        if (cancelled) return;
        console.error(`[useCachedSupabaseOnce] Exception on "${tableName}":`, err);
        setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchIt();

    return () => {
      cancelled = true;
    };
  }, [tableName, filtersKey, orderBy?.column, orderBy?.ascending, limitCount, fetchTrigger, cacheKey]);

  const refetch = useCallback(() => {
    setFetchTrigger(t => t + 1);
  }, []);

  return { documents, loading, error, refetch };
}

export function useDocumentOnce<
  TName extends TableName,
  T = Database['public']['Tables'][TName]['Row']
>(
  tableName: TName | null | false,
  docId: string | null | false,
  idColumnName: string = 'id'
) {
  const [document, setDocument] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!tableName && !!docId);
  const [error, setError] = useState<Error | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    if (!tableName || !docId) {
      setDocument(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchIt = async () => {
      try {
        const { data, error } = await supabase.from(tableName).select('*').eq(idColumnName, docId).single();
        if (cancelled) return;
        if (error) {
           if (error.code === 'PGRST116') {
               setDocument(null);
           } else {
               console.error(`[useDocumentOnce] Error on "${tableName}/${docId}":`, error);
               setError(new Error(error.message));
           }
        } else {
          setDocument(data as T);
        }
      } catch (err) {
        if (cancelled) return;
        console.error(`[useDocumentOnce] Exception on "${tableName}/${docId}":`, err);
        setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchIt();

    return () => {
      cancelled = true;
    };
  }, [tableName, docId, idColumnName, fetchTrigger]);

  const refetch = useCallback(() => {
    setFetchTrigger(t => t + 1);
  }, []);

  return { document, loading, error, refetch };
}
