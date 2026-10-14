import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  RefreshCw,
  X,
  Droplet,
  Droplets,
  Package,
  Receipt,
  Check,
  Split,
  UserPlus
} from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { formatCurrency, cn } from '../lib/utils';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { applyRefillToBottles, compareClosedBottles, computeBottleStatusCounts, getAvailableMl, orderBottlesForRefill, parseBottleSizeMl, type BottleDoc } from '../lib/bottles';
import { buildActorMeta } from '../lib/actor';
import CustomerModal from '../components/customers/CustomerModal';
import { useLocation, useNavigate } from 'react-router-dom';
import { reverseSaleImpact } from '../lib/salesReversal';
import { REFILL_STEP_ML, isValidRefillMl, snapRefillMl, roundRupees } from '../lib/quantities';
import { fetchLiveStock, refreshLocalProducts, refreshLocalBottles, refreshAfterSaleReversal } from '../lib/liveStock';
import { CLIENT_BUILD, getDeviceId } from '../lib/clientInfo';
import Dexie from 'dexie';
import { announceDeleted } from '../lib/liveSync';
import { friendlyError } from '../lib/errors';
import { REASONS, useShopPermissions } from '../lib/permissions';

const CART_KEY = 'vapetrax_cart';

type SplitAmounts = { cash: number; online: number; credit: number };

const toSplitNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeSplit = (value: any): SplitAmounts => ({
  cash: toSplitNumber(value?.cash),
  online: toSplitNumber(value?.online),
  credit: toSplitNumber(value?.credit),
});

// Money is compared in whole paisa so floating-point noise can never make a
// correct split look wrong (or a wrong one look right).
const toPaisa = (rupees: number): number => Math.round(rupees * 100);

/** A sale price: whole rupees above zero. */
const isValidLinePrice = (price: unknown): boolean => {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 && toPaisa(n) % 100 === 0;
};

interface CartItem {
  productId: string;
  productName: string;
  category: string;
  unitPrice: number;
  quantity: number;
  saleType: 'regular' | 'refill' | 'full_bottle';
  refillAmount?: number;
  bottleSize?: number;
}

const NewSale: React.FC = () => {
  const { currentUser, shopId, userRole } = useAuth();
  const { canDeleteSales: canEditSales } = useShopPermissions();
  const location = useLocation();
  const navigate = useNavigate();

  const editSale = location.state?.editSale;
  const isEditing = !!editSale;

  const { products, productsLoading, customers, customersLoading, refetchProducts, refetchCustomers } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (editSale?.items) {
      return editSale.items.map((item: any) => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category || 'unknown',
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        saleType: item.saleType,
        refillAmount: item.refillAmount || undefined,
        bottleSize: item.bottleSize || undefined
      }));
    }
    try {
      const saved = localStorage.getItem(CART_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(editSale?.customerId || null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online' | 'credit' | 'return' | 'split'>(editSale?.paymentMethod || 'cash');
  const [splitAmounts, setSplitAmounts] = useState<SplitAmounts>(() => normalizeSplit(editSale?.splitAmounts));
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [saleDateOverride, setSaleDateOverride] = useState<string>('');

  // The POS cart survives a reload. An old sale being edited is never written
  // there: it would replace the saved cart and come back as a new sale later.
  useEffect(() => {
    if (isEditing) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch { /* storage full or blocked: the cart still works in memory */ }
  }, [cart, isEditing]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [showRefillModal, setShowRefillModal] = useState<{ product: any } | null>(null);
  const [refillAmount, setRefillAmount] = useState<number>(3.0);
  const [refillText, setRefillText] = useState<string>('3');
  const [customRefillPrice, setCustomRefillPrice] = useState<number | ''>('');
  const [refillModalBottles, setRefillModalBottles] = useState<BottleDoc[] | null>(null);
  const REFILL_PRICE_PER_ML = 100;
  const actorMeta = useMemo(() => buildActorMeta({ currentUser, userRole }), [currentUser, userRole]);

  // Show all products initially or filter by search, with out-of-stock sorted to bottom
  const displayProducts = useMemo(() => {
    let filtered = products;
    if (searchTerm) {
      filtered = products.filter(p =>
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    // Sort: in-stock first (by name), then out-of-stock (by name)
    return [...filtered].sort((a, b) => {
      const aInStock = (a.stockQuantity || 0) > 0 ? 0 : 1;
      const bInStock = (b.stockQuantity || 0) > 0 ? 0 : 1;
      if (aInStock !== bInStock) return aInStock - bInStock;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [products, searchTerm]);

  /**
   * Calculates the total amount already reserved in the cart for a specific product.
   * For E-Liquids: returns total reserved MLs across ALL sale types (full_bottle + refill).
   * For Standard products: returns total reserved unit count.
   * @param excludeIndex - optionally exclude a cart item index (for updateQuantity checks)
   */
  const getCartReservedAmount = (productId: string, product: any, excludeIndex?: number): number => {
    const isELiquid = product?.category === 'e-liquid';
    const bottleSizeMl = parseBottleSizeMl(product?.bottleSize, 30);

    return cart.reduce((sum, item, idx) => {
      if (item.productId !== productId) return sum;
      if (excludeIndex !== undefined && idx === excludeIndex) return sum;

      if (isELiquid) {
        // E-Liquid: everything is calculated in ML
        if (item.saleType === 'full_bottle') {
          return sum + (item.quantity * (item.bottleSize || bottleSizeMl));
        }
        if (item.saleType === 'refill') {
          return sum + ((item.refillAmount || 0) * item.quantity);
        }
        return sum;
      } else {
        // Standard products: simple unit count
        return sum + item.quantity;
      }
    }, 0);
  };

  const addToCart = (product: any, type: 'regular' | 'refill' | 'full_bottle', amount?: number, customPrice?: number) => {
    if (product.stockQuantity <= 0) {
      toast.error('Product is out of stock');
      return;
    }

    if (customPrice !== undefined && !isValidLinePrice(customPrice)) {
      toast.error('The price must be a whole number of rupees above 0.');
      return;
    }

    if (type === 'refill' && !isValidRefillMl(amount ?? 0)) {
      toast.error(`Refills are sold in ${REFILL_STEP_ML} ml steps (0.5, 1, 1.5, 2 ...).`);
      return;
    }

    const isELiquid = product.category === 'e-liquid';
    const availableStock = Number(product.stockQuantity) || 0;
    const bottleSizeMl = parseBottleSizeMl(product.bottleSize, 30);

    // --- Cart-wide stock validation (covers ALL sale types including refills) ---
    const reservedAmount = getCartReservedAmount(product.id, product);

    if (isELiquid) {
      // E-Liquid: validate in ML
      const requestedMl = type === 'full_bottle' ? bottleSizeMl : (type === 'refill' ? (amount || 0) : 1);
      if (reservedAmount + requestedMl > availableStock) {
        const remainingMl = Math.max(0, availableStock - reservedAmount);
        toast.error(`Not enough stock. You already have ${reservedAmount}ml in the cart. Only ${remainingMl}ml remaining.`);
        return;
      }
    } else {
      // Standard: validate in units
      if (reservedAmount + 1 > availableStock) {
        toast.error(`Not enough stock. Only ${availableStock} unit(s) available.`);
        return;
      }
    }

    const existingItemIndex = cart.findIndex(item =>
      item.productId === product.id && item.saleType === type && item.refillAmount === amount
    );

    if (existingItemIndex > -1) {
      const newCart = [...cart];
      newCart[existingItemIndex].quantity += 1;
      setCart(newCart);
    } else {
      const refillMl = amount ?? 1;
      setCart([...cart, {
        productId: product.id,
        productName: product.name,
        category: product.category,
        // Refill pricing: use product.pricePerMl if available, otherwise fallback to REFILL_PRICE_PER_ML
        unitPrice: customPrice !== undefined
          ? roundRupees(customPrice)
          : (type === 'refill' ? roundRupees(refillMl * (Number(product.pricePerMl) || REFILL_PRICE_PER_ML)) : roundRupees(Number(product.sellingPrice) || 0)),
        quantity: 1,
        saleType: type,
        refillAmount: type === 'refill' ? refillMl : undefined,
        bottleSize: bottleSizeMl
      }]);
    }
    toast.success(`${product.name} added`);
  };

  const removeFromCart = (index: number) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  const updateQuantity = (index: number, delta: number) => {
    const newCart = [...cart];
    const item = newCart[index];
    const newQty = Math.max(1, item.quantity + delta);

    // --- Cart-wide stock validation on increment ---
    if (delta > 0) {
      const product = products.find(p => p.id === item.productId);
      if (product) {
        const isELiquid = product.category === 'e-liquid';
        const availableStock = Number(product.stockQuantity) || 0;
        const bottleSizeMl = parseBottleSizeMl(product.bottleSize, 30);

        // Reserved amount from OTHER cart items for this product
        const otherReserved = getCartReservedAmount(item.productId, product, index);

        // What THIS item would reserve at the new quantity
        let thisItemReserved: number;
        if (isELiquid) {
          if (item.saleType === 'full_bottle') {
            thisItemReserved = newQty * (item.bottleSize || bottleSizeMl);
          } else if (item.saleType === 'refill') {
            thisItemReserved = (item.refillAmount || 0) * newQty;
          } else {
            thisItemReserved = newQty;
          }
        } else {
          thisItemReserved = newQty;
        }

        if (otherReserved + thisItemReserved > availableStock) {
          const remainingMl = Math.max(0, availableStock - otherReserved);
          toast.error(
            isELiquid
              ? `Cannot add more. Only ${remainingMl}ml remaining for ${item.productName}.`
              : `Cannot add more. Stock limit reached for ${item.productName}.`
          );
          return;
        }
      }
    }

    newCart[index].quantity = newQty;
    setCart(newCart);
  };

  const updateUnitPrice = (index: number, nextUnitPrice: number) => {
    const newCart = [...cart];
    newCart[index].unitPrice = Math.max(0, roundRupees(nextUnitPrice));
    setCart(newCart);
  };

  const subtotal = cart.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0);
  const tax = 0; // configurable later
  const totalAmount = subtotal + tax;

  // Re-checks stock with the server just before selling. The local copy can be
  // out of date (another device, the Stock page), and stock must never go below
  // zero. Takes at most a few seconds; if the server can't be reached, the sale
  // goes ahead offline and the server still refuses to go below zero.
  const verifyStockWithServer = async (): Promise<boolean> => {
    try {
      // The answer also goes into the device copy, through the same rules as every
      // other server row: every unsynced sale on this device (waiting or failed) is
      // still taken off, and a newer live update is never overwritten.
      const productIds = Array.from(new Set<string>(cart.map(i => i.productId)));
      const live = await fetchLiveStock(shopId!, productIds, { store: true });
      if (!live) return true;

      let ok = true;
      // Deleted on another device: the server would take the sale without taking any
      // stock off, so it is stopped here with a plain reason.
      const gone = productIds.filter(id => !live.has(id));
      if (gone.length) {
        const names = [...new Set(cart.filter(i => gone.includes(i.productId)).map(i => i.productName))].join(', ');
        toast.error(`${names}: deleted on another device. Remove it from the cart to continue.`, { duration: 7000 });
        ok = false;
      }
      for (const row of live.values()) {
        const localProduct = products.find(p => p.id === row.id);
        const needed = getCartReservedAmount(row.id, localProduct);
        if (needed > row.available) {
          const unit = localProduct?.category === 'e-liquid' ? 'ml' : 'pcs';
          toast.error(`Not enough stock for ${row.name}: only ${row.available} ${unit} left, but the cart needs ${needed} ${unit}.`, { duration: 7000 });
          ok = false;
        }
      }
      return ok;
    } catch (err) {
      console.warn('[POS] Live stock check failed; the server still enforces stock limits.', err);
      return true;
    }
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    // Checked before anything is changed: an edited old sale may still hold
    // refill amounts like 2.3 ml, which the server no longer accepts.
    const badRefill = cart.find(item => item.saleType === 'refill' && !isValidRefillMl(item.refillAmount ?? 0));
    if (badRefill) {
      toast.error(`${badRefill.productName}: refill of ${badRefill.refillAmount} ml is not allowed. Remove it and add it again in 0.5 ml steps.`, { duration: 7000 });
      return;
    }
    const badQuantity = cart.find(item => !(Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0));
    if (badQuantity) {
      toast.error(`${badQuantity.productName}: quantity ${badQuantity.quantity} is not allowed. Quantities must be whole numbers.`, { duration: 7000 });
      return;
    }
    const badPrice = cart.find(item => !isValidLinePrice(item.unitPrice));
    if (badPrice) {
      toast.error(`${badPrice.productName}: price ${badPrice.unitPrice} is not allowed. Prices must be whole rupees above 0.`, { duration: 7000 });
      return;
    }

    if (paymentMethod === 'credit' && !selectedCustomerId) {
      toast.error('Customer must be selected for credit sales');
      return;
    }

    if (paymentMethod === 'split') {
      const parts: Array<[string, number]> = [
        ['Cash', Number(splitAmounts.cash)],
        ['Online', Number(splitAmounts.online)],
        ['Credit', Number(splitAmounts.credit)],
      ];
      for (const [label, value] of parts) {
        if (!Number.isFinite(value) || value < 0) {
          toast.error(`${label} amount must be zero or more.`);
          return;
        }
        if (toPaisa(value) % 100 !== 0) {
          toast.error(`${label} amount must be whole rupees (no paisa).`);
          return;
        }
      }
      const totalSplitPaisa = parts.reduce((sum, [, value]) => sum + toPaisa(value), 0);
      if (totalSplitPaisa !== toPaisa(totalAmount)) {
        toast.error(`Split amounts must equal total amount (${formatCurrency(totalAmount)}). Current split is ${formatCurrency(totalSplitPaisa / 100)}.`);
        return;
      }
      if (splitAmounts.credit > 0 && !selectedCustomerId) {
        toast.error('Customer must be selected if split includes credit');
        return;
      }
    }

    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait a moment and try again.');
      return;
    }

    // Editing an old sale reverses it on the server first, which only the shop admin
    // may do: never start it for anyone else (nothing would be saved).
    if (isEditing && !canEditSales) {
      toast.error(REASONS.deleteSale);
      return;
    }

    setIsProcessing(true);

    if (!isEditing && navigator.onLine) {
      const stockOk = await verifyStockWithServer();
      if (!stockOk) {
        setIsProcessing(false);
        return;
      }
    }

    try {
      if (isEditing) {
        await reverseSaleImpact(editSale, shopId, actorMeta, true);
        const { error: delError } = await supabase.from('sales').delete().eq('id', editSale.id);
        if (delError) throw new Error(`Failed to remove old sale: ${delError.message}`);
        // The old sale's stock, bottles and udhaar were restored on the server only:
        // bring the device copy up to date before the new sale is worked out.
        announceDeleted('sales', [editSale.id]);
        await refreshAfterSaleReversal(shopId, editSale);
        const editedIds = Array.from(new Set<string>(cart.map(i => i.productId)));
        await refreshLocalProducts(shopId, editedIds);
        await refreshLocalBottles(shopId, cart.filter(i => i.category === 'e-liquid').map(i => i.productId));
      }

      const saleItems = [];
      const inventoryLogs = [];
      const bottleUpdates = [];
      const productUpdates = [];
      const timestampIso = new Date().toISOString();

      for (const item of cart) {
        if (item.saleType === 'refill') {
          const mlNeeded = (item.refillAmount || 0) * item.quantity;
          if (mlNeeded <= 0) throw new Error(`Invalid refill amount for ${item.productName}`);

          const productSnap = await db.products.get(item.productId);
          const bottleSizeMl = parseBottleSizeMl(productSnap?.bottleSize, item.bottleSize || 30);

          const bottlesData = (await db.bottles.where('productId').equals(item.productId).toArray()).filter(b => b.shopId === shopId);
          
          let bottles: BottleDoc[] = (bottlesData || []).map((d: any) => ({
            id: d.id,
            bottleSize: Number(d.bottleSize) || bottleSizeMl,
            remainingMl: Number(d.remainingMl) || 0,
            status: d.status,
            createdAt: d.createdAt,
            openedDate: d.openedDate,
            updatedAt: d.updatedAt
          }));

          let availableMl = getAvailableMl(bottles.filter(b => b.status !== 'sold'));

          if (availableMl < mlNeeded && (productSnap?.stockQuantity || 0) >= mlNeeded) {
            const missingMl = (productSnap?.stockQuantity || 0) - availableMl;
            const missingBottlesCount = Math.ceil(missingMl / bottleSizeMl);
            const newBottlesToInsert = [];
            for (let i = 0; i < missingBottlesCount; i++) {
              newBottlesToInsert.push({
                id: crypto.randomUUID(),
                productId: item.productId,
                shopId,
                bottleSize: bottleSizeMl,
                remainingMl: bottleSizeMl,
                status: 'closed',
                createdAt: timestampIso,
                updatedAt: timestampIso
              });
            }
            if (newBottlesToInsert.length > 0) {
              const insertedBottles = newBottlesToInsert;
              if (insertedBottles) {
                insertedBottles.forEach((d: any) => {
                  bottles.push({
                    id: d.id,
                    bottleSize: Number(d.bottleSize) || bottleSizeMl,
                    remainingMl: Number(d.remainingMl) || 0,
                    status: d.status,
                    createdAt: d.createdAt,
                    openedDate: d.openedDate,
                    updatedAt: d.updatedAt
                  });
                });
                availableMl = getAvailableMl(bottles.filter(b => b.status !== 'sold'));
              }
            }
          }

          if (availableMl < mlNeeded) throw new Error(`Insufficient ml for ${item.productName}. Needed ${mlNeeded}ml, available ${availableMl}ml.`);

          const ordered = orderBottlesForRefill(bottles);
          const { plans, mlApplied } = applyRefillToBottles({ orderedBottles: ordered, mlNeeded, openedDateValue: timestampIso });
          if (mlApplied !== mlNeeded) throw new Error(`Unable to allocate full refill for ${item.productName}. Allocated ${mlApplied}ml of ${mlNeeded}ml.`);

          const bottleChanges = [];
          for (const p of plans) {
            bottleUpdates.push({
              id: p.bottleId,
              productId: item.productId,
              bottleSize: bottleSizeMl,
              remainingMl: p.after.remainingMl,
              status: p.after.status,
              openedDate: p.after.openedDate || null,
              updatedAt: timestampIso
            });
            bottleChanges.push({
              bottleId: p.bottleId,
              beforeRemainingMl: p.before.remainingMl,
              afterRemainingMl: p.after.remainingMl,
              beforeStatus: p.before.status,
              afterStatus: p.after.status,
              beforeOpenedDate: p.before.openedDate || null,
              afterOpenedDate: null
            });
          }

          productUpdates.push({ id: item.productId, deduction: mlNeeded });

          // productSnap and bottleSizeMl are already fetched above
          const itemCostPrice = (productSnap?.costPrice || 0) / bottleSizeMl * (item.refillAmount || 0);
          const profit = (item.unitPrice * item.quantity) - (itemCostPrice * item.quantity);
          
          saleItems.push({
            productId: item.productId, productName: item.productName, quantity: item.quantity,
            unitPrice: item.unitPrice, costPrice: itemCostPrice, totalPrice: item.unitPrice * item.quantity,
            totalCost: itemCostPrice * item.quantity, profit, saleType: item.saleType,
            refillAmount: item.refillAmount || null, bottleSize: bottleSizeMl, bottleChanges
          });

          inventoryLogs.push({
            id: crypto.randomUUID(), shopId, productId: item.productId, productName: item.productName,
            action: 'sale', type: 'sale', mlChange: -mlNeeded, change: -mlNeeded, quantityChange: 0,
            newStockMl: (Number(productSnap?.stockQuantity) || 0) - mlNeeded,
            newStock: (Number(productSnap?.stockQuantity) || 0) - mlNeeded,
            reason: `Sale: ${item.saleType}`, notes: `Refill ${item.refillAmount}ml x ${item.quantity}`,
            ...actorMeta, createdAt: timestampIso, createdAtClient: timestampIso
          });

        } else if (item.saleType === 'full_bottle') {
          const productSnap = await db.products.get(item.productId);
          const bottleSizeMl = parseBottleSizeMl(productSnap?.bottleSize, item.bottleSize || 30);
          
          let closedBottles = (await db.bottles.where('productId').equals(item.productId).toArray()).filter(b => b.shopId === shopId && b.status === 'closed').sort(compareClosedBottles).slice(0, item.quantity);
          
          if ((!closedBottles || closedBottles.length < item.quantity) && (productSnap?.stockQuantity || 0) >= (bottleSizeMl * item.quantity)) {
            const neededNew = item.quantity - (closedBottles ? closedBottles.length : 0);
            const newBottlesToInsert = [];
            for (let i = 0; i < neededNew; i++) {
              newBottlesToInsert.push({
                id: crypto.randomUUID(),
                productId: item.productId,
                shopId,
                bottleSize: bottleSizeMl,
                remainingMl: bottleSizeMl,
                status: 'closed',
                createdAt: timestampIso,
                updatedAt: timestampIso
              });
            }
            const insertedBottles = newBottlesToInsert;
            if (insertedBottles) {
              closedBottles = [...(closedBottles || []), ...insertedBottles];
            }
          }

          if (!closedBottles || closedBottles.length < item.quantity) throw new Error(`Not enough full bottles for ${item.productName}`);

          const bottleChanges = [];
          for (const bottle of closedBottles) {
            bottleUpdates.push({
              id: bottle.id, productId: item.productId, bottleSize: bottleSizeMl, status: 'sold', remainingMl: 0, updatedAt: timestampIso
            });
            bottleChanges.push({
              bottleId: bottle.id, beforeRemainingMl: Number(bottle.remainingMl) || bottleSizeMl,
              afterRemainingMl: 0, beforeStatus: bottle.status || 'closed', afterStatus: 'sold',
              beforeOpenedDate: bottle.openedDate || null, afterOpenedDate: bottle.openedDate || null
            });
          }

          productUpdates.push({ id: item.productId, deduction: bottleSizeMl * item.quantity });
          
          const itemCostPrice = Number(productSnap?.costPrice) || 0;
          const profit = (item.unitPrice * item.quantity) - (itemCostPrice * item.quantity);
          
          saleItems.push({
            productId: item.productId, productName: item.productName, quantity: item.quantity,
            unitPrice: item.unitPrice, costPrice: itemCostPrice, totalPrice: item.unitPrice * item.quantity,
            totalCost: itemCostPrice * item.quantity, profit, saleType: item.saleType,
            refillAmount: null, bottleSize: bottleSizeMl, bottleChanges
          });

          inventoryLogs.push({
            id: crypto.randomUUID(), shopId, productId: item.productId, productName: item.productName,
            action: 'sale', type: 'sale', mlChange: -(bottleSizeMl * item.quantity), change: -(bottleSizeMl * item.quantity),
            quantityChange: -item.quantity, newStockMl: (Number(productSnap?.stockQuantity) || 0) - (bottleSizeMl * item.quantity),
            newStock: (Number(productSnap?.stockQuantity) || 0) - (bottleSizeMl * item.quantity),
            reason: `Sale: ${item.saleType}`, notes: `Full bottle x ${item.quantity}`,
            ...actorMeta, createdAt: timestampIso, createdAtClient: timestampIso
          });
        } else {
          const productSnap = await db.products.get(item.productId);
          productUpdates.push({ id: item.productId, deduction: item.quantity });
          
          const itemCostPrice = Number(productSnap?.costPrice) || 0;
          const profit = (item.unitPrice * item.quantity) - (itemCostPrice * item.quantity);
          
          saleItems.push({
            productId: item.productId, productName: item.productName, quantity: item.quantity,
            unitPrice: item.unitPrice, costPrice: itemCostPrice, totalPrice: item.unitPrice * item.quantity,
            totalCost: itemCostPrice * item.quantity, profit, saleType: item.saleType, refillAmount: null
          });

          inventoryLogs.push({
            id: crypto.randomUUID(), shopId, productId: item.productId, productName: item.productName,
            action: 'sale', type: 'sale', change: -item.quantity, quantityChange: -item.quantity,
            newStock: (Number(productSnap?.stockQuantity) || 0) - item.quantity,
            reason: `Sale: ${item.saleType}`, notes: `Sale: ${item.saleType}`,
            ...actorMeta, createdAt: timestampIso, createdAtClient: timestampIso
          });
        }
      }

      const totalCOGS = saleItems.reduce((acc, item) => acc + (item.totalCost || 0), 0);
      const totalProfit = totalAmount - totalCOGS;

      let finalSaleDateIso = timestampIso;
      let finalSaleDateClientIso = timestampIso;

      const extractDate = (val: any): Date => {
        if (!val) return new Date();
        if (typeof val.toDate === 'function') return val.toDate();
        if (val.seconds !== undefined) return new Date(val.seconds * 1000);
        return new Date(val);
      };

      if (isEditing) {
        finalSaleDateIso = extractDate(editSale.saleDate).toISOString();
        finalSaleDateClientIso = extractDate(editSale.saleDateClient).toISOString();
      } else if (saleDateOverride) {
        const d = new Date();
        const [y, m, day] = saleDateOverride.split('-').map(Number);
        d.setFullYear(y, m - 1, day);
        finalSaleDateIso = d.toISOString();
        finalSaleDateClientIso = d.toISOString();
      }

      const saleId = isEditing ? editSale.id : crypto.randomUUID();
      const finalSplit = paymentMethod === 'split' ? normalizeSplit(splitAmounts) : null;
      const saleData: any = {
        id: saleId, customerId: selectedCustomerId, shopId, totalAmount, totalCOGS, totalProfit,
        paymentMethod, items: saleItems, ...actorMeta, splitAmounts: finalSplit,
        saleDate: finalSaleDateIso, saleDateClient: finalSaleDateClientIso,
        createdAt: isEditing ? editSale.createdAt : timestampIso,
        updatedAt: timestampIso,
        // Which app build and device sent this sale (counted per build on the server).
        clientBuild: CLIENT_BUILD,
        deviceId: getDeviceId()
      };
      
      let creditIncrement = 0;
      if (paymentMethod === 'credit') creditIncrement = totalAmount;
      else if (finalSplit) creditIncrement = finalSplit.credit;

      await db.transaction('rw', db.products, db.bottles, db.syncQueue, db.customers, async () => {
        for (const up of productUpdates) {
          const prod = await db.products.get(up.id);
          if (prod) await db.products.update(up.id, { stockQuantity: Math.max(0, (Number(prod.stockQuantity) || 0) - up.deduction) });
        }
        for (const up of bottleUpdates) {
          const bot = await db.bottles.get(up.id);
          if (bot) await db.bottles.update(up.id, { remainingMl: up.remainingMl, status: up.status, openedDate: up.openedDate || bot.openedDate });
        }
        if (selectedCustomerId && creditIncrement > 0) {
          const cust = await db.customers.get(selectedCustomerId);
          if (cust) await db.customers.update(selectedCustomerId, { creditBalance: (Number(cust.creditBalance) || 0) + creditIncrement });
        }
        await db.syncQueue.add({
          type: 'process_checkout',
          payload: {
            p_shop_id: shopId,
            p_sale_data: saleData,
            p_inventory_logs: inventoryLogs,
            p_bottle_updates: bottleUpdates,
            p_product_updates: productUpdates,
            p_customer_id: selectedCustomerId,
            p_credit_increment: creditIncrement
          },
          status: 'pending',
          createdAt: timestampIso,
          retryCount: 0
        });
      });

      setCart([]);
      setSelectedCustomerId(null);
      setPaymentMethod('cash');
      setSplitAmounts({ cash: 0, online: 0, credit: 0 });
      setSaleDateOverride('');
      setIsProcessing(false);
      setShowSuccessOverlay(true);
      setTimeout(() => {
        setShowSuccessOverlay(false);
        if (isEditing) navigate('/sales');
      }, 1200);

    } catch (error: any) {
      console.error('Sale completion error:', error);
      // A failure of this device's own storage: the sale was not saved anywhere.
      toast.error(error instanceof Dexie.DexieError
        ? 'This device could not save the sale, so nothing was saved. The cart is kept: reload the app and press Generate Bill again.'
        : friendlyError(error, 'The sale could not be completed. Please try again.'), { duration: 7000 });
      setIsProcessing(false);
    }
  };

  if (productsLoading || customersLoading) return <LoadingSpinner />;

  // The refill amount the modal will actually add (typed text snapped to 0.5 ml).
  const refillPreviewMl = snapRefillMl(parseFloat(refillText));

  return (
    <div className="flex flex-col xl:grid xl:grid-cols-[1fr_380px] gap-6 w-full h-auto xl:h-[calc(100vh-112px)] xl:min-h-[700px] animate-in fade-in duration-500 pb-2">
      {showSuccessOverlay && (
        <div className="fixed bottom-6 right-6 z-[200] pointer-events-none animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="bg-white border border-slate-100 rounded-[20px] p-5 flex items-center gap-4 shadow-[0_10px_30px_rgba(0,0,0,0.08)] pointer-events-auto max-w-sm">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0 shadow-inner shadow-emerald-500/10">
              <Check size={24} strokeWidth={3} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Sale Completed!</h2>
              <p className="text-slate-400 font-medium text-xs">Your cart has been cleared.</p>
            </div>
          </div>
        </div>
      )}
      {/* Left Panel: Product Selection */}
      <div className="flex flex-col gap-6 min-w-0 xl:h-full overflow-visible xl:overflow-hidden order-2 xl:order-1">
        {/* Header */}
        <div className="shrink-0 pl-14 md:pl-0">
          <h1 className="text-[32px] font-extrabold text-slate-900 tracking-tight">
            {isEditing ? 'Edit Bill' : 'Billing'}
          </h1>
          <p className="text-slate-400 mt-1 text-base">
            {isEditing ? `Modifying Sale #${editSale.id.slice(-6).toUpperCase()}` : 'Select products to generate a new bill.'}
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative shrink-0">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
          <input
            type="text"
            placeholder="Search by name or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl text-slate-900 text-lg placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all shadow-sm h-16"
          />
        </div>

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 xl:overflow-y-auto pb-6 xl:pr-2 xl:-mr-2 style-scrollbar">
          {displayProducts.map((product) => {
            const isOutOfStock = product.stockQuantity <= 0;
            const isELiquid = product.category === 'e-liquid';

            return (
              <div
                key={product.id}
                className={cn(
                  "bg-white border rounded-[24px] p-6 transition-all hover:shadow-lg group relative flex flex-col",
                  isOutOfStock
                    ? "border-slate-200 opacity-60"
                    : "border-slate-200 hover:border-violet-300"
                )}
              >
                {/* Stock Badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm",
                    isOutOfStock ? "bg-slate-100 text-slate-400" :
                      product.category === 'device' ? "bg-blue-100 text-blue-600" :
                        product.category === 'coil' ? "bg-emerald-100 text-emerald-600" :
                          "bg-violet-100 text-violet-600"
                  )}>
                    {isELiquid ? <Droplet size={24} /> : <Package size={24} />}
                  </div>
                  <span className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold tracking-wider",
                    isOutOfStock ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {isELiquid
                      ? (() => {
                        const bSize = parseBottleSizeMl(product.bottleSize, 30);
                        const bottles = Math.floor((product.stockQuantity || 0) / bSize);
                        const ml = Math.round((product.stockQuantity || 0) % bSize);
                        return `${bottles} bottle ${ml}ml left`;
                      })()
                      : `${product.stockQuantity} Left`}
                  </span>
                </div>

                <div className="flex-1">
                  {/* Product Details */}
                  <h3 className="text-xl font-bold text-slate-900 mb-1 line-clamp-2 leading-tight">{product.name}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">{product.category}</p>
                </div>

                {/* Price & Action */}
                <div className="flex items-end justify-between mt-auto">
                  <p className={cn(
                    "text-2xl font-extrabold tracking-tight",
                    isOutOfStock ? "text-slate-400" : "text-violet-600"
                  )}>
                    {formatCurrency(product.sellingPrice)}
                  </p>

                  {isELiquid ? (
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          setRefillModalBottles(null);
                          setRefillAmount(3);
                          setRefillText('3');
                          setCustomRefillPrice('');
                          setShowRefillModal({ product });
                          try {
                            if (!shopId) return;
                            const bottlesData = (await db.bottles.where('productId').equals(product.id).toArray()).filter(b => b.shopId === shopId);
                            const bottles: BottleDoc[] = (bottlesData || []).map(d => {
                              return {
                                id: d.id,
                                bottleSize: Number(d.bottleSize) || parseBottleSizeMl(product.bottleSize, 30),
                                remainingMl: Number(d.remainingMl) || 0,
                                status: d.status as any,
                                createdAt: d.createdAt,
                                openedDate: d.openedDate,
                                updatedAt: d.updatedAt
                              };
                            });
                            setRefillModalBottles(bottles);
                          } catch {
                            setRefillModalBottles(null);
                          }
                        }}
                        disabled={isOutOfStock}
                        className="w-12 h-12 flex items-center justify-center bg-violet-50 text-violet-600 hover:bg-violet-600 hover:text-white rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-md active:scale-95"
                        title="Refill"
                      >
                        <Droplets size={22} />
                      </button>
                      <button
                        onClick={() => addToCart(product, 'full_bottle')}
                        disabled={isOutOfStock}
                        className="w-12 h-12 flex items-center justify-center bg-slate-50 text-slate-600 hover:bg-violet-600 hover:text-white rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-md active:scale-95"
                        title="Full Bottle"
                      >
                        <Plus size={22} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => addToCart(product, 'regular')}
                      disabled={isOutOfStock}
                      className="w-12 h-12 flex items-center justify-center bg-slate-50 text-slate-600 hover:bg-violet-600 hover:text-white hover:shadow-md rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                      title="Add to cart"
                    >
                      <Plus size={22} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {displayProducts.length === 0 && (
            <div className="col-span-full py-24 text-center text-slate-400 flex flex-col items-center">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6 border border-slate-100 shadow-sm">
                <Package size={40} className="text-slate-300" />
              </div>
              <p className="text-xl font-bold text-slate-500">No products found</p>
              <p className="text-slate-400 mt-2">Try adjusting your search terms.</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Cart & Checkout */}
      <div className="flex flex-col bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm h-auto xl:h-full min-h-0 order-1 xl:order-2">
        {/* Cart Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
              <ShoppingCart size={20} />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Current Order</h2>
          </div>
          <span className="bg-violet-600 text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm">
            {cart.reduce((acc, i) => acc + i.quantity, 0)} Items
          </span>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 style-scrollbar max-h-[50vh] xl:max-h-none">
          {cart.length > 0 ? (
            cart.map((item, index) => (
              <div key={index} className="bg-white p-3.5 rounded-2xl border border-slate-100 flex flex-col gap-2.5 shadow-sm group hover:border-violet-200 transition-all">
                {/* Product Name - Top Row */}
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-900 leading-tight block">{item.productName}</p>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                    {item.saleType.replace('_', ' ')} {item.refillAmount ? `Ã¢â‚¬Â¢ ${item.refillAmount}ml` : ''}
                  </p>
                </div>

                {/* Bottom Row: Actions & Price */}
                <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-50">
                  <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1 border border-slate-100/50">
                    <button
                      onClick={() => updateQuantity(index, -1)}
                      className="w-8 h-8 flex items-center justify-center hover:bg-white rounded-lg text-slate-600 transition-all hover:shadow-sm"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="text-sm font-bold text-slate-900 min-w-[20px] text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(index, 1)}
                      className="w-8 h-8 flex items-center justify-center hover:bg-white rounded-lg text-slate-600 transition-all hover:shadow-sm"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={item.unitPrice}
                        onChange={(e) => updateUnitPrice(index, parseFloat(e.target.value) || 0)}
                        className="w-[90px] text-right px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-900 font-bold text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all touch-manipulation"
                      />
                      <p className="text-sm font-bold text-violet-600 mt-0.5">{formatCurrency(item.unitPrice * item.quantity)}</p>
                    </div>
                    <button
                      onClick={() => removeFromCart(index)}
                      className="text-slate-300 hover:text-rose-500 p-1.5 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 border-2 border-dashed border-slate-200">
                <ShoppingCart size={40} className="text-slate-300" />
              </div>
              <p className="text-lg font-bold text-slate-600">Your cart is empty.</p>
              <p className="text-base text-slate-400 mt-2 text-center max-w-[200px]">Select products to start building an order.</p>
            </div>
          )}
        </div>

        {/* Checkout Section - Sticky Bottom */}
        <div className="shrink-0 sticky bottom-0 p-3.5 border-t border-slate-100 space-y-3.5 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 z-10">
          {/* Customer & Payment Options */}
          <div className="flex flex-col gap-3">
            {/* Customer Dropdown */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                Customer
              </label>
              <div className="flex items-center bg-white border border-slate-200 rounded-2xl p-1 pr-1.5 focus-within:ring-4 focus-within:ring-violet-500/10 focus-within:border-violet-300 transition-all shadow-sm">
                <select
                  value={selectedCustomerId || ''}
                  onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                  className="flex-1 bg-transparent border-0 px-3 py-2 text-sm text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer outline-none"
                >
                  <option value="">Walk-in Customer</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(true)}
                  className="flex items-center justify-center p-2 bg-violet-100/60 hover:bg-violet-100 text-violet-600 rounded-xl transition-all cursor-pointer active:scale-95 shrink-0"
                  title="Add New Customer"
                >
                  <UserPlus size={18} />
                </button>
              </div>
            </div>

            {/* Sale Date Override */}
            {!isEditing && (
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                  Sale Date (Optional)
                </label>
                <div className="flex items-center bg-white border border-slate-200 rounded-2xl p-1 focus-within:ring-4 focus-within:ring-violet-500/10 focus-within:border-violet-300 transition-all shadow-sm">
                  <input
                    type="date"
                    value={saleDateOverride}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSaleDateOverride(e.target.value)}
                    className="flex-1 bg-transparent border-0 px-3 py-2 text-sm text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer outline-none w-full"
                  />
                  {saleDateOverride && (
                    <button
                      type="button"
                      onClick={() => setSaleDateOverride('')}
                      className="p-2 text-slate-400 hover:text-rose-500 rounded-xl transition-all"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Payment Method Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                Payment Method
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['cash', 'online', 'credit', 'split'] as const).map(method => {
                  const isActive = paymentMethod === method;
                  let activeStyles = "";
                  let inactiveIconColor = "";
                  let activeIconColor = "";
                  
                  if (method === 'cash') {
                    activeStyles = "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-[0_2px_8px_-2px_rgba(16,185,129,0.25)]";
                    activeIconColor = "text-emerald-600";
                    inactiveIconColor = "text-emerald-500";
                  } else if (method === 'online') {
                    activeStyles = "bg-blue-50 border-blue-500 text-blue-700 shadow-[0_2px_8px_-2px_rgba(59,130,246,0.25)]";
                    activeIconColor = "text-blue-600";
                    inactiveIconColor = "text-blue-500";
                  } else if (method === 'credit') {
                    activeStyles = "bg-amber-50 border-amber-500 text-amber-700 shadow-[0_2px_8px_-2px_rgba(245,158,11,0.25)]";
                    activeIconColor = "text-amber-600";
                    inactiveIconColor = "text-amber-500";
                  } else { // split
                    activeStyles = "bg-violet-50 border-violet-500 text-violet-700 shadow-[0_2px_8px_-2px_rgba(139,92,246,0.25)]";
                    activeIconColor = "text-violet-600";
                    inactiveIconColor = "text-slate-600";
                  }

                  return (
                    <button
                      key={method}
                      onClick={() => setPaymentMethod(method)}
                      type="button"
                      className={cn(
                        "rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-1.5 py-2.5 px-1 transition-all border-2 active:scale-95 duration-200 cursor-pointer",
                        isActive 
                          ? activeStyles 
                          : "bg-white border-slate-100 text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                      )}
                    >
                      {method === 'cash' && <Banknote size={20} className={isActive ? activeIconColor : inactiveIconColor} />}
                      {method === 'online' && <RefreshCw size={20} className={isActive ? activeIconColor : inactiveIconColor} />}
                      {method === 'credit' && <CreditCard size={20} className={isActive ? activeIconColor : inactiveIconColor} />}
                      {method === 'split' && <Split size={20} className={isActive ? activeIconColor : inactiveIconColor} />}
                      <span className="capitalize tracking-wide">{method}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {paymentMethod === 'split' && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2.5 animate-in slide-in-from-top-2 duration-300">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Split Payment Details</h4>
              
              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center"><Banknote size={16} /></div> 
                  CASH
                </div>
                <input 
                  type="number" 
                  min="0"
                  value={splitAmounts.cash || ''}
                  step={1}
                  inputMode="numeric"
                  onChange={e => setSplitAmounts(prev => ({ ...prev, cash: parseFloat(e.target.value) || 0 }))}
                  onBlur={() => setSplitAmounts(prev => ({ ...prev, cash: roundRupees(prev.cash) }))}
                  className="w-32 text-right bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  placeholder="0"
                />
              </div>

              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center"><RefreshCw size={16} /></div> 
                  ONLINE
                </div>
                <input 
                  type="number" 
                  min="0"
                  value={splitAmounts.online || ''}
                  step={1}
                  inputMode="numeric"
                  onChange={e => setSplitAmounts(prev => ({ ...prev, online: parseFloat(e.target.value) || 0 }))}
                  onBlur={() => setSplitAmounts(prev => ({ ...prev, online: roundRupees(prev.online) }))}
                  className="w-32 text-right bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  placeholder="0"
                />
              </div>

              <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center"><CreditCard size={16} /></div> 
                  CREDIT
                </div>
                <input 
                  type="number" 
                  min="0"
                  value={splitAmounts.credit || ''}
                  step={1}
                  inputMode="numeric"
                  onChange={e => setSplitAmounts(prev => ({ ...prev, credit: parseFloat(e.target.value) || 0 }))}
                  onBlur={() => setSplitAmounts(prev => ({ ...prev, credit: roundRupees(prev.credit) }))}
                  className="w-32 text-right bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  placeholder="0"
                />
              </div>

              <div className="flex justify-between items-center pt-3 pb-1 border-t border-slate-200 mt-2">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Split</span>
                <span className={cn(
                  "font-black text-lg tracking-tight",
                  toPaisa(splitAmounts.cash) + toPaisa(splitAmounts.online) + toPaisa(splitAmounts.credit) === toPaisa(totalAmount) 
                    ? "text-emerald-600" 
                    : "text-rose-500"
                )}>
                  {formatCurrency(splitAmounts.cash + splitAmounts.online + splitAmounts.credit)}
                </span>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex justify-between items-end">
              <span className="text-xl font-black text-slate-900 mb-[2px]">Total</span>
              <span className="text-[32px] leading-none font-black text-violet-600 tracking-tight">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {/* Generate Bill Button */}
          <button
            onClick={handleCompleteSale}
            disabled={isProcessing || cart.length === 0}
            className="w-full h-14 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-[20px] shadow-[0_8px_20px_-6px_rgba(139,92,246,0.5)] hover:shadow-[0_12px_24px_-8px_rgba(139,92,246,0.6)] focus:ring-4 focus:ring-violet-500/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-3 text-lg"
          >
            {isProcessing ? (
              <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                <Receipt size={24} />
                {isEditing ? 'Update Bill' : 'Generate Bill'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Refill Modal */}
      {showRefillModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl animate-in zoom-in duration-300 overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">E-Liquid Refill</h2>
              <button onClick={() => setShowRefillModal(null)} className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 transition-colors focus:ring-2 focus:ring-violet-500/20 outline-none"><X size={24} /></button>
            </div>
            <div className="p-8 space-y-8">
              <div className="text-center">
                <h3 className="text-2xl font-bold text-slate-900 mb-3">{showRefillModal.product.name}</h3>
                <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-50 rounded-full text-violet-600 font-bold text-sm uppercase tracking-widest shadow-sm">
                  <Droplets size={18} />
                  {showRefillModal.product.stockQuantity}ml Available
                </div>
                {refillModalBottles && (
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {(() => {
                      const counts = computeBottleStatusCounts(refillModalBottles);
                      return (
                        <>
                          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Closed</p>
                            <p className="text-xl font-black text-emerald-700">{counts.closed}</p>
                          </div>
                          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Opened</p>
                            <p className="text-xl font-black text-amber-700">{counts.opened}</p>
                          </div>
                          <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600">Empty</p>
                            <p className="text-xl font-black text-rose-700">{counts.empty}</p>
                          </div>
                          <div className="bg-sky-50 border border-sky-100 rounded-xl p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Sold</p>
                            <p className="text-xl font-black text-sky-700">{counts.sold}</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Refill Amount (ml)</label>
                <div className="grid grid-cols-3 gap-4">
                  {[1, 2, 3].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setRefillAmount(val);
                        setRefillText(String(val));
                        setCustomRefillPrice('');
                      }}
                      className={cn(
                        "py-5 rounded-[20px] border-2 text-xl font-black transition-all focus:outline-none focus:border-violet-400",
                        refillPreviewMl === val
                          ? "bg-violet-600 border-violet-600 text-white shadow-lg shadow-violet-600/30 scale-105"
                          : "bg-white border-slate-100 text-slate-500 hover:border-violet-200 hover:bg-violet-50 active:scale-95"
                      )}
                    >
                      {val}ml
                    </button>
                  ))}
                </div>
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Decrease by 0.5 ml"
                    onClick={() => {
                      const next = Math.max(REFILL_STEP_ML, snapRefillMl(parseFloat(refillText)) - REFILL_STEP_ML);
                      setRefillAmount(next);
                      setRefillText(String(next));
                      setCustomRefillPrice('');
                    }}
                    className="w-12 h-12 shrink-0 flex items-center justify-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-600 hover:bg-violet-50 hover:text-violet-600 transition-all"
                  >
                    <Minus size={18} />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={REFILL_STEP_ML}
                    step={REFILL_STEP_ML}
                    value={refillText}
                    aria-label="Refill amount in ml"
                    onChange={(e) => {
                      setRefillText(e.target.value);
                      const typed = parseFloat(e.target.value);
                      if (isValidRefillMl(typed)) setRefillAmount(typed);
                      setCustomRefillPrice('');
                    }}
                    onBlur={() => {
                      const typed = parseFloat(refillText);
                      const snapped = snapRefillMl(typed);
                      if (typed !== snapped) toast(`Refills are sold in 0.5 ml steps. Set to ${snapped} ml.`, { id: 'refill-step' });
                      setRefillAmount(snapped);
                      setRefillText(String(snapped));
                    }}
                    className="flex-1 min-w-0 text-center px-4 py-3 bg-white border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-300 transition-all shadow-sm"
                    placeholder="e.g. 2.5"
                  />
                  <button
                    type="button"
                    aria-label="Increase by 0.5 ml"
                    onClick={() => {
                      const next = snapRefillMl(parseFloat(refillText)) + REFILL_STEP_ML;
                      setRefillAmount(next);
                      setRefillText(String(next));
                      setCustomRefillPrice('');
                    }}
                    className="w-12 h-12 shrink-0 flex items-center justify-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-600 hover:bg-violet-50 hover:text-violet-600 transition-all"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                <p className="text-xs text-slate-400">Refills are sold in 0.5 ml steps: 0.5, 1, 1.5, 2 ...</p>
              </div>

              <div className="p-5 bg-violet-50/50 rounded-2xl border border-violet-100 flex justify-between items-center">
                <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Total Price</span>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-violet-400">Rs</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    aria-label="Refill price in rupees"
                    value={customRefillPrice === '' ? roundRupees(refillPreviewMl * (Number(showRefillModal.product.pricePerMl) || REFILL_PRICE_PER_ML)) : customRefillPrice}
                    onChange={(e) => setCustomRefillPrice(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    onBlur={() => { if (customRefillPrice !== '') setCustomRefillPrice(roundRupees(Number(customRefillPrice))); }}
                    className="w-24 text-right px-3 py-2 bg-white border border-violet-200 rounded-xl text-violet-600 text-2xl font-black focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </div>
              </div>

              <button
                onClick={() => {
                  // Read the typed text directly: a click can arrive before the blur snap re-renders.
                  const typed = parseFloat(refillText);
                  const ml = snapRefillMl(typed);
                  if (!isValidRefillMl(typed)) {
                    // Show the corrected amount and price first; the next tap adds it.
                    setRefillAmount(ml);
                    setRefillText(String(ml));
                    setCustomRefillPrice('');
                    toast(`Refills are sold in 0.5 ml steps. Changed to ${ml} ml; check the price and tap Add again.`, { id: 'refill-step' });
                    return;
                  }
                  const finalPrice = customRefillPrice === ''
                    ? roundRupees(ml * (Number(showRefillModal.product.pricePerMl) || REFILL_PRICE_PER_ML))
                    : roundRupees(Number(customRefillPrice));
                  if (!isValidLinePrice(finalPrice)) {
                    toast.error('The refill price must be a whole number of rupees above 0.');
                    return;
                  }
                  addToCart(showRefillModal.product, 'refill', ml, finalPrice);
                  setShowRefillModal(null);
                }}
                className="w-full h-16 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-[20px] shadow-[0_8px_20px_-6px_rgba(139,92,246,0.5)] transition-all active:scale-[0.98] text-lg focus:ring-4 focus:ring-violet-500/30 outline-none"
              >
                Add Refill to Cart
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddCustomerModal && (
        <CustomerModal
          onClose={() => setShowAddCustomerModal(false)}
          onSuccess={(newCustomerId) => {
            setSelectedCustomerId(newCustomerId);
          }}
        />
      )}
    </div>
  );
};

export default NewSale;








