"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { insertImages, loadFromBlob, setPointerScene } from "@/lib/actions";
import { useCollab } from "@/lib/collab/session";
import { GRID_SIZE, HANDLE_SIZE, MAX_ZOOM, MIN_ZOOM } from "@/lib/scene/constants";
import {
  getBoundText,
  newFreedraw,
  newLinear,
  newShape,
  newText,
  normalizePoints,
  update,
} from "@/lib/scene/elements";
import {
  getHandleCursor,
  getTransformBox,
  hitElement,
  hitHandle,
  pointInElementBox,
  type HandleType,
  type TransformBox,
} from "@/lib/scene/hittest";
import { distance, getCenter, rotate, snapAngle, snapToGrid, type Bounds, boundsContain, getElementBounds } from "@/lib/scene/math";
import { getLinearHandles, renderScene, setImageLoadCallback } from "@/lib/scene/render";
import { resetFontCache } from "@/lib/scene/text";
import { FILE_EXTENSION } from "@/lib/scene/export";
import type { Theme } from "@/lib/scene/theme";
import type { LinearElement, Point, SceneElement, TextElement } from "@/lib/scene/types";
import { isBindable, isLinear, isTextContainer } from "@/lib/scene/types";
import { expandToGroups, fixLabelOrder, useEditor } from "@/lib/store";

const now = () => performance.now();

type Interaction =
  | { kind: "pan"; startX: number; startY: number; scrollX: number; scrollY: number }
  | { kind: "create"; id: string; origin: Point }
  | { kind: "createLinear"; id: string; origin: Point; startBind: string | null }
  | { kind: "freedraw"; id: string }
  | { kind: "move"; origin: Point; originals: Map<string, SceneElement>; moved: boolean }
  | { kind: "resize"; handle: HandleType; originals: Map<string, SceneElement>; box: TransformBox }
  | { kind: "rotate"; originals: Map<string, SceneElement>; center: Point; startAngle: number }
  | { kind: "marquee"; origin: Point; base: Set<string> }
  | { kind: "linearPoint"; id: string; index: number; original: LinearElement }
  | { kind: "erase"; last: Point }
  | { kind: "laser" };

const isEditableTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

/** Topmost element at a point. Labels resolve to their container. */
const getElementAt = (elements: SceneElement[], p: Point, zoom: number, selected: Set<string>) => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!hitElement(el, p, zoom, selected.has(el.id))) continue;
    if (el.type === "text" && el.containerId) {
      return elements.find((e) => e.id === el.containerId) ?? el;
    }
    return el;
  }
  return null;
};

/** Shape under an arrow endpoint that the arrow should attach to. */
const getBindTarget = (elements: SceneElement[], p: Point, zoom: number, excludeId: string) => {
  const margin = 12 / zoom;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.id === excludeId || !isBindable(el)) continue;
    const [cx, cy] = getCenter(el);
    const [lx, ly] = rotate(p[0], p[1], cx, cy, -el.angle);
    if (lx >= el.x - margin && lx <= el.x + el.width + margin && ly >= el.y - margin && ly <= el.y + el.height + margin) {
      return el;
    }
  }
  return null;
};

const remoteSelections = () => {
  const { peers, selections } = useCollab.getState();
  if (!peers.length) return undefined;
  return peers.flatMap((p) => (selections[p.id]?.length ? [{ color: p.color, ids: selections[p.id] }] : []));
};

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const overlay = useRef<{
    marquee: Bounds | null;
    faded: Set<string>;
    bindTarget: string | null;
    laser: { points: Point[]; times: number[] };
  }>({ marquee: null, faded: new Set(), bindTarget: null, laser: { points: [], times: [] } });
  const multiPoint = useRef<string | null>(null);
  const spaceDown = useRef(false);
  const pointer = useRef<Point>([0, 0]);
  const frame = useRef(0);
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const [hoverCursor, setCursor] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const themeRef = useRef<Theme>("light");

  const tool = useEditor((s) => s.tool);

  const renderRef = useRef<() => void>(() => {});
  const scheduleRender = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => renderRef.current());
  }, []);

  const render = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = useEditor.getState();
    const o = overlay.current;
    renderScene(ctx, {
      elements: s.elements,
      files: s.files,
      viewport: s.viewport,
      width: size.current.width,
      height: size.current.height,
      dpr: size.current.dpr,
      background: s.viewBackgroundColor,
      grid: s.grid,
      selectedIds: s.selectedIds,
      hiddenIds: s.editingTextId ? new Set([s.editingTextId]) : undefined,
      fadedIds: o.faded,
      hoveredBindTarget: o.bindTarget,
      marquee: o.marquee,
      laser: o.laser,
      showHandles: !interaction.current || interaction.current.kind === "marquee",
      theme: themeRef.current,
      remoteSelections: remoteSelections(),
    });
    // Keep animating while the laser trail fades out.
    const times = o.laser.times;
    if (times.length && now() - times[times.length - 1] < 1000) scheduleRender();
    else if (times.length) o.laser = { points: [], times: [] };
  }, [scheduleRender]);

  useEffect(() => {
    renderRef.current = render;
  }, [render]);

  useEffect(() => {
    themeRef.current = resolvedTheme === "dark" ? "dark" : "light";
    scheduleRender();
  }, [resolvedTheme, scheduleRender]);

  // Re-render on any store change.
  useEffect(() => {
    setImageLoadCallback(scheduleRender);
    const unsub = useEditor.subscribe(scheduleRender);
    const unsubCollab = useCollab.subscribe((c, prev) => c.selections !== prev.selections && scheduleRender());
    document.fonts?.ready.then(() => {
      resetFontCache();
      scheduleRender();
    });
    return () => {
      unsub();
      unsubCollab();
      cancelAnimationFrame(frame.current);
    };
  }, [scheduleRender]);

  // Keep the canvas sized to its container at device pixel ratio.
  useEffect(() => {
    const container = containerRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { width, height, dpr };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      useEditor.getState().setViewportSize({ width, height });
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    return () => ro.disconnect();
  }, [render]);

  const toScene = useCallback((clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { viewport: v } = useEditor.getState();
    return [(clientX - rect.left) / v.zoom - v.scrollX, (clientY - rect.top) / v.zoom - v.scrollY];
  }, []);

  const snap = (p: Point): Point => {
    if (!useEditor.getState().grid) return p;
    return [snapToGrid(p[0], GRID_SIZE), snapToGrid(p[1], GRID_SIZE)];
  };

  const finishTool = (createdId?: string) => {
    const s = useEditor.getState();
    if (createdId) s.select([createdId]);
    if (!s.toolLocked) {
      useEditor.setState({ tool: "selection" });
    }
    s.commit();
  };

  /** Start editing text for an existing text element, a container's label, or a new free text. */
  const startTextEditing = useCallback((p: Point, target: SceneElement | null) => {
    const s = useEditor.getState();
    if (target?.type === "text") {
      s.select([target.containerId ?? target.id]);
      s.setEditingTextId(target.id);
      return;
    }
    if (target && isTextContainer(target) && !target.locked) {
      const existing = getBoundText(s.elements, target.id);
      if (existing) {
        s.select([target.id]);
        s.setEditingTextId(existing.id);
        return;
      }
      const label = newText({ ...s.style, strokeColor: target.strokeColor }, target.x, target.y, "", target.id);
      s.setElements(fixLabelOrder([...s.elements, label]));
      s.select([target.id]);
      s.setEditingTextId(label.id);
      return;
    }
    const text = newText(s.style, p[0], p[1]);
    const placed = { ...text, y: p[1] - text.height / 2 };
    s.setElements([...s.elements, placed]);
    s.select([]);
    s.setEditingTextId(placed.id);
  }, []);

  const finishMultiPoint = useCallback(() => {
    const id = multiPoint.current;
    if (!id) return;
    multiPoint.current = null;
    const s = useEditor.getState();
    const el = s.elements.find((e) => e.id === id) as LinearElement | undefined;
    if (!el) return;
    // Drop the floating point that follows the cursor.
    const points = el.points.slice(0, -1);
    if (points.length < 2) {
      s.setElements(s.elements.filter((e) => e.id !== id));
      s.commit();
      return;
    }
    const last: Point = [el.x + points[points.length - 1][0], el.y + points[points.length - 1][1]];
    const endTarget = el.type === "arrow" ? getBindTarget(s.elements, last, s.viewport.zoom, el.id) : null;
    const finished = normalizePoints(update(el, { points, endBinding: endTarget ? { elementId: endTarget.id } : null }));
    s.setElements(s.elements.map((e) => (e.id === id ? finished : e)));
    overlay.current.bindTarget = null;
    finishTool(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Pointer handling

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    if (s.editingTextId) {
      // Clicking the canvas commits the text being edited.
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toScene(e.clientX, e.clientY);
    const zoom = s.viewport.zoom;

    if (e.button === 1 || (e.button === 0 && (spaceDown.current || s.tool === "hand"))) {
      interaction.current = { kind: "pan", startX: e.clientX, startY: e.clientY, scrollX: s.viewport.scrollX, scrollY: s.viewport.scrollY };
      setCursor("grabbing");
      return;
    }
    if (e.button !== 0) return;

    // Click-by-click line creation.
    if (multiPoint.current) {
      const el = s.elements.find((x) => x.id === multiPoint.current) as LinearElement | undefined;
      if (!el) {
        multiPoint.current = null;
      } else {
        const pts = el.points;
        const last: Point = [el.x + pts[pts.length - 1][0], el.y + pts[pts.length - 1][1]];
        const prev: Point = [el.x + pts[pts.length - 2][0], el.y + pts[pts.length - 2][1]];
        if (distance(last, prev) < 8 / zoom) {
          finishMultiPoint();
          return;
        }
        const next = update(el, { points: [...pts, [last[0] - el.x, last[1] - el.y]] });
        s.setElements(s.elements.map((x) => (x.id === el.id ? next : x)));
        return;
      }
    }

    switch (s.tool) {
      case "selection":
        return selectionDown(e, p);
      case "rectangle":
      case "diamond":
      case "ellipse": {
        const sp = snap(p);
        const el = newShape(s.tool, s.style, sp[0], sp[1]);
        s.setElements([...s.elements, el]);
        s.select([]);
        interaction.current = { kind: "create", id: el.id, origin: sp };
        return;
      }
      case "arrow":
      case "line": {
        const sp = snap(p);
        const startTarget = s.tool === "arrow" ? getBindTarget(s.elements, sp, zoom, "") : null;
        const el = newLinear(s.tool, s.style, sp[0], sp[1]);
        s.setElements([...s.elements, el]);
        s.select([]);
        interaction.current = { kind: "createLinear", id: el.id, origin: sp, startBind: startTarget?.id ?? null };
        return;
      }
      case "freedraw": {
        const el = newFreedraw(s.style, p[0], p[1]);
        const withPressure = e.pointerType === "pen" ? { ...el, pressures: [e.pressure] } : el;
        s.setElements([...s.elements, withPressure]);
        s.select([]);
        interaction.current = { kind: "freedraw", id: el.id };
        return;
      }
      case "text": {
        const target = getElementAt(s.elements, p, zoom, new Set());
        startTextEditing(p, target && (target.type === "text" || isTextContainer(target)) ? target : null);
        if (!s.toolLocked) useEditor.setState({ tool: "selection" });
        return;
      }
      case "eraser": {
        interaction.current = { kind: "erase", last: p };
        eraseAlong(p, p);
        return;
      }
      case "laser": {
        interaction.current = { kind: "laser" };
        overlay.current.laser.points.push(p);
        overlay.current.laser.times.push(now());
        scheduleRender();
        return;
      }
    }
  };

  const selectionDown = (e: React.PointerEvent, p: Point) => {
    const s = useEditor.getState();
    const zoom = s.viewport.zoom;
    const selected = s.elements.filter((el) => s.selectedIds.has(el.id));
    const unlocked = selected.filter((el) => !el.locked);

    // Point handles of a single selected arrow/line.
    if (selected.length === 1 && isLinear(selected[0]) && !selected[0].locked) {
      const el = selected[0];
      const { points, mids } = getLinearHandles(el);
      const r = HANDLE_SIZE / zoom;
      const idx = points.findIndex((pt) => distance(pt, p) <= r);
      if (idx >= 0) {
        interaction.current = { kind: "linearPoint", id: el.id, index: idx, original: el };
        return;
      }
      const mid = mids.findIndex((pt) => distance(pt, p) <= r);
      if (mid >= 0) {
        const pts = [...el.points];
        pts.splice(mid + 1, 0, [mids[mid][0] - el.x, mids[mid][1] - el.y]);
        const next = update(el, { points: pts });
        s.setElements(s.elements.map((x) => (x.id === el.id ? next : x)));
        interaction.current = { kind: "linearPoint", id: el.id, index: mid + 1, original: next };
        return;
      }
    }

    // Resize / rotate handles.
    const box = getTransformBox(selected);
    const handlesShown = box && unlocked.length === selected.length && !(selected.length === 1 && isLinear(selected[0]));
    if (box && handlesShown) {
      const handle = hitHandle(box, p, zoom, selected.length === 1 && selected[0].type === "text");
      if (handle) {
        const originals = new Map(selected.map((el) => [el.id, el]));
        if (handle === "rotation") {
          const center: Point = [box.x + box.width / 2, box.y + box.height / 2];
          interaction.current = { kind: "rotate", originals, center, startAngle: Math.atan2(p[1] - center[1], p[0] - center[0]) };
        } else {
          interaction.current = { kind: "resize", handle, originals, box };
        }
        return;
      }
    }

    let hit = getElementAt(s.elements, p, zoom, s.selectedIds);
    // Clicking inside a multi-selection's box drags the whole selection.
    if (!hit && selected.length > 1 && box && p[0] >= box.x && p[0] <= box.x + box.width && p[1] >= box.y && p[1] <= box.y + box.height) {
      hit = selected[0];
    }
    if (!hit && selected.length === 1 && pointInElementBox(selected[0], p)) hit = selected[0];

    if (hit) {
      let ids = new Set(s.selectedIds);
      if (e.shiftKey) {
        const group = expandToGroups(s.elements, [hit.id]);
        const remove = ids.has(hit.id);
        for (const id of group) {
          if (remove) ids.delete(id);
          else ids.add(id);
        }
      } else if (!ids.has(hit.id)) {
        ids = expandToGroups(s.elements, [hit.id]);
      }
      if (e.altKey && ids.has(hit.id)) {
        // Alt+drag duplicates in place and drags the copies.
        s.select(ids);
        s.duplicateSelected();
        const after = useEditor.getState();
        // duplicateSelected offsets copies; put them back under the cursor.
        const copies = after.elements.map((el) => (after.selectedIds.has(el.id) ? update(el, { x: el.x - 10, y: el.y - 10 }) : el));
        after.setElements(copies);
        ids = new Set(after.selectedIds);
      }
      useEditor.getState().select(ids);
      const current = useEditor.getState().elements;
      const originals = new Map(current.filter((el) => ids.has(el.id) && !el.locked).map((el) => [el.id, el]));
      interaction.current = { kind: "move", origin: p, originals, moved: false };
      return;
    }

    if (!e.shiftKey) s.select([]);
    interaction.current = { kind: "marquee", origin: p, base: e.shiftKey ? new Set(s.selectedIds) : new Set() };
  };

  const eraseAlong = (from: Point, to: Point) => {
    const s = useEditor.getState();
    const steps = Math.max(1, Math.ceil(distance(from, to) / (4 / s.viewport.zoom)));
    const faded = overlay.current.faded;
    let changed = false;
    for (let i = 0; i <= steps; i++) {
      const pt: Point = [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps];
      for (const el of s.elements) {
        if (faded.has(el.id) || el.locked) continue;
        if (hitElement(el, pt, s.viewport.zoom)) {
          const target = el.type === "text" && el.containerId ? el.containerId : el.id;
          for (const id of expandToGroups(s.elements, [target])) faded.add(id);
          changed = true;
        }
      }
    }
    if (changed) scheduleRender();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    const p = toScene(e.clientX, e.clientY);
    pointer.current = p;
    setPointerScene(p);
    const it = interaction.current;
    const zoom = s.viewport.zoom;

    if (!it) {
      if (multiPoint.current) {
        const el = s.elements.find((x) => x.id === multiPoint.current) as LinearElement | undefined;
        if (el) {
          const pts = [...el.points];
          let target = snap(p);
          if (e.shiftKey) {
            const prev = pts[pts.length - 2];
            const [dx, dy] = snapAngle(target[0] - el.x - prev[0], target[1] - el.y - prev[1]);
            target = [el.x + prev[0] + dx, el.y + prev[1] + dy];
          }
          pts[pts.length - 1] = [target[0] - el.x, target[1] - el.y];
          s.setElements(s.elements.map((x) => (x.id === el.id ? update(el, { points: pts }) : x)));
          overlay.current.bindTarget = el.type === "arrow" ? getBindTarget(s.elements, target, zoom, el.id)?.id ?? null : null;
        }
      }
      updateHoverCursor(p, e);
      return;
    }

    switch (it.kind) {
      case "pan": {
        s.setViewport({
          scrollX: it.scrollX + (e.clientX - it.startX) / zoom,
          scrollY: it.scrollY + (e.clientY - it.startY) / zoom,
        });
        return;
      }
      case "create": {
        const el = s.elements.find((x) => x.id === it.id);
        if (!el) return;
        const sp = snap(p);
        let w = sp[0] - it.origin[0];
        let h = sp[1] - it.origin[1];
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        let x = Math.min(it.origin[0], it.origin[0] + w);
        let y = Math.min(it.origin[1], it.origin[1] + h);
        let width = Math.abs(w);
        let height = Math.abs(h);
        if (e.altKey) {
          x = it.origin[0] - width;
          y = it.origin[1] - height;
          width *= 2;
          height *= 2;
        }
        s.setElements(s.elements.map((x0) => (x0.id === it.id ? update(el, { x, y, width, height }) : x0)));
        return;
      }
      case "createLinear": {
        const el = s.elements.find((x) => x.id === it.id) as LinearElement | undefined;
        if (!el) return;
        let target = snap(p);
        if (e.shiftKey) {
          const [dx, dy] = snapAngle(target[0] - it.origin[0], target[1] - it.origin[1]);
          target = [it.origin[0] + dx, it.origin[1] + dy];
        }
        const next = update(el, { points: [[0, 0], [target[0] - el.x, target[1] - el.y]], width: Math.abs(target[0] - el.x), height: Math.abs(target[1] - el.y) });
        s.setElements(s.elements.map((x) => (x.id === it.id ? next : x)));
        overlay.current.bindTarget = el.type === "arrow" ? getBindTarget(s.elements, target, zoom, el.id)?.id ?? null : null;
        return;
      }
      case "freedraw": {
        const el = s.elements.find((x) => x.id === it.id);
        if (!el || el.type !== "freedraw") return;
        const local: Point = [p[0] - el.x, p[1] - el.y];
        const last = el.points[el.points.length - 1];
        if (last && Math.hypot(local[0] - last[0], local[1] - last[1]) < 1 / zoom) return;
        const next = {
          ...el,
          points: [...el.points, local],
          pressures: e.pointerType === "pen" ? [...el.pressures, e.pressure] : el.pressures,
          version: el.version + 1,
        };
        s.setElements(s.elements.map((x) => (x.id === it.id ? next : x)));
        return;
      }
      case "move": {
        let dx = p[0] - it.origin[0];
        let dy = p[1] - it.origin[1];
        if (!it.moved && Math.hypot(dx, dy) * zoom < 2) return;
        it.moved = true;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (s.grid && it.originals.size) {
          const first = it.originals.values().next().value!;
          dx = snapToGrid(first.x + dx, GRID_SIZE) - first.x;
          dy = snapToGrid(first.y + dy, GRID_SIZE) - first.y;
        }
        const next = s.elements.map((el) => {
          const o = it.originals.get(el.id);
          if (!o) return el;
          const moved = update(o, { x: o.x + dx, y: o.y + dy });
          if (isLinear(moved)) {
            // Arrows dragged away from their targets detach.
            if (moved.startBinding && !it.originals.has(moved.startBinding.elementId)) moved.startBinding = null;
            if (moved.endBinding && !it.originals.has(moved.endBinding.elementId)) moved.endBinding = null;
          }
          return moved;
        });
        s.setElements(next);
        return;
      }
      case "resize":
        return resizeMove(it, p, e);
      case "rotate": {
        let delta = Math.atan2(p[1] - it.center[1], p[0] - it.center[0]) - it.startAngle;
        if (e.shiftKey) {
          const step = Math.PI / 12;
          const single = it.originals.size === 1 ? [...it.originals.values()][0] : null;
          const base = single && !isLinear(single) && single.type !== "freedraw" ? single.angle : 0;
          delta = Math.round((base + delta) / step) * step - base;
        }
        const [cx, cy] = it.center;
        const next = s.elements.map((el) => {
          const o = it.originals.get(el.id);
          if (!o) return el;
          if (isLinear(o) || o.type === "freedraw") {
            const pts = o.points.map(([x, y]) => {
              const [rx, ry] = rotate(o.x + x, o.y + y, cx, cy, delta);
              return [rx - o.x, ry - o.y] as Point;
            });
            const rotated = normalizePoints(update(o, { points: pts } as Partial<SceneElement>) as SceneElement & { points: Point[] });
            return isLinear(rotated) ? { ...rotated, startBinding: null, endBinding: null } : rotated;
          }
          const [ox, oy] = getCenter(o);
          const [nx, ny] = rotate(ox, oy, cx, cy, delta);
          return update(o, { x: nx - o.width / 2, y: ny - o.height / 2, angle: o.angle + delta });
        });
        s.setElements(next);
        return;
      }
      case "marquee": {
        const [ox, oy] = it.origin;
        const m: Bounds = { minX: Math.min(ox, p[0]), minY: Math.min(oy, p[1]), maxX: Math.max(ox, p[0]), maxY: Math.max(oy, p[1]) };
        overlay.current.marquee = m;
        const inside = s.elements
          .filter((el) => !(el.type === "text" && el.containerId) && boundsContain(m, getElementBounds(el)))
          .map((el) => el.id);
        s.select(new Set([...it.base, ...expandToGroups(s.elements, inside)]));
        scheduleRender();
        return;
      }
      case "linearPoint": {
        const el = s.elements.find((x) => x.id === it.id) as LinearElement | undefined;
        if (!el) return;
        let target = snap(p);
        const n = it.original.points.length;
        const neighborIdx = it.index === 0 ? 1 : it.index - 1;
        if (e.shiftKey) {
          const nb = it.original.points[neighborIdx];
          const [dx, dy] = snapAngle(target[0] - it.original.x - nb[0], target[1] - it.original.y - nb[1]);
          target = [it.original.x + nb[0] + dx, it.original.y + nb[1] + dy];
        }
        const isEnd = it.index === 0 || it.index === n - 1;
        const bind = isEnd && el.type === "arrow" ? getBindTarget(s.elements, target, zoom, el.id) : null;
        overlay.current.bindTarget = bind?.id ?? null;
        const pts = it.original.points.map((pt, i) => (i === it.index ? [target[0] - it.original.x, target[1] - it.original.y] : pt) as Point);
        const changes: Partial<LinearElement> = { points: pts };
        // Dragging an endpoint detaches it; it re-attaches on release over a shape.
        if (it.index === 0) changes.startBinding = null;
        if (it.index === n - 1) changes.endBinding = null;
        const next = normalizePoints(update(it.original, changes));
        s.setElements(s.elements.map((x) => (x.id === it.id ? next : x)));
        return;
      }
      case "erase": {
        eraseAlong(it.last, p);
        it.last = p;
        return;
      }
      case "laser": {
        overlay.current.laser.points.push(p);
        overlay.current.laser.times.push(now());
        scheduleRender();
        return;
      }
    }
  };

  const resizeMove = (it: Extract<Interaction, { kind: "resize" }>, p: Point, e: React.PointerEvent) => {
    const s = useEditor.getState();
    const { box, handle } = it;
    const single = it.originals.size === 1 ? [...it.originals.values()][0] : null;
    const angle = box.angle;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const [lx, ly] = rotate(p[0], p[1], cx, cy, -angle);
    let x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
    const sp = s.grid && angle === 0 ? snap([lx, ly]) : ([lx, ly] as Point);
    if (handle.includes("w")) x0 = sp[0];
    if (handle.includes("e")) x1 = sp[0];
    if (handle.includes("n")) y0 = sp[1];
    if (handle.includes("s")) y1 = sp[1];

    const hasText = [...it.originals.values()].some((el) => el.type === "text" || el.type === "image" || el.type === "icon");
    const keepAspect = e.shiftKey !== (hasText && handle.length === 2) || (single?.type === "text");
    if (e.altKey) {
      // Resize symmetrically around the center.
      if (handle.includes("w")) x1 = 2 * cx - x0;
      if (handle.includes("e")) x0 = 2 * cx - x1;
      if (handle.includes("n")) y1 = 2 * cy - y0;
      if (handle.includes("s")) y0 = 2 * cy - y1;
    }
    if (keepAspect && box.width > 0 && box.height > 0) {
      const ratio = box.width / box.height;
      let w = x1 - x0;
      let h = y1 - y0;
      if (handle === "n" || handle === "s") w = h * ratio;
      else if (handle === "e" || handle === "w") h = w / ratio;
      else if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.abs(w) / ratio) * Math.sign(h || 1);
      else w = Math.abs(h) * ratio * Math.sign(w || 1);
      if (handle.includes("w")) x0 = x1 - w;
      else if (handle.includes("e")) x1 = x0 + w;
      else {
        x0 = cx - w / 2;
        x1 = cx + w / 2;
      }
      if (handle.includes("n")) y0 = y1 - h;
      else if (handle.includes("s")) y1 = y0 + h;
      else {
        y0 = cy - h / 2;
        y1 = cy + h / 2;
      }
    }
    const minSize = 1;
    const nx0 = Math.min(x0, x1);
    const ny0 = Math.min(y0, y1);
    let nx1 = Math.max(x0, x1);
    let ny1 = Math.max(y0, y1);
    if (nx1 - nx0 < minSize) nx1 = nx0 + minSize;
    if (ny1 - ny0 < minSize) ny1 = ny0 + minSize;
    const flipX = x1 < x0;
    const flipY = y1 < y0;

    if (single && !isLinear(single) && single.type !== "freedraw") {
      const w = nx1 - nx0;
      const h = ny1 - ny0;
      // New center, rotated back into scene space around the original center.
      const [ncx, ncy] = rotate((nx0 + nx1) / 2, (ny0 + ny1) / 2, cx, cy, angle);
      const changes: Partial<SceneElement> = { x: ncx - w / 2, y: ncy - h / 2, width: w, height: h };
      if (single.type === "text") {
        (changes as Partial<TextElement>).fontSize = Math.max(4, (single.fontSize * w) / single.width);
      }
      s.setElements(s.elements.map((el) => (el.id === single.id ? update(single, changes) : el)));
      return;
    }

    // Scale a group of elements relative to the selection box.
    const sx = (nx1 - nx0) / (box.width || 1);
    const sy = (ny1 - ny0) / (box.height || 1);
    const mapX = (x: number) => (flipX ? nx1 - (x - box.x) * sx : nx0 + (x - box.x) * sx);
    const mapY = (y: number) => (flipY ? ny1 - (y - box.y) * sy : ny0 + (y - box.y) * sy);
    const next = s.elements.map((el) => {
      const o = it.originals.get(el.id);
      if (!o) return el;
      if (isLinear(o) || o.type === "freedraw") {
        const pts = o.points.map(([px, py]) => [mapX(o.x + px) - o.x, mapY(o.y + py) - o.y] as Point);
        return normalizePoints(update(o, { points: pts } as Partial<SceneElement>) as SceneElement & { points: Point[] });
      }
      const [ocx, ocy] = getCenter(o);
      const w = o.width * sx;
      const h = o.height * sy;
      const changes: Partial<SceneElement> = { x: mapX(ocx) - w / 2, y: mapY(ocy) - h / 2, width: w, height: h };
      if (o.type === "text") (changes as Partial<TextElement>).fontSize = Math.max(4, o.fontSize * Math.min(sx, sy));
      return update(o, changes);
    });
    s.setElements(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const it = interaction.current;
    interaction.current = null;
    const s = useEditor.getState();
    const zoom = s.viewport.zoom;
    if (!it) return;

    switch (it.kind) {
      case "pan":
        setCursor(spaceDown.current || s.tool === "hand" ? "grab" : "default");
        break;
      case "create": {
        const el = s.elements.find((x) => x.id === it.id);
        if (el && el.width * zoom < 3 && el.height * zoom < 3) {
          s.setElements(s.elements.filter((x) => x.id !== it.id));
          break;
        }
        finishTool(it.id);
        break;
      }
      case "createLinear": {
        const el = s.elements.find((x) => x.id === it.id) as LinearElement | undefined;
        if (!el) break;
        const end: Point = [el.x + el.points[1][0], el.y + el.points[1][1]];
        if (distance([el.x, el.y], end) * zoom < 5) {
          // A click without drag starts click-by-click mode.
          multiPoint.current = el.id;
          const next = update(el, { startBinding: it.startBind ? { elementId: it.startBind } : null });
          s.setElements(s.elements.map((x) => (x.id === el.id ? next : x)));
          break;
        }
        const endTarget = el.type === "arrow" ? getBindTarget(s.elements, end, zoom, el.id) : null;
        const next = normalizePoints(
          update(el, {
            startBinding: it.startBind && it.startBind !== endTarget?.id ? { elementId: it.startBind } : null,
            endBinding: endTarget && endTarget.id !== it.startBind ? { elementId: endTarget.id } : null,
          }),
        );
        s.setElements(s.elements.map((x) => (x.id === el.id ? next : x)));
        overlay.current.bindTarget = null;
        finishTool(el.id);
        break;
      }
      case "freedraw": {
        const el = s.elements.find((x) => x.id === it.id);
        if (el && el.type === "freedraw") {
          s.setElements(s.elements.map((x) => (x.id === it.id ? normalizePoints(el) : x)));
        }
        s.commit();
        break;
      }
      case "move":
      case "resize":
      case "rotate":
        s.commit();
        break;
      case "marquee":
        overlay.current.marquee = null;
        scheduleRender();
        break;
      case "linearPoint": {
        const el = s.elements.find((x) => x.id === it.id) as LinearElement | undefined;
        const n = it.original.points.length;
        if (el && el.type === "arrow" && (it.index === 0 || it.index === n - 1)) {
          const pt = it.index === 0 ? el.points[0] : el.points[el.points.length - 1];
          const target = getBindTarget(s.elements, [el.x + pt[0], el.y + pt[1]], zoom, el.id);
          if (target) {
            const key = it.index === 0 ? "startBinding" : "endBinding";
            const other = it.index === 0 ? el.endBinding : el.startBinding;
            if (other?.elementId !== target.id) {
              s.setElements(s.elements.map((x) => (x.id === el.id ? update(el, { [key]: { elementId: target.id } }) : x)));
            }
          }
        }
        overlay.current.bindTarget = null;
        s.commit();
        break;
      }
      case "erase": {
        const faded = overlay.current.faded;
        if (faded.size) {
          s.setElements(s.elements.filter((el) => !faded.has(el.id)));
          s.select([...s.selectedIds].filter((id) => !faded.has(id)));
          s.commit();
        }
        overlay.current.faded = new Set();
        scheduleRender();
        break;
      }
      case "laser":
        break;
    }
    updateHoverCursor(toScene(e.clientX, e.clientY), e);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useEditor.getState();
    if (multiPoint.current) {
      finishMultiPoint();
      return;
    }
    if (s.tool !== "selection") return;
    const p = toScene(e.clientX, e.clientY);
    let target = getElementAt(s.elements, p, s.viewport.zoom, s.selectedIds);
    // Double-clicking a label edits the label rather than selecting the container.
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const el = s.elements[i];
      if (el.type === "text" && el.containerId && hitElement(el, p, s.viewport.zoom)) {
        target = el;
        break;
      }
    }
    if (target?.locked) return;
    if (target && target.type !== "text" && !isTextContainer(target)) return;
    startTextEditing(p, target);
  };

  const updateHoverCursor = (p: Point, e: { shiftKey: boolean }) => {
    const s = useEditor.getState();
    if (spaceDown.current || s.tool === "hand") return setCursor("grab");
    if (s.tool === "text") return setCursor("text");
    if (s.tool === "eraser" || s.tool === "laser") return setCursor("crosshair");
    if (s.tool !== "selection") return setCursor("crosshair");
    const zoom = s.viewport.zoom;
    const selected = s.elements.filter((el) => s.selectedIds.has(el.id));
    if (selected.length === 1 && isLinear(selected[0]) && !selected[0].locked) {
      const { points, mids } = getLinearHandles(selected[0]);
      const r = HANDLE_SIZE / zoom;
      if ([...points, ...mids].some((pt) => distance(pt, p) <= r)) return setCursor("pointer");
    } else if (selected.length && !selected.some((el) => el.locked)) {
      const box = getTransformBox(selected);
      const handle = box && hitHandle(box, p, zoom, selected.length === 1 && selected[0].type === "text");
      if (box && handle) return setCursor(getHandleCursor(handle, box.angle));
    }
    const hit = getElementAt(s.elements, p, zoom, s.selectedIds);
    setCursor(hit && !e.shiftKey ? "move" : "default");
  };

  // ---------------------------------------------------------------------------
  // Wheel: scroll to pan, ctrl/pinch to zoom.

  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useEditor.getState();
      const rect = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
        s.zoomAt(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.viewport.zoom * factor)), e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      s.setViewport({ scrollX: s.viewport.scrollX - dx / s.viewport.zoom, scrollY: s.viewport.scrollY - dy / s.viewport.zoom });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Space to pan, Escape/Enter for in-progress lines.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.code === "Space" && !e.repeat) {
        spaceDown.current = true;
        setCursor("grab");
        e.preventDefault();
      }
      if ((e.key === "Escape" || e.key === "Enter") && multiPoint.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishMultiPoint();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = false;
        const t = useEditor.getState().tool;
        setCursor(t === "hand" ? "grab" : t === "selection" ? "default" : "crosshair");
      }
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
    };
  }, [finishMultiPoint]);

  // Finish an in-progress line if the user switches tools.
  useEffect(() => {
    if (multiPoint.current && tool !== "arrow" && tool !== "line") finishMultiPoint();
  }, [tool, finishMultiPoint]);

  const [cursorTool, setCursorTool] = useState(tool);
  if (cursorTool !== tool) {
    // Tool changed: drop the hover cursor computed for the previous tool.
    setCursorTool(tool);
    setCursor(null);
  }
  const cursor = hoverCursor ?? (tool === "hand" ? "grab" : tool === "selection" ? "default" : tool === "text" ? "text" : "crosshair");

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const scene = files.find((f) => f.name.endsWith(FILE_EXTENSION) || f.name.endsWith(".excile") || f.type === "application/json");
    if (scene) return loadFromBlob(scene);
    await insertImages(files, toScene(e.clientX, e.clientY));
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        data-canvas
        className="block touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          // Right-click selects what's under the cursor before the menu opens.
          const s = useEditor.getState();
          const p = toScene(e.clientX, e.clientY);
          const hit = getElementAt(s.elements, p, s.viewport.zoom, s.selectedIds);
          if (hit && !s.selectedIds.has(hit.id)) s.select(expandToGroups(s.elements, [hit.id]));
          if (!hit) s.select([]);
        }}
      />
    </div>
  );
}

