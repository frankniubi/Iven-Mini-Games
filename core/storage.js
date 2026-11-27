/**
 * Namespaced safe localStorage wrapper for the Game Hall and all mini-games.
 * Falls back cleanly to in-memory Map if storage is blocked (e.g. strict Safari private mode).
 */

const PREFIX = 'arcade_box_v1:';
const memoryFallback = new Map();

function rawGet(fullKey) {
  try {
    const val = window.localStorage.getItem(fullKey);
    return val !== null ? val : memoryFallback.get(fullKey) ?? null;
  } catch {
    return memoryFallback.get(fullKey) ?? null;
  }
}

function rawSet(fullKey, value) {
  memoryFallback.set(fullKey, value);
  try {
    window.localStorage.setItem(fullKey, value);
  } catch {
    // Quota or private mode; memoryFallback preserves session state
  }
}

function rawRemove(fullKey) {
  memoryFallback.delete(fullKey);
  try {
    window.localStorage.removeItem(fullKey);
  } catch {
    // ignore
  }
}

export function createNamespaceStorage(namespace) {
  const nsPrefix = `${PREFIX}${namespace}:`;
  return {
    get(key, defaultValue = null) {
      const raw = rawGet(nsPrefix + key);
      if (raw === null) return defaultValue;
      try {
        return JSON.parse(raw);
      } catch {
        return defaultValue;
      }
    },
    set(key, value) {
      try {
        rawSet(nsPrefix + key, JSON.stringify(value));
      } catch {
        // ignore serialization error
      }
    },
    remove(key) {
      rawRemove(nsPrefix + key);
    },
  };
}

export const hallStorage = createNamespaceStorage('hall');
