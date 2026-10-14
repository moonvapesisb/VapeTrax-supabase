// Error messages people can act on. Database codes and SQL wording never reach the
// screen: the raw error goes to the console for the owner, the person at the
// counter gets a plain sentence.

const NETWORK_TEXT = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timed? ?out|aborted|aborterror/i;
// Wording that comes from the database or the API, not from the app.
const TECHNICAL_TEXT = /violates|relation |column |syntax|function |permission denied|jwt|pgrst|duplicate key|null value|constraint|policy|schema|sqlstate|operator|uuid|invalid input|rpc|postgres|could not find/i;

const MESSAGES = {
  network: 'No internet connection, or the server did not answer. Check the connection and try again.',
  notAllowed: 'This account is not allowed to do that. Ask the shop admin.',
  adminOnly: 'Only the shop admin can do that.',
  appendOnly: 'History entries cannot be changed or deleted. Add a new entry to correct one.',
  massDelete: 'For safety, at most 25 can be deleted at once. Nothing was deleted: select 25 or fewer and try again.',
  retired: 'This version of the app is out of date. Reload the app and try again.',
  duplicate: 'This was already saved.',
  rules: 'Not saved: this breaks a shop rule (stock below zero, a refill not in 0.5 ml steps, a part quantity, or a price with paisa).',
  missingLink: 'Not saved: something it refers to was deleted on another device. Refresh and try again.',
  badValue: 'A value is not in the right format. Check the numbers and try again.',
  notFound: 'Not found. It may have been deleted on another device.',
  loginExpired: 'Your login has expired. Log out and log in again.',
  busy: 'The server is busy. Please try again in a moment.',
  wrongPassword: 'Incorrect password.',
} as const;

const textOf = (error: any): string =>
  [error?.message, error?.details, error?.hint].filter(v => typeof v === 'string' && v).join(' ');

/** True when the error means the server could not be reached. */
export const isNetworkError = (error: any): boolean => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!error) return false;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return true;
  if (error?.code === 'network' || error?.status === 0) return true;
  return NETWORK_TEXT.test(textOf(error)) && !error?.code;
};

/**
 * A plain sentence for this error, without database codes. `fallback` is used when
 * the error says nothing a person could act on.
 */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;
  const err: any = error;
  const code = String(err?.code ?? '');
  const text = textOf(err) || (typeof error === 'string' ? error : '');

  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || /incorrect password|invalid login credentials/i.test(text)) {
    return MESSAGES.wrongPassword;
  }
  if (code === 'PT422' || /mass_delete_blocked/i.test(text)) return MESSAGES.massDelete;
  if (code === 'PT410' || /is retired \(deprecated\)/i.test(text)) return MESSAGES.retired;
  if (code === '42501' || code === '403' || /row-level security|permission denied/i.test(text)) {
    if (/append-only/i.test(text)) return MESSAGES.appendOnly;
    if (/only the shop admin/i.test(text)) return MESSAGES.adminOnly;
    return MESSAGES.notAllowed;
  }
  if (code === '23505') return MESSAGES.duplicate;
  if (code === '23514' || code === '23502') return MESSAGES.rules;
  if (code === '23503') return MESSAGES.missingLink;
  if (code === 'PGRST116') return MESSAGES.notFound;
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt expired|invalid jwt/i.test(text)) return MESSAGES.loginExpired;
  if (['57014', '40001', '40P01', '55P03', '53300', '57P01', '57P03'].includes(code)) return MESSAGES.busy;
  if (isNetworkError(err)) return MESSAGES.network;
  // The server's own checks (22023 and friends) explain themselves in words.
  if (code === '22023' || code === 'P0001') {
    const own = typeof err?.message === 'string' ? err.message.trim() : '';
    if (own && !TECHNICAL_TEXT.test(own)) return own;
    return MESSAGES.rules;
  }
  if (code.startsWith('22')) return MESSAGES.badValue;
  const message = typeof err?.message === 'string' ? err.message.trim() : typeof error === 'string' ? error.trim() : '';
  if (message && !code && !TECHNICAL_TEXT.test(message) && message.length <= 240) return message;
  return fallback;
}

/** Logs the raw error for the owner and returns the friendly sentence. */
export function reportError(context: string, error: unknown, fallback?: string): string {
  console.error(`[${context}]`, error);
  return friendlyError(error, fallback);
}
