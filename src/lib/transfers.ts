import { supabase } from './supabase';

// Shop-to-shop stock transfers (migration 20261012200000_shop_links_and_transfers).
// Everything here needs the internet: the server moves the stock in one
// transaction, so a transfer is either fully done or not done at all.

export interface LinkedShop {
  shopId: string;
  name: string;
  linkedAt: string | null;
}

export interface LinkCode {
  code: string;
  expiresAt: string;
}

export type MatchKind = 'linked' | 'name' | 'new';

export interface PreviewLine {
  fromProductId: string;
  productName?: string;
  category?: string | null;
  isLiquid?: boolean;
  /** ml per sealed bottle (e-liquid only). */
  bottleSize?: number | null;
  fromStock?: number;
  match?: MatchKind;
  nameMatches?: number;
  toProductId?: string | null;
  toProductName?: string | null;
  toStock?: number | null;
  toSellingPrice?: number | null;
  toPricePerMl?: number | null;
  newSellingPrice?: number | null;
  newPricePerMl?: number | null;
  /** Why this line cannot be sent as it is. */
  problem?: string | null;
}

export interface TransferPreview {
  toShopId: string;
  toShopName: string;
  lines: PreviewLine[];
}

export interface TransferItemInput {
  productId: string;
  /** Pieces, or sealed bottles for e-liquid. Whole number, 1 to 10000. */
  quantity: number;
}

export interface TransferLine {
  fromProductId: string;
  toProductId: string;
  productName: string | null;
  toProductName: string | null;
  category: string | null;
  quantity: number;
  mlPerUnit: number | null;
  stockMoved: number;
  costPerUnit: number | null;
  createdProduct: boolean;
  matchedBy: MatchKind | null;
  bottlesMoved: number;
  bottlesCreated: number;
}

export interface TransferResult {
  /** 'duplicate': this transfer id was already applied earlier (a retry). */
  status: 'completed' | 'duplicate';
  transferId: string;
  toShopName: string | null;
  lines: TransferLine[];
}

export interface StockTransfer {
  id: string;
  clientMutationId: string;
  fromShop: string;
  toShop: string;
  fromShopName: string | null;
  toShopName: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  note: string | null;
  status: string;
  lineCount: number;
}

export interface StockTransferItem {
  transferId: string;
  fromProductId: string;
  toProductId: string;
  productName: string | null;
  toProductName: string | null;
  category: string | null;
  quantity: number;
  mlPerUnit: number | null;
  stockMoved: number;
  costPerUnit: number | null;
  createdProduct: boolean;
  matchedBy: MatchKind | null;
  bottlesMoved: number;
  bottlesCreated: number;
}

/**
 * A failed call.
 *
 * `uncertain`: the answer says nothing reliable about whether the request
 * ran (connection dropped, timeout, expired login, database briefly
 * unreachable). For a transfer it may or may not have been saved: keep the
 * SAME clientMutationId and retry. The server applies a transfer id once and
 * answers 'duplicate' to a retry.
 *
 * `notApplied`: transfer_stock looked this transfer id up, found it not
 * saved, and refused (hint 'transfer_not_applied'). Only this proves that an
 * earlier attempt with the same id, whose answer was lost, did not go through.
 */
export class TransferError extends Error {
  code?: string;
  uncertain: boolean;
  notApplied: boolean;
  constructor(message: string, code?: string, uncertain = false, notApplied = false) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
    this.uncertain = uncertain;
    this.notApplied = notApplied;
  }
}

const NETWORK_MESSAGE = 'Could not reach the server. Check the internet connection and try again.';
const TIMEOUT_MESSAGE = 'The server did not answer in time. Check the internet connection and try again.';
const RETRY_LATER_MESSAGE = 'The server could not take the request just now (login refresh or a short server problem). Try again in a moment.';
const NOT_SET_UP_MESSAGE = 'Shop transfers are not set up on the server yet (the database update has not been applied).';

/** transfer_stock's mark on refusals made after its duplicate check. */
const NOT_APPLIED_HINT = 'transfer_not_applied';

/** Read calls give up after this; transfer_stock after TRANSFER_TIMEOUT_MS. */
const READ_TIMEOUT_MS = 20000;
const TRANSFER_TIMEOUT_MS = 30000;

/** A Postgres error code (5 characters) or a PostgREST one: the server answered. */
const isServerCode = (code: unknown): code is string =>
  typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST'));

// Answers that come BEFORE the database runs anything (or run it as someone
// else): the database or its pool unreachable (PGRST000-003), the schema
// cache reloading (PGRST002), an expired or rejected login (PGRST301-303,
// HTTP 401), and "permission denied for function", which is what an expired
// session that fell back to the anon key gets. They say nothing about the
// transfer: safe to retry with the same id, never "refused, nothing changed".
const RETRYABLE_CODES = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', 'PGRST301', 'PGRST302', 'PGRST303']);
const NOT_SET_UP_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

type ApiError = { message?: string; code?: string; hint?: string | null } | null | undefined;

const toTransferError = (error: ApiError, status?: number): TransferError => {
  const code = error?.code;
  const message = error?.message || '';
  if (code && NOT_SET_UP_CODES.has(code)) return new TransferError(NOT_SET_UP_MESSAGE, code);
  if ((code && RETRYABLE_CODES.has(code)) || status === 401
      || (code === '42501' && /permission denied for function/i.test(message))) {
    return new TransferError(RETRY_LATER_MESSAGE, code, true);
  }
  if (isServerCode(code)) {
    return new TransferError(message || 'The server refused the request.', code, false, error?.hint === NOT_APPLIED_HINT);
  }
  return new TransferError(NETWORK_MESSAGE, code, true);
};

/** Aborts after `ms`, also in browsers without AbortSignal.timeout. */
const timeoutSignal = (ms: number): AbortSignal => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

/**
 * Runs one Supabase request with a time limit. The request is aborted at
 * `ms`; the extra second covers a login refresh that hangs before the
 * request is even sent (an aborted signal then stops it from going out).
 * A timeout is reported as `uncertain`: the request may still have run.
 */
async function withTimeout<R extends { data: unknown; error: any; status?: number }>(
  run: (signal: AbortSignal) => PromiseLike<R>,
  ms: number,
): Promise<R> {
  const signal = timeoutSignal(ms);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TransferError(TIMEOUT_MESSAGE, undefined, true)), ms + 1000);
  });
  try {
    return await Promise.race([Promise.resolve(run(signal)), late]);
  } catch (e) {
    if (e instanceof TransferError) throw e;
    throw new TransferError(signal.aborted ? TIMEOUT_MESSAGE : NETWORK_MESSAGE, undefined, true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callRpc<T>(fn: string, args: Record<string, unknown> = {}, ms = READ_TIMEOUT_MS): Promise<T> {
  const res = await withTimeout(signal => supabase.rpc(fn, args).abortSignal(signal), ms);
  if (res.error) {
    // An aborted request comes back as an error with no code.
    const err = toTransferError(res.error, res.status);
    if (err.uncertain && !err.code && /abort/i.test(String(res.error?.message || '') + String(res.error?.hint || ''))) {
      throw new TransferError(TIMEOUT_MESSAGE, undefined, true);
    }
    throw err;
  }
  if (res.data === null || res.data === undefined) {
    throw new TransferError('The server sent an empty answer. Please try again.', undefined, true);
  }
  return res.data as T;
}

/**
 * After a failed transferStock call: true only when the transfer was
 * definitely NOT saved, so the draft may be edited and get a new id.
 * `afterLostAnswer`: an earlier attempt with the same id has an unknown
 * outcome. Then only a refusal made after the server's duplicate check
 * (notApplied) proves it; any other error says nothing about that earlier
 * attempt, which may have been saved.
 */
export const transferDefinitelyNotSaved = (e: unknown, afterLostAnswer: boolean): boolean =>
  e instanceof TransferError && !e.uncertain && (e.notApplied || !afterLostAnswer);

/** A new id for one transfer. Keep it for every retry of that same transfer. */
export const newClientMutationId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** Shop admin only. Valid 30 minutes, once; a new code replaces the previous one. */
export const createShopLinkCode = () => callRpc<LinkCode>('create_shop_link_code');

/** Shop admin only. Links this shop with the shop that made the code. */
export const linkShopWithCode = async (code: string): Promise<{ linkedShopId: string; linkedShopName: string }> => {
  const res = await callRpc<{ status: string; linkedShopId?: string; linkedShopName?: string; message?: string; reason?: string }>(
    'link_shop_with_code', { p_code: code });
  if (res.status !== 'linked' || !res.linkedShopId) {
    throw new TransferError(res.message || 'That code was not accepted.', res.reason);
  }
  return { linkedShopId: res.linkedShopId, linkedShopName: res.linkedShopName || 'the other shop' };
};

/** Shop admin of either shop. Old transfers stay in the history. */
export const unlinkShop = async (otherShopId: string): Promise<'unlinked' | 'not_linked'> => {
  const res = await callRpc<{ status: 'unlinked' | 'not_linked' }>('unlink_shop', { p_other: otherShopId });
  return res.status;
};

export const listLinkedShops = async (): Promise<LinkedShop[]> => {
  const res = await callRpc<LinkedShop[]>('list_linked_shops');
  return Array.isArray(res) ? res : [];
};

/** What the transfer would do at the other shop (match, its stock and prices). Changes nothing. */
export const previewTransfer = (toShopId: string, productIds: string[]) =>
  callRpc<TransferPreview>('preview_transfer', { p_to_shop: toShopId, p_product_ids: productIds });

/** Moves the stock in one server transaction. Throws TransferError when refused or unconfirmed. */
export const transferStock = async (params: {
  clientMutationId: string;
  toShopId: string;
  items: TransferItemInput[];
  note?: string;
}): Promise<TransferResult> => {
  const res = await callRpc<TransferResult>('transfer_stock', {
    p_client_mutation_id: params.clientMutationId,
    p_to_shop: params.toShopId,
    p_items: params.items,
    p_note: params.note?.trim() || null,
  }, TRANSFER_TIMEOUT_MS);
  if (!res || (res.status !== 'completed' && res.status !== 'duplicate') || !res.transferId) {
    throw new TransferError('The server answer could not be read. Check History before trying again.', undefined, true);
  }
  return res;
};

/** This shop's transfers, sent and received, newest first. */
export const listTransfers = async (shopId: string, limit = 100): Promise<StockTransfer[]> => {
  const res = await withTimeout(signal => supabase
    .from('stock_transfers')
    .select('*')
    .or(`fromShop.eq.${shopId},toShop.eq.${shopId}`)
    .order('createdAt', { ascending: false })
    .limit(limit)
    .abortSignal(signal), READ_TIMEOUT_MS);
  if (res.error) throw toTransferError(res.error, res.status);
  return (res.data as StockTransfer[]) || [];
};

export const listTransferItems = async (transferId: string): Promise<StockTransferItem[]> => {
  const res = await withTimeout(signal => supabase
    .from('stock_transfer_items')
    .select('*')
    .eq('transferId', transferId)
    .order('productName', { ascending: true })
    .abortSignal(signal), READ_TIMEOUT_MS);
  if (res.error) throw toTransferError(res.error, res.status);
  return (res.data as StockTransferItem[]) || [];
};

/** The lines of several transfers at once (at most 100 ids per call). */
export const listItemsOfTransfers = async (transferIds: string[]): Promise<StockTransferItem[]> => {
  const ids = [...new Set(transferIds)];
  const out: StockTransferItem[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await withTimeout(signal => supabase
      .from('stock_transfer_items')
      .select('*')
      .in('transferId', chunk)
      .abortSignal(signal), READ_TIMEOUT_MS);
    if (res.error) throw toTransferError(res.error, res.status);
    out.push(...((res.data as StockTransferItem[]) || []));
  }
  return out;
};

/**
 * The saved transfer with this transfer id (clientMutationId), or null when
 * the server has none. Used to settle a transfer whose answer was lost.
 * Note: null does not prove much if the request was sent only moments ago.
 */
export const findTransferByMutationId = async (clientMutationId: string): Promise<StockTransfer | null> => {
  const res = await withTimeout(signal => supabase
    .from('stock_transfers')
    .select('*')
    .eq('clientMutationId', clientMutationId)
    .limit(1)
    .abortSignal(signal), READ_TIMEOUT_MS);
  if (res.error) throw toTransferError(res.error, res.status);
  const rows = (res.data as StockTransfer[]) || [];
  return rows[0] || null;
};

/** e-liquid is counted in ml and moves as sealed bottles; everything else in pieces. */
export const isLiquidCategory = (category: unknown): boolean =>
  String(category ?? '').trim().toLowerCase() === 'e-liquid';

/**
 * Bottle size in ml as the server reads it ('30', '30ml', '60 ML'); null when
 * it is not a plain number (the server then refuses to transfer that e-liquid).
 */
export const transferBottleMl = (bottleSize: unknown): number | null => {
  if (typeof bottleSize === 'number') return Number.isFinite(bottleSize) && bottleSize > 0 && bottleSize <= 1000 ? bottleSize : null;
  const m = /^\s*([0-9]{1,4}(?:\.[0-9]{1,2})?)\s*(?:ml)?\s*$/i.exec(String(bottleSize ?? ''));
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v <= 1000 ? v : null;
};
