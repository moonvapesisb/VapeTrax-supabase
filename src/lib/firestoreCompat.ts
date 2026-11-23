import { supabase } from './supabase';

export const db = {};

export interface FirestoreQueryConstraint {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: string;
  value?: any;
  direction?: 'asc' | 'desc';
  count?: number;
}

export function collection(dbInstance: any, path: string, ...rest: string[]) {
  const fullPath = rest.length > 0 ? [path, ...rest].join('/') : path;
  return { type: 'collection', path: fullPath };
}

export function doc(dbOrCol: any, pathOrId?: string, ...rest: string[]) {
  let collectionName = 'default';
  let id = '';
  if (typeof dbOrCol === 'object' && dbOrCol && dbOrCol.type === 'collection') {
    collectionName = dbOrCol.path;
    id = pathOrId || (Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10));
  } else if (typeof pathOrId === 'string' && rest.length === 0) {
    const parts = pathOrId.split('/');
    if (parts.length >= 2) {
      id = parts.pop() || '';
      collectionName = parts.join('/');
    } else {
      collectionName = typeof dbOrCol === 'string' ? dbOrCol : 'default';
      id = pathOrId;
    }
  } else {
    collectionName = typeof dbOrCol === 'string' ? dbOrCol : 'default';
    id = pathOrId || '';
  }
  return { type: 'doc', collection: collectionName, id, ref: { collection: collectionName, id } };
}

export function query(col: any, ...constraints: FirestoreQueryConstraint[]) {
  return { ...col, constraints };
}

export function where(field: string, op: string, value: any): FirestoreQueryConstraint {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FirestoreQueryConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): FirestoreQueryConstraint {
  return { type: 'limit', count };
}

export class Timestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds || 0;
  }
  toDate() { return new Date(this.seconds * 1000); }
  toMillis() { return this.seconds * 1000; }
  static now() { return Timestamp.fromDate(new Date()); }
  static fromDate(date: Date) { return new Timestamp(Math.floor(date.getTime() / 1000), 0); }
  static fromMillis(millis: number) { return new Timestamp(Math.floor(millis / 1000), (millis % 1000) * 1000000); }
}

export function serverTimestamp() {
  return new Date().toISOString();
}

export async function getDoc(docRef: any) {
  const tableName = normalizeTable(docRef.collection);
  try {
    const { data, error } = await supabase.from(tableName).select('*').eq('id', docRef.id).maybeSingle();
    if (error || !data) {
      return {
        exists: () => false,
        data: () => null,
        id: docRef.id,
      };
    }
    return {
      exists: () => true,
      data: () => data,
      id: data.id || docRef.id,
    };
  } catch (err) {
    console.warn('[firestoreCompat] getDoc fallback', err);
    return { exists: () => false, data: () => null, id: docRef.id };
  }
}

export async function getDocs(q: any) {
  const collectionPath = q.path || (q.collection && q.collection.path) || 'products';
  const tableName = normalizeTable(collectionPath);
  try {
    let queryBuilder: any = supabase.from(tableName).select('*');

    if (q.constraints && Array.isArray(q.constraints)) {
      for (const c of q.constraints) {
        if (c.type === 'where') {
          if (c.op === '==' || c.op === '=') {
            queryBuilder = queryBuilder.eq(c.field, c.value);
          } else if (c.op === '>') {
            queryBuilder = queryBuilder.gt(c.field, c.value);
          } else if (c.op === '>=') {
            queryBuilder = queryBuilder.gte(c.field, c.value);
          } else if (c.op === '<') {
            queryBuilder = queryBuilder.lt(c.field, c.value);
          } else if (c.op === '<=') {
            queryBuilder = queryBuilder.lte(c.field, c.value);
          } else if (c.op === 'in' && Array.isArray(c.value)) {
            queryBuilder = queryBuilder.in(c.field, c.value);
          }
        } else if (c.type === 'orderBy') {
          queryBuilder = queryBuilder.order(c.field, { ascending: c.direction !== 'desc' });
        } else if (c.type === 'limit') {
          queryBuilder = queryBuilder.limit(c.count);
        }
      }
    }

    const { data, error } = await queryBuilder;
    const list = data || [];
    return {
      docs: list.map((item: any) => ({
        id: item.id,
        data: () => item,
      })),
      size: list.length,
      empty: list.length === 0,
      forEach: (fn: (d: any) => void) => list.forEach((item: any) => fn({ id: item.id, data: () => item })),
    };
  } catch (err) {
    console.warn('[firestoreCompat] getDocs fallback', err);
    return { docs: [], size: 0, empty: true, forEach: () => {} };
  }
}

export async function addDoc(col: any, data: any) {
  const tableName = normalizeTable(col.path);
  const id = data.id || (Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10));
  const payload = { ...data, id };
  try {
    const { data: inserted, error } = await supabase.from(tableName).insert([payload]).select().single();
    if (error) {
      console.error(`[firestoreCompat] addDoc error in ${tableName}:`, error);
    }
    return { id: inserted?.id || id };
  } catch (err) {
    console.error(`[firestoreCompat] addDoc exception in ${tableName}:`, err);
    return { id };
  }
}

export async function updateDoc(docRef: any, updates: any) {
  const tableName = normalizeTable(docRef.collection);
  try {
    const { error } = await supabase.from(tableName).update(updates).eq('id', docRef.id);
    if (error) {
      console.error(`[firestoreCompat] updateDoc error in ${tableName}:`, error);
    }
  } catch (err) {
    console.error(`[firestoreCompat] updateDoc exception in ${tableName}:`, err);
  }
}

export async function deleteDoc(docRef: any) {
  const tableName = normalizeTable(docRef.collection);
  try {
    const { error } = await supabase.from(tableName).delete().eq('id', docRef.id);
    if (error) {
      console.error(`[firestoreCompat] deleteDoc error in ${tableName}:`, error);
    }
  } catch (err) {
    console.error(`[firestoreCompat] deleteDoc exception in ${tableName}:`, err);
  }
}

export function writeBatch(_dbInstance?: any) {
  const ops: Array<() => Promise<any>> = [];
  return {
    set(docRef: any, data: any) {
      ops.push(async () => {
        const tableName = normalizeTable(docRef.collection);
        await supabase.from(tableName).upsert({ ...data, id: docRef.id });
      });
    },
    update(docRef: any, data: any) {
      ops.push(async () => {
        const tableName = normalizeTable(docRef.collection);
        await supabase.from(tableName).update(data).eq('id', docRef.id);
      });
    },
    delete(docRef: any) {
      ops.push(async () => {
        const tableName = normalizeTable(docRef.collection);
        await supabase.from(tableName).delete().eq('id', docRef.id);
      });
    },
    async commit() {
      for (const op of ops) {
        try { await op(); } catch (e) { console.warn('[firestoreCompat] batch op error', e); }
      }
    }
  };
}

export const increment = (n: number) => n;

function normalizeTable(path: string): string {
  if (!path) return 'products';
  if (path.includes('/bottles') || path === 'bottles') return 'bottles';
  if (path.includes('inventoryLogs') || path === 'inventoryLogs') return 'inventory_logs';
  return path.replace(/^\/+|\/+$/g, '');
}
