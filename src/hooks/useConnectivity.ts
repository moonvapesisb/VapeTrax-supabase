import { useState, useEffect, useCallback, useRef } from 'react';

export type ConnectivityStatus = 'online' | 'offline' | 'syncing';

export function useConnectivity() {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const pendingCountRef = useRef(0);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // Supabase JS doesn't have an equivalent global sync hook out-of-the-box
    // so we just rely on browser online/offline and manual reportPendingWrite.
  }, []);

  const reportPendingWrite = useCallback((pending: boolean) => {
    pendingCountRef.current += pending ? 1 : -1;
    if (pendingCountRef.current < 0) pendingCountRef.current = 0;
    setHasPendingWrites(pendingCountRef.current > 0);
  }, []);

  let status: ConnectivityStatus;
  if (!browserOnline) {
    status = 'offline';
  } else if (hasPendingWrites) {
    status = 'syncing';
  } else {
    status = 'online';
  }

  return { status, reportPendingWrite };
}
