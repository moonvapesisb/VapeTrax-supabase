import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

// What the signed-in user may do, in one place. A button the database would refuse
// is never shown as if it worked: it is hidden, or disabled with one of the reasons
// below. Database rules (migration 20261012100000):
//   - deleting or editing a sale (process_reversal): the shop admin only;
//   - settings: every member reads them (invoice branding), the shop admin saves;
//   - personal expenses: the shop admin only;
//   - credits and inventory logs: anyone in the shop adds; nobody edits or deletes;
//   - products, customers, bottles: a delete archives; at most 25 rows per delete.
// "The shop admin" is the account the shop belongs to (private.legacy_is_shop_admin:
// role admin and shopId = the account's own id). A cashier's shopId is the admin's.

export const MAX_DELETE_AT_ONCE = 25;

export const REASONS = {
  deleteSale: 'Only the shop admin can delete or edit a sale.',
  manageProducts: 'Only the shop admin can add, edit or delete products and stock.',
  editExpenses: 'Only the shop admin can edit or delete expenses.',
  settings: 'Only the shop admin can change settings, backups and cashiers.',
  personalExpenses: 'Personal expenses are visible to the shop admin only.',
  historyIsPermanent: 'Entries are permanent: they cannot be edited or deleted. To correct one, add a new entry.',
  deleteCustomers: 'Only the shop admin can delete customers.',
  tooManyToDelete: `At most ${MAX_DELETE_AT_ONCE} can be deleted at once.`,
} as const;

export interface ShopPermissions {
  isAdmin: boolean;
  isCashier: boolean;
  /** The admin the shop belongs to, as the database checks it. */
  isShopAdmin: boolean;
  canDeleteSales: boolean;
  canChangeSettings: boolean;
  canSeePersonalExpenses: boolean;
  /** App rule: products and stock are managed by the admin. */
  canManageProducts: boolean;
  /** App rule: a cashier adds expenses; the admin edits and deletes them. */
  canEditExpenses: boolean;
  /**
   * Anyone in the shop (the database archives the customer). Customers.tsx reads it
   * for the row Delete button, the checkboxes and "Delete Selected": set it to
   * isAdmin to make customer deletes admin-only.
   */
  canDeleteCustomers: boolean;
}

export function permissionsFor(userRole: string | null | undefined, shopId: string | null | undefined, uid: string | null | undefined): ShopPermissions {
  const isAdmin = userRole === 'admin';
  const isCashier = userRole === 'cashier';
  const isShopAdmin = isAdmin && !!shopId && !!uid && shopId === uid;
  return {
    isAdmin,
    isCashier,
    isShopAdmin,
    canDeleteSales: isShopAdmin,
    canChangeSettings: isShopAdmin,
    canSeePersonalExpenses: isShopAdmin,
    canManageProducts: isAdmin,
    canEditExpenses: isAdmin,
    canDeleteCustomers: isAdmin || isCashier,
  };
}

export function useShopPermissions(): ShopPermissions {
  const { userRole, shopId, currentUser } = useAuth();
  const uid = currentUser?.uid ?? null;
  return useMemo(() => permissionsFor(userRole, shopId, uid), [userRole, shopId, uid]);
}
