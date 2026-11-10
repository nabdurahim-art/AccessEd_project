// IndexedDB: packs, their files, progress and quiz attempts. Works with no internet.
// Stores: meta (cached catalog, device id), packs, files, progress, attempts.
let opening;
function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open('accessed', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('meta', { keyPath: 'key' });
        d.createObjectStore('packs', { keyPath: 'pack_id' });
        d.createObjectStore('files', { keyPath: 'key' });
        d.createObjectStore('progress', { keyPath: 'key' });
        d.createObjectStore('attempts', { keyPath: 'attempt_id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return opening;
}

const run = (store, mode, fn) =>
  open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let out;
    const rq = fn(tx.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));

export const put = (store, value) => run(store, 'readwrite', (os) => os.put(value));
export const get = (store, key) => run(store, 'readonly', (os) => os.get(key));
export const getAll = (store) => run(store, 'readonly', (os) => os.getAll());
export const remove = (store, key) => run(store, 'readwrite', (os) => os.delete(key));

export const putMany = (store, items) =>
  open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    items.forEach((i) => os.put(i));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));

// Remove every stored file of one pack (used before saving a newer version).
export const removeFilesOfPack = (packId) =>
  open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const rq = tx.objectStore('files').openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (c) { if (c.value.pack_id === packId) c.delete(); c.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
