/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Please check your .env file.');
}

// No custom global headers here on purpose: a header the server's CORS rules
// don't allow would fail the preflight and break EVERY request. The build and
// device id travel inside the checkout payload instead (see lib/clientInfo.ts).
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

/**
 * The localStorage key where supabase-js keeps the signed-in session (its
 * default, `sb-<project>-auth-token`). AuthContext reads it to keep a device
 * signed in offline when the session can't be refreshed.
 */
export const authStorageKey: string = (() => {
  const fromClient = (supabase as unknown as { storageKey?: unknown }).storageKey;
  if (typeof fromClient === 'string' && fromClient) return fromClient;
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  } catch {
    return '';
  }
})();

/**
 * A throwaway client with its own in-memory session. Signing up a cashier
 * through it never touches the admin's session on this device, and nothing
 * is saved to localStorage.
 */
export function createIsolatedAuthClient(storageKey: string) {
  return createClient(supabaseUrl || '', supabaseAnonKey || '', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey,
    },
  });
}
