import React, { useEffect, useState, useMemo } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  ArrowUpDown,
  AlertTriangle,
  X
} from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { formatCurrency, cn } from '../lib/utils';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { supabase } from '../lib/supabase';
import { fetchLiveStock, refreshLocalProducts, refreshLocalBottles, removeLocalRows } from '../lib/liveStock';
import { roundRupees } from '../lib/quantities';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { computeBottleStatusCounts, getAvailableMl, parseBottleSizeMl, type BottleDoc } from '../lib/bottles';
import { buildActorMeta } from '../lib/actor';
import ConfirmBulkDeleteModal from '../components/ui/ConfirmBulkDeleteModal';
import { reauthenticateForSensitiveAction, requiresPasswordReauth } from '../lib/secureAction';
import { announceDeleted, notifyTableChanged } from '../lib/liveSync';
import { useTableChanged } from '../hooks/useTableChanged';
import { MAX_DELETE_AT_ONCE, REASONS } from '../lib/permissions';

/** Sheet "Price" column = purchase / cost; selling = purchase Ã— (1 + 65%) */
const IMPORT_SELLING_MULTIPLIER = 1.65;

/** Runs one write and throws if the server refused it, so a failed save never shows success. */
const mustWrite = async (what: string, request: PromiseLike<{ error: any }>) => {
  const { error } = await request;
  if (error) throw Object.assign(new Error(`${what} failed: ${error.message}`), { code: error.code });
};

/**
 * Runs a product update that asks for the changed row back (.select('id')) and also
 * throws when no row changed. After migration 20261012100000 a product deleted on
 * another device is archived and hidden, so its update reports 0 rows and no error;
 * before it the product is really gone. Either way nothing was saved.
 */
const mustUpdateProduct = async (what: string, product: { id: string; name: string }, request: PromiseLike<{ data: any[] | null; error: any }>) => {
  const { data, error } = await request;
  if (error) throw Object.assign(new Error(`${what} failed: ${error.message}`), { code: error.code });
  if (!data || data.length === 0) {
    throw Object.assign(
      new Error(`${product.name} was deleted on another device, so nothing was saved`),
      { productGone: true, productId: product.id }
    );
  }
};

/** The server refuses more than 25 deletes in one request (from migration 20261012100000). */
const isMassDeleteBlocked = (error: any) =>
  error?.code === 'PT422' ||
  /mass_delete_blocked/i.test(`${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`);

const MASS_DELETE_MESSAGE =
  'For safety, at most 25 products can be deleted at once. Nothing was deleted: select 25 or fewer and try again.';

/**
 * Deletes products on the server, then re-reads them to learn what happened.
 * Before migration 20261012100000 a delete really deletes. After it, the server
 * archives the product instead: it reports 0 rows and no error, and hides the row.
 * Either way a product that can no longer be read is gone, so it also leaves this
 * device's copy. A product that can still be read was not deleted.
 * Returns null when the delete went through but the re-read failed.
 */
const deleteProductsOnServer = async (shopId: string, ids: string[]) => {
  const { count, error } = await supabase
    .from('products')
    .delete({ count: 'exact' })
    .eq('shopId', shopId)
    .in('id', ids);
  if (error) throw error;
  const stillThere = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: readError } = await supabase
      .from('products')
      .select('id')
      .eq('shopId', shopId)
      .in('id', ids.slice(i, i + 100));
    if (readError) return null;
    for (const row of data || []) stillThere.add(row.id);
  }
  const removed = ids.filter(id => !stillThere.has(id));
  if (removed.length) {
    // Write-through, and the shop's other devices are told (a delete archives the row,
    // which the live channel cannot send by itself).
    await removeLocalRows('products', removed);
    announceDeleted('products', removed);
  }
  return {
    removed,
    notRemoved: ids.filter(id => stillThere.has(id)),
    archived: (count ?? 0) < removed.length,
  };
};

interface ParsedImportRow {
  rowNumber: number;
  rawRow: Record<string, any>;
  name: string;
  /** Purchase price from file (column usually named Price) */
  purchasePrice: number;
  /** Computed: purchase Ã— 1.65 (e.g. 1000 â†’ 1650) */
  sellingPrice: number;
  category: 'device' | 'coil' | 'e-liquid';
  bottleSizeMl?: number | null;
  stock: number;
  remainingMl?: number | null;
  isValid: boolean;
  reason?: string;
}

type ImportMode = 'general' | 'eliquid';

const Stock: React.FC = () => {
  const { shopId, userRole, currentUser } = useAuth();
  const isAdmin = userRole === 'admin';
  const needsPassword = requiresPasswordReauth(currentUser);
  const { products, productsLoading: loading, refetchProducts } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [showBottleModal, setShowBottleModal] = useState<any | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ParsedImportRow[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('general');
  const [uploadingImport, setUploadingImport] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [shortfalls, setShortfalls] = useState<{ id: string; product_name: string; message: string; created_at: string }[]>([]);

  // Sales that arrived when the system showed too little stock (offline, or two
  // devices at once). Stock was stopped at 0; the owner should recount.
  useEffect(() => {
    if (!shopId || !isAdmin) return;
    let cancelled = false;
    supabase
      .from('inventory_alerts')
      .select('id, product_name, message, created_at')
      .eq('shop_id', shopId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        // Before the database update is applied this table isn't readable yet: show nothing.
        if (!cancelled && !error) setShortfalls(data || []);
      });
    return () => { cancelled = true; };
  }, [shopId, isAdmin]);

  const markRecounted = async (alertId: string) => {
    const { error } = await supabase
      .from('inventory_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', alertId);
    if (error) {
      toast.error(`Could not update the alert: ${error.message}`);
      return;
    }
    setShortfalls(list => list.filter(a => a.id !== alertId));
  };
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [productToDelete, setProductToDelete] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredProducts = useMemo(() => {
    let result = products.filter(p => 
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (categoryFilter === 'all' || p.category === categoryFilter)
    );

    if (sortConfig.key) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [products, searchTerm, categoryFilter, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleDelete = (product: any) => {
    setProductToDelete(product);
    setDeleteReason('');
    setDeletePassword('');
  };

  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    if (!deleteReason.trim()) {
      toast.error('Please provide a reason for deletion');
      return;
    }
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait and try again.');
      return;
    }
    setIsDeleting(true);
    try {
      if (needsPassword && currentUser) {
        await reauthenticateForSensitiveAction(currentUser, deletePassword);
      }
      
      const isELiquid = productToDelete.category === 'e-liquid';
      const currentStock = Number(productToDelete.stockQuantity) || 0;
      
      const logPayload: any = {
        id: crypto.randomUUID(),
        productId: productToDelete.id,
        productName: productToDelete.name,
        shopId,
        action: 'deduction',
        type: 'deduction',
        change: -currentStock,
        quantityChange: isELiquid ? 0 : -currentStock,
        newStock: 0,
        reason: 'Product Deletion',
        notes: deleteReason,
        ...buildActorMeta({ currentUser, userRole }),
        createdAt: new Date().toISOString(),
        createdAtClient: new Date().toISOString()
      };

      if (isELiquid) {
        logPayload.mlChange = -currentStock;
        logPayload.newStockMl = 0;
      }

      const { error } = await supabase.from('inventory_logs').insert(logPayload);
      if (error) throw error;
      notifyTableChanged('inventory_logs');

      const result = await deleteProductsOnServer(shopId, [productToDelete.id]);
      if (!result) {
        toast('The delete was sent, but its result could not be checked. Refreshing the list.');
        refetchProducts();
      } else if (result.notRemoved.length) {
        throw new Error(`${productToDelete.name} was not deleted. Check the internet connection and that you are signed in as the shop admin, then try again.`);
      } else {
        toast.success(result.archived ? `Archived ${productToDelete.name}` : 'Product deleted successfully');
      }
      setProductToDelete(null);
      setDeleteReason('');
      setDeletePassword('');
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') toast.error('Incorrect password.');
      else if (isMassDeleteBlocked(error)) toast.error(MASS_DELETE_MESSAGE);
      else toast.error(error?.message || 'Failed to delete product');
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? filteredProducts.map((p) => p.id) : []);
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id));
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait and try again.');
      return;
    }
    if (selectedIds.length > MAX_DELETE_AT_ONCE) {
      toast.error(MASS_DELETE_MESSAGE);
      return;
    }
    const ids = [...selectedIds];
    setBulkDeleting(true);
    try {
      if (needsPassword && currentUser) {
        await reauthenticateForSensitiveAction(currentUser, deletePassword);
      }
      const result = await deleteProductsOnServer(shopId, ids);
      if (!result) {
        toast('The delete was sent, but its result could not be checked. Refreshing the list.');
        refetchProducts();
        setSelectedIds([]);
      } else {
        const removed = new Set(result.removed);
        setSelectedIds(prev => prev.filter(id => !removed.has(id)));
        if (result.notRemoved.length) {
          toast.error(`${result.removed.length} of ${ids.length} product(s) ${result.archived ? 'archived' : 'deleted'}. The other ${result.notRemoved.length} were not deleted and stay selected.`);
        } else {
          toast.success(result.archived ? `Archived ${ids.length} product(s)` : `Deleted ${ids.length} product(s)`);
        }
      }
      setShowBulkDeleteModal(false);
      setDeleteTyped('');
      setDeletePassword('');
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') toast.error('Incorrect password.');
      else if (isMassDeleteBlocked(error)) toast.error(MASS_DELETE_MESSAGE);
      else toast.error(error?.message || 'Failed to delete selected products');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleImportFile = async (file: File, mode: ImportMode) => {
    if (!file) return;
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait and try again.');
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(fileBuffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: '' });

      const normalizeCategory = (value: string): 'device' | 'coil' | 'e-liquid' => {
        const v = String(value || '').trim().toLowerCase();
        if (v === 'coil' || v === 'coils') return 'coil';
        if (['e-liquid', 'e-liquids', 'eliquid', 'eliquids', 'e liquid', 'e liquids', 'juice', 'liquid', 'liquids', 'ejuice', 'e-juice'].includes(v)) return 'e-liquid';
        return 'device';
      };

      const normalizeHeader = (header: string) =>
        String(header || '')
          .replace(/\uFEFF/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');

      const toNumberSafe = (value: any) => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        const cleaned = String(value ?? '')
          .replace(/[^\d.-]/g, '')
          .trim();
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const readByAliases = (row: Record<string, any>, aliases: string[]) => {
        const normalizedEntries = Object.entries(row).map(([k, v]) => [normalizeHeader(k), v] as const);
        for (const alias of aliases) {
          const key = normalizeHeader(alias);
          const hit = normalizedEntries.find(([k]) => k === key);
          if (hit) return hit[1];
        }
        return '';
      };

      const parsed: ParsedImportRow[] = rows.map((row, index) => {
        const name = String(
          readByAliases(row, ['name', 'product name', 'item', 'item name', 'product'])
        ).trim();
        // "Price" in the sheet is purchase / cost only (not retail).
        const purchasePrice = toNumberSafe(
          readByAliases(row, ['price', 'purchase price', 'cost', 'cost price', 'buying price', 'rate'])
        );
        const sellingPrice =
          Math.round(purchasePrice * IMPORT_SELLING_MULTIPLIER * 100) / 100;
        const inferredCategory = normalizeCategory(String(readByAliases(row, ['category', 'type', 'product type']) || 'device'));
        const category = mode === 'eliquid' ? 'e-liquid' : inferredCategory;
        const stock = Math.max(0, toNumberSafe(readByAliases(row, ['stock', 'qty', 'quantity'])));
        const bottleSizeRaw = readByAliases(row, ['bottle size', 'bottlesize', 'ml', 'size ml', 'size']);
        const bottleSizeMl = category === 'e-liquid' ? parseBottleSizeMl(bottleSizeRaw, 0) : null;
        const remainingMlRaw = readByAliases(row, ['remaining ml', 'remainingml', 'remaining_ml', 'remaining', 'rem ml']);
        const remainingMl = category === 'e-liquid' ? Math.max(0, toNumberSafe(remainingMlRaw)) : null;
        // Only skip if name is actually empty after trim.
        const invalidGeneralELiquid = mode === 'general' && inferredCategory === 'e-liquid';
        const isValid = name.length > 0 && (!invalidGeneralELiquid) && (category !== 'e-liquid' || (bottleSizeMl || 0) > 0);
        if (!isValid) {
          console.warn('[Bulk Import] Skipping row due to empty Name after trim', {
            rowNumber: index + 2,
            row
          });
        }
        return {
          rowNumber: index + 2,
          rawRow: row,
          name,
          purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : 0,
          sellingPrice: Number.isFinite(sellingPrice) ? sellingPrice : 0,
          category,
          bottleSizeMl,
          stock: Number.isFinite(stock) ? stock : 0,
          remainingMl,
          isValid,
          reason: isValid
            ? undefined
            : name.length === 0
              ? 'Missing Name'
              : invalidGeneralELiquid
                ? 'Use E-Liquid Import for this row'
                : 'Missing BottleSize/ML'
        };
      });

      setImportMode(mode);
      setImportRows(parsed);
      setImportFileName(file.name);
      setImportProgress(0);
      setShowImportModal(true);
      toast.success(`Parsed ${parsed.length} rows from ${file.name}`);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || 'Failed to parse file');
    }
  };

  const handleBulkUpload = async () => {
    if (!shopId) {
      toast.error('Shop not loaded yet. Please wait and try again.');
      return;
    }
    const validRows = importRows.filter(r => r.isValid);
    const failedRows = importRows.filter(r => !r.isValid);
    if (validRows.length === 0) {
      toast.error('No valid rows to upload');
      return;
    }
    setUploadingImport(true);
    setImportProgress(0);
    let processed = 0;
    let currentRow: ParsedImportRow | null = null;
    // How far the current row got: nothing sent yet, its product write on the way
    // (if the connection drops then, the server may or may not have saved it), or
    // its product row saved (a later bottles write may still fail).
    let rowStage: 'before' | 'sending' | 'saved' = 'before';
    // Rows fully saved. If the import stops, they leave the list, so pressing
    // Import again continues with the rest and never adds them twice.
    const savedRowNumbers = new Set<number>();
    const touchedIds: string[] = [];
    const eLiquidIds: string[] = [];
    try {
      let merged = 0;

      for (const row of validRows) {
        currentRow = row;
        rowStage = 'before';
        const isELiquid = row.category === 'e-liquid';
        const bottleSizeMl = parseBottleSizeMl(row.bottleSizeMl, 30);
        const bottleCount = Math.max(0, Math.floor(row.stock));
        const importedRemainingMl = isELiquid ? Math.max(0, Number(row.remainingMl) || 0) : 0;
        const stockQuantity = isELiquid ? (bottleSizeMl * bottleCount + importedRemainingMl) : bottleCount;

        const existingProduct = products.find(
          (p) => p.name?.trim().toLowerCase() === row.name.trim().toLowerCase() && p.category === row.category
        );

        const timestampIso = new Date().toISOString();

        if (existingProduct) {
          // Add to the live server stock, not the device's possibly out-of-date copy.
          const liveRow = (await fetchLiveStock(shopId, [existingProduct.id]))?.get(existingProduct.id);
          if (!liveRow) throw new Error(`Could not read the current stock of ${existingProduct.name}. Nothing after it was imported; check the internet and try again.`);
          const currentStock = liveRow.serverStock;
          const currentCost = Number(existingProduct.costPrice) || 0;
          const addedStock = stockQuantity;
          const addedCost = row.purchasePrice;
          const totalStock = currentStock + addedStock;
          const weightedCost = totalStock > 0
            ? ((currentStock * (isELiquid ? (currentCost / (parseBottleSizeMl(existingProduct.bottleSize, 30) || 1)) : currentCost))
              + (addedStock * (isELiquid ? (addedCost / (bottleSizeMl || 1)) : addedCost))) / totalStock
            : addedCost;

          rowStage = 'sending';
          if (isELiquid) {
            const newUnitCostPerMl = weightedCost;
            const newCostPrice = newUnitCostPerMl * bottleSizeMl;
            await mustUpdateProduct(`Updating ${existingProduct.name}`, existingProduct, supabase.from('products').update({
              costPrice: Math.round(newCostPrice * 100) / 100,
              unitCostPerMl: Math.round(newUnitCostPerMl * 100) / 100,
              stockQuantity: currentStock + addedStock,
              updatedAt: timestampIso
            }).eq('id', existingProduct.id).select('id'));
          } else {
            await mustUpdateProduct(`Updating ${existingProduct.name}`, existingProduct, supabase.from('products').update({
              costPrice: Math.round(weightedCost * 100) / 100,
              stockQuantity: currentStock + addedStock,
              updatedAt: timestampIso
            }).eq('id', existingProduct.id).select('id'));
          }
          rowStage = 'saved';
          touchedIds.push(existingProduct.id);
          if (isELiquid) eLiquidIds.push(existingProduct.id);

          if (isELiquid) {
            if (importedRemainingMl > 0) {
              const { data: existingBottles } = await supabase
                .from('bottles')
                .select('*')
                .eq('shopId', shopId)
                .eq('productId', existingProduct.id)
                .order('createdAt', { ascending: true });

              const targetBottle = (existingBottles || []).find((b: any) => b.status === 'opened') || (existingBottles || [])[0];

              if (targetBottle) {
                const currentRemaining = Number(targetBottle.remainingMl) || 0;
                await mustWrite(`Updating remaining ml for ${existingProduct.name}`, supabase.from('bottles').update({
                  remainingMl: currentRemaining + importedRemainingMl,
                  updatedAt: timestampIso
                }).eq('id', targetBottle.id));
              } else {
                await mustWrite(`Adding opened bottle to ${existingProduct.name}`, supabase.from('bottles').insert({
                  id: crypto.randomUUID(),
                  productId: existingProduct.id,
                  shopId,
                  bottleSize: bottleSizeMl,
                  remainingMl: importedRemainingMl,
                  status: 'opened',
                  openedDate: timestampIso,
                  createdAt: timestampIso,
                  updatedAt: timestampIso
                }));
              }
            }

            if (bottleCount > 0) {
              const bottles = [];
              for (let i = 0; i < bottleCount; i++) {
                bottles.push({
                  id: crypto.randomUUID(),
                  productId: existingProduct.id,
                  shopId,
                  bottleSize: bottleSizeMl,
                  remainingMl: bottleSizeMl,
                  status: 'closed',
                  createdAt: timestampIso,
                  updatedAt: timestampIso
                });
              }
              if (bottles.length > 0) {
                await mustWrite(`Adding bottles to ${existingProduct.name}`, supabase.from('bottles').insert(bottles));
              }
            }
          }
          merged += 1;
        } else {
          const newProductId = crypto.randomUUID();
          touchedIds.push(newProductId);
          if (isELiquid) eLiquidIds.push(newProductId);
          rowStage = 'sending';
          await mustWrite(`Saving ${row.name}`, supabase.from('products').insert({
            id: newProductId,
            name: row.name,
            category: row.category,
            costPrice: row.purchasePrice,
            sellingPrice: roundRupees(row.sellingPrice),
            stockQuantity,
            minStockLevel: isELiquid ? bottleSizeMl * 2 : 2,
            lowStockAlert: isELiquid ? bottleSizeMl * 2 : 2,
            unit: isELiquid ? 'bottle' : 'piece',
            ...(isELiquid ? { bottleSize: String(bottleSizeMl), unitCostPerMl: row.purchasePrice / (bottleSizeMl || 1) } : {}),
            brand: '',
            shopId,
            createdAt: timestampIso,
            createdAtClient: timestampIso,
            updatedAt: timestampIso
          }));
          rowStage = 'saved';

          if (isELiquid) {
            const bottles = [];
            for (let i = 0; i < bottleCount; i++) {
              bottles.push({
                id: crypto.randomUUID(),
                productId: newProductId,
                shopId,
                bottleSize: bottleSizeMl,
                remainingMl: bottleSizeMl,
                status: 'closed',
                createdAt: timestampIso,
                updatedAt: timestampIso
              });
            }
            if (importedRemainingMl > 0) {
              bottles.push({
                id: crypto.randomUUID(),
                productId: newProductId,
                shopId,
                bottleSize: bottleSizeMl,
                remainingMl: importedRemainingMl,
                status: 'opened',
                openedDate: timestampIso,
                createdAt: timestampIso,
                updatedAt: timestampIso
              });
            }
            if (bottles.length > 0) {
              await mustWrite(`Adding bottles to ${row.name}`, supabase.from('bottles').insert(bottles));
            }
          }
        }
        savedRowNumbers.add(row.rowNumber);
        processed += 1;
        setImportProgress(Math.round((processed / validRows.length) * 100));
      }
      // Every row is saved: a later failure (refreshing this device) is not a row's.
      currentRow = null;

      // Make the imported products and bottles available to the POS right away.
      await refreshLocalProducts(shopId, touchedIds);
      await refreshLocalBottles(shopId, eLiquidIds);

      const newCount = validRows.length - merged;
      toast.success(`Imported ${newCount} new product(s), merged ${merged} existing product(s). ${failedRows.length} row(s) skipped.`);
      setShowImportModal(false);
      setImportRows([]);
      setImportFileName('');
      setImportProgress(0);
    } catch (error: any) {
      console.error(error);
      const message = String(error?.message || 'Bulk import failed').replace(/\.$/, '');
      const failed: ParsedImportRow | null = currentRow;
      // The row that stopped the import must not be imported again blindly when:
      // - its product row was already saved (only its bottles are missing);
      // - its product write got no answer from the server (no error code: the
      //   connection dropped), so it may have been saved;
      // - its product was deleted on another device.
      // A refusal with an error code means nothing was saved: it stays importable.
      const note: string | null = !failed
        ? null
        : error?.productGone
          ? 'Deleted on another device: not imported'
          : rowStage === 'saved'
            ? 'Saved partly: check by hand'
            : rowStage === 'sending' && !error?.code
              ? 'Maybe saved: check by hand'
              : null;
      // Saved rows leave the list, so pressing Import again continues with the rest.
      setImportRows(rows => rows
        .filter(r => !savedRowNumbers.has(r.rowNumber))
        .map(r => (failed && note && r.rowNumber === failed.rowNumber ? { ...r, isValid: false, reason: note } : r)));
      if (failed) {
        const left = validRows.length - processed - (note ? 1 : 0);
        toast.error(
          `Import stopped at row ${failed.rowNumber} (${failed.name}): ${message}. ` +
          (processed > 0 ? `The ${processed} row(s) before it were saved and removed from this list. ` : 'No row before it was saved. ') +
          (note ? `Row ${failed.rowNumber} is marked "${note}" and will not be imported again. ` : '') +
          (left > 0
            ? `Do not load the file again: press Import to continue with the remaining ${left} row(s).`
            : 'Nothing else is left to import.'),
          { duration: 15000 }
        );
      } else {
        toast.error(`Every row was saved, but this device could not be updated: ${message}. Do not import the file again.`);
      }
      // A product the server no longer shows leaves this device's copy too.
      if (error?.productGone && error?.productId) void removeLocalRows('products', [error.productId]).catch(() => {});
      // Show what was saved before the failure on this device too (best effort).
      void refreshLocalProducts(shopId, touchedIds).catch(() => {});
      void refreshLocalBottles(shopId, eLiquidIds).catch(() => {});
    } finally {
      setUploadingImport(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 glass-card p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/20">
            <Package size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Inventory Management</h1>
            <p className="text-slate-500 text-sm">Manage your products and stock levels</p>
            {!isAdmin && <p className="text-slate-400 text-xs mt-0.5">{REASONS.manageProducts}</p>}
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 cursor-pointer">
              Bulk Import (Device/Coil)
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file, 'general');
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <label className="flex items-center gap-2 bg-fuchsia-500 hover:bg-fuchsia-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-fuchsia-500/20 cursor-pointer">
              Bulk Import E-Liquid
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file, 'eliquid');
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <button 
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-rose-500/20"
            >
              <Plus size={18} />
              Add Product
            </button>
          </div>
        )}
      </div>

      {shortfalls.length > 0 && (
        <div role="alert" className="rounded-2xl p-5 border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 font-bold text-amber-800">
            <AlertTriangle size={18} />
            Stock shortfall: please recount {shortfalls.length === 1 ? 'this product' : 'these products'}
          </div>
          <p className="text-xs text-amber-700 mt-1">
            A sale arrived when the system showed too little stock (made offline, or on two devices at once). Stock was stopped at 0 instead of going below zero.
          </p>
          <ul className="mt-3 space-y-2">
            {shortfalls.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-3 bg-white rounded-xl px-3 py-2 border border-amber-100">
                <div className="text-sm">
                  <span className="font-semibold text-slate-900">{a.product_name}</span>
                  <span className="text-slate-600">: {a.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => markRecounted(a.id)}
                  className="text-xs font-bold text-amber-700 hover:text-amber-900 whitespace-nowrap"
                >
                  Mark recounted
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="metric-card-violet rounded-2xl p-6 shadow-lg shadow-violet-500/20">
          <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Products</p>
          <p className="text-3xl font-bold">{products.length}</p>
        </div>
        <div className="metric-card-orange rounded-2xl p-6 shadow-lg shadow-orange-500/20">
          <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Low Stock Items</p>
          <p className="text-3xl font-bold">{products.filter(p => p.stockQuantity <= (p.minStockLevel || 2)).length}</p>
        </div>
        <div className="metric-card-red rounded-2xl p-6 shadow-lg shadow-rose-500/20">
          <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Out of Stock</p>
          <p className="text-3xl font-bold">{products.filter(p => p.stockQuantity === 0).length}</p>
        </div>
        {isAdmin && (
          <div className="metric-card-emerald rounded-2xl p-6 shadow-lg shadow-emerald-500/20">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mb-1">Total Value</p>
            <p className="text-3xl font-bold">
              {formatCurrency(products.reduce((acc, p) => {
                if (p.category === 'e-liquid') {
                  const unitCost = Number(p.unitCostPerMl) || (Number(p.costPrice) / (Number(parseBottleSizeMl(p.bottleSize, 30)) || 1));
                  return acc + (unitCost * (Number(p.stockQuantity) || 0));
                }
                return acc + ((Number(p.costPrice) || 0) * (Number(p.stockQuantity) || 0));
              }, 0))}
            </p>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
          />
        </div>
        <select 
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
        >
          <option value="all">All Categories</option>
          <option value="device">Devices</option>
          <option value="coil">Coils</option>
          <option value="e-liquid">E-Liquids</option>
        </select>
        {isAdmin && selectedIds.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              disabled={selectedIds.length > MAX_DELETE_AT_ONCE}
              title={selectedIds.length > MAX_DELETE_AT_ONCE ? REASONS.tooManyToDelete : undefined}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Selected ({selectedIds.length})
            </button>
            {selectedIds.length > MAX_DELETE_AT_ONCE && (
              <span className="text-[11px] font-semibold text-rose-600">{REASONS.tooManyToDelete} Select fewer.</span>
            )}
          </div>
        )}
      </div>

      {/* Product Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest">
                <th className="px-6 py-4 font-bold cursor-pointer hover:text-violet-600 transition-colors" onClick={() => handleSort('name')}>
                  <div className="flex items-center gap-2">Product <ArrowUpDown size={12} /></div>
                </th>
                <th className="px-6 py-4 font-bold">Category</th>
                {isAdmin && (
                  <th className="px-6 py-4 font-bold cursor-pointer hover:text-violet-600 transition-colors" onClick={() => handleSort('costPrice')}>
                    <div className="flex items-center gap-2">Cost <ArrowUpDown size={12} /></div>
                  </th>
                )}
                <th className="px-6 py-4 font-bold cursor-pointer hover:text-violet-600 transition-colors" onClick={() => handleSort('sellingPrice')}>
                  <div className="flex items-center gap-2">Price <ArrowUpDown size={12} /></div>
                </th>
                <th className="px-6 py-4 font-bold cursor-pointer hover:text-violet-600 transition-colors" onClick={() => handleSort('stockQuantity')}>
                  <div className="flex items-center gap-2">Stock <ArrowUpDown size={12} /></div>
                </th>
                {isAdmin && (
                  <th className="px-3 py-4 font-bold text-right">
                    <input
                      type="checkbox"
                      checked={filteredProducts.length > 0 && selectedIds.length === filteredProducts.length}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                {isAdmin && <th className="px-6 py-4 font-bold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="text-slate-900 font-semibold group-hover:text-violet-600 transition-colors">{product.name}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      product.category === 'device' ? "bg-blue-100 text-blue-700" :
                      product.category === 'coil' ? "bg-emerald-100 text-emerald-700" :
                      "bg-fuchsia-100 text-fuchsia-700"
                    )}>
                      {product.category}
                    </span>
                  </td>
                  {isAdmin && <td className="px-6 py-4 text-sm text-slate-500 font-medium">{formatCurrency(product.costPrice)}</td>}
                  <td className="px-6 py-4 text-sm text-slate-900 font-bold">{formatCurrency(product.sellingPrice)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "font-bold text-sm",
                      product.stockQuantity <= (product.minStockLevel || 2) ? "text-amber-600" : "text-slate-900"
                    )}>
                      {product.category === 'e-liquid'
                        ? (() => {
                            const size = parseBottleSizeMl(product.bottleSize, 30);
                            const bottles = Math.floor(product.stockQuantity / size);
                            const ml = Math.round(product.stockQuantity % size);
                            return `${bottles} Bottles and ${ml} ml`;
                          })()
                        : `${product.stockQuantity} ${product.unit || 'pcs'}`}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-4 text-right">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(product.id)}
                        onChange={(e) => toggleSelectOne(product.id, e.target.checked)}
                      />
                    </td>
                  )}
                  {isAdmin && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        {product.category === 'e-liquid' && (
                          <button
                            onClick={() => setShowBottleModal(product)}
                            className="p-2 hover:bg-sky-50 rounded-lg text-slate-400 hover:text-sky-600 transition-all"
                            title="View Bottles"
                          >
                            <Package size={18} />
                          </button>
                        )}
                        <button 
                          onClick={() => setEditingProduct(product)}
                          className="p-2 hover:bg-violet-50 rounded-lg text-slate-400 hover:text-violet-600 transition-all" 
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => handleDelete(product)}
                          className="p-2 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition-all" 
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredProducts.length === 0 && (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Package className="text-slate-400" size={32} />
            </div>
            <p className="text-slate-500 font-medium">No products found.</p>
          </div>
        )}
      </div>

      {/* Add/Edit Product Modal */}
      {(showAddModal || editingProduct) && (
        <ProductModal 
          product={editingProduct} 
          onClose={() => {
            setShowAddModal(false);
            setEditingProduct(null);
          }} 
        />
      )}

      {showBottleModal && (
        <BottleModal product={showBottleModal} onClose={() => setShowBottleModal(null)} />
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Bulk Import Preview</h2>
                <p className="text-xs text-slate-500 mt-1">
                  File: {importFileName || 'N/A'} | {importMode === 'eliquid'
                    ? 'E-Liquid mode: columns Name, Price, Stock, Bottle Size, Remaining ML (Category optional).'
                    : 'Device/Coil mode: columns Name, Price, Category, Stock. E-liquid rows are skipped for safety.'} Selling price is auto set (+65%, Ã—{IMPORT_SELLING_MULTIPLIER}).
                </p>
              </div>
              <button
                onClick={() => {
                  if (!uploadingImport) {
                    setShowImportModal(false);
                    setImportRows([]);
                  }
                }}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"
                disabled={uploadingImport}
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Rows Found</p>
                  <p className="text-2xl font-black text-slate-900">{importRows.length}</p>
                </div>
                <div className="glass-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Valid Products</p>
                  <p className="text-2xl font-black text-emerald-600">{importRows.filter(r => r.isValid).length}</p>
                </div>
                <div className="glass-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Skipped Rows</p>
                  <p className="text-2xl font-black text-rose-600">{importRows.filter(r => !r.isValid).length}</p>
                </div>
              </div>

              {uploadingImport && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-slate-500">
                    <span>Uploading products...</span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-violet-600 transition-all duration-200" style={{ width: `${importProgress}%` }} />
                  </div>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest">
                      <th className="px-4 py-3 font-bold">Row</th>
                      <th className="px-4 py-3 font-bold">Name</th>
                      <th className="px-4 py-3 font-bold">Purchase</th>
                      <th className="px-4 py-3 font-bold">Selling (Ã—1.65)</th>
                      <th className="px-4 py-3 font-bold">Category</th>
                      <th className="px-4 py-3 font-bold">Stock</th>
                      {importMode === 'eliquid' && <th className="px-4 py-3 font-bold">Remaining ML</th>}
                      <th className="px-4 py-3 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importRows.slice(0, 200).map((row, idx) => (
                      <tr key={`${row.rowNumber}-${idx}`} className="text-sm">
                        <td className="px-4 py-3 text-slate-500">{row.rowNumber}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.name || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{row.purchasePrice}</td>
                        <td className="px-4 py-3 text-slate-700">{row.sellingPrice}</td>
                        <td className="px-4 py-3 text-slate-700">{row.category}</td>
                        <td className="px-4 py-3 text-slate-700">{row.stock}</td>
                        {importMode === 'eliquid' && (
                          <td className="px-4 py-3 text-slate-700">{row.remainingMl != null ? `${row.remainingMl}ml` : '-'}</td>
                        )}
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest",
                            row.isValid ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                          )}>
                            {row.isValid ? 'Valid' : row.reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    if (!uploadingImport) {
                      setShowImportModal(false);
                      setImportRows([]);
                    }
                  }}
                  disabled={uploadingImport}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkUpload}
                  disabled={uploadingImport || importRows.filter(r => r.isValid).length === 0}
                  className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {uploadingImport ? 'Uploading...' : `Import ${importRows.filter(r => r.isValid).length} Product(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {productToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-xl font-bold text-slate-900">Delete Product</h2>
              <button 
                onClick={() => setProductToDelete(null)}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-sm">
                <p>Are you sure you want to delete <strong>{productToDelete.name}</strong>? This action cannot be undone and will remove all stock.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Reason for Deletion</label>
                <textarea 
                  required
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Why are you deleting this product?"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none resize-none h-24"
                />
              </div>

              {needsPassword && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Account Password</label>
                  <input 
                    type="password"
                    required
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter your login password"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setProductToDelete(null)}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all uppercase tracking-widest text-xs"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleConfirmDelete}
                  disabled={isDeleting || !deleteReason.trim() || (needsPassword && !deletePassword.trim())}
                  className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-lg shadow-rose-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest text-xs"
                >
                  {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmBulkDeleteModal
        open={showBulkDeleteModal}
        count={selectedIds.length}
        title="Delete selected products?"
        busy={bulkDeleting}
        typedConfirm={deleteTyped}
        onTypedConfirmChange={setDeleteTyped}
        requirePassword={needsPassword}
        password={deletePassword}
        onPasswordChange={setDeletePassword}
        onClose={() => {
          if (bulkDeleting) return;
          setShowBulkDeleteModal(false);
          setDeleteTyped('');
          setDeletePassword('');
        }}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
};

const BottleModal: React.FC<{ product: any; onClose: () => void }> = ({ product, onClose }) => {
  const { shopId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bottles, setBottles] = useState<BottleDoc[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  // Live: read again when a bottle of this product changes (a sale or a refill on any device).
  useTableChanged('bottles', () => setReloadTick(t => t + 1),
    detail => !detail.rows || detail.rows.some(row => String(row?.productId) === String(product?.id)));

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!shopId) return;
      if (reloadTick === 0) setLoading(true);
      try {
        const { data: bottlesData } = await supabase.from('bottles')
          .select('*')
          .eq('shopId', shopId)
          .eq('productId', product.id)
          .order('createdAt', { ascending: true });
        
        const rows: BottleDoc[] = (bottlesData || []).map(d => ({
          id: d.id,
          bottleSize: Number(d.bottleSize) || parseBottleSizeMl(product.bottleSize, 30),
          remainingMl: Number(d.remainingMl) || 0,
          status: d.status,
          createdAt: d.createdAt,
          openedDate: d.openedDate,
          updatedAt: d.updatedAt
        }));
        if (active) setBottles(rows);
      } catch (err) {
        console.error('Error loading bottles:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [product?.id, product?.bottleSize, shopId, reloadTick]);

  const counts = computeBottleStatusCounts(bottles);
  const availableMl = getAvailableMl(bottles);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Bottle Details - {product.name}</h2>
            <p className="text-slate-500 text-sm">Bottle Size: {parseBottleSizeMl(product.bottleSize, 30)}ml</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="glass-card p-4 md:col-span-2">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Available ML</p>
              <p className="text-2xl font-black text-slate-900">{availableMl}ml</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
              <p className="text-emerald-700 text-[10px] font-bold uppercase tracking-widest mb-1">Closed</p>
              <p className="text-2xl font-black text-emerald-800">{counts.closed}</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <p className="text-amber-700 text-[10px] font-bold uppercase tracking-widest mb-1">Opened</p>
              <p className="text-2xl font-black text-amber-800">{counts.opened}</p>
            </div>
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
              <p className="text-rose-700 text-[10px] font-bold uppercase tracking-widest mb-1">Empty</p>
              <p className="text-2xl font-black text-rose-800">{counts.empty}</p>
            </div>
            <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4">
              <p className="text-sky-700 text-[10px] font-bold uppercase tracking-widest mb-1">Sold</p>
              <p className="text-2xl font-black text-sky-800">{counts.sold}</p>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <p className="text-slate-900 font-bold">Individual Bottles</p>
              {loading && <p className="text-slate-400 text-sm font-semibold">Loadingâ€¦</p>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest">
                    <th className="px-6 py-4 font-bold">Bottle ID</th>
                    <th className="px-6 py-4 font-bold">Capacity</th>
                    <th className="px-6 py-4 font-bold">Remaining ML</th>
                    <th className="px-6 py-4 font-bold">Status</th>
                    <th className="px-6 py-4 font-bold">Opened Date</th>
                    <th className="px-6 py-4 font-bold">Created</th>
                    <th className="px-6 py-4 font-bold">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bottles.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-mono text-slate-500">{b.id.slice(-6).toUpperCase()}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-700">{b.bottleSize}ml</td>
                      <td className="px-6 py-4 text-sm font-bold text-slate-900">{b.remainingMl}ml</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          b.status === 'closed' ? "bg-emerald-100 text-emerald-700" :
                          b.status === 'opened' ? "bg-amber-100 text-amber-700" :
                          b.status === 'empty' ? "bg-rose-100 text-rose-700" :
                          "bg-sky-100 text-sky-700"
                        )}>
                          {b.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {b.openedDate?.toDate ? b.openedDate.toDate().toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {b.createdAt?.toDate ? b.createdAt.toDate().toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {b.updatedAt?.toDate ? b.updatedAt.toDate().toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                  {bottles.length === 0 && !loading && (
                    <tr>
                      <td className="px-6 py-10 text-center text-slate-400 font-medium" colSpan={7}>
                        No bottles found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Simplified ProductModal â€” no Brand, no Min Stock Level (hardcoded to 2) */
const ProductModal: React.FC<{ product?: any, onClose: () => void }> = ({ product, onClose }) => {
  const { shopId, currentUser, userRole } = useAuth();
  const isEditing = !!product;
  const [formData, setFormData] = useState({
    name: product?.name || '',
    category: product?.category || 'device',
    costPrice: isEditing ? (product?.costPrice || 0) : '',
    sellingPrice: isEditing ? (product?.sellingPrice || 0) : '',
    stockQuantity: isEditing ? (product?.stockQuantity || 0) : '',
    bottleSize: product?.bottleSize || (product ? '' : '30'),
    pricePerMl: isEditing ? (product?.pricePerMl || 0) : 100
  });
  const [addBottleCount, setAddBottleCount] = useState<number | string>('');
  const [addMlCount, setAddMlCount] = useState<number | string>('');
  const [removeMlCount, setRemoveMlCount] = useState<number | string>('');
  const [addStockCount, setAddStockCount] = useState<number | string>('');
  const [removeStockCount, setRemoveStockCount] = useState<number | string>('');
  const [saving, setSaving] = useState(false);

  /** Helper: auto-select on focus for numeric inputs */
  const handleNumericFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const costPrice = Number(formData.costPrice) || 0;
    const sellingPrice = roundRupees(Number(formData.sellingPrice) || 0);
    const stockQuantity = Number(formData.stockQuantity) || 0;
    const pricePerMl = Number(formData.pricePerMl) || 0;
    const addStock = Math.max(0, Math.floor(Number(addStockCount) || 0));

    if (!formData.name.trim()) {
      toast.error('Product name is required');
      return;
    }
    if (sellingPrice <= 0) {
      toast.error('Selling price must be greater than 0');
      return;
    }
    if (!shopId) {
      toast.error('Shop ID not loaded yet. Please wait a moment and try again.');
      return;
    }

    setSaving(true);
    // Set once the product row itself is saved, so a later failure (bottles, log)
    // is reported as such and never leads to adding the same product twice.
    let savedProductId: string | null = null;
    try {
      const actorMeta = buildActorMeta({ currentUser, userRole });
      const finalUnit = formData.category === 'e-liquid' ? 'bottle' : 'piece';
      const timestampIso = new Date().toISOString();

      if (isEditing) {
        const isELiquid = formData.category === 'e-liquid';
        const bottleSizeMl = parseBottleSizeMl(formData.bottleSize, 30);
        const bottlesToAdd = isELiquid ? Math.max(0, Math.floor(Number(addBottleCount) || 0)) : 0;
        const mlFromBottles = bottlesToAdd > 0 ? bottleSizeMl * bottlesToAdd : 0;
        const rawMlToAdd = isELiquid ? Math.max(0, Number(addMlCount) || 0) : 0;
        const rawMlToRemove = isELiquid ? Math.max(0, Number(removeMlCount) || 0) : 0;
        const removeCount = !isELiquid ? Math.max(0, Math.floor(Number(removeStockCount) || 0)) : 0;
        const totalMlToAdd = mlFromBottles + rawMlToAdd;

        // Use the live stock from the server: the local copy can be out of date
        // (sales on other devices), and stock must never go below zero. Sales on
        // this device that haven't synced yet still count against what can be removed.
        const live = (await fetchLiveStock(shopId, [product.id]))?.get(product.id);
        if (!live) throw new Error('Could not read the current stock. Check the internet connection and try again.');
        const currentStockQty = live.serverStock;
        const availableQty = live.available;
        if (isELiquid && rawMlToRemove > 0) {
          const effectiveStock = availableQty + totalMlToAdd;
          if (rawMlToRemove > effectiveStock) {
            toast.error(`Cannot remove ${rawMlToRemove}ml. Only ${effectiveStock}ml available.`);
            setSaving(false);
            return;
          }
        }
        if (!isELiquid && removeCount > 0) {
          const effectiveStock = availableQty + addStock;
          if (removeCount > effectiveStock) {
            toast.error(`Cannot remove ${removeCount} units. Only ${effectiveStock} in stock.`);
            setSaving(false);
            return;
          }
        }

        let finalCostPrice = costPrice;
        let finalUnitCostPerMl = costPrice / (bottleSizeMl || 1);

        if (isELiquid && totalMlToAdd > 0) {
          const currentMl = currentStockQty;
          const currentCostPerMl = Number(product.unitCostPerMl) || (Number(product.costPrice) / (parseBottleSizeMl(product.bottleSize, 30) || 1));
          const newCostPerMl = Number(costPrice) / (bottleSizeMl || 1);
          const totalMl = currentMl + totalMlToAdd;
          finalUnitCostPerMl = totalMl > 0
            ? ((currentMl * currentCostPerMl) + (totalMlToAdd * newCostPerMl)) / totalMl
            : newCostPerMl;
          finalCostPrice = Math.round(finalUnitCostPerMl * bottleSizeMl * 100) / 100;
          finalUnitCostPerMl = Math.round(finalUnitCostPerMl * 100) / 100;
        } else if (!isELiquid && addStock > 0) {
          const currentCost = Number(product.costPrice) || 0;
          if (costPrice !== currentCost) {
            const totalStock = currentStockQty + addStock;
            finalCostPrice = totalStock > 0
              ? Math.round(((currentStockQty * currentCost) + (addStock * costPrice)) / totalStock * 100) / 100
              : costPrice;
          }
        }

        const updatePayload: Record<string, any> = {
          name: formData.name,
          category: formData.category,
          costPrice: finalCostPrice,
          sellingPrice,
          unit: finalUnit,
          bottleSize: formData.bottleSize,
          shopId,
          updatedAt: timestampIso
        };

        if (isELiquid) {
          updatePayload.unitCostPerMl = finalUnitCostPerMl;
          updatePayload.pricePerMl = pricePerMl;
          const netMlChange = totalMlToAdd - rawMlToRemove;
          if (netMlChange !== 0) {
            updatePayload.stockQuantity = currentStockQty + netMlChange;
          }
        } else {
          const netChange = addStock - removeCount;
          if (netChange !== 0) {
            updatePayload.stockQuantity = currentStockQty + netChange;
          }
        }

        // Ask for the row back: 0 rows means the product was deleted on another
        // device, and then no bottles or stock log may be written for it.
        const { data: updatedRows, error: updateError } = await supabase.from('products').update(updatePayload).eq('id', product.id).select('id');
        if (updateError) throw new Error(`Product was not saved: ${updateError.message}`);
        if (!updatedRows || updatedRows.length === 0) {
          throw Object.assign(
            new Error('This product was deleted on another device, so nothing was saved. It has been removed from this list.'),
            { productGone: true, productId: product.id }
          );
        }
        savedProductId = product.id;

        if (isELiquid && bottlesToAdd > 0) {
          const bottles = [];
          for (let i = 0; i < bottlesToAdd; i++) {
            bottles.push({
              id: crypto.randomUUID(),
              productId: product.id,
              shopId,
              bottleSize: bottleSizeMl,
              remainingMl: bottleSizeMl,
              status: 'closed',
              createdAt: timestampIso,
              updatedAt: timestampIso
            });
          }
          if (bottles.length > 0) {
            await mustWrite('Adding the bottles', supabase.from('bottles').insert(bottles));
          }
        }

        if (isELiquid && rawMlToAdd > 0) {
          const { data: allBottles, error: bottlesReadError } = await supabase.from('bottles')
            .select('*')
            .eq('shopId', shopId)
            .eq('productId', product.id)
            .order('createdAt', { ascending: true });
          if (bottlesReadError) throw new Error(`Reading the bottles failed: ${bottlesReadError.message}`);

          let mlLeft = rawMlToAdd;

          const openedBottles = (allBottles || [])
            .filter(d => d.status === 'opened' && (Number(d.remainingMl) || 0) < (Number(d.bottleSize) || bottleSizeMl))
            .sort((a, b) => {
              const aSpace = (Number(a.bottleSize) || bottleSizeMl) - (Number(a.remainingMl) || 0);
              const bSpace = (Number(b.bottleSize) || bottleSizeMl) - (Number(b.remainingMl) || 0);
              return aSpace - bSpace;
            });

          for (const bottleDoc of openedBottles) {
            if (mlLeft <= 0) break;
            const bSize = Number(bottleDoc.bottleSize) || bottleSizeMl;
            const curRemaining = Number(bottleDoc.remainingMl) || 0;
            const capacity = bSize - curRemaining;
            if (capacity <= 0) continue;

            const toAdd = Math.min(capacity, mlLeft);
            const newRemaining = curRemaining + toAdd;
            await mustWrite('Topping up an opened bottle', supabase.from('bottles').update({
              remainingMl: newRemaining,
              updatedAt: timestampIso
            }).eq('id', bottleDoc.id));
            mlLeft -= toAdd;
          }

          while (mlLeft > 0) {
            const thisBottleMl = Math.min(mlLeft, bottleSizeMl);
            const isFull = thisBottleMl >= bottleSizeMl;
            await mustWrite('Adding a bottle', supabase.from('bottles').insert({
              id: crypto.randomUUID(),
              productId: product.id,
              shopId,
              bottleSize: bottleSizeMl,
              remainingMl: thisBottleMl,
              status: isFull ? 'closed' : 'opened',
              ...(!isFull ? { openedDate: timestampIso } : {}),
              createdAt: timestampIso,
              updatedAt: timestampIso
            }));
            mlLeft -= thisBottleMl;
          }
        }

        if (isELiquid && rawMlToRemove > 0) {
          const { data: allBottles, error: bottlesReadError } = await supabase.from('bottles')
            .select('*')
            .eq('shopId', shopId)
            .eq('productId', product.id)
            .order('createdAt', { ascending: true });
          if (bottlesReadError) throw new Error(`Reading the bottles failed: ${bottlesReadError.message}`);

          let mlLeft = rawMlToRemove;

          const openedForDrain = (allBottles || [])
            .filter(d => d.status === 'opened' && (Number(d.remainingMl) || 0) > 0)
            .sort((a, b) => (Number(a.remainingMl) || 0) - (Number(b.remainingMl) || 0));

          for (const bottleDoc of openedForDrain) {
            if (mlLeft <= 0) break;
            const curRemaining = Number(bottleDoc.remainingMl) || 0;
            const toRemove = Math.min(curRemaining, mlLeft);
            const newRemaining = curRemaining - toRemove;
            await mustWrite('Removing ml from an opened bottle', supabase.from('bottles').update({
              remainingMl: newRemaining,
              status: newRemaining <= 0 ? 'empty' : 'opened',
              updatedAt: timestampIso
            }).eq('id', bottleDoc.id));
            mlLeft -= toRemove;
          }

          if (mlLeft > 0) {
            const closedForDrain = (allBottles || [])
              .filter(d => d.status === 'closed' && (Number(d.remainingMl) || 0) > 0)
              .sort((a, b) => {
                const aMs = new Date(a.createdAt).getTime();
                const bMs = new Date(b.createdAt).getTime();
                return bMs - aMs;
              });

            for (const bottleDoc of closedForDrain) {
              if (mlLeft <= 0) break;
              const curRemaining = Number(bottleDoc.remainingMl) || 0;
              const toRemove = Math.min(curRemaining, mlLeft);
              const newRemaining = curRemaining - toRemove;
              await mustWrite('Removing ml from a closed bottle', supabase.from('bottles').update({
                remainingMl: newRemaining,
                status: newRemaining <= 0 ? 'empty' : 'opened',
                openedDate: timestampIso,
                updatedAt: timestampIso
              }).eq('id', bottleDoc.id));
              mlLeft -= toRemove;
            }
          }
        }

        if (isELiquid) {
          const netMlChange = totalMlToAdd - rawMlToRemove;
          if (netMlChange !== 0) {
            const newStockMl = Math.max(0, currentStockQty + netMlChange);
            const parts: string[] = [];
            if (bottlesToAdd > 0) parts.push(`${bottlesToAdd} bottle(s) [${mlFromBottles}ml]`);
            if (rawMlToAdd > 0) parts.push(`${rawMlToAdd}ml loose`);
            if (rawMlToRemove > 0) parts.push(`removed ${rawMlToRemove}ml`);
            const { error } = await supabase.from('inventory_logs').insert({
              id: crypto.randomUUID(),
              productId: product.id,
              productName: formData.name,
              shopId,
              action: netMlChange > 0 ? 'addition' : 'deduction',
              type: netMlChange > 0 ? 'addition' : 'deduction',
              mlChange: netMlChange,
              change: netMlChange,
              quantityChange: bottlesToAdd > 0 ? bottlesToAdd : 0,
              newStockMl,
              newStock: newStockMl,
              reason: netMlChange > 0 ? 'Stock addition' : 'Manual stock deduction',
              notes: parts.join(', ') || `${netMlChange > 0 ? 'Added' : 'Removed'} ${Math.abs(netMlChange)}ml`,
              ...actorMeta,
              createdAt: timestampIso,
              createdAtClient: timestampIso
            });
            if (error) throw error;
          }
        }

        if (!isELiquid) {
          const netChange = addStock - removeCount;
          
          if (netChange !== 0) {
            const newStock = Math.max(0, currentStockQty + netChange);
            const { error } = await supabase.from('inventory_logs').insert({
              id: crypto.randomUUID(),
              productId: product.id,
              productName: formData.name,
              shopId,
              action: netChange > 0 ? 'addition' : 'deduction',
              type: netChange > 0 ? 'addition' : 'deduction',
              change: netChange,
              quantityChange: netChange,
              newStock,
              reason: removeCount > 0 && netChange < 0 ? 'Manual stock deduction' : 'Stock adjustment',
              notes: netChange > 0 ? `Added ${netChange} unit(s)` : `Removed ${Math.abs(netChange)} unit(s)`,
              ...actorMeta,
              createdAt: timestampIso,
              createdAtClient: timestampIso
            });
            if (error) throw error;
          }
        }

        // Keep this device's copy (used by the POS) in step with what was saved.
        await refreshLocalProducts(shopId, [product.id]);
        if (isELiquid) await refreshLocalBottles(shopId, [product.id]);
        notifyTableChanged('inventory_logs');

        toast.success('Product updated successfully');
      } else {
        const isELiquid = formData.category === 'e-liquid';
        const bottleSizeMl = parseBottleSizeMl(formData.bottleSize, 30);
        const initialBottleCount = isELiquid ? Math.max(0, Math.floor(stockQuantity || 0)) : 0;
        const initialMl = isELiquid ? bottleSizeMl * initialBottleCount : stockQuantity;
        const unitCostPerMl = costPrice / (bottleSizeMl || 1);
        const newProductId = crypto.randomUUID();
        const productData = {
          id: newProductId,
          name: formData.name,
          category: formData.category,
          costPrice,
          sellingPrice,
          stockQuantity: initialMl,
          minStockLevel: isELiquid ? bottleSizeMl * 2 : 2,
          unit: finalUnit,
          bottleSize: formData.bottleSize,
          ...(isELiquid ? { unitCostPerMl, pricePerMl } : {}),
          brand: '',
          shopId,
          createdAt: timestampIso,
          updatedAt: timestampIso
        };

        await mustWrite('Saving the product', supabase.from('products').insert(productData));
        savedProductId = newProductId;

        await mustWrite('Saving the stock log', supabase.from('inventory_logs').insert({
          id: crypto.randomUUID(),
          productId: newProductId,
          productName: formData.name,
          shopId,
          action: 'addition',
          type: 'addition',
          ...(isELiquid
            ? {
                mlChange: initialMl,
                change: initialMl,
                quantityChange: initialBottleCount,
                newStockMl: initialMl,
                newStock: initialMl
              }
            : {
                change: stockQuantity,
                quantityChange: stockQuantity,
                newStock: stockQuantity
              }),
          reason: 'Initial stock',
          notes: 'Initial stock',
          ...actorMeta,
          createdAt: timestampIso,
          createdAtClient: timestampIso
        }));

        if (formData.category === 'e-liquid' && initialBottleCount > 0) {
          const bottles = [];
          for (let i = 0; i < initialBottleCount; i++) {
            bottles.push({
              id: crypto.randomUUID(),
              productId: newProductId,
              shopId,
              bottleSize: bottleSizeMl,
              remainingMl: bottleSizeMl,
              status: 'closed',
              createdAt: timestampIso,
              updatedAt: timestampIso
            });
          }
          if (bottles.length > 0) {
            await mustWrite('Adding the bottles', supabase.from('bottles').insert(bottles));
          }
        }

        // Make the new product (and its bottles) available to the POS right away.
        await refreshLocalProducts(shopId, [newProductId]);
        if (isELiquid) await refreshLocalBottles(shopId, [newProductId]);
        notifyTableChanged('inventory_logs');

        toast.success('Product added successfully');
      }
      onClose();
    } catch (error: any) {
      console.error('Product save error:', error);
      const code = error?.code ? ` (${error.code})` : '';
      const message = (error?.message || (isEditing ? 'Failed to update product' : 'Failed to add product')) + code;
      if (error?.productGone) {
        // The server no longer shows this product: drop it from this device's copy
        // too (only this one row; a full re-read would also reset the bottles).
        toast.error(message, { duration: 10000 });
        void removeLocalRows('products', [product.id]).catch(() => {});
        onClose();
      } else if (savedProductId && shopId) {
        // The product row was saved but a later step was not: say so, show what was
        // saved on this device, and close the form so the product is not added twice.
        toast.error(`The product was saved, but not everything with it: ${message}. Open it from the list and check its stock.`, { duration: 12000 });
        void refreshLocalProducts(shopId, [savedProductId]).catch(() => {});
        void refreshLocalBottles(shopId, [savedProductId]).catch(() => {});
        onClose();
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-slate-900">{isEditing ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Product Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Product Name *</label>
            <input 
              required
              type="text" 
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="e.g. Vaporesso XROS 3"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">Category</label>
            <select 
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
              disabled={isEditing}
            >
              <option value="device">Device</option>
              <option value="coil">Coil</option>
              <option value="e-liquid">E-Liquid</option>
            </select>
          </div>

          {/* Cost + Selling Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cost Price (Rs)</label>
              <input 
                required
                type="number" 
                value={formData.costPrice}
                onChange={(e) => setFormData({...formData, costPrice: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0)})}
                onFocus={handleNumericFocus}
                placeholder="0"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selling Price (Rs) *</label>
              <input 
                required
                type="number" 
                value={formData.sellingPrice}
                onChange={(e) => setFormData({...formData, sellingPrice: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0)})}
                onFocus={handleNumericFocus}
                placeholder="0"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
              />
            </div>
          </div>

          {/* Stock */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {formData.category === 'e-liquid'
                ? isEditing
                  ? 'Available ML (read-only)'
                  : 'Initial Bottle Count'
                : isEditing
                  ? 'Current Stock (read-only)'
                  : 'Initial Stock'}
            </label>
            {isEditing && formData.category !== 'e-liquid' ? (
              <input 
                type="number" 
                value={formData.stockQuantity}
                readOnly
                className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 font-semibold cursor-not-allowed"
              />
            ) : (
              <input 
                required
                type="number" 
                value={formData.stockQuantity}
                onChange={(e) => setFormData({...formData, stockQuantity: e.target.value === '' ? '' : (parseInt(e.target.value) || 0)})}
                onFocus={handleNumericFocus}
                placeholder="0"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                disabled={isEditing && formData.category === 'e-liquid'}
              />
            )}

            {/* E-Liquid: Add Bottles + Add/Remove ML */}
            {isEditing && formData.category === 'e-liquid' && (
              <div className="space-y-4 pt-3">
                {/* Add Bottles Row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Add Bottles</label>
                    <input
                      type="number"
                      min={0}
                      value={addBottleCount}
                      onChange={(e) => setAddBottleCount(e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                      onFocus={handleNumericFocus}
                      placeholder="0"
                      className="w-full px-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                    />
                    {Number(addBottleCount) > 0 && (
                      <p className="text-[10px] font-semibold text-emerald-600">
                        = {parseBottleSizeMl(formData.bottleSize, 30) * Math.max(0, Math.floor(Number(addBottleCount) || 0))}ml from bottles
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bottle Size</label>
                    <input
                      type="text"
                      value={`${parseBottleSizeMl(formData.bottleSize, 30)} ml each`}
                      readOnly
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 font-semibold cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Add ML / Remove ML Row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Add ML</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={addMlCount}
                      onChange={(e) => setAddMlCount(e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))}
                      onFocus={handleNumericFocus}
                      placeholder="e.g. 10"
                      className="w-full px-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">Remove ML</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={removeMlCount}
                      onChange={(e) => setRemoveMlCount(e.target.value === '' ? '' : (parseFloat(e.target.value) || 0))}
                      onFocus={handleNumericFocus}
                      placeholder="e.g. 5"
                      className="w-full px-4 py-2.5 bg-white border border-rose-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-rose-500/20 outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Live preview of new stock */}
                {(Number(addBottleCount) > 0 || Number(addMlCount) > 0 || Number(removeMlCount) > 0) && (
                  <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl">
                    <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-1">New Stock After Save</p>
                    {(() => {
                      const bottleSizeMl = parseBottleSizeMl(formData.bottleSize, 30);
                      const currentMl = Number(formData.stockQuantity) || 0;
                      const mlFromBottles = Math.max(0, Math.floor(Number(addBottleCount) || 0)) * bottleSizeMl;
                      const rawAdd = Math.max(0, Number(addMlCount) || 0);
                      const rawRemove = Math.max(0, Number(removeMlCount) || 0);
                      const newTotal = Math.max(0, currentMl + mlFromBottles + rawAdd - rawRemove);
                      const bottles = Math.floor(newTotal / bottleSizeMl);
                      const looseMl = Math.round(newTotal % bottleSizeMl);
                      return (
                        <p className="text-sm font-bold text-violet-700">
                          {bottles} Bottle{bottles !== 1 ? 's' : ''} and {looseMl}ml ({newTotal}ml total)
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Device/Coil: Add / Remove Stock */}
            {isEditing && formData.category !== 'e-liquid' && (
              <div className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Add Stock</label>
                    <input
                      type="number"
                      min={0}
                      value={addStockCount}
                      onChange={(e) => setAddStockCount(e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                      onFocus={handleNumericFocus}
                      placeholder="e.g. 5"
                      className="w-full px-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">Remove Stock</label>
                    <input
                      type="number"
                      min={0}
                      value={removeStockCount}
                      onChange={(e) => setRemoveStockCount(e.target.value === '' ? '' : (parseInt(e.target.value) || 0))}
                      onFocus={handleNumericFocus}
                      placeholder="0"
                      className="w-full px-4 py-2.5 bg-white border border-rose-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-rose-500/20 outline-none transition-all"
                    />
                  </div>
                </div>
                {(Number(addStockCount) > 0 || Number(removeStockCount) > 0) && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">New Stock After Save</p>
                    <p className="text-sm font-bold text-slate-900">
                      {Math.max(0, (Number(formData.stockQuantity) || 0) + Math.max(0, Math.floor(Number(addStockCount) || 0)) - Math.max(0, Math.floor(Number(removeStockCount) || 0)))} {formData.category === 'device' ? 'devices' : 'coils'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* E-Liquid specific */}
          {formData.category === 'e-liquid' && (
            <div className="p-4 bg-violet-50 border border-violet-100 rounded-xl space-y-4">
              <h3 className="text-violet-600 font-bold text-sm">Bottle Size & Pricing</h3>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bottle Size (ml)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 30, 60"
                    value={formData.bottleSize}
                    onChange={(e) => setFormData({...formData, bottleSize: e.target.value})}
                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Refill Price Per ML (Rs)</label>
                  <input 
                    type="number" 
                    placeholder="e.g. 100"
                    value={formData.pricePerMl}
                    onChange={(e) => setFormData({...formData, pricePerMl: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0)})}
                    onFocus={handleNumericFocus}
                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-violet-500/20 outline-none transition-all"
                  />
                </div>
                <div className="p-3 bg-white/50 rounded-lg border border-violet-100/50">
                  <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-1">Unit Cost Per ML</p>
                  <p className="text-sm font-bold text-violet-600">
                    {formatCurrency(formData.costPrice / (parseBottleSizeMl(formData.bottleSize, 30) || 1))}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all uppercase tracking-widest text-xs"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={saving || !shopId}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold rounded-xl shadow-lg shadow-violet-600/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest text-xs"
            >
              {saving ? 'Saving...' : isEditing ? 'Update Product' : 'Save Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Stock;
