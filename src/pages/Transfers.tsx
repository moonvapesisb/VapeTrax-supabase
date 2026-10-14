import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Trash2,
  Unlink,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useConnectivity } from '../hooks/useConnectivity';
import { db } from '../lib/db';
import { announceDeleted } from '../lib/liveSync';
import { fetchLiveStock, refreshLocalBottles, refreshLocalProducts, type LiveStock } from '../lib/liveStock';
import {
  createShopLinkCode,
  findTransferByMutationId,
  isLiquidCategory,
  linkShopWithCode,
  listItemsOfTransfers,
  listLinkedShops,
  listTransferItems,
  listTransfers,
  newClientMutationId,
  previewTransfer,
  transferBottleMl,
  transferDefinitelyNotSaved,
  transferStock,
  unlinkShop,
  type LinkCode,
  type LinkedShop,
  type PreviewLine,
  type StockTransfer,
  type StockTransferItem,
  type TransferPreview,
} from '../lib/transfers';
import { cn, formatCurrency } from '../lib/utils';

const OFFLINE_MESSAGE = 'Transfers need internet';
const MAX_QTY = 10000;
const DEVICE_REFRESH_TIMEOUT_MS = 30000;

const errorText = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';

/** Prices are whole rupees. */
const rupees = (v: unknown): string => formatCurrency(Math.round(Number(v) || 0));

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtNum = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));

const fmtDate = (v: string | null | undefined): string => {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
};

const sectionCard = 'glass-card p-6 space-y-4';
const buttonPrimary = 'flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-violet-600/20';
const buttonQuiet = 'flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 px-3 py-2 rounded-xl font-semibold text-sm transition-all';
const inputClass = 'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all disabled:opacity-60';

// =====================================================================
// This device's copy of the stock after transfers
// =====================================================================
// The device keeps its own copy of products and bottles. A transfer changes
// both shops on the server. The shops' other devices hear of it live
// (liveSync.ts): product changes and the bottles that arrive reach the
// receiving shop's devices; the sealed bottles that LEFT now belong to the
// other shop, so the sending shop's devices are told to read them again (the
// transfer's 'transfer_out' log, and announceMovedBottles below). This device
// re-reads the products involved itself. The ids of the transfers this device
// has already applied are remembered (per shop, in this browser only).
const seenKey = (shopId: string) => `vapetrax_transfer_seen_${shopId}`;
const MAX_SEEN = 300;

/** The transfer ids this device has applied, or null if it never applied any. */
const readSeen = (shopId: string): Set<string> | null => {
  try {
    const raw = localStorage.getItem(seenKey(shopId));
    if (!raw) return null;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((x: unknown): x is string => typeof x === 'string')) : null;
  } catch {
    return null;
  }
};

const markTransfersSeen = (shopId: string, ids: string[]) => {
  try {
    const current = [...(readSeen(shopId) || [])].filter(id => !ids.includes(id));
    localStorage.setItem(seenKey(shopId), JSON.stringify([...current, ...ids].slice(-MAX_SEEN)));
  } catch { /* storage blocked: the device simply refreshes again next time */ }
};

const raceTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The server did not answer in time.')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });

/**
 * Re-reads these products (and the bottles of the e-liquids) from the server
 * into this device's copy, keeping this device's unsynced sales deducted.
 * True when both were refreshed.
 */
const refreshDeviceStock = async (shopId: string, productIds: string[], liquidIds: string[]): Promise<boolean> => {
  try {
    const [okProducts, okBottles] = await raceTimeout(
      Promise.all([refreshLocalProducts(shopId, productIds), refreshLocalBottles(shopId, liquidIds)]),
      DEVICE_REFRESH_TIMEOUT_MS,
    );
    return okProducts && okBottles;
  } catch {
    return false;
  }
};

/**
 * This shop's sealed and opened bottles of these e-liquids in this device's copy:
 * the ones a transfer FROM this shop may have moved (sealed on the server; opened
 * here when a sale on this device has not synced yet). Read it before this device
 * refreshes, which removes the bottles that left.
 */
const movableBottleIds = async (shopId: string, liquidIds: string[]): Promise<string[]> => {
  if (!liquidIds.length) return [];
  try {
    const rows = await db.bottles.where('productId').anyOf(liquidIds).toArray();
    return rows
      .filter((b: any) => String(b.shopId) === shopId && (b.status === 'closed' || b.status === 'opened'))
      .map((b: any) => String(b.id));
  } catch {
    return [];
  }
};

/**
 * Sealed bottles that a transfer moved to the other shop now belong to that shop, so
 * this shop's live channel never hears that they left. This tells the shop's other
 * devices (cashiers too) to read them again by id. They never trust the message:
 * only what the server no longer returns for this shop leaves, and bottles their own
 * unsynced sales use stay.
 */
const announceMovedBottles = (ids: string[]) => {
  if (ids.length) announceDeleted('bottles', ids);
};

// =====================================================================
// Page
// =====================================================================
const Transfers: React.FC = () => {
  const { shopId, userRole } = useAuth();
  const { status } = useConnectivity();
  const online = status !== 'offline';

  const [shops, setShops] = useState<LinkedShop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopsError, setShopsError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  /** Reloads the linked shops; returns them, or null when they could not be read. */
  const loadShops = useCallback(async (): Promise<LinkedShop[] | null> => {
    if (!online || userRole !== 'admin') return null;
    setShopsLoading(true);
    setShopsError(null);
    try {
      const list = await listLinkedShops();
      setShops(list);
      return list;
    } catch (e) {
      setShopsError(errorText(e));
      return null;
    } finally {
      setShopsLoading(false);
    }
  }, [online, userRole]);

  useEffect(() => {
    if (shopId) void loadShops();
  }, [loadShops, shopId]);

  if (userRole !== 'admin') {
    return (
      <div className="glass-card p-8 text-center text-slate-600">Only the shop admin can use Shop Transfers.</div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 glass-card p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/20">
            <ArrowLeftRight size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Shop Transfers</h1>
            <p className="text-slate-500 text-sm">Send stock to a linked shop: it leaves this shop and arrives there in one step.</p>
          </div>
        </div>
      </div>

      {!online && (
        <div role="alert" className="rounded-2xl p-5 border border-rose-200 bg-rose-50 flex items-start gap-3">
          <WifiOff size={20} className="text-rose-600 mt-0.5" />
          <div>
            <p className="font-bold text-rose-800">{OFFLINE_MESSAGE}</p>
            <p className="text-xs text-rose-700 mt-1">
              Linking shops and sending stock happen on the server, so both shops stay correct. Sales keep working offline as usual.
            </p>
          </div>
        </div>
      )}

      <LinkedShopsSection
        online={online}
        shops={shops}
        loading={shopsLoading}
        error={shopsError}
        reload={loadShops}
      />

      {shopId && (
        <NewTransferSection
          online={online}
          shopId={shopId}
          shops={shops}
          onDone={() => setHistoryKey(k => k + 1)}
        />
      )}

      {shopId && <HistorySection online={online} shopId={shopId} reloadKey={historyKey} />}
    </div>
  );
};

// =====================================================================
// a. Linked shops
// =====================================================================
const LinkedShopsSection: React.FC<{
  online: boolean;
  shops: LinkedShop[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<LinkedShop[] | null>;
}> = ({ online, shops, loading, error, reload }) => {
  const [code, setCode] = useState<LinkCode | null>(null);
  const [generating, setGenerating] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [linking, setLinking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [linkedNotice, setLinkedNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  // The linked shops when the code was made: a shop that appears later is
  // the one that used the code.
  const shopsAtCode = useRef<Set<string> | null>(null);

  const expired = code ? new Date(code.expiresAt).getTime() <= Date.now() : false;
  const minutesLeft = code ? Math.max(0, Math.ceil((new Date(code.expiresAt).getTime() - Date.now()) / 60000)) : 0;

  // While a valid code is shown: re-render every 15 s (so its expiry stays
  // true) and look for the other shop using it, also when the window gets
  // the focus back (the owner often enters the code on another device).
  useEffect(() => {
    if (!code || expired) return;
    const check = () => { if (online) void reload(); };
    const t = setInterval(() => { setTick(n => n + 1); check(); }, 15000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', check);
    };
  }, [code, expired, online, reload]);

  useEffect(() => {
    if (!code || !shopsAtCode.current) return;
    const added = shops.find(s => !shopsAtCode.current!.has(s.shopId));
    if (added) {
      setCode(null);
      shopsAtCode.current = null;
      setLinkedNotice(`Linked with ${added.name}. The code is used up.`);
    }
  }, [shops, code]);

  const generate = async () => {
    setGenerating(true);
    setLinkedNotice(null);
    try {
      const current = await reload();
      const created = await createShopLinkCode();
      // Only from a list read just now (else an old list could make a shop
      // look newly linked).
      shopsAtCode.current = current ? new Set(current.map(s => s.shopId)) : null;
      setCode(created);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      toast.success('Code copied');
    } catch {
      toast.error('Could not copy. Select the code and copy it by hand.');
    }
  };

  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = codeInput.replace(/[^a-z0-9]/gi, '');
    if (typed.length !== 10) {
      toast.error('A link code has 10 letters and numbers.');
      return;
    }
    setLinking(true);
    try {
      const res = await linkShopWithCode(typed);
      toast.success(`Linked with ${res.linkedShopName}`);
      setCodeInput('');
      await reload();
    } catch (err) {
      toast.error(errorText(err), { duration: 7000 });
      // The link may exist even so (an earlier answer that was lost): show it.
      await reload();
    } finally {
      setLinking(false);
    }
  };

  const unlink = async (shop: LinkedShop) => {
    setUnlinking(true);
    try {
      const status = await unlinkShop(shop.shopId);
      toast.success(status === 'unlinked' ? `Unlinked from ${shop.name}` : `${shop.name} was not linked any more`);
      setConfirmUnlink(null);
      await reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <section className={sectionCard}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link2 size={20} className="text-violet-600" />
          <h2 className="text-lg font-bold text-slate-900">Linked shops</h2>
        </div>
        <button type="button" className={buttonQuiet} onClick={() => void reload()} disabled={!online || loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {linkedNotice && (
        <div className="rounded-xl p-3 border border-emerald-200 bg-emerald-50 flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 size={16} /> {linkedNotice}
        </div>
      )}

      {shops.length === 0 && !loading && !error && (
        <p className="text-sm text-slate-500">No linked shops yet. Link two shops with a code: one admin makes the code, the other enters it.</p>
      )}

      {shops.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
          {shops.map(shop => (
            <li key={shop.shopId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">{shop.name}</p>
                <p className="text-xs text-slate-500">Linked since {fmtDate(shop.linkedAt)}</p>
              </div>
              {confirmUnlink === shop.shopId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-600">Unlink? Transfers between the two shops stop; the history stays.</span>
                  <button
                    type="button"
                    className="flex items-center gap-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-3 py-2 rounded-xl text-sm font-semibold"
                    onClick={() => void unlink(shop)}
                    disabled={!online || unlinking}
                  >
                    <Unlink size={14} /> Yes, unlink
                  </button>
                  <button type="button" className={buttonQuiet} onClick={() => setConfirmUnlink(null)} disabled={unlinking}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className={buttonQuiet} onClick={() => setConfirmUnlink(shop.shopId)} disabled={!online}>
                  <Unlink size={14} /> Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-100 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">This shop makes a code</p>
          <p className="text-xs text-slate-500">Give the code to the admin of the other shop. It works once and only for 30 minutes.</p>
          <button type="button" className={buttonPrimary} onClick={() => void generate()} disabled={!online || generating}>
            <KeyRound size={16} />
            {generating ? 'Making a code...' : 'Generate link code'}
          </button>
          {code && (
            <div className={cn('rounded-xl p-4 border', expired ? 'bg-slate-50 border-slate-200' : 'bg-violet-50 border-violet-200')}>
              <div className="flex items-center justify-between gap-3">
                <span className={cn('font-mono text-2xl font-bold tracking-[0.2em]', expired ? 'text-slate-400 line-through' : 'text-violet-800')}>
                  {code.code.slice(0, 5)} {code.code.slice(5)}
                </span>
                <button type="button" className={buttonQuiet} onClick={() => void copy()} disabled={expired}>
                  <Copy size={14} /> Copy
                </button>
              </div>
              <p className="text-xs mt-2 text-slate-600">
                {expired
                  ? 'This code has expired. Generate a new one.'
                  : `Valid until ${new Date(code.expiresAt).toLocaleTimeString()} (about ${minutesLeft} min left). Making a new code cancels this one. This page notices when the other shop has used it.`}
              </p>
            </div>
          )}
        </div>

        <form className="rounded-xl border border-slate-100 p-4 space-y-3" onSubmit={e => void link(e)}>
          <p className="text-sm font-bold text-slate-800">Link with a code from the other shop</p>
          <p className="text-xs text-slate-500">Enter the 10-character code the other shop's admin generated.</p>
          <input
            className={cn(inputClass, 'font-mono uppercase tracking-widest')}
            value={codeInput}
            onChange={e => setCodeInput(e.target.value.toUpperCase().slice(0, 13))}
            placeholder="ABCDE FGHJK"
            autoComplete="off"
            spellCheck={false}
            disabled={!online || linking}
            aria-label="Link code"
          />
          <button type="submit" className={buttonPrimary} disabled={!online || linking || !codeInput.trim()}>
            <Link2 size={16} />
            {linking ? 'Linking...' : 'Link shops'}
          </button>
        </form>
      </div>
    </section>
  );
};

// =====================================================================
// b. New transfer
// =====================================================================
interface DraftLine {
  productId: string;
  qty: string;
}

interface SavedDraft {
  mutationId: string;
  toShop: string;
  lines: DraftLine[];
  note: string;
}

// The transfer being sent, saved BEFORE its request goes out and removed
// only when the server has given a definite answer. After a reload, a
// closed app or a lost answer it comes back with the same transfer id, so a
// retry can never send it twice.
const draftKey = (shopId: string) => `vapetrax_transfer_unconfirmed_${shopId}`;

const readSavedDraft = (shopId: string): SavedDraft | null => {
  try {
    const raw = localStorage.getItem(draftKey(shopId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.mutationId === 'string' && typeof d.toShop === 'string' && Array.isArray(d.lines)) return d as SavedDraft;
  } catch { /* unreadable: ignore */ }
  return null;
};

const writeSavedDraft = (shopId: string, d: SavedDraft | null) => {
  try {
    if (d) localStorage.setItem(draftKey(shopId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(shopId));
  } catch { /* storage blocked: the draft still lives in memory */ }
};

const NewTransferSection: React.FC<{
  online: boolean;
  shopId: string;
  shops: LinkedShop[];
  onDone: () => void;
}> = ({ online, shopId, shops, onDone }) => {
  const { products } = useData();
  const saved = useMemo(() => readSavedDraft(shopId), [shopId]);

  const [toShop, setToShop] = useState(saved?.toShop || '');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(saved?.lines || []);
  const [note, setNote] = useState(saved?.note || '');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [live, setLive] = useState<Map<string, LiveStock> | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [settling, setSettling] = useState(false);
  // The transfer id is kept for every retry of the same transfer, so the
  // server never applies it twice. "uncertain": it is not known whether the
  // last attempt was saved; the draft is locked until the server answers.
  const mutationId = useRef<string | null>(saved?.mutationId || null);
  const [uncertain, setUncertain] = useState(!!saved);
  const [sendAnyway, setSendAnyway] = useState(false);
  // Bumped whenever the draft changes: a preview answer for an older draft is dropped.
  const previewSeq = useRef(0);

  // Sales (and other stock changes) of THIS shop that this device has not
  // synced yet. Another shop's items (an owner who logged in to both shops
  // on one device) cannot sync under this shop and are not counted.
  const unsynced = useLiveQuery(
    () => db.syncQueue
      .filter(op => op.type !== 'insert_customer' && (op.payload?.p_shop_id ?? shopId) === shopId)
      .count(),
    [shopId],
    0,
  );

  const locked = uncertain || submitting || previewing || settling;
  const productById = useMemo(() => new Map(products.map((p: any) => [p.id, p])), [products]);
  const toShopName = shops.find(s => s.shopId === toShop)?.name || preview?.toShopName || '';

  const invalidate = () => {
    previewSeq.current += 1;
    setPreview(null);
    setLive(null);
    setLiveFailed(false);
  };

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    const taken = new Set(lines.map(l => l.productId));
    return products
      .filter((p: any) => !taken.has(p.id) && String(p.name || '').toLowerCase().includes(term))
      .slice(0, 8);
  }, [search, products, lines]);

  // Sealed bottles this device has on record (closed and full, of the
  // product's bottle size): what can really be handed over as sealed.
  const liquidKey = useMemo(() => {
    const pairs: [string, number][] = [];
    const seen = new Set<string>();
    for (const p of [...lines.map(l => productById.get(l.productId)), ...results] as any[]) {
      if (!p || seen.has(p.id) || !isLiquidCategory(p.category)) continue;
      const size = transferBottleMl(p.bottleSize);
      if (!size) continue;
      seen.add(p.id);
      pairs.push([p.id, size]);
    }
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return JSON.stringify(pairs);
  }, [lines, results, productById]);

  const sealedCounts = useLiveQuery(async () => {
    const pairs = JSON.parse(liquidKey) as [string, number][];
    const counts = new Map<string, number>();
    if (!pairs.length) return counts;
    const sizeOf = new Map(pairs);
    const rows = await db.bottles.where('productId').anyOf(pairs.map(p => p[0])).toArray();
    for (const b of rows as any[]) {
      const size = sizeOf.get(b.productId);
      if (!size || b.shopId !== shopId || b.status !== 'closed' || b.archivedAt) continue;
      if (Number(b.bottleSize) !== size || Number(b.remainingMl) !== size) continue;
      counts.set(b.productId, (counts.get(b.productId) || 0) + 1);
    }
    return counts;
  }, [liquidKey, shopId], new Map<string, number>());

  const addLine = (productId: string) => {
    if (locked) return;
    setLines(prev => [...prev, { productId, qty: '1' }]);
    setSearch('');
    invalidate();
  };

  const setQty = (productId: string, value: string) => {
    if (locked) return;
    const digits = value.replace(/[^0-9]/g, '').slice(0, 5);
    setLines(prev => prev.map(l => (l.productId === productId ? { ...l, qty: digits } : l)));
    invalidate();
  };

  const removeLine = (productId: string) => {
    if (locked) return;
    setLines(prev => prev.filter(l => l.productId !== productId));
    invalidate();
  };

  /**
   * Per line: what moves, what is available, why it cannot be sent
   * (`problem`, blocks), and what to know (`warning`, does not block: the
   * server makes the final stock check and never lets stock go below zero).
   */
  const checked = lines.map(l => {
    const p: any = productById.get(l.productId);
    const isLiquid = isLiquidCategory(p?.category);
    const size = isLiquid ? transferBottleMl(p?.bottleSize) : null;
    const qty = Number(l.qty);
    const moved = isLiquid ? qty * (size || 0) : qty;
    const liveRow = live?.get(l.productId);
    const available = liveRow ? liveRow.available : Math.max(0, num(p?.stockQuantity));
    const sealed = isLiquid ? (sealedCounts.get(l.productId) ?? 0) : null;
    let problem: string | null = null;
    let warning: string | null = null;
    if (!p) problem = 'This product is no longer on this device. Remove it.';
    else if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) problem = `Enter a whole number from 1 to ${MAX_QTY}.`;
    else if (isLiquid && !size) problem = 'This e-liquid has no bottle size (ml). Set it on the Products page first.';
    else {
      if (moved > available) {
        const text = isLiquid
          ? `Only ${fmtNum(available)} ml in stock (enough for ${Math.floor(available / (size || 1))} bottle(s) of ${size} ml).`
          : `Only ${fmtNum(available)} in stock.`;
        // Only the live server stock can block: this device's copy may be
        // behind (stock received or added on another device).
        if (liveRow) problem = text;
        else warning = `${text} That is this device's copy; "Check transfer" reads the live stock.`;
      }
      if (isLiquid && size && sealed !== null && qty > sealed) {
        const sealedText = `Only ${sealed} sealed bottle(s) of ${size} ml are recorded here. The rest is counted from loose (opened) stock, and new sealed bottles are recorded at the other shop: send only bottles that are really sealed.`;
        warning = warning ? `${warning} ${sealedText}` : sealedText;
      }
    }
    return { ...l, p, isLiquid, size, qty, moved, available, liveRow, sealed, problem, warning };
  });

  const previewProblems = (preview?.lines || []).filter(l => l.problem);
  // The preview must be for this shop and every line (it is dropped when the draft changes).
  const previewFits = !!preview && preview.toShopId === toShop
    && lines.every(l => preview.lines.some(pl => pl.fromProductId === l.productId));
  // While a transfer is unconfirmed, its retry is decided by the server only
  // (it may already be applied, so this device's stock can look short).
  const hasProblems = !uncertain && (checked.some(c => c.problem) || previewProblems.length > 0);
  const needsSyncOk = !uncertain && unsynced > 0 && !sendAnyway;
  const canPreview = online && !!toShop && lines.length > 0 && !locked && !checked.some(c => c.problem);
  const canConfirm = online && !!toShop && lines.length > 0 && (uncertain || previewFits)
    && !hasProblems && !needsSyncOk && !submitting && !previewing && !settling;

  const runPreview = async () => {
    if (!canPreview) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    try {
      const ids = lines.map(l => l.productId);
      const [pv, liveStock] = await Promise.all([previewTransfer(toShop, ids), fetchLiveStock(shopId, ids)]);
      if (seq !== previewSeq.current) return; // the draft changed meanwhile
      setPreview(pv);
      setLive(liveStock);
      setLiveFailed(!liveStock);
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      toast.error(errorText(e), { duration: 7000 });
    } finally {
      setPreviewing(false);
    }
  };

  const resetDraft = () => {
    mutationId.current = null;
    setUncertain(false);
    writeSavedDraft(shopId, null);
    setLines([]);
    setNote('');
    setSendAnyway(false);
    invalidate();
  };

  /**
   * The transfer is saved on the server: clear the draft, tell this shop's other
   * devices which bottles may have left, and update this device's copy.
   */
  const finishDone = async (transferId: string, message: string, productIds: string[], liquidIds: string[]) => {
    resetDraft();
    toast.success(message, { duration: 6000 });
    // Before this device's own refresh removes them; whether or not that refresh works.
    announceMovedBottles(await movableBottleIds(shopId, liquidIds));
    if (await refreshDeviceStock(shopId, productIds, liquidIds)) {
      markTransfersSeen(shopId, [transferId]);
    } else {
      toast.error('The transfer is saved, but this device could not refresh its stock. Press "Update this device\'s stock" under History, or reload the app while online.', { duration: 9000 });
    }
    onDone();
  };

  const draftProductIds = () => {
    const ids = lines.map(l => l.productId);
    const liquidIds = ids.filter(id => isLiquidCategory(productById.get(id)?.category));
    return { ids, liquidIds };
  };

  /**
   * Asks the server whether the unconfirmed transfer was saved. 'saved'
   * settles it. 'not_found' means it is not saved now (a request still on
   * its way could in theory arrive later, so retrying is the safe way on).
   */
  const settleFromServer = async (interactive: boolean): Promise<'saved' | 'not_found' | 'error'> => {
    const mid = mutationId.current;
    if (!mid) return 'not_found';
    setSettling(true);
    try {
      const found = await findTransferByMutationId(mid);
      if (!found) return 'not_found';
      const { ids, liquidIds } = draftProductIds();
      await finishDone(found.id, `The last transfer${found.toShopName ? ` to ${found.toShopName}` : ''} was saved on the server. Nothing will be sent twice.`, ids, liquidIds);
      return 'saved';
    } catch (e) {
      if (interactive) toast.error(errorText(e));
      return 'error';
    } finally {
      setSettling(false);
    }
  };

  // An unconfirmed transfer brought back after a reload: when online, ask
  // the server whether it was saved (it settles itself if so).
  const settleRef = useRef(settleFromServer);
  settleRef.current = settleFromServer;
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!online || !uncertain || submitting || autoChecked.current) return;
    autoChecked.current = true;
    void settleRef.current(false);
  }, [online, uncertain, submitting]);

  const confirm = async () => {
    if (!canConfirm) return;
    // A previous attempt with this id has an unknown outcome.
    const wasUncertain = uncertain;
    if (!mutationId.current) mutationId.current = newClientMutationId();
    const draft: SavedDraft = { mutationId: mutationId.current, toShop, lines, note };
    const items = checked.map(c => ({ productId: c.productId, quantity: c.qty }));
    // Write-ahead: saved before the request goes out (see draftKey).
    writeSavedDraft(shopId, draft);
    setSubmitting(true);
    try {
      const res = await transferStock({ clientMutationId: draft.mutationId, toShopId: toShop, items, note });
      const ids = res.lines.length ? res.lines.map(l => l.fromProductId) : draftProductIds().ids;
      const liquidIds = res.lines.length
        ? res.lines.filter(l => l.mlPerUnit !== null && l.mlPerUnit !== undefined).map(l => l.fromProductId)
        : draftProductIds().liquidIds;
      await finishDone(
        res.transferId,
        res.status === 'duplicate'
          ? 'This transfer was already saved earlier. Nothing was sent twice.'
          : `Sent ${res.lines.length} product(s) to ${res.toShopName || toShopName}.`,
        ids,
        liquidIds,
      );
    } catch (e) {
      // Definitely not saved: the server refused THIS attempt. On a retry,
      // only a refusal made after the server's duplicate check proves it;
      // any other error (expired login, database briefly unreachable, a
      // timeout) says nothing about the earlier attempt.
      if (transferDefinitelyNotSaved(e, wasUncertain)) {
        mutationId.current = null;
        setUncertain(false);
        writeSavedDraft(shopId, null);
        toast.error(errorText(e), { duration: 8000 });
      } else {
        // Unknown outcome: keep the same transfer id (also saved for a
        // reload), so pressing Confirm again can never send it twice.
        setUncertain(true);
        toast.error(`${errorText(e)} It is not known yet whether the transfer was saved. Press "Confirm transfer (retry)" when the connection is back: it is never sent twice.`, { duration: 10000 });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const discard = async () => {
    if (!online) {
      toast.error(OFFLINE_MESSAGE);
      return;
    }
    const outcome = await settleFromServer(true);
    if (outcome !== 'not_found') return; // saved (settled), or the check failed
    if (!window.confirm('This transfer is not on the server, so it was not sent. Discard it?')) return;
    resetDraft();
  };

  const matchText = (l: PreviewLine): string => {
    if (l.problem) return l.problem;
    if (l.match === 'linked') return `${l.toProductName} (same product as before)`;
    if (l.match === 'name') return `${l.toProductName} (same name)`;
    return (l.nameMatches || 0) > 1
      ? `Will be created (${l.nameMatches} products there have this name, so none is used)`
      : 'Will be created there';
  };

  return (
    <section className={sectionCard}>
      <div className="flex items-center gap-2">
        <Send size={20} className="text-violet-600" />
        <h2 className="text-lg font-bold text-slate-900">New transfer</h2>
      </div>

      {uncertain && (
        <div role="alert" className="rounded-xl p-4 border border-amber-200 bg-amber-50 space-y-2">
          <p className="text-sm font-bold text-amber-800">The last transfer is not confirmed yet</p>
          <p className="text-xs text-amber-700">
            Its answer did not arrive. Press "Confirm transfer (retry)" when online: the server will either do it once or tell you it was already done. It is never sent twice.
          </p>
          <button type="button" className={buttonQuiet} onClick={() => void discard()} disabled={!online || submitting || settling}>
            {settling ? 'Checking...' : 'Discard this draft'}
          </button>
        </div>
      )}

      {unsynced > 0 && !uncertain && (
        <div className="rounded-xl p-4 border border-amber-200 bg-amber-50 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <AlertTriangle size={16} />
            This device has {unsynced} change(s) waiting to sync
          </div>
          <p className="text-xs text-amber-700">
            Wait until they reach the server (the sync badge shows 0), so the stock you send is counted correctly.
          </p>
          <label className="flex items-center gap-2 text-xs text-amber-800">
            <input type="checkbox" checked={sendAnyway} onChange={e => setSendAnyway(e.target.checked)} />
            Send anyway (the server still never lets stock go below zero)
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Send to</span>
          <select
            className={inputClass}
            value={toShop}
            onChange={e => { setToShop(e.target.value); invalidate(); }}
            disabled={!online || locked || shops.length === 0}
          >
            <option value="">{shops.length ? 'Pick a linked shop' : 'No linked shops yet'}</option>
            {shops.map(s => <option key={s.shopId} value={s.shopId}>{s.name}</option>)}
            {toShop && !shops.some(s => s.shopId === toShop) && <option value={toShop}>{toShopName || 'Linked shop'}</option>}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Add a product from this shop</span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              className={cn(inputClass, 'pl-10')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products..."
              disabled={!online || locked}
            />
          </div>
        </label>
      </div>

      {results.length > 0 && (
        <ul className="border border-slate-100 rounded-xl divide-y divide-slate-100">
          {results.map((p: any) => {
            const liquid = isLiquidCategory(p.category);
            const size = liquid ? transferBottleMl(p.bottleSize) : null;
            const stockNow = Math.max(0, num(p.stockQuantity));
            const sealed = sealedCounts.get(p.id) ?? 0;
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.category || 'no category'} - in stock {liquid
                      ? `${fmtNum(stockNow)} ml${size ? `, ${sealed} sealed bottle(s) of ${size} ml recorded` : ', no bottle size'}`
                      : `${fmtNum(stockNow)} pcs`}
                  </p>
                </div>
                <button type="button" className={buttonQuiet} onClick={() => addLine(p.id)} disabled={!online || locked}>
                  <Plus size={14} /> Add
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {checked.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-widest">
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-4 py-3 font-bold">Quantity</th>
                <th className="px-4 py-3 font-bold">Moves</th>
                <th className="px-4 py-3 font-bold">Available here</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {checked.map(c => (
                <tr key={c.productId}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{c.p?.name || c.productId}</p>
                    <p className="text-xs text-slate-500">{c.p?.category || ''}</p>
                    {c.problem && !uncertain && <p className="text-xs text-rose-600 mt-1">{c.problem}</p>}
                    {c.warning && !uncertain && <p className="text-xs text-amber-700 mt-1">{c.warning}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60"
                        inputMode="numeric"
                        value={c.qty}
                        onChange={e => setQty(c.productId, e.target.value)}
                        disabled={!online || locked}
                        aria-label={`Quantity of ${c.p?.name || c.productId}`}
                      />
                      <span className="text-xs text-slate-500">{c.isLiquid ? 'sealed bottles' : 'pcs'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {c.isLiquid
                      ? (c.size ? `${fmtNum(c.moved)} ml (${c.size} ml each)` : '-')
                      : `${fmtNum(c.moved || 0)} pcs`}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {fmtNum(c.available)} {c.isLiquid ? 'ml' : 'pcs'}
                    <span className="block text-xs text-slate-500">{c.liveRow ? 'live' : "this device's copy"}</span>
                    {c.liveRow && c.liveRow.pending > 0 && (
                      <span className="block text-xs text-amber-600">{fmtNum(c.liveRow.pending)} held by unsynced sales</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="text-slate-400 hover:text-rose-600 disabled:opacity-40" onClick={() => removeLine(c.productId)} disabled={locked} aria-label="Remove line">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checked.length > 0 && (
        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Note (optional)</span>
          <input
            className={inputClass}
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 500))}
            placeholder="For example: sent with Ali on Monday"
            disabled={!online || locked}
          />
        </label>
      )}

      {preview && previewFits && (
        <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 space-y-3">
          <p className="text-sm font-bold text-slate-800">At {preview.toShopName}</p>
          {liveFailed && (
            <p className="text-xs text-amber-700">Live stock could not be read, so this device's copy is shown. The server still refuses a transfer if stock is short.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-500 text-[10px] uppercase tracking-widest">
                  <th className="px-3 py-2 font-bold">Product</th>
                  <th className="px-3 py-2 font-bold">Arrives as</th>
                  <th className="px-3 py-2 font-bold">Their stock</th>
                  <th className="px-3 py-2 font-bold">Their price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-100">
                {preview.lines.map(l => {
                  const c = checked.find(x => x.productId === l.fromProductId);
                  const unit = l.isLiquid ? 'ml' : 'pcs';
                  const before = l.toStock ?? 0;
                  const after = before + (c?.moved || 0);
                  return (
                    <tr key={l.fromProductId}>
                      <td className="px-3 py-2 text-sm font-semibold text-slate-900">{l.productName || l.fromProductId}</td>
                      <td className={cn('px-3 py-2 text-sm', l.problem ? 'text-rose-600' : 'text-slate-700')}>{matchText(l)}</td>
                      <td className="px-3 py-2 text-sm text-slate-700">{fmtNum(before)} {'->'} {fmtNum(after)} {unit}</td>
                      <td className="px-3 py-2 text-sm text-slate-700">
                        {l.toProductId
                          ? <>{rupees(l.toSellingPrice)}{l.isLiquid && num(l.toPricePerMl) > 0 ? ` (${rupees(l.toPricePerMl)}/ml)` : ''} <span className="text-xs text-slate-500">unchanged</span></>
                          : <>{rupees(l.newSellingPrice)}{l.isLiquid && num(l.newPricePerMl) > 0 ? ` (${rupees(l.newPricePerMl)}/ml)` : ''} <span className="text-xs text-slate-500">your price, change it there</span></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Their cost becomes the average of their stock and what you send. Their selling prices are never changed.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonQuiet} onClick={() => void runPreview()} disabled={!canPreview}>
          <RefreshCw size={16} className={previewing ? 'animate-spin' : ''} />
          {previewing ? 'Checking...' : 'Check transfer'}
        </button>
        <button type="button" className={buttonPrimary} onClick={() => void confirm()} disabled={!canConfirm}>
          <Send size={16} />
          {submitting ? 'Sending...' : uncertain ? 'Confirm transfer (retry)' : 'Confirm transfer'}
        </button>
        {!online && <span className="self-center text-sm font-semibold text-rose-600">{OFFLINE_MESSAGE}</span>}
      </div>
      {submitting && (
        <p className="text-xs text-slate-500">Sending... If the connection drops, this transfer stays saved on this device and can be retried safely.</p>
      )}
      {!previewFits && !uncertain && lines.length > 0 && (
        <p className="text-xs text-slate-500">Press "Check transfer" to see the live stock and how it arrives at the other shop, then confirm.</p>
      )}
    </section>
  );
};

// =====================================================================
// c. History
// =====================================================================
type ItemsState = StockTransferItem[] | 'loading' | { error: string };

const HistorySection: React.FC<{ online: boolean; shopId: string; reloadKey: number }> = ({ online, shopId, reloadKey }) => {
  const [rows, setRows] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, ItemsState>>({});
  const [updating, setUpdating] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const updatingRef = useRef(false);

  /**
   * Re-reads, into this device's copy, the products (and e-liquid bottles)
   * of this shop that these transfers changed: stock that arrived, stock
   * that left from another device, products created by a transfer.
   */
  const updateDeviceStock = useCallback(async (transfers: StockTransfer[], interactive: boolean) => {
    if (updatingRef.current) return;
    if (!transfers.length) {
      if (interactive) toast.success("This device's stock is up to date.");
      return;
    }
    updatingRef.current = true;
    setUpdating(true);
    try {
      const items = await listItemsOfTransfers(transfers.map(t => t.id));
      const byId = new Map(transfers.map(t => [t.id, t]));
      const ids = new Set<string>();
      const liquidIds = new Set<string>();
      const sentLiquidIds = new Set<string>();
      for (const i of items) {
        const t = byId.get(i.transferId);
        if (!t) continue;
        const pid = t.toShop === shopId ? i.toProductId : t.fromShop === shopId ? i.fromProductId : null;
        if (!pid) continue;
        ids.add(pid);
        if (i.mlPerUnit !== null && i.mlPerUnit !== undefined) {
          liquidIds.add(pid);
          if (t.fromShop === shopId) sentLiquidIds.add(pid);
        }
      }
      const before = await movableBottleIds(shopId, [...sentLiquidIds]);
      if (!(await refreshDeviceStock(shopId, [...ids], [...liquidIds]))) {
        throw new Error('The stock could not be read from the server.');
      }
      // Sent bottles this device still had: the shop's other devices may still have
      // them too. Only those that turned out to have left are announced, so a first
      // visit with a long history sends no large message.
      const after = new Set(await movableBottleIds(shopId, [...sentLiquidIds]));
      announceMovedBottles(before.filter(id => !after.has(id)));
      markTransfersSeen(shopId, transfers.map(t => t.id));
      setDeviceError(null);
      const received = transfers.filter(t => t.toShop === shopId).length;
      if (interactive) toast.success("This device's stock is up to date.");
      else if (received > 0) toast.success(`This device now shows the stock of ${received} received transfer(s).`, { duration: 6000 });
    } catch (e) {
      setDeviceError(`This device could not update its stock for the latest transfers (${errorText(e)}). Press "Update this device's stock", or reload the app while online.`);
      if (interactive) toast.error(errorText(e));
    } finally {
      updatingRef.current = false;
      setUpdating(false);
    }
  }, [shopId]);

  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listTransfers(shopId);
      setRows(list);
      // Transfers this device has not applied yet (received ones above all:
      // nothing else tells this device about them).
      const seen = readSeen(shopId);
      const fresh = list.filter(t => !seen || !seen.has(t.id));
      if (fresh.length) void updateDeviceStock(fresh, false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [online, shopId, updateDeviceStock]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const toggle = async (id: string) => {
    if (open[id] && open[id] !== 'loading') {
      setOpen(prev => { const next = { ...prev }; delete next[id]; return next; });
      return;
    }
    if (!online) {
      toast.error(OFFLINE_MESSAGE);
      return;
    }
    setOpen(prev => ({ ...prev, [id]: 'loading' }));
    try {
      const items = await listTransferItems(id);
      setOpen(prev => ({ ...prev, [id]: items }));
    } catch (e) {
      setOpen(prev => ({ ...prev, [id]: { error: errorText(e) } }));
    }
  };

  return (
    <section className={sectionCard}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={20} className="text-violet-600" />
          <h2 className="text-lg font-bold text-slate-900">History</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonQuiet}
            onClick={() => void updateDeviceStock(rows, true)}
            disabled={!online || updating || loading}
            title="Re-reads the stock of every product in this list from the server"
          >
            <Smartphone size={16} className={updating ? 'animate-pulse' : ''} />
            {updating ? 'Updating...' : "Update this device's stock"}
          </button>
          <button type="button" className={buttonQuiet} onClick={() => void load()} disabled={!online || loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Stock that arrives or leaves updates by itself, within a few seconds, on every phone and computer of both shops (cashiers too) while they are online. A device that was offline catches up as soon as it reconnects. If this device still looks behind, press "Update this device's stock".
      </p>

      {deviceError && <p className="text-sm text-amber-700">{deviceError}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!error && !loading && rows.length === 0 && (
        <p className="text-sm text-slate-500">{online ? 'No transfers yet.' : OFFLINE_MESSAGE}</p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
          {rows.map(t => {
            const sent = t.fromShop === shopId;
            const state = open[t.id];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => void toggle(t.id)}
                  aria-expanded={!!state}
                >
                  <div className="flex items-center gap-3">
                    {state ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest',
                      sent ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}>
                      {sent ? 'Sent' : 'Received'}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {sent ? `to ${t.toShopName || 'linked shop'}` : `from ${t.fromShopName || 'linked shop'}`}
                    </span>
                    <span className="text-xs text-slate-500">{t.lineCount} product(s)</span>
                  </div>
                  <div className="text-xs text-slate-500 sm:text-right">
                    {fmtDate(t.createdAt)}{t.createdByName ? ` - ${t.createdByName}` : ''}
                    {t.note && <span className="block italic">"{t.note}"</span>}
                  </div>
                </button>
                {state === 'loading' && <p className="px-10 pb-3 text-xs text-slate-500">Loading...</p>}
                {state && typeof state === 'object' && !Array.isArray(state) && (
                  <p className="px-10 pb-3 text-xs text-rose-600">{state.error}</p>
                )}
                {Array.isArray(state) && (
                  <div className="px-4 pb-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-slate-500 text-[10px] uppercase tracking-widest">
                          <th className="px-3 py-2 font-bold">Product</th>
                          <th className="px-3 py-2 font-bold">Quantity</th>
                          <th className="px-3 py-2 font-bold">Stock moved</th>
                          <th className="px-3 py-2 font-bold">At the receiving shop</th>
                          <th className="px-3 py-2 font-bold">Cost each</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {state.map(i => {
                          const liquid = i.mlPerUnit !== null && i.mlPerUnit !== undefined;
                          return (
                            <tr key={i.fromProductId}>
                              <td className="px-3 py-2 text-sm font-semibold text-slate-900">{i.productName || i.fromProductId}</td>
                              <td className="px-3 py-2 text-sm text-slate-700">{i.quantity} {liquid ? 'sealed bottle(s)' : 'pcs'}</td>
                              <td className="px-3 py-2 text-sm text-slate-700">
                                {liquid ? `${fmtNum(num(i.stockMoved))} ml` : `${fmtNum(num(i.stockMoved))} pcs`}
                                {liquid && (
                                  <span className="block text-xs text-slate-500">
                                    {i.bottlesMoved} bottle(s) moved{i.bottlesCreated ? `, ${i.bottlesCreated} added` : ''}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-sm text-slate-700">
                                {i.toProductName || i.toProductId}
                                {i.createdProduct && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-600">new product</span>}
                              </td>
                              <td className="px-3 py-2 text-sm text-slate-700">{i.costPerUnit === null ? '-' : formatCurrency(num(i.costPerUnit))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default Transfers;
