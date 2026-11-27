/**
 * Native-app detection and lazy access to the Capacitor plugins.
 * The same files run on the website and inside the Android/iOS app; only the app has
 * window.Capacitor injected before any page script runs.
 */

const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;

export const isNativeApp = Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
export const nativePlatform = isNativeApp ? cap.getPlatform() : 'web';

let vendorPromise = null;

/** Resolves to the bundled Capacitor exports (core/vendor/capacitor.js), or null on the website. */
export function loadNative() {
  if (!isNativeApp) return Promise.resolve(null);
  if (!vendorPromise) {
    vendorPromise = import('./vendor/capacitor.js').catch((err) => {
      vendorPromise = null;
      throw err;
    });
  }
  return vendorPromise;
}

export function hasNativePlugin(name) {
  return isNativeApp && typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable(name);
}

/** Lock to landscape inside card games (app only; the website just shows a rotate hint). */
export async function lockLandscape() {
  if (!hasNativePlugin('ScreenOrientation')) return false;
  try {
    const { ScreenOrientation } = await loadNative();
    await ScreenOrientation.lock({ orientation: 'landscape' });
    return true;
  } catch {
    return false;
  }
}

export async function unlockOrientation() {
  if (!hasNativePlugin('ScreenOrientation')) return;
  try {
    const { ScreenOrientation } = await loadNative();
    await ScreenOrientation.unlock();
  } catch {
    // ignore
  }
}

/** Keep the screen on while a networked game is running so the host's links don't drop. */
export async function keepAwake(on) {
  if (!hasNativePlugin('KeepAwake')) return;
  try {
    const { KeepAwake } = await loadNative();
    if (on) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  } catch {
    // ignore
  }
}

export async function hapticTap(style = 'light') {
  if (!hasNativePlugin('Haptics')) return;
  try {
    const { Haptics, ImpactStyle } = await loadNative();
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] || ImpactStyle.Light });
  } catch {
    // ignore
  }
}
