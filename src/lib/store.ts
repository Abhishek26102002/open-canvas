"use client";

import { create } from "zustand";
import { DEFAULT_STYLE, MAX_ZOOM, MIN_ZOOM } from "./scene/constants";
import { duplicateElements, newId, normalizePoints, normalizeScene, update } from "./scene/elements";
import { measureText } from "./scene/text";
import { getCommonBounds } from "./scene/math";
import type { BinaryFile, ItemStyle, SceneElement, ToolType, Viewport } from "./scene/types";
import { isLinear } from "./scene/types";

interface HistoryEntry {
  elements: SceneElement[];
  selectedIds: string[];
}

export type AlignType = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeType = "horizontal" | "vertical";
export type LayerAction = "front" | "forward" | "backward" | "back";

interface EditorState {
  name: string;
  elements: SceneElement[];
  files: Record<string, BinaryFile>;
  selectedIds: Set<string>;
  tool: ToolType;
  toolLocked: boolean;
  viewport: Viewport;
  viewportSize: { width: number; height: number };
  style: ItemStyle;
  editingTextId: string | null;
  grid: boolean;
  viewBackgroundColor: string;
  past: HistoryEntry[];
  future: HistoryEntry[];
  committed: HistoryEntry;
  hydrated: boolean;

  setName: (name: string) => void;
  setTool: (tool: ToolType) => void;
  setToolLocked: (locked: boolean) => void;
  setElements: (elements: SceneElement[]) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: Iterable<string>) => void;
  setViewport: (v: Partial<Viewport>) => void;
  setViewportSize: (size: { width: number; height: number }) => void;
  zoomAt: (zoom: number, screenX?: number, screenY?: number) => void;
  zoomToFit: (onlySelected?: boolean) => void;
  setStyle: (changes: Partial<ItemStyle>) => void;
  setEditingTextId: (id: string | null) => void;
  setGrid: (grid: boolean) => void;
  setViewBackgroundColor: (c: string) => void;
  addFiles: (files: BinaryFile[]) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  selectAll: () => void;
  group: () => void;
  ungroup: () => void;
  reorder: (action: LayerAction) => void;
  align: (type: AlignType) => void;
  distribute: (type: DistributeType) => void;
  toggleLock: () => void;
  flip: (axis: "horizontal" | "vertical") => void;
  loadScene: (elements: SceneElement[], files: Record<string, BinaryFile>, background?: string) => void;
  hydrate: (data: Partial<Pick<EditorState, "name" | "elements" | "files" | "viewport" | "viewBackgroundColor" | "grid" | "toolLocked">>) => void;
  /**
   * Applies changes from collaborators. They are folded into the undo history
   * too, so undo only ever reverts your own edits.
   */
  applyRemote: (merge: (elements: SceneElement[], live: boolean) => SceneElement[]) => void;
}

const HISTORY_LIMIT = 100;

/** Returns the outermost group of an element, if any. */
export const outerGroup = (el: SceneElement) => el.groupIds[el.groupIds.length - 1];

/** Expands a selection to whole groups, the way clicking any member selects the group. */
export const expandToGroups = (elements: SceneElement[], ids: Iterable<string>) => {
  const set = new Set(ids);
  const groups = new Set<string>();
  for (const el of elements) if (set.has(el.id) && outerGroup(el)) groups.add(outerGroup(el)!);
  if (!groups.size) return set;
  for (const el of elements) if (outerGroup(el) && groups.has(outerGroup(el)!)) set.add(el.id);
  return set;
};

/** Keeps every bound label directly above its container in z-order. */
export const fixLabelOrder = (elements: SceneElement[]) => {
  const labels = new Map<string, SceneElement>();
  for (const el of elements) if (el.type === "text" && el.containerId) labels.set(el.containerId, el);
  if (!labels.size) return elements;
  const out: SceneElement[] = [];
  for (const el of elements) {
    if (el.type === "text" && el.containerId) continue;
    out.push(el);
    const label = labels.get(el.id);
    if (label) out.push(label);
  }
  return out;
};

const selectedElements = (s: EditorState) => s.elements.filter((e) => s.selectedIds.has(e.id));

export const useEditor = create<EditorState>()((set, get) => ({
  name: "Untitled canvas",
  elements: [],
  files: {},
  selectedIds: new Set(),
  tool: "selection",
  toolLocked: false,
  viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
  viewportSize: { width: 0, height: 0 },
  style: DEFAULT_STYLE,
  editingTextId: null,
  grid: false,
  viewBackgroundColor: "#ffffff",
  past: [],
  future: [],
  committed: { elements: [], selectedIds: [] },
  hydrated: false,

  setName: (name) => set({ name }),
  setTool: (tool) => set((s) => ({ tool, selectedIds: tool === "selection" || tool === "hand" ? s.selectedIds : new Set() })),
  setToolLocked: (toolLocked) => set({ toolLocked }),

  setElements: (elements) => set({ elements: normalizeScene(elements) }),

  commit: () => {
    const s = get();
    if (s.elements === s.committed.elements) return;
    set({
      past: [...s.past, s.committed].slice(-HISTORY_LIMIT),
      future: [],
      committed: { elements: s.elements, selectedIds: [...s.selectedIds] },
    });
  },

  undo: () => {
    const s = get();
    // Uncommitted in-progress changes get committed first so they can be undone.
    if (s.elements !== s.committed.elements) s.commit();
    const { past, committed, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      elements: prev.elements,
      selectedIds: new Set(prev.selectedIds.filter((id) => prev.elements.some((e) => e.id === id))),
      past: past.slice(0, -1),
      future: [committed, ...future],
      committed: prev,
      editingTextId: null,
    });
  },

  redo: () => {
    const { past, committed, future } = get();
    const next = future[0];
    if (!next) return;
    set({
      elements: next.elements,
      selectedIds: new Set(next.selectedIds.filter((id) => next.elements.some((e) => e.id === id))),
      past: [...past, committed],
      future: future.slice(1),
      committed: next,
      editingTextId: null,
    });
  },

  select: (ids) => set({ selectedIds: new Set(ids) }),

  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),
  setViewportSize: (viewportSize) => set({ viewportSize }),

  zoomAt: (zoom, screenX, screenY) => {
    const { viewport: v, viewportSize } = get();
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const sx = screenX ?? viewportSize.width / 2;
    const sy = screenY ?? viewportSize.height / 2;
    // Keep the scene point under (sx, sy) fixed while zooming.
    const sceneX = sx / v.zoom - v.scrollX;
    const sceneY = sy / v.zoom - v.scrollY;
    set({ viewport: { zoom: z, scrollX: sx / z - sceneX, scrollY: sy / z - sceneY } });
  },

  zoomToFit: (onlySelected) => {
    const s = get();
    const els = onlySelected ? selectedElements(s) : s.elements;
    if (!els.length) {
      set({ viewport: { scrollX: 0, scrollY: 0, zoom: 1 } });
      return;
    }
    const b = getCommonBounds(els);
    const { width, height } = s.viewportSize;
    const pad = 80;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((width - pad * 2) / (b.maxX - b.minX || 1), (height - pad * 2) / (b.maxY - b.minY || 1), onlySelected ? MAX_ZOOM : 1)),
    );
    set({
      viewport: {
        zoom,
        scrollX: width / 2 / zoom - (b.minX + b.maxX) / 2,
        scrollY: height / 2 / zoom - (b.minY + b.maxY) / 2,
      },
    });
  },

  setStyle: (changes) => {
    const s = get();
    set({ style: { ...s.style, ...changes } });
    if (!s.selectedIds.size) return;
    // Labels follow their container's text and stroke settings.
    const targets = new Set(s.selectedIds);
    for (const el of s.elements) {
      if (el.type === "text" && el.containerId && s.selectedIds.has(el.containerId)) targets.add(el.id);
    }
    const next = s.elements.map((el) => {
      if (!targets.has(el.id)) return el;
      const c: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes)) {
        if (k === "arrowType") {
          if (isLinear(el)) {
            c.arrowType = v;
            c.roundness = v === "round" ? "round" : "sharp";
          }
        } else if (k === "startArrowhead" || k === "endArrowhead") {
          if (el.type === "arrow") c[k] = v;
        } else if (k === "fontSize" || k === "fontFamily" || k === "textAlign") {
          if (el.type === "text" && !(k === "textAlign" && el.containerId)) c[k] = v;
        } else if (k === "backgroundColor" || k === "fillStyle") {
          if (el.type === "icon") {
            if (k === "backgroundColor") c[k] = v;
          } else if (el.type !== "text" && el.type !== "image" && !isLinear(el) && el.type !== "freedraw") c[k] = v;
        } else if (k === "roughness") {
          if (el.type !== "icon") c[k] = v;
        } else if (k === "roundness") {
          if (el.type === "rectangle" || el.type === "diamond") c[k] = v;
        } else if (k in el) {
          c[k] = v;
        }
      }
      if (!Object.keys(c).length) return el;
      const updated = update(el, c as Partial<SceneElement>);
      if (updated.type === "text" && ("fontSize" in c || "fontFamily" in c) && !updated.containerId) {
        // Re-measure free-standing text after font changes.
        return { ...updated, ...measureText(updated.text || " ", updated.fontFamily, updated.fontSize) };
      }
      return updated;
    });
    get().setElements(next);
    get().commit();
  },

  setEditingTextId: (editingTextId) => set({ editingTextId }),
  setGrid: (grid) => set({ grid }),
  setViewBackgroundColor: (viewBackgroundColor) => set({ viewBackgroundColor }),
  addFiles: (files) => set((s) => ({ files: { ...s.files, ...Object.fromEntries(files.map((f) => [f.id, f])) } })),

  deleteSelected: () => {
    const s = get();
    if (!s.selectedIds.size) return;
    const removed = new Set(s.selectedIds);
    // Unlocked only; deleting a container removes its label too (via normalize).
    for (const el of s.elements) if (removed.has(el.id) && el.locked) removed.delete(el.id);
    get().setElements(s.elements.filter((e) => !removed.has(e.id)));
    set({ selectedIds: new Set() });
    get().commit();
  },

  duplicateSelected: () => {
    const s = get();
    const sel = selectedElements(s);
    if (!sel.length) return;
    const withLabels = s.elements.filter(
      (e) => s.selectedIds.has(e.id) || (e.type === "text" && e.containerId && s.selectedIds.has(e.containerId)),
    );
    const copies = duplicateElements(withLabels, 10);
    get().setElements(fixLabelOrder([...s.elements, ...copies]));
    set({ selectedIds: new Set(copies.filter((c) => !(c.type === "text" && c.containerId)).map((c) => c.id)) });
    get().commit();
  },

  selectAll: () => {
    const s = get();
    set({ selectedIds: new Set(s.elements.filter((e) => !(e.type === "text" && e.containerId)).map((e) => e.id)), tool: "selection" });
  },

  group: () => {
    const s = get();
    if (s.selectedIds.size < 2) return;
    const gid = newId();
    get().setElements(
      s.elements.map((el) => (s.selectedIds.has(el.id) ? update(el, { groupIds: [...el.groupIds, gid] }) : el)),
    );
    get().commit();
  },

  ungroup: () => {
    const s = get();
    get().setElements(
      s.elements.map((el) => (s.selectedIds.has(el.id) && el.groupIds.length ? update(el, { groupIds: el.groupIds.slice(0, -1) }) : el)),
    );
    get().commit();
  },

  reorder: (action) => {
    const s = get();
    if (!s.selectedIds.size) return;
    const isSel = (e: SceneElement) => s.selectedIds.has(e.id) || (e.type === "text" && !!e.containerId && s.selectedIds.has(e.containerId));
    let els = [...s.elements];
    if (action === "front") els = [...els.filter((e) => !isSel(e)), ...els.filter(isSel)];
    else if (action === "back") els = [...els.filter(isSel), ...els.filter((e) => !isSel(e))];
    else if (action === "forward") {
      for (let i = els.length - 2; i >= 0; i--) {
        if (isSel(els[i]) && !isSel(els[i + 1])) [els[i], els[i + 1]] = [els[i + 1], els[i]];
      }
    } else {
      for (let i = 1; i < els.length; i++) {
        if (isSel(els[i]) && !isSel(els[i - 1])) [els[i], els[i - 1]] = [els[i - 1], els[i]];
      }
    }
    get().setElements(fixLabelOrder(els));
    get().commit();
  },

  align: (type) => {
    const s = get();
    const sel = selectedElements(s);
    if (sel.length < 2) return;
    const all = getCommonBounds(sel);
    // Align whole groups as units.
    const units = new Map<string, SceneElement[]>();
    for (const el of sel) {
      const key = outerGroup(el) ?? el.id;
      units.set(key, [...(units.get(key) ?? []), el]);
    }
    const offsets = new Map<string, [number, number]>();
    for (const unit of units.values()) {
      const b = getCommonBounds(unit);
      let dx = 0, dy = 0;
      if (type === "left") dx = all.minX - b.minX;
      if (type === "right") dx = all.maxX - b.maxX;
      if (type === "hcenter") dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
      if (type === "top") dy = all.minY - b.minY;
      if (type === "bottom") dy = all.maxY - b.maxY;
      if (type === "vcenter") dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
      for (const el of unit) offsets.set(el.id, [dx, dy]);
    }
    get().setElements(
      s.elements.map((el) => {
        const o = offsets.get(el.id);
        return o ? update(el, { x: el.x + o[0], y: el.y + o[1] }) : el;
      }),
    );
    get().commit();
  },

  distribute: (type) => {
    const s = get();
    const sel = selectedElements(s);
    const units = new Map<string, SceneElement[]>();
    for (const el of sel) {
      const key = outerGroup(el) ?? el.id;
      units.set(key, [...(units.get(key) ?? []), el]);
    }
    if (units.size < 3) return;
    const list = [...units.values()].map((els) => ({ els, b: getCommonBounds(els) }));
    const h = type === "horizontal";
    list.sort((a, b) => (h ? a.b.minX - b.b.minX : a.b.minY - b.b.minY));
    const first = list[0].b;
    const last = list[list.length - 1].b;
    const span = h ? last.maxX - first.minX : last.maxY - first.minY;
    const total = list.reduce((acc, u) => acc + (h ? u.b.maxX - u.b.minX : u.b.maxY - u.b.minY), 0);
    const gap = (span - total) / (list.length - 1);
    let pos = h ? first.minX : first.minY;
    const offsets = new Map<string, number>();
    for (const u of list) {
      const d = pos - (h ? u.b.minX : u.b.minY);
      for (const el of u.els) offsets.set(el.id, d);
      pos += (h ? u.b.maxX - u.b.minX : u.b.maxY - u.b.minY) + gap;
    }
    get().setElements(
      s.elements.map((el) => {
        const d = offsets.get(el.id);
        if (d === undefined) return el;
        return update(el, h ? { x: el.x + d } : { y: el.y + d });
      }),
    );
    get().commit();
  },

  toggleLock: () => {
    const s = get();
    const sel = selectedElements(s);
    if (!sel.length) return;
    const locked = !sel.every((e) => e.locked);
    get().setElements(s.elements.map((el) => (s.selectedIds.has(el.id) ? update(el, { locked }) : el)));
    get().commit();
  },

  flip: (axis) => {
    const s = get();
    const sel = selectedElements(s).filter((e) => !e.locked);
    if (!sel.length) return;
    const b = getCommonBounds(sel);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const hz = axis === "horizontal";
    get().setElements(
      s.elements.map((el) => {
        if (!s.selectedIds.has(el.id) || el.locked) return el;
        if (isLinear(el) || el.type === "freedraw") {
          const abs = el.points.map(([x, y]) => [el.x + x, el.y + y]);
          const points = abs.map(([x, y]) => (hz ? [2 * cx - x - el.x, y - el.y] : [x - el.x, 2 * cy - y - el.y]) as [number, number]);
          return normalizePoints(update(el, { points, ...(isLinear(el) ? { startBinding: null, endBinding: null } : {}) } as Partial<SceneElement>) as SceneElement & { points: [number, number][] });
        }
        return update(el, hz
          ? { x: 2 * cx - el.x - el.width, angle: -el.angle }
          : { y: 2 * cy - el.y - el.height, angle: -el.angle });
      }),
    );
    get().commit();
  },

  loadScene: (elements, files, background) => {
    const s = get();
    set({
      elements: normalizeScene(elements),
      files: { ...s.files, ...files },
      selectedIds: new Set(),
      editingTextId: null,
      ...(background ? { viewBackgroundColor: background } : {}),
    });
    get().commit();
    get().zoomToFit();
  },

  applyRemote: (merge) => {
    const s = get();
    const elements = fixLabelOrder(normalizeScene(merge(s.elements, true)));
    const patch = (h: HistoryEntry): HistoryEntry => ({ ...h, elements: normalizeScene(merge(h.elements, false)) });
    const ids = new Set(elements.map((e) => e.id));
    set({
      elements,
      // Mid-gesture the live scene is ahead of `committed`; keep that gap intact.
      committed: s.elements === s.committed.elements ? { ...s.committed, elements } : patch(s.committed),
      past: s.past.map(patch),
      future: s.future.map(patch),
      selectedIds: [...s.selectedIds].every((id) => ids.has(id)) ? s.selectedIds : new Set([...s.selectedIds].filter((id) => ids.has(id))),
      editingTextId: s.editingTextId && ids.has(s.editingTextId) ? s.editingTextId : null,
    });
  },

  hydrate: (data) => {
    const elements = data.elements ? normalizeScene(data.elements) : [];
    set({
      ...data,
      elements,
      selectedIds: new Set(),
      editingTextId: null,
      hydrated: true,
      committed: { elements, selectedIds: [] },
      past: [],
      future: [],
    });
  },
}));

export const getSelectedElements = () => selectedElements(useEditor.getState());
