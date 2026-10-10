import { HANDLE_SIZE, ROTATION_HANDLE_OFFSET } from "./constants";
import { catmullRom, distanceToSegment, getCenter, getCommonBounds, rotate, type Bounds } from "./math";
import type { Point, SceneElement } from "./types";
import { isLinear } from "./types";

const polylineHit = (p: Point, pts: Point[], threshold: number) => {
  for (let i = 1; i < pts.length; i++) {
    if (distanceToSegment(p, pts[i - 1], pts[i]) <= threshold) return true;
  }
  return false;
};

/**
 * Whether the scene point hits the element. Transparent shapes are only hit on
 * their outline (like Excalidraw), unless `inside` is set.
 */
export const hitElement = (el: SceneElement, p: Point, zoom: number, inside = false): boolean => {
  const threshold = Math.max(el.strokeWidth / 2, 10 / zoom);
  if (isLinear(el) || el.type === "freedraw") {
    const local: Point = [p[0] - el.x, p[1] - el.y];
    const pts = isLinear(el) && el.arrowType === "round" ? catmullRom(el.points) : el.points;
    if (pts.length === 1) return Math.hypot(local[0] - pts[0][0], local[1] - pts[0][1]) <= threshold;
    return polylineHit(local, pts, threshold);
  }
  const [cx, cy] = getCenter(el);
  const [lx, ly] = rotate(p[0], p[1], cx, cy, -el.angle);
  const x = lx - el.x;
  const y = ly - el.y;
  const { width: w, height: h } = el;
  const filled = inside || el.backgroundColor !== "transparent" || el.type === "text" || el.type === "image" || el.type === "icon";

  if (el.type === "text" || el.type === "image" || el.type === "icon") {
    return x >= -threshold / 2 && x <= w + threshold / 2 && y >= -threshold / 2 && y <= h + threshold / 2;
  }
  if (el.type === "ellipse") {
    const a = w / 2, b = h / 2;
    const nx = x - a, ny = y - b;
    const outer = (nx * nx) / ((a + threshold) ** 2) + (ny * ny) / ((b + threshold) ** 2);
    if (outer > 1) return false;
    if (filled) return true;
    const ia = Math.max(a - threshold, 0.1), ib = Math.max(b - threshold, 0.1);
    return (nx * nx) / (ia * ia) + (ny * ny) / (ib * ib) >= 1;
  }
  if (el.type === "diamond") {
    const pts: Point[] = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2], [w / 2, 0]];
    if (polylineHit([x, y], pts, threshold)) return true;
    if (!filled) return false;
    return Math.abs(x - w / 2) / (w / 2 || 1) + Math.abs(y - h / 2) / (h / 2 || 1) <= 1;
  }
  // rectangle
  const inOuter = x >= -threshold && x <= w + threshold && y >= -threshold && y <= h + threshold;
  if (!inOuter) return false;
  if (filled) return true;
  const inInner = x > threshold && x < w - threshold && y > threshold && y < h - threshold;
  return !inInner;
};

/** Whether the point lies inside the element's (rotated) box. */
export const pointInElementBox = (el: SceneElement, p: Point) => {
  if (isLinear(el) || el.type === "freedraw") {
    const b = getCommonBounds([el]);
    return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
  }
  const [cx, cy] = getCenter(el);
  const [lx, ly] = rotate(p[0], p[1], cx, cy, -el.angle);
  return lx >= el.x && lx <= el.x + el.width && ly >= el.y && ly <= el.y + el.height;
};

// ---------------------------------------------------------------------------
// Transform handles

export type HandleType = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "rotation";

export interface TransformBox {
  /** Unrotated box in scene coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

export const getTransformBox = (selected: SceneElement[]): TransformBox | null => {
  if (!selected.length) return null;
  if (selected.length === 1 && !isLinear(selected[0]) && selected[0].type !== "freedraw") {
    const el = selected[0];
    return { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle };
  }
  const b: Bounds = getCommonBounds(selected);
  return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY, angle: 0 };
};

/** Handle centers in scene coordinates, with padding applied around the box. */
export const getHandles = (box: TransformBox, zoom: number, omitSides = false): Partial<Record<HandleType, Point>> => {
  const pad = 6 / zoom;
  const x0 = box.x - pad, y0 = box.y - pad;
  const x1 = box.x + box.width + pad, y1 = box.y + box.height + pad;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const raw: Partial<Record<HandleType, Point>> = {
    nw: [x0, y0], ne: [x1, y0], sw: [x0, y1], se: [x1, y1],
    rotation: [cx, y0 - ROTATION_HANDLE_OFFSET / zoom],
  };
  const sideMin = (HANDLE_SIZE * 4) / zoom;
  if (!omitSides) {
    if (box.width > sideMin) {
      raw.n = [cx, y0];
      raw.s = [cx, y1];
    }
    if (box.height > sideMin) {
      raw.w = [x0, cy];
      raw.e = [x1, cy];
    }
  }
  const out: Partial<Record<HandleType, Point>> = {};
  for (const [k, p] of Object.entries(raw) as [HandleType, Point][]) {
    out[k] = rotate(p[0], p[1], box.x + box.width / 2, box.y + box.height / 2, box.angle);
  }
  return out;
};

export const hitHandle = (box: TransformBox, p: Point, zoom: number, omitSides = false): HandleType | null => {
  const handles = getHandles(box, zoom, omitSides);
  const r = (HANDLE_SIZE / zoom) * 0.9;
  for (const [k, h] of Object.entries(handles) as [HandleType, Point][]) {
    if (Math.abs(p[0] - h[0]) <= r && Math.abs(p[1] - h[1]) <= r) return k;
  }
  return null;
};

const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
const HANDLE_ANGLES: Record<Exclude<HandleType, "rotation">, number> = {
  n: 0, ne: 1, e: 2, se: 3, s: 4, sw: 5, w: 6, nw: 7,
};

export const getHandleCursor = (handle: HandleType, angle: number) => {
  if (handle === "rotation") return "grab";
  const steps = Math.round((angle / (Math.PI / 4)) % 8);
  const idx = (HANDLE_ANGLES[handle] + steps + 8) % 8;
  return CURSORS[idx % 4];
};
