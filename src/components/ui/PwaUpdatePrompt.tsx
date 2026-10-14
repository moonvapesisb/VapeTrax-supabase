import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
// @ts-ignore
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from '../../lib/db';

// A new version is applied by itself only when nothing is going on, so a
// reload can never interrupt a sale. Otherwise a toast stays on screen until
// someone taps Reload, so every release still reaches every device.
// This holds for EVERY open tab: when one tab applies the update, the new
// version takes over all of them, and each of the others reloads only once it
// is idle itself (or when someone taps Reload there).
const IDLE_ROUTES = new Set(['/', '/sales/new', '/dashboard']);
const IDLE_AFTER_MS = 20_000;         // no taps or typing for this long
const IDLE_CHECK_MS = 10_000;         // how often to look for an idle moment
const UPDATE_CHECK_MS = 60 * 60_000;  // ask the server for a new version hourly
const TOAST_ID = 'pwa-update-available';
const CART_KEY = 'vapetrax_cart';

const cartIsEmpty = (): boolean => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false; // can't tell: treat as busy
  }
};

const inputIsFocused = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

// Modals and overlays in this app are full-screen fixed layers.
const dialogIsOpen = (): boolean =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], .fixed.inset-0'))
    .some(el => el.getClientRects().length > 0);

const syncQueueIsEmpty = async (): Promise<boolean> => {
  try {
    // Any queued item (waiting, being sent or failed) means "not idle".
    return (await db.syncQueue.count()) === 0;
  } catch {
    return false;
  }
};

const PwaUpdatePrompt: React.FC = () => {
  const location = useLocation();
  const lastActivityRef = useRef(Date.now());
  // This tab asked for the update (Reload tapped, or it was idle).
  const applyingRef = useRef(false);
  // The new version already controls this tab (another tab applied it); a
  // plain reload finishes the update here.
  const pendingReloadRef = useRef(false);
  const [reloadPending, setReloadPending] = useState(false);
  const routeRef = useRef({ pathname: location.pathname, editing: false });

  routeRef.current = {
    pathname: location.pathname,
    editing: !!(location.state as any)?.editSale,
  };

  // Reads refs only, so the copy captured by useRegisterSW below stays valid.
  const isIdle = useCallback(async (): Promise<boolean> => {
    const { pathname, editing } = routeRef.current;
    if (!IDLE_ROUTES.has(pathname) || editing) return false;
    if (Date.now() - lastActivityRef.current < IDLE_AFTER_MS) return false;
    if (inputIsFocused() || dialogIsOpen()) return false;
    if (!cartIsEmpty()) return false;
    return syncQueueIsEmpty();
  }, []);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // The new version has taken control of this tab. Without this callback
    // vite-plugin-pwa reloads EVERY open tab right here, including one that
    // is in the middle of a sale, because another tab applied the update.
    // (Registered once, on the first render: refs and setters only.)
    onNeedReload() {
      if (applyingRef.current) {
        window.location.reload();
        return;
      }
      if (pendingReloadRef.current) return;
      pendingReloadRef.current = true;
      void isIdle().then((idle) => {
        if (idle) window.location.reload();
        else setReloadPending(true); // toast + reload once idle (effect below)
      });
    },
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (!registration) return;
      // Long-running POS tabs: look for a new version every hour.
      setInterval(() => {
        if (navigator.onLine === false) return;
        registration.update().catch(() => undefined);
      }, UPDATE_CHECK_MS);
    },
    onRegisterError(error: unknown) {
      console.log('SW registration error', error);
    },
  });

  const applyUpdate = useCallback(() => {
    toast.dismiss(TOAST_ID);
    if (pendingReloadRef.current) {
      // Already installed in this tab: only the reload is left.
      window.location.reload();
      return;
    }
    if (applyingRef.current) return;
    applyingRef.current = true;
    // Activates the new service worker; onNeedReload then reloads this tab.
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  // Track taps and typing, so "idle" means nobody is using the screen.
  useEffect(() => {
    const markActive = () => { lastActivityRef.current = Date.now(); };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));
    return () => events.forEach(evt => window.removeEventListener(evt, markActive));
  }, []);

  useEffect(() => {
    if (!needRefresh && !reloadPending) return;

    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <span className="text-sm font-medium">{reloadPending ? 'Update installed' : 'Update available'}</span>
          <button
            type="button"
            onClick={() => { toast.dismiss(t.id); applyUpdate(); }}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg"
          >
            Reload
          </button>
        </span>
      ),
      { id: TOAST_ID, duration: Infinity }
    );

    let cancelled = false;
    const tryApply = async () => {
      if (cancelled || applyingRef.current) return;
      if (await isIdle()) {
        if (!cancelled) applyUpdate();
      }
    };
    void tryApply();
    const timer = setInterval(() => { void tryApply(); }, IDLE_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [needRefresh, reloadPending, applyUpdate, isIdle]);

  return null;
};

export default PwaUpdatePrompt;
