// Identifies which app build and which device sent a request, so the server
// can tell old and new app versions apart (legacy_rpc_calls, gate_r0.sql).
//
// These go INSIDE the checkout payload (p_sale_data.clientBuild and
// p_sale_data.deviceId), never as custom HTTP headers: a custom header needs
// a CORS preflight, and a rejected preflight would break every request.

/** The git commit this app was built from (set by vite.config.ts), or 'dev'. */
export const CLIENT_BUILD: string =
  typeof __APP_BUILD__ === 'string' && __APP_BUILD__ ? __APP_BUILD__ : 'dev';

const DEVICE_ID_KEY = 'vapetrax_device_id';
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

let memoryDeviceId: string | null = null;

const newDeviceId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * A random id for this device, kept in localStorage. It is not personal data:
 * it only lets the owner see how many devices still run an old build.
 * Logging out does not change it.
 */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
    const fresh = newDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing or storage blocked: keep one id for this page load.
    if (!memoryDeviceId) memoryDeviceId = newDeviceId();
    return memoryDeviceId;
  }
}
