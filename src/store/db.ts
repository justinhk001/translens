/**
 * 本地存储：优先 IndexedDB（容量大），不可用时退回 localStorage，再不行就只存内存。
 * 两个仓库：kv（应用状态）与 cache（段落级翻译缓存）。
 */
type Store = 'kv' | 'cache';
const DB_NAME = 'translens';
const LS_PREFIX = 'translens:';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((ok, fail) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

export async function dbGet<T>(store: Store, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (db) { try { return await tx<T>(db, store, 'readonly', s => s.get(key)); } catch { /* fall through */ } }
  try { const v = localStorage.getItem(LS_PREFIX + store + ':' + key); if (v != null) return JSON.parse(v); } catch { /* ignore */ }
  return memory.get(store + ':' + key) as T | undefined;
}

export async function dbSet(store: Store, key: string, value: unknown): Promise<'idb' | 'local' | 'memory'> {
  const db = await openDb();
  if (db) { try { await tx(db, store, 'readwrite', s => s.put(value, key)); return 'idb'; } catch { /* fall through */ } }
  try { localStorage.setItem(LS_PREFIX + store + ':' + key, JSON.stringify(value)); return 'local'; } catch { /* ignore */ }
  memory.set(store + ':' + key, value);
  return 'memory';
}

export async function dbClear(store: Store): Promise<void> {
  const db = await openDb();
  if (db) { try { await tx(db, store, 'readwrite', s => s.clear()); } catch { /* ignore */ } }
  try { Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX + store + ':')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  for (const k of [...memory.keys()]) if (k.startsWith(store + ':')) memory.delete(k);
}

export async function dbCount(store: Store): Promise<number> {
  const db = await openDb();
  if (db) { try { return await tx<number>(db, store, 'readonly', s => s.count()); } catch { /* ignore */ } }
  return 0;
}

export async function storageInfo(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return { usage: est?.usage, quota: est?.quota, persisted };
  } catch { return {}; }
}

export async function requestPersist(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
