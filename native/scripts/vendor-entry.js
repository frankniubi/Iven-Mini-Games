/**
 * Entry point for core/vendor/capacitor.js (built by build-vendor.mjs with esbuild).
 *
 * The hall is a plain static site with native ES modules and no bundler, so the
 * Capacitor JS runtime + plugin proxies are pre-bundled into one ESM file that the
 * web code can `import('./vendor/capacitor.js')` when it runs inside the app.
 * Importing it in a normal browser is harmless: every plugin falls back to its web
 * implementation (or an "unimplemented" rejection) and nothing runs at import time
 * except registering proxies.
 */

import { registerPlugin } from '@capacitor/core';

export { Capacitor, registerPlugin, CapacitorHttp } from '@capacitor/core';
export { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
export { FileTransfer } from '@capacitor/file-transfer';
export { App } from '@capacitor/app';
export { ScreenOrientation } from '@capacitor/screen-orientation';
export { StatusBar, Style } from '@capacitor/status-bar';
export { Haptics, ImpactStyle } from '@capacitor/haptics';
export { KeepAwake } from '@capacitor-community/keep-awake';

// Local multiplayer: BLE central + peripheral/GATT server, raw TCP sockets, Bonjour/NSD discovery.
export { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';
export { TcpSocket, DataEncoding } from 'capacitor-tcp-socket';
export { ZeroConf } from '@mhaberler/capacitor-zeroconf-nsd';

// Built-in native plugin (Android: com.getcapacitor.plugin.WebView, iOS: CAPWebViewPlugin):
// setServerBasePath / getServerBasePath / persistServerBasePath / setServerAssetPath.
// @capacitor/core also exports a `WebView` proxy, but it is a tree-shaken /*#__PURE__*/
// registration, so this is the only registration in the bundle (same proxy either way).
export const WebView = registerPlugin('WebView');

// In-app Android plugin (android/app/src/main/java/cc/mcbar/minigames/AppBridgePlugin.java):
//   copyBundledWeb({ to }) -> { files, bytes }   getLocalIp() -> { ip: string | null }
// Not implemented on iOS/web (calls reject with UNIMPLEMENTED there).
export const AppBridge = registerPlugin('AppBridge');
