// Sending data Map Notes to GISMap SI's bots, and showing what they did. A note goes to SI only
// when its author presses "Send to SI bots"; nothing is sent in the background. SI's notes
// agent (RATATOSKR) triages it into a proposal that a person approves in SI before anything
// changes, and reports a status back that the note shows.

export const NOTES_SCOPE = "notes:write";
const SENT_KEY = "gismap-online:si-notes:v1"; // note id -> SI workspace id. No tokens, no note text.
const POLL_MS = 30000;

/** A label and tone for the chip on a note, from SI's status for it. */
export function noteChip(status) {
  const known = {
    needs_target: ["Sent · SI is finding the data", "waiting"],
    needs_input: ["Sent · waiting for a reviewer", "waiting"],
    proposed: ["Sent · waiting for approval", "waiting"],
    in_progress: ["Approved · in progress", "working"],
    done: ["Done", "done"],
    answered: ["Answered", "done"],
    acknowledged: ["Received", "info"],
    rejected: ["Declined", "declined"],
    failed: ["Didn't work", "declined"],
    superseded: ["Replaced by a newer send", "info"],
  };
  const [label, tone] = known[status] || ["Sent", "info"];
  return { label, tone };
}

export class SiNotes {
  /** `connection`: the tab's SiConnection. `storage`: localStorage (or null). `workspaceId()`: the open SI map's workspace, if any. */
  constructor({ connection, storage = globalThis.localStorage ?? null, workspaceId = () => null }) {
    Object.assign(this, { connection, storage, workspaceId });
  }

  get available() { return this.connection.connected; }
  get allowed() { return this.connection.can(NOTES_SCOPE); }

  sentTo() {
    try { return JSON.parse(this.storage?.getItem(SENT_KEY) || "{}") || {}; } catch { return {}; }
  }

  #remember(noteId, workspaceId) {
    const sent = { ...this.sentTo(), [noteId]: workspaceId };
    try { this.storage?.setItem(SENT_KEY, JSON.stringify(sent)); } catch { /* The chip is then shown for this tab only. */ }
  }

  /** The workspace to send to: the open SI map's, or the person's only one. Otherwise null and the caller asks. */
  async defaultWorkspace() {
    const fixed = this.workspaceId();
    if (fixed) return fixed;
    const { data } = await this.connection.request("/stored/workspaces");
    const list = Array.isArray(data?.workspaces) ? data.workspaces : [];
    return list.length === 1 ? list[0].id : null;
  }

  async workspaces() {
    const { data } = await this.connection.request("/stored/workspaces");
    return (Array.isArray(data?.workspaces) ? data.workspaces : []).map(w => ({ id: String(w.id), name: String(w.name || w.id) }));
  }

  /** Sends one note as it is stored. Resolves with SI's request (status, summary). */
  async send(note, workspaceId, mapId = null) {
    const { data } = await this.connection.request("/ratatoskr/notes", { method: "POST", body: { workspace_id: workspaceId, note, ...(mapId ? { map_id: mapId } : {}) } });
    this.#remember(note.id, workspaceId);
    return data;
  }

  /** SI's latest status for each sent note, by note id. Notes never sent are not asked about. */
  async statuses(noteIds) {
    const sent = this.sentTo(), byWorkspace = new Map();
    for (const id of noteIds) if (sent[id]) byWorkspace.set(sent[id], [...(byWorkspace.get(sent[id]) || []), id]);
    const result = {};
    for (const [workspaceId, ids] of byWorkspace) {
      for (let i = 0; i < ids.length; i += 200) {
        const query = new URLSearchParams({ workspace_id: workspaceId, note_ids: ids.slice(i, i + 200).join(",") });
        const { data } = await this.connection.request(`/ratatoskr/notes/status?${query}`);
        for (const item of data?.notes || []) result[item.note_id] = item;
      }
    }
    return result;
  }
}

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The status line under a note: chip, SI's one-line summary, and any reply. Text only. */
export function statusHtml(item) {
  if (!item) return "";
  const { label, tone } = noteChip(item.status);
  return `<span class="si-note-chip si-note-chip--${tone}">${escape(label)}</span> <span>${escape(item.summary)}</span>${item.reply ? `<blockquote class="si-note-reply">${escape(item.reply)}</blockquote>` : ""}`;
}

/**
 * Adds "Send to SI bots" to each note card in `host` and fills each card's status line. `notes()`
 * lists the project's data Map Notes. Returns a stop function for the status polling.
 */
export function wireSiNotes(host, { siNotes, notes, signIn, mapId = () => null, setInterval: every = globalThis.setInterval, clearInterval: stop = globalThis.clearInterval }) {
  if (!siNotes?.available || !host?.querySelectorAll) return () => {};
  const byId = () => new Map(notes().map(note => [note.id, note]));
  const refresh = async () => {
    const lines = [...host.querySelectorAll("[data-si-note-status]")];
    if (!lines.length || !siNotes.allowed) return;
    try {
      const found = await siNotes.statuses(lines.map(line => line.dataset.siNoteStatus));
      for (const line of lines) if (found[line.dataset.siNoteStatus]) line.innerHTML = statusHtml(found[line.dataset.siNoteStatus]);
    } catch { /* Statuses are a convenience; the notes still work. */ }
  };
  host.querySelectorAll("[data-si-note-send]").forEach(button => {
    button.hidden = false;
    if (!siNotes.allowed) button.textContent = "Reconnect to GISMap SI to send notes";
    button.addEventListener("click", async () => {
      const line = host.querySelector(`[data-si-note-status="${button.dataset.siNoteSend}"]`);
      if (!siNotes.allowed) { await signIn?.(); return; }
      const note = byId().get(button.dataset.siNoteSend);
      if (!note) return;
      button.disabled = true;
      try {
        let workspaceId = await siNotes.defaultWorkspace();
        if (!workspaceId) workspaceId = await chooseWorkspace(button, await siNotes.workspaces());
        if (!workspaceId) { button.disabled = false; return; }
        const sent = await siNotes.send(note, workspaceId, mapId());
        if (line) line.innerHTML = statusHtml({ status: sent.status, summary: sent.summary, reply: sent.reply });
        button.textContent = "Send again";
      } catch (error) {
        if (line) line.textContent = `Not sent: ${error.message}`;
      } finally { button.disabled = false; }
    });
  });
  refresh();
  const timer = every?.(refresh, POLL_MS);
  return () => stop?.(timer);
}

/** An inline workspace picker next to the button; resolves with the chosen id, or null. */
function chooseWorkspace(button, workspaces) {
  if (!workspaces.length) return Promise.reject(new Error("You don't have a GISMap SI workspace yet."));
  return new Promise(resolve => {
    const form = button.ownerDocument.createElement("form");
    form.className = "si-note-workspace";
    form.innerHTML = `<label>Send to workspace <select name="workspace">${workspaces.map(w => `<option value="${escape(w.id)}">${escape(w.name)}</option>`).join("")}</select></label><button type="submit">Send</button><button type="button" data-cancel>Cancel</button>`;
    button.after(form);
    form.addEventListener("submit", event => { event.preventDefault(); const id = form.elements.workspace.value; form.remove(); resolve(id); });
    form.querySelector("[data-cancel]").addEventListener("click", () => { form.remove(); resolve(null); });
  });
}
