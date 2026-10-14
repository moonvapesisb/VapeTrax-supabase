import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { Database } from '../types/supabase';

type TableName = keyof Database['public']['Tables'];

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'ilike' | 'or';
  value: any;
}

export interface OrderCondition {
  column: string;
  ascending?: boolean;
}

const channelCache: { [tableName: string]: ReturnType<typeof supabase.channel> } = {};
const channelSubscribers: { [tableName: string]: Set<(payload: any) => void> } = {};

/**
 * A custom hook to fetch and listen to a Supabase table.
 * It initially fetches the data based on filters, and then subscribes
 * to real-time changes to keep the data synced.
 * 
 * Note: Realtime subscriptions apply to ALL rows in the table.
 * For simpler use-cases, use useSupabaseOnce instead.
 *
 * @deprecated Not used. It opens one unfiltered channel per table; live updates now
 * come from the one per-shop channel in lib/liveSync.ts, and useSupabaseOnce reads
 * again by itself when its table changes.
 */
export function useSupabase<
  TName extends TableName,
  T = Database['public']['Tables'][TName]['Row']
>(
  tableName: TName | null | false,
  filters: FilterCondition[] = [],
  orderBy?: OrderCondition
) {
  const [documents, setDocuments] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(!!tableName);
  const [error, setError] = useState<Error | null>(null);

  const filtersKey = JSON.stringify(filters);

  const fetchData = useCallback(async () => {
    if (!tableName) return;
    
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

    const { data, error } = await query;

    if (error) {
      console.error(`[useSupabase] Error fetching ${tableName}:`, error);
      setError(new Error(error.message));
      toast.error(`Error loading ${tableName}: ${error.message}`);
    } else {
      setDocuments(data as T[]);
    }
  }, [tableName, filtersKey, orderBy?.column, orderBy?.ascending]);

  useEffect(() => {
    if (!tableName) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Initial fetch
    fetchData().then(() => setLoading(false));

    // Setup shared realtime subscription
    if (!channelSubscribers[tableName]) {
      channelSubscribers[tableName] = new Set();
    }

    const handlePayload = (payload: any) => {
      // Immediately update local state without waiting for a re-fetch
      setDocuments((currentDocs) => {
        if (payload.eventType === 'INSERT') {
          // Add new document only if it matches our filter locally (e.g. shopId)
          const matchesFilter = filters.every(f => {
            if (f.operator === 'eq') return payload.new[f.column] === f.value;
            return true;
          });
          if (matchesFilter) {
            // Avoid duplicates
            if (currentDocs.some((d: any) => d.id === payload.new.id)) return currentDocs;
            return [...currentDocs, payload.new as T];
          }
          return currentDocs;
        }
        if (payload.eventType === 'UPDATE') {
          // Update existing document
          return currentDocs.map((doc: any) =>
            doc.id === payload.new.id ? { ...doc, ...payload.new } : doc
          );
        }
        if (payload.eventType === 'DELETE') {
          // Remove document
          return currentDocs.filter((doc: any) => doc.id !== payload.old.id);
        }
        return currentDocs;
      });
    };

    channelSubscribers[tableName].add(handlePayload);

    if (!channelCache[tableName]) {
      const channelName = `public:${tableName}-shared`;
      channelCache[tableName] = supabase.channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: tableName,
          },
          (payload) => {
            console.log(`[Shared Realtime ${tableName}] Payload received:`, payload);
            channelSubscribers[tableName].forEach(callback => callback(payload));
          }
        )
        .subscribe((status) => {
          console.log(`[Shared Realtime ${tableName}] Subscription status:`, status);
        });
    }

    return () => {
      if (channelSubscribers[tableName]) {
        channelSubscribers[tableName].delete(handlePayload);
        if (channelSubscribers[tableName].size === 0) {
          // If no more components are listening to this table, we can safely remove the channel
          if (channelCache[tableName]) {
            supabase.removeChannel(channelCache[tableName]);
            delete channelCache[tableName];
          }
        }
      }
    };
  }, [tableName, filtersKey, orderBy?.column, orderBy?.ascending, fetchData]);

  return { documents, loading, error, refetch: fetchData };
}
