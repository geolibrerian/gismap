// IndexedDB is the durable store for field observations. Attachments have their
// own reserved store; this version does not accept or export attachment data.
import { normalizeNotes } from './map-notes.js?v=0.2.0';

export class FieldSessionStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.db = null; }
  async open() {
    if (this.db) return this.db;
    if (!this.indexedDB) throw new Error('Local field storage is unavailable in this browser.');
    this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open('gismap-field-notes', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('settings');
        db.createObjectStore('attachments', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local field storage.'));
      request.onblocked = () => reject(new Error('Local field storage is blocked by another browser tab.'));
    });
    this.db.onversionchange = () => { this.db.close(); this.db = null; };
    return this.db;
  }
  async active() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['settings', 'sessions'], 'readonly');
      const request = tx.objectStore('settings').get('active'); let result = null;
      request.onsuccess = () => { if (request.result) { const session = tx.objectStore('sessions').get(request.result); session.onsuccess = () => { result = session.result || null; }; } };
      tx.oncomplete = () => { try { if (result) result.notes = normalizeNotes(result.notes); resolve(result); } catch (error) { reject(error); } };
      tx.onerror = () => reject(tx.error || new Error('Could not read the field session.'));
      tx.onabort = () => reject(tx.error || new Error('Reading the field session was interrupted.'));
    });
  }
  async list() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').getAll();
      tx.oncomplete = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      tx.onerror = () => reject(tx.error || new Error('Could not list field sessions.'));
    });
  }
  async save(session) {
    const clean = { ...session, notes: normalizeNotes(session.notes), revision: (session.revision || 0) + 1, updatedAt: new Date().toISOString() };
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'settings'], 'readwrite');
      let conflict = false;
      const sessions = tx.objectStore('sessions');
      const existing = sessions.get(clean.id);
      existing.onsuccess = () => {
        if ((existing.result?.revision || 0) !== (session.revision || 0)) { conflict = true; tx.abort(); return; }
        sessions.put(clean); tx.objectStore('settings').put(clean.id, 'active');
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not save the field session.'));
      tx.onabort = () => reject(conflict ? new Error('This field session changed in another tab. Resume the latest version before saving.') : tx.error || new Error('Saving the field session was interrupted.'));
    });
    return clean;
  }
}

export function newFieldSession(project) {
  const now = new Date().toISOString();
  return { id: `field_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`, title: 'Field notes', description: '', collector: '', projectId: project.id, createdAt: now, updatedAt: now, notes: structuredClone(project.notes || []) };
}

// Stage changes through the existing registry, then commit IndexedDB before
// publishing them to the project mirror. A failed transaction never reports a save.
export class FieldSessionController {
  constructor(projectManager, events, store = new FieldSessionStore()) {
    Object.assign(this, { projectManager, events, store }); this.session = null; this.pending = Promise.resolve();
  }
  async inspect() { return this.store.active(); }
  async resume(session) {
    if (this.projectManager.current.notes?.length) throw new Error('Open an empty project before resuming a field session; existing project notes will not be overwritten.');
    const notes = normalizeNotes(session.notes);
    this.session = { ...structuredClone(session), resumedIntoProjectId: this.projectManager.current.id };
    this.projectManager.current.notes = notes;
    this.events?.publish('notes:changed', { action: 'resume', noteId: null, count: notes.length });
  }
  mutate(action, ...args) {
    const operation = this.pending.then(async () => {
      const project = this.projectManager.current;
      if (!this.session || this.session.projectId !== project.id && !this.session.resumedIntoProjectId) this.session = newFieldSession(project);
      if (this.session.resumedIntoProjectId && this.session.resumedIntoProjectId !== project.id) this.session = newFieldSession(project);
      const session = this.session;
      const { MapNotesRegistry } = await import('./map-notes.js?v=0.2.0');
      const draft = { id: project.id, notes: structuredClone(project.notes || []) };
      const registry = new MapNotesRegistry({ project: () => draft });
      if (action === 'create') args[0] = { ...args[0], fieldSessionId: session.id, observedAt: new Date().toISOString(), revision: 1 };
      if (action === 'update') { const old = registry.get(args[0]); args[1] = { ...args[1], revision: (old?.revision || 0) + 1 }; }
      const result = registry[action](...args);
      if (action === 'remove' && !result) return result;
      const saved = await this.store.save({ ...session, notes: draft.notes });
      // A project switch while the transaction is running must not write into the new project.
      if (this.projectManager.current !== project) throw new Error('The observation was saved locally, but the project changed. Resume the field session to see it.');
      this.session = saved;
      project.notes = draft.notes;
      try { this.projectManager.persistCurrentIfSaved(); } catch { /* IndexedDB remains the durable copy. */ }
      this.events?.publish('notes:changed', { action, noteId: result?.id || (action === 'remove' ? args[0] : null), count: draft.notes.length });
      return result;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
