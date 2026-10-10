"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { create } from "zustand";
import { onPointerScene } from "../actions";
import { loadPrefs } from "../scene/storage";
import type { BinaryFile, Point, SceneElement } from "../scene/types";
import { useEditor } from "../store";
import { fetchFiles, fetchWorkspace, getSupabase, saveWorkspace, uploadFile } from "./api";
import { loadIdentity, saveIdentity, sessionUserId, type Identity } from "./identity";
import { SyncEngine, type ElementsMessage, type WireChange } from "./reconcile";

export type CollabStatus = "idle" | "loading" | "connecting" | "connected" | "reconnecting" | "not-found" | "error" | "unconfigured";

export interface Peer extends Identity {
  id: string;
}

interface CollabState {
  workspaceId: string | null;
  status: CollabStatus;
  me: Peer | null;
  /** Everyone else in the workspace right now. */
  peers: Peer[];
  cursors: Record<string, Point | null>;
  selections: Record<string, string[]>;
  setMyName: (name: string) => void;
}

/** Hook up to the active session; set when a workspace connects. */
let onIdentityChange: ((me: Peer) => void) | null = null;

export const useCollab = create<CollabState>()((set, get) => ({
  workspaceId: null,
  status: "idle",
  me: null,
  peers: [],
  cursors: {},
  selections: {},
  setMyName: (name) => {
    const me = get().me ?? { id: sessionUserId, ...loadIdentity() };
    const next = { ...me, name: name.slice(0, 40) };
    saveIdentity({ name: next.name, color: next.color });
    set({ me: next });
    onIdentityChange?.(next);
  },
}));

/** Broadcast payloads have a size cap, so big batches are split. */
const MAX_CHUNK = 200_000;
const chunkMessage = (msg: ElementsMessage): ElementsMessage[] => {
  const chunks: ElementsMessage[] = [];
  let current: WireChange[] = [];
  let size = 0;
  for (const c of msg.changes) {
    const len = JSON.stringify(c).length;
    if (current.length && size + len > MAX_CHUNK) {
      chunks.push({ changes: current, order: msg.order });
      current = [];
      size = 0;
    }
    current.push(c);
    size += len;
  }
  chunks.push({ changes: current, order: msg.order });
  return chunks;
};

/**
 * Loads a workspace, joins its realtime channel and keeps the editor in sync
 * until the returned cleanup runs.
 */
export function connectWorkspace(id: string) {
  const set = useCollab.setState;
  const me: Peer = { id: sessionUserId, ...loadIdentity() };
  set({ workspaceId: id, status: "loading", me, peers: [], cursors: {}, selections: {} });

  // Clear whatever canvas was open before so it can't leak into the workspace.
  useEditor.getState().hydrate({ name: "Shared canvas", elements: [], files: {} });

  const sb = getSupabase();
  if (!sb) {
    set({ status: "unconfigured" });
    return () => set({ workspaceId: null, status: "idle" });
  }

  const engine = new SyncEngine();
  const uploaded = new Set<string>();
  const fileAttempts = new Map<string, number>();
  let channel: RealtimeChannel | null = null;
  let disposed = false;
  let loaded = false;
  // True while remote changes are being written to the store, so they aren't echoed back.
  let applying = false;
  let metaStamp = 0;
  let lastPointer: Point | null = null;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerTimer: ReturnType<typeof setTimeout> | undefined;
  let fileTimer: ReturnType<typeof setTimeout> | undefined;
  let saveFailed = false;
  const cleanups: (() => void)[] = [];

  const send = (event: string, payload: unknown) => {
    if (channel) void channel.send({ type: "broadcast", event, payload });
  };
  const sendElements = (event: string, msg: ElementsMessage) => {
    for (const chunk of chunkMessage(msg)) send(event, chunk);
  };

  const uploadNewFiles = (elements: SceneElement[], files: Record<string, BinaryFile>) => {
    for (const el of elements) {
      if (el.type !== "image" || uploaded.has(el.fileId) || !files[el.fileId]) continue;
      uploaded.add(el.fileId);
      uploadFile(id, files[el.fileId]).catch(() => uploaded.delete(el.fileId));
    }
  };

  const flush = () => {
    clearTimeout(sendTimer);
    sendTimer = undefined;
    if (!loaded) return;
    const s = useEditor.getState();
    const msg = engine.diff(s.elements);
    if (!msg) return;
    sendElements("elements", msg);
    uploadNewFiles(s.elements, s.files);
    scheduleSave();
  };

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!loaded) return;
    flush();
    const s = useEditor.getState();
    // Store the shared versions so a later joiner's copy ranks correctly.
    const elements = s.elements.map((e) => {
      const v = engine.versionOf(e);
      return v === e.version ? e : { ...e, version: v };
    });
    saveWorkspace({ id, name: s.name, elements, background: s.viewBackgroundColor })
      .then(() => {
        if (saveFailed) toast.success("Workspace saved again");
        saveFailed = false;
      })
      .catch(() => {
        if (!saveFailed) toast.error("Couldn't save the workspace. Changes still sync live; retrying…");
        saveFailed = true;
        if (!disposed) saveTimer = setTimeout(save, 5000);
      });
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  };

  const fetchMissingFiles = async () => {
    fileTimer = undefined;
    const s = useEditor.getState();
    const ids = [...new Set(s.elements.flatMap((e) => (e.type === "image" && !s.files[e.fileId] ? [e.fileId] : [])))].filter(
      (f) => (fileAttempts.get(f) ?? 0) < 8,
    );
    if (!ids.length) return;
    let got = new Set<string>();
    try {
      const files = await fetchFiles(id, ids);
      if (disposed) return;
      if (files.length) useEditor.getState().addFiles(files);
      for (const f of files) uploaded.add(f.id);
      got = new Set(files.map((f) => f.id));
    } catch {}
    const pending = ids.filter((f) => !got.has(f));
    for (const f of pending) fileAttempts.set(f, (fileAttempts.get(f) ?? 0) + 1);
    // The uploader may still be sending it.
    if (pending.length && !disposed) fileTimer = setTimeout(fetchMissingFiles, 1500);
  };
  const requestMissingFiles = () => {
    fileTimer ??= setTimeout(fetchMissingFiles, 200);
  };

  const receive = (msg: ElementsMessage) => {
    if (!loaded || !Array.isArray(msg?.changes)) return;
    // Send our pending edits first so we compare against up-to-date versions.
    flush();
    const r = engine.receive(msg);
    if (!r.changed) return;
    applying = true;
    try {
      useEditor.getState().applyRemote(r.merge);
      engine.absorb(useEditor.getState().elements);
    } finally {
      applying = false;
    }
    requestMissingFiles();
  };

  const sendPointer = () => {
    clearTimeout(pointerTimer);
    pointerTimer = undefined;
    send("pointer", { id: me.id, p: lastPointer, sel: [...useEditor.getState().selectedIds] });
  };
  const schedulePointer = () => {
    pointerTimer ??= setTimeout(sendPointer, 50);
  };

  const sendMeta = () => {
    const s = useEditor.getState();
    send("meta", { name: s.name, background: s.viewBackgroundColor, t: metaStamp });
  };

  const track = (who: Peer) => {
    if (channel) void channel.track({ id: who.id, name: who.name, color: who.color });
  };
  onIdentityChange = (who) => {
    Object.assign(me, who);
    track(me);
  };

  const join = () => {
    const ch = sb.channel(`workspace:${id}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    channel = ch;
    ch.on("broadcast", { event: "elements" }, ({ payload }) => receive(payload as ElementsMessage));
    ch.on("broadcast", { event: "snapshot" }, ({ payload }) => receive(payload as ElementsMessage));
    ch.on("broadcast", { event: "hello" }, ({ payload }) => {
      receive(payload as ElementsMessage);
      // Bring the newcomer up to date with anything their saved copy missed.
      sendElements("snapshot", engine.snapshot(useEditor.getState().elements));
      sendMeta();
    });
    ch.on("broadcast", { event: "meta" }, ({ payload }) => {
      const p = payload as { name?: string; background?: string; t?: number };
      if (!p?.t || p.t <= metaStamp) return;
      metaStamp = p.t;
      applying = true;
      const s = useEditor.getState();
      if (typeof p.name === "string") s.setName(p.name);
      if (typeof p.background === "string") s.setViewBackgroundColor(p.background);
      applying = false;
    });
    ch.on("broadcast", { event: "pointer" }, ({ payload }) => {
      const p = payload as { id: string; p: Point | null; sel?: string[] };
      if (!p?.id) return;
      set((st) => ({ cursors: { ...st.cursors, [p.id]: p.p }, selections: { ...st.selections, [p.id]: p.sel ?? [] } }));
    });
    ch.on("presence", { event: "sync" }, () => {
      const seen = new Map<string, Peer>();
      for (const list of Object.values(ch.presenceState<Peer>())) {
        for (const p of list) if (p.id && p.id !== me.id) seen.set(p.id, { id: p.id, name: p.name, color: p.color });
      }
      const peers = [...seen.values()];
      set((st) => ({
        peers,
        cursors: Object.fromEntries(Object.entries(st.cursors).filter(([k]) => seen.has(k))),
        selections: Object.fromEntries(Object.entries(st.selections).filter(([k]) => seen.has(k))),
      }));
    });
    ch.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        set({ status: "connected" });
        track(me);
        // Announce ourselves with everything we have; peers merge it and reply with theirs.
        sendElements("hello", engine.snapshot(useEditor.getState().elements));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        set({ status: "reconnecting" });
      } else if (status === "CLOSED") {
        set({ status: "reconnecting" });
      }
    });
  };

  const load = async () => {
    let record;
    try {
      record = await fetchWorkspace(id);
    } catch {
      if (!disposed) set({ status: "error" });
      return;
    }
    if (disposed) return;
    if (!record) {
      set({ status: "not-found" });
      return;
    }
    const prefs = loadPrefs();
    const editor = useEditor.getState();
    editor.hydrate({
      name: record.name,
      elements: Array.isArray(record.elements) ? record.elements : [],
      files: {},
      viewBackgroundColor: record.background,
      viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
      grid: prefs.grid ?? false,
      toolLocked: prefs.toolLocked ?? false,
    });
    useEditor.getState().zoomToFit();
    const elements = useEditor.getState().elements;
    engine.init(elements);
    for (const el of elements) if (el.type === "image") uploaded.add(el.fileId);
    loaded = true;
    set({ status: "connecting" });
    requestMissingFiles();

    cleanups.push(
      useEditor.subscribe((s, prev) => {
        if (applying) return;
        if (s.elements !== prev.elements) sendTimer ??= setTimeout(flush, 40);
        if (s.name !== prev.name || s.viewBackgroundColor !== prev.viewBackgroundColor) {
          metaStamp = Date.now();
          sendMeta();
          scheduleSave();
        }
        if (s.selectedIds !== prev.selectedIds) schedulePointer();
      }),
      onPointerScene((p) => {
        lastPointer = p;
        schedulePointer();
      }),
    );
    const onHide = () => {
      if (saveTimer) save();
    };
    window.addEventListener("pagehide", onHide);
    cleanups.push(() => window.removeEventListener("pagehide", onHide));
    join();
  };
  void load();

  return () => {
    disposed = true;
    // Persist anything not yet saved, but only if this session ever owned the editor state.
    if (loaded && saveTimer) save();
    clearTimeout(sendTimer);
    clearTimeout(saveTimer);
    clearTimeout(pointerTimer);
    clearTimeout(fileTimer);
    for (const c of cleanups) c();
    onIdentityChange = null;
    if (channel) void sb.removeChannel(channel);
    set({ workspaceId: null, status: "idle", peers: [], cursors: {}, selections: {} });
  };
}

/**
 * Publishes the current canvas as a new shared workspace and returns its id.
 * Images go up first so collaborators can load them.
 */
export async function createWorkspaceFromCanvas(id: string) {
  const s = useEditor.getState();
  await saveWorkspace({ id, name: s.name, elements: s.elements, background: s.viewBackgroundColor });
  const used = new Set(s.elements.flatMap((e) => (e.type === "image" ? [e.fileId] : [])));
  await Promise.all([...used].filter((f) => s.files[f]).map((f) => uploadFile(id, s.files[f])));
  return id;
}
