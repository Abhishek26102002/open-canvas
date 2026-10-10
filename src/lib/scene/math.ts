import type { Point, SceneElement, Viewport } from "./types";
import { isLinear } from "./types";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const rotate = (x: number, y: number, cx: number, cy: number, angle: number): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [(x - cx) * cos - (y - cy) * sin + cx, (x - cx) * sin + (y - cy) * cos + cy];
};

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

export const sceneToScreen = (x: number, y: number, v: Viewport): Point => [
  (x + v.scrollX) * v.zoom,
  (y + v.scrollY) * v.zoom,
];

export const screenToScene = (x: number, y: number, v: Viewport): Point => [
  x / v.zoom - v.scrollX,
  y / v.zoom - v.scrollY,
];

export const getCenter = (el: SceneElement): Point => [el.x + el.width / 2, el.y + el.height / 2];

/** Bounds of the points of a linear/freedraw element, relative to its origin. */
export const getPointsBounds = (points: Point[]): Bounds => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

/** Axis-aligned bounds of an element in scene coordinates (rotation included). */
export const getElementBounds = (el: SceneElement): Bounds => {
  if (isLinear(el) || el.type === "freedraw") {
    const b = getPointsBounds(el.points);
    return { minX: el.x + b.minX, minY: el.y + b.minY, maxX: el.x + b.maxX, maxY: el.y + b.maxY };
  }
  const [cx, cy] = getCenter(el);
  const corners: Point[] = [
    [el.x, el.y],
    [el.x + el.width, el.y],
    [el.x + el.width, el.y + el.height],
    [el.x, el.y + el.height],
  ].map(([x, y]) => rotate(x, y, cx, cy, el.angle));
  return getPointsBounds(corners);
};

export const getCommonBounds = (elements: SceneElement[]): Bounds => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
};

export const boundsContain = (outer: Bounds, inner: Bounds) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

export const boundsIntersect = (a: Bounds, b: Bounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export const normalizeAngle = (a: number) => {
  const full = Math.PI * 2;
  return ((a % full) + full) % full;
};

/** Snap the vector (dx, dy) to the nearest 15° increment. */
export const snapAngle = (dx: number, dy: number): Point => {
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(angle) * len, Math.sin(angle) * len];
};

export const snapToGrid = (v: number, grid: number) => Math.round(v / grid) * grid;

/** Sample points along a Catmull-Rom curve through the given points. */
export const catmullRom = (points: Point[], segments = 12): Point[] => {
  if (points.length < 3) return points;
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
};

/** Point at half the length of a polyline. */
export const polylineMidpoint = (points: Point[]): Point => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  let half = total / 2;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1], points[i]);
    if (half <= d && d > 0) {
      const t = half / d;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
    half -= d;
  }
  return points[0];
};
