/* IndexedDB дээр суурилсан энгийн хадгалах сан */
const DB = (() => {
  const NAME = "buteelDugneltDB";
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    getAll: () => tx("records", "readonly", s => s.getAll()),
    get: id => tx("records", "readonly", s => s.get(id)),
    put: rec => tx("records", "readwrite", s => s.put(rec)),
    del: id => tx("records", "readwrite", s => s.delete(id)),
    clear: () => Promise.all([
      tx("records", "readwrite", s => s.clear()),
      tx("kv", "readwrite", s => s.clear())
    ]),
    getKV: key => tx("kv", "readonly", s => s.get(key)),
    setKV: (key, val) => tx("kv", "readwrite", s => s.put(val, key))
  };
})();
