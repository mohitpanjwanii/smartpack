/**
 * Saves the browser-preview database in IndexedDB so it survives a page
 * reload. Only used when SmartPack runs in a desktop browser for testing;
 * on phones the native SQLite file is used instead.
 */
const STORE = 'files';
const KEY = 'smartpack.sqlite';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('smartpack-preview', 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadBytes(): Promise<Uint8Array | null> {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBytes(bytes: Uint8Array): Promise<void> {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
