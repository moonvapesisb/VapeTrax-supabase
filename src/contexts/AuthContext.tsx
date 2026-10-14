import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isAuthRetryableFetchError, type User } from '@supabase/supabase-js';
import { supabase, authStorageKey, createIsolatedAuthClient } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

/** The only roles that may use a shop. Anything else means "not linked". */
export type ShopRole = 'admin' | 'cashier';

/**
 * - loading: still finding out who is signed in.
 * - signed-out: nobody is signed in.
 * - ready: a live session. Role and shop were confirmed by the server, or are
 *   the last confirmed copy on this device when the server can't be reached.
 * - offline: the session could not be refreshed because there is no internet.
 *   The last confirmed role and shop on this device apply; POS and the sync
 *   queue only.
 * - unverified: signed in, but the role could not be checked and this device
 *   has no confirmed copy. Nothing is allowed until it is checked.
 * - not-linked: the server says this account has no shop yet (role 'pending',
 *   an unknown role, or no shop). Nothing is allowed.
 */
export type AuthStatus = 'loading' | 'signed-out' | 'ready' | 'offline' | 'unverified' | 'not-linked';

interface AuthContextType {
  currentUser: AppUser | null;
  userRole: ShopRole | null;
  shopId: string | null;
  loading: boolean;
  authStatus: AuthStatus;
  /** Checks the session and the profile with the server again. */
  retryVerification: () => Promise<void>;
  login: (email: string, pass: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (email: string, pass: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  createCashier: (email: string, password: string, name: string) => Promise<void>;
  deleteCashier: (cashierUid: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PROFILE_CACHE_KEY = 'vapetrax_user_profile';
const CART_KEY = 'vapetrax_cart';
const PROFILE_CACHE_VERSION = 2;
const PROFILE_TIMEOUT_MS = 8000;
const RECHECK_INTERVAL_MS = 30_000;
const OFFLINE_START_GRACE_MS = 4000;
const CASHIER_SIGNUP_STORAGE_KEY = 'vapetrax-cashier-signup';

const isShopRole = (role: unknown): role is ShopRole => role === 'admin' || role === 'cashier';

const cleanShopId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Saves a role and shop the server has just confirmed. Nothing else is ever cached. */
function cacheConfirmedProfile(uid: string, role: ShopRole, shopId: string) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      v: PROFILE_CACHE_VERSION,
      uid,
      role,
      shopId,
      confirmedAt: new Date().toISOString(),
    }));
  } catch { /* quota exceeded or private browsing */ }
}

/**
 * The last server-confirmed role and shop for this user on this device.
 * Copies written by older app versions are ignored: they could hold a
 * fallback 'admin', or the user's own id standing in for a missing shop.
 */
function getCachedProfile(uid: string): { role: ShopRole; shopId: string } | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== PROFILE_CACHE_VERSION || parsed.uid !== uid) return null;
    const shopId = cleanShopId(parsed.shopId);
    if (!isShopRole(parsed.role) || !shopId) return null;
    return { role: parsed.role, shopId };
  } catch { /* parse error or storage blocked */ }
  return null;
}

function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
}

/** Forgets this user's copies on the device. Only for a real sign-out. */
function clearLocalUserData() {
  clearCachedProfile();
  try { localStorage.removeItem(CART_KEY); } catch { /* ignore */ }
}

/**
 * The user of the session supabase-js still keeps in localStorage, even when
 * that session could not be refreshed. Used only to stay signed in offline.
 */
function readStoredSessionUser(): any | null {
  if (!authStorageKey) return null;
  try {
    const raw = localStorage.getItem(authStorageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!stored || typeof stored.refresh_token !== 'string' || !stored.refresh_token) return null;
    let user = stored.user;
    if (!user || typeof user.id !== 'string') {
      const rawUser = localStorage.getItem(`${authStorageKey}-user`);
      user = rawUser ? JSON.parse(rawUser)?.user : null;
    }
    return user && typeof user.id === 'string' && user.id ? user : null;
  } catch {
    return null;
  }
}

/** True when the failure is "no internet" (or the server is unreachable), not a refusal. */
function isNetworkFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function mapSupabaseUser(user: any): AppUser | null {
  if (!user) return null;
  return {
    uid: user.id,
    email: user.email || null,
    displayName: user.user_metadata?.full_name || user.user_metadata?.username || user.email?.split('@')[0] || 'User',
  };
}

type ProfileOutcome =
  | { kind: 'linked'; role: ShopRole; shopId: string }
  | { kind: 'not-linked' }
  | { kind: 'error'; error: unknown };

function classifyProfile(row: any): ProfileOutcome {
  const shopId = cleanShopId(row?.shopId);
  // Never substitute the user's own id for a missing shop.
  if (isShopRole(row?.role) && shopId) return { kind: 'linked', role: row.role, shopId };
  return { kind: 'not-linked' };
}

async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const fetchProfileRow = (uid: string) =>
  withTimeout((signal) =>
    supabase.from('profiles').select('role, shopId').eq('id', uid).abortSignal(signal).single()
  );

/**
 * Reads the profile. Only "no row" (PGRST116) creates one: a new self
 * sign-up becomes admin of a new shop whose id is their own, which is the
 * only admin profile the database accepts. Any other failure is reported as
 * an error and never grants a role.
 */
async function loadProfile(user: User): Promise<ProfileOutcome> {
  try {
    const first = await fetchProfileRow(user.id);
    if (first.data) return classifyProfile(first.data);
    if (first.error?.code !== 'PGRST116') {
      return { kind: 'error', error: first.error ?? new Error('Empty profile response') };
    }

    // A login an admin created as a cashier is never made admin of a new
    // shop, even if linking it to the admin's shop failed: it waits to be
    // linked. (Users can set this tag on themselves, but it only takes
    // rights away from them.)
    if (cleanShopId(user.user_metadata?.invitedToShop)) return { kind: 'not-linked' };

    const appUser = mapSupabaseUser(user);
    const created = await withTimeout((signal) =>
      supabase
        .from('profiles')
        .insert({
          id: user.id,
          username: appUser?.displayName || 'User',
          email: user.email,
          role: 'admin',
          shopId: user.id,
        })
        .select('role, shopId')
        .abortSignal(signal)
        .single()
    );
    // Trust what the server stored, not what was sent.
    if (created.data) return classifyProfile(created.data);
    console.error('Error creating profile:', created.error);

    // Another tab or a second auth event may have created it in the meantime.
    const again = await fetchProfileRow(user.id);
    if (again.data) return classifyProfile(again.data);
    return { kind: 'error', error: created.error ?? again.error };
  } catch (error) {
    return { kind: 'error', error };
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [userRole, setUserRole] = useState<ShopRole | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [authStatus, setAuthStatusState] = useState<AuthStatus>('loading');

  // Mirrors for the auth listener, which is registered once.
  const statusRef = useRef<AuthStatus>('loading');
  const uidRef = useRef<string | null>(null);
  const profileFromServerRef = useRef(false);
  const generationRef = useRef(0);
  const inflightRef = useRef<{ uid: string; promise: Promise<void> } | null>(null);
  const recheckingRef = useRef(false);

  const setStatus = (status: AuthStatus) => {
    statusRef.current = status;
    setAuthStatusState(status);
  };

  const grant = (role: ShopRole, sId: string, status: 'ready' | 'offline') => {
    setUserRole(role);
    setShopId(sId);
    setStatus(status);
  };

  const revoke = (status: Exclude<AuthStatus, 'ready' | 'offline'>) => {
    setUserRole(null);
    setShopId(null);
    setStatus(status);
  };

  const handleSignedOut = (clearLocal: boolean) => {
    generationRef.current += 1;
    uidRef.current = null;
    profileFromServerRef.current = false;
    inflightRef.current = null;
    if (clearLocal) clearLocalUserData();
    setCurrentUser(null);
    revoke('signed-out');
  };

  const verifyProfile = (user: User): Promise<void> => {
    const uid = user.id;
    if (inflightRef.current?.uid === uid) return inflightRef.current.promise;
    const generation = generationRef.current;

    const promise: Promise<void> = (async () => {
      const outcome = await loadProfile(user);
      // Signed out, or another user signed in, while this was running.
      if (generation !== generationRef.current || uidRef.current !== uid) return;

      if (outcome.kind === 'linked') {
        profileFromServerRef.current = true;
        cacheConfirmedProfile(uid, outcome.role, outcome.shopId);
        grant(outcome.role, outcome.shopId, 'ready');
      } else if (outcome.kind === 'not-linked') {
        profileFromServerRef.current = true;
        clearCachedProfile();
        revoke('not-linked');
      } else {
        profileFromServerRef.current = false;
        console.warn('[Auth] Could not check the profile; using the last confirmed copy if there is one.', outcome.error);
        const cached = getCachedProfile(uid);
        if (cached) grant(cached.role, cached.shopId, 'ready');
        else revoke('unverified');
      }
    })().finally(() => {
      if (inflightRef.current?.promise === promise) inflightRef.current = null;
    });

    inflightRef.current = { uid, promise };
    return promise;
  };

  /** A live session for `user` (sign-in, token refresh, or the session found at start-up). */
  const handleSessionUser = (user: User) => {
    const uid = user.id;
    const sameUser = uidRef.current === uid;
    setCurrentUser(mapSupabaseUser(user));

    if (!sameUser) {
      generationRef.current += 1;
      uidRef.current = uid;
      profileFromServerRef.current = false;
      inflightRef.current = null;
      const cached = getCachedProfile(uid);
      if (cached) grant(cached.role, cached.shopId, 'ready');
      else revoke('loading');
    } else if (statusRef.current === 'offline') {
      // The session works again: the confirmed copy applies until the server answers.
      setStatus('ready');
    } else if (statusRef.current === 'ready' && profileFromServerRef.current) {
      return; // Already confirmed by the server for this session.
    }

    void verifyProfile(user);
  };

  /**
   * getSession() failed because there is no internet. If localStorage still
   * holds this user's session, stay signed in with the last confirmed role and
   * shop: never more than that, and never the user's own id as the shop.
   */
  const enterOfflineSession = () => {
    const storedUser = readStoredSessionUser();
    if (!storedUser) {
      handleSignedOut(false);
      return;
    }
    if (uidRef.current !== storedUser.id) {
      generationRef.current += 1;
      inflightRef.current = null;
    }
    uidRef.current = storedUser.id;
    profileFromServerRef.current = false;
    setCurrentUser(mapSupabaseUser(storedUser));
    const cached = getCachedProfile(storedUser.id);
    if (cached) grant(cached.role, cached.shopId, 'offline');
    else revoke('unverified');
  };

  const readSession = async (): Promise<{ user: User | null; error: unknown }> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      return { user: data.session?.user ?? null, error };
    } catch (error) {
      return { user: null, error };
    }
  };

  /** Re-checks the session and profile, e.g. when the internet comes back. */
  const recheck = async (manual: boolean) => {
    if (recheckingRef.current) return;
    const status = statusRef.current;
    if (status === 'loading' || status === 'signed-out') return;
    recheckingRef.current = true;
    try {
      if (manual) profileFromServerRef.current = false;
      const { user, error } = await readSession();
      if (user) {
        handleSessionUser(user);
        await inflightRef.current?.promise;
        if (manual && statusRef.current === 'unverified') {
          toast.error('Still could not check your account. Check the internet connection and try again.');
        }
      } else if (manual) {
        toast.error(isNetworkFailure(error)
          ? 'No internet connection. Connect to the internet and try again.'
          : 'Could not check your account. Please log in again.');
      }
      // No user: still offline, or the session is gone (supabase-js reports that with SIGNED_OUT).
    } finally {
      recheckingRef.current = false;
    }
  };

  useEffect(() => {
    let disposed = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      // The start-up session is read with getSession() below, which also says
      // WHY a session is missing (no internet versus signed out).
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        // The only place this device's copies are cleared (besides logout()).
        handleSignedOut(true);
        return;
      }
      // Not awaited: supabase calls must not be awaited inside this callback.
      if (session?.user) handleSessionUser(session.user);
    });

    // Offline start-up: supabase-js keeps retrying an expired token's refresh
    // for up to ~30 s before getSession() answers. Don't hold the POS behind a
    // spinner meanwhile: if this device has the session AND a confirmed
    // profile, open it as 'offline' now. The getSession() answer replaces it.
    const offlineStartTimer = setTimeout(() => {
      if (disposed || statusRef.current !== 'loading' || uidRef.current !== null) return;
      const storedUser = readStoredSessionUser();
      if (storedUser && getCachedProfile(storedUser.id)) enterOfflineSession();
    }, navigator.onLine === false ? 0 : OFFLINE_START_GRACE_MS);

    void (async () => {
      const { user, error } = await readSession();
      clearTimeout(offlineStartTimer);
      if (disposed) return;
      const status = statusRef.current;
      if (user) {
        handleSessionUser(user);
      } else if (error && isNetworkFailure(error)) {
        if (status === 'loading' || status === 'offline') enterOfflineSession();
      } else if (uidRef.current === null || status === 'offline') {
        // No session. Nothing is cleared here: a missing session is not a sign-out.
        handleSignedOut(false);
      }
    })();

    const needsRecheck = () => {
      const status = statusRef.current;
      return status === 'offline' || status === 'unverified' || (status === 'ready' && !profileFromServerRef.current);
    };
    const onOnline = () => { if (needsRecheck()) void recheck(false); };
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => {
      if (needsRecheck() && navigator.onLine !== false) void recheck(false);
    }, RECHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      clearTimeout(offlineStartTimer);
      subscription.unsubscribe();
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryVerification = () => recheck(true);

  const login = async (email: string, pass: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      toast.error(error.message);
      throw error;
    }
    toast.success('Logged in successfully');
  };

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) {
      toast.error(error.message);
      throw error;
    }
    // toast will be handled on redirect back
  };

  const signup = async (email: string, pass: string) => {
    // A new self sign-up becomes admin of their own new shop on first sign-in
    // (the PGRST116 path in loadProfile).
    const { data, error } = await supabase.auth.signUp({ email, password: pass });
    if (error) {
      toast.error(error.message);
      throw error;
    }
    if (data.session) {
      toast.success('Account created successfully');
    } else {
      toast.success('Account created. Check your email to confirm it, then sign in.');
    }
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      toast.error(error.message);
      throw error;
    }
    toast.success('Password reset email sent');
  };

  const logout = async () => {
    // 'local' signs out THIS device only. The default ('global') would also
    // end the session of every other device using the same login, and the
    // shop's POS devices share one.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    // supabase-js removes the session even when the logout request itself
    // fails (e.g. offline with a still-valid token); it keeps it only when the
    // session could not be read at all (an expired token with no internet).
    const signedOut = statusRef.current === 'signed-out' || (!!authStorageKey && !readStoredSessionUser());
    if (error && !signedOut) {
      toast.error(isNetworkFailure(error)
        ? 'You are offline. Connect to the internet to log out. Sales on this device are kept safe.'
        : error.message);
      return;
    }
    // SIGNED_OUT has normally cleared these already; this covers a missed event.
    clearLocalUserData();
    if (error && isNetworkFailure(error)) {
      toast.success('Logged out on this device. You need internet to log in again.');
    } else {
      toast.success('Logged out successfully');
    }
  };

  const createCashier = async (email: string, password: string, name: string) => {
    try {
      if (!shopId || userRole !== 'admin' || authStatus !== 'ready') {
        throw new Error('Only a shop admin who is online can add cashiers.');
      }
      const cleanEmail = email.trim().toLowerCase();
      const cleanName = name.trim();

      // Sign the cashier up through a separate client with its own in-memory
      // session. "Confirm email" is off, so signUp signs the NEW user in at
      // once; on the main client that would replace the admin's session and
      // could even create an admin profile for the cashier.
      const signupClient = createIsolatedAuthClient(CASHIER_SIGNUP_STORAGE_KEY);
      try {
        const { data, error } = await signupClient.auth.signUp({
          email: cleanEmail,
          password,
          // invitedToShop: should linking below fail, this login still never
          // becomes admin of a new shop on its first sign-in (loadProfile).
          options: { data: { full_name: cleanName, invitedToShop: shopId } },
        });
        if (error) throw error;
        const newUser = data.user;
        if (!newUser?.id) throw new Error('The cashier login could not be created. Please try again.');
        if (Array.isArray(newUser.identities) && newUser.identities.length === 0) {
          throw new Error('This email is already registered.');
        }

        // Link the cashier to this shop with the admin's own session. Tried
        // twice (a dropped connection), then read back: an insert whose reply
        // was lost has still linked the cashier.
        const cashierId = newUser.id;
        const linkCashier = async (): Promise<unknown> => {
          try {
            const { error: insertError } = await withTimeout((signal) =>
              supabase.from('profiles').insert({
                id: cashierId,
                username: cleanName,
                email: cleanEmail,
                role: 'cashier',
                shopId,
              }).abortSignal(signal)
            );
            return insertError;
          } catch (insertError) {
            return insertError ?? new Error('Linking failed');
          }
        };
        const isLinked = async (): Promise<boolean> => {
          try {
            const { data: row } = await withTimeout((signal) =>
              supabase.from('profiles').select('role, shopId').eq('id', cashierId).abortSignal(signal).maybeSingle()
            );
            return row?.role === 'cashier' && row?.shopId === shopId;
          } catch {
            return false;
          }
        };

        let profileError = await linkCashier();
        if (profileError && (await isLinked())) profileError = null;
        if (profileError) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          profileError = await linkCashier();
          if (profileError && (await isLinked())) profileError = null;
        }
        if (profileError) {
          const reason = (profileError as { message?: string })?.message || String(profileError);
          throw new Error(`The cashier login was created, but linking it to your shop failed (${reason}). That login cannot be used until it is linked.`);
        }
      } finally {
        // End the throwaway session; the admin's session is untouched.
        await signupClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }

      toast.success(`Cashier "${cleanName}" created successfully`);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create the cashier');
      throw error;
    }
  };

  const deleteCashier = async (cashierUid: string) => {
    // Only deletes the profile here. Deleting from auth.users requires an Admin API key.
    // For now, this revokes their access from the shop.
    const { data, error } = await supabase.from('profiles').delete().eq('id', cashierUid).select('id');
    if (error) {
      toast.error(error.message);
      throw error;
    }
    if (!data || data.length === 0) {
      const notRemoved = new Error('The cashier was not removed. Refresh the page and try again.');
      toast.error(notRemoved.message);
      throw notRemoved;
    }
    toast.success('Cashier removed successfully');
  };

  const loading = authStatus === 'loading';

  return (
    <AuthContext.Provider value={{ currentUser, userRole, shopId, loading, authStatus, retryVerification, login, loginWithGoogle, signup, resetPassword, logout, createCashier, deleteCashier }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
