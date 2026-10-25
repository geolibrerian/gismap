// Field Mode stores its independent records and binary assets separately from
// legacy field-note sessions. This prevents a standalone install from changing
// the version of the map app's existing IndexedDB database.
const DB_NAME = "gismap-field-mode";
const DB_VERSION = 3;
const requestResult = (request, fallback) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result ?? fallback);
  request.onerror = () => reject(request.error || new Error("Local field storage is unavailable."));
});

export class FieldRecordStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.db = null; }
  async open() {
    if (this.db) return this.db;
    if (!this.indexedDB) throw new Error("IndexedDB is unavailable, so Field Mode cannot safely store records.");
    this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("fieldRecords")) db.createObjectStore("fieldRecords", { keyPath: "id" });
        if (!db.objectStoreNames.contains("fieldAssets")) db.createObjectStore("fieldAssets", { keyPath: "id" });
        if (!db.objectStoreNames.contains("fieldTasks")) db.createObjectStore("fieldTasks", { keyPath: "id" });
        // Incoming work and outgoing receipts are an audit trail separate from
        // task content.  A future server can reconcile this ledger without
        // changing the locally authored task or observation records.
        if (!db.objectStoreNames.contains("fieldHandoffs")) db.createObjectStore("fieldHandoffs", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open Field Mode storage."));
      request.onblocked = () => reject(new Error("Close other GISMap tabs to update Field Mode storage."));
    });
    this.db.onversionchange = () => { this.db.close(); this.db = null; };
    return this.db;
  }
  async listRecords() {
    const db = await this.open();
    const records = await requestResult(db.transaction("fieldRecords", "readonly").objectStore("fieldRecords").getAll(), []);
    return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async saveRecord(record) {
    const db = await this.open(); const tx = db.transaction("fieldRecords", "readwrite");
    tx.objectStore("fieldRecords").put(record);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not save this observation.")); tx.onabort = () => reject(tx.error || new Error("Saving this observation was interrupted.")); });
    return record;
  }
  async deleteRecord(id) {
    const db = await this.open(); const tx = db.transaction("fieldRecords", "readwrite"); tx.objectStore("fieldRecords").delete(id);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not remove this observation.")); });
  }
  async saveAsset(asset) {
    const db = await this.open(); const tx = db.transaction("fieldAssets", "readwrite"); tx.objectStore("fieldAssets").put(asset);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not save this attachment.")); });
    return asset;
  }
  async getAssets(ids) {
    const db = await this.open(); const tx = db.transaction("fieldAssets", "readonly"); const store = tx.objectStore("fieldAssets");
    const assets = await Promise.all(ids.map((id) => requestResult(store.get(id), null)));
    return assets.filter(Boolean);
  }
  async deleteAssets(ids) {
    if (!ids.length) return;
    const db = await this.open(); const tx = db.transaction("fieldAssets", "readwrite"); const assets = tx.objectStore("fieldAssets");
    ids.forEach((id) => assets.delete(id));
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not remove observation attachments.")); });
  }
  async listTasks() {
    const db = await this.open();
    const tasks = await requestResult(db.transaction("fieldTasks", "readonly").objectStore("fieldTasks").getAll(), []);
    return tasks.sort((a, b) => String(b.updatedAt || b.importedAt || "").localeCompare(String(a.updatedAt || a.importedAt || "")));
  }
  async saveTask(task) {
    const db = await this.open(); const tx = db.transaction("fieldTasks", "readwrite"); tx.objectStore("fieldTasks").put(task);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not save this field task.")); });
    return task;
  }
  async listHandoffs() {
    const db = await this.open();
    const handoffs = await requestResult(db.transaction("fieldHandoffs", "readonly").objectStore("fieldHandoffs").getAll(), []);
    return handoffs.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  }
  async saveHandoff(handoff) {
    const db = await this.open(); const tx = db.transaction("fieldHandoffs", "readwrite"); tx.objectStore("fieldHandoffs").put(handoff);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("Could not save this handoff state.")); });
    return handoff;
  }
  async getHandoff(id) {
    const db = await this.open();
    return requestResult(db.transaction("fieldHandoffs", "readonly").objectStore("fieldHandoffs").get(id), null);
  }
}
