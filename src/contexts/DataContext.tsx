import React, { createContext, useContext, ReactNode, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { syncCloudToLocal } from '../lib/sync';
import { startLiveSync } from '../lib/liveSync';

interface DataContextType {
  products: any[];
  productsLoading: boolean;
  customers: any[];
  customersLoading: boolean;
  refetchProducts: () => void;
  refetchCustomers: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { shopId, authStatus, currentUser } = useAuth();

  // Live updates for this shop (one channel, liveSync.ts) while there is a live
  // session. It also catches up the device copy (products, bottles, customers) as
  // soon as it connects, again after every reconnect (coming back online included),
  // and after a short wait if it cannot connect: in full at start and every few hours,
  // otherwise only the rows that changed. A catch-up that fails is tried again until
  // one succeeds. It stops on logout and on shop change.
  // Without a live session (offline start) the device copy is used as it is, and the
  // sync queue still sends sales whenever it can.
  const liveSession = authStatus === 'ready' && !!currentUser;
  useEffect(() => {
    if (!shopId || !liveSession) return;
    return startLiveSync(shopId);
  }, [shopId, liveSession]);

  // Read purely from Local DB (Dexie)
  const products = useLiveQuery(() => db.products.where('shopId').equals(shopId || '').toArray(), [shopId]);
  const customers = useLiveQuery(() => db.customers.where('shopId').equals(shopId || '').toArray(), [shopId]);

  const productsLoading = products === undefined;
  const customersLoading = customers === undefined;

  // Full re-reads, for when a write's result could not be checked. Products bring
  // their bottles along: the POS works out refills from both.
  const refetchProducts = () => { if (shopId) syncCloudToLocal(shopId, ['products', 'bottles']); };
  const refetchCustomers = () => { if (shopId) syncCloudToLocal(shopId, ['customers']); };

  return (
    <DataContext.Provider value={{
      products: products || [],
      productsLoading,
      customers: customers || [],
      customersLoading,
      refetchProducts,
      refetchCustomers
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
