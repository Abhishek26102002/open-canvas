import rough from "roughjs";
import type { Drawable, Options } from "roughjs/bin/core";
import { getStroke } from "perfect-freehand";
import type { Arrowhead, FreedrawElement, LinearElement, Point, SceneElement } from "./types";
import { isLinear } from "./types";
import { themeColor, type Theme } from "./theme";

const generator = rough.generator();

const roughOptions = (el: SceneElement, theme: Theme): Options => {
  const sw = el.strokeWidth;
  const opts: Options = {
    seed: el.seed,
    stroke: themeColor(el.strokeColor, theme),
    strokeWidth: sw,
    roughness: el.roughness,
    bowing: el.roughness === 0 ? 0 : 1,
    fillWeight: sw / 2,
    hachureGap: sw * 4,
    preserveVertices: el.roughness < 2,
    disableMultiStroke: el.strokeStyle !== "solid",
  };
  if (el.strokeStyle === "dashed") opts.strokeLineDash = [8, 8 + sw];
  if (el.strokeStyle === "dotted") opts.strokeLineDash = [1.5, 6 + sw];
  if (el.strokeStyle !== "solid") opts.strokeWidth = sw + 0.5;
  if (el.backgroundColor !== "transparent" && !isLinear(el)) {
    opts.fill = themeColor(el.backgroundColor, theme);
    opts.fillStyle = el.fillStyle;
  }
  return opts;
};

const roundedRectPath = (w: number, h: number, r: number) =>
  `M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`;

const roundedDiamondPath = (w: number, h: number) => {
  const r = Math.min(w, h) * 0.12;
  const top: Point = [w / 2, 0], right: Point = [w, h / 2], bottom: Point = [w / 2, h], left: Point = [0, h / 2];
  const lerp = (a: Point, b: Point, d: number): Point => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [a[0] + ((b[0] - a[0]) / len) * d, a[1] + ((b[1] - a[1]) / len) * d];
  };
  const pts = [top, right, bottom, left];
  let d = "";
  pts.forEach((p, i) => {
    const prev = pts[(i + 3) % 4];
    const next = pts[(i + 1) % 4];
    const a = lerp(p, prev, r);
    const b = lerp(p, next, r);
    d += `${i === 0 ? "M" : "L"} ${a[0]} ${a[1]} Q ${p[0]} ${p[1]}, ${b[0]} ${b[1]} `;
  });
  return d + "Z";
};

const arrowheadDrawables = (el: LinearElement, theme: Theme, head: Arrowhead, tip: Point, from: Point): Drawable[] => {
  if (!head) return [];
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const segLen = Math.hypot(dx, dy);
  if (segLen < 1) return [];
  const ux = dx / segLen;
  const uy = dy / segLen;
  const size = Math.min(14 + el.strokeWidth * 3, segLen * 0.6);
  const opts: Options = { ...roughOptions(el, theme), strokeLineDash: undefined, fill: undefined };
  const ink = themeColor(el.strokeColor, theme);
  const wing = (angle: number): Point => {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const bx = -ux * size, by = -uy * size;
    return [tip[0] + bx * cos - by * sin, tip[1] + bx * sin + by * cos];
  };
  switch (head) {
    case "arrow": {
      const a = wing(Math.PI / 7), b = wing(-Math.PI / 7);
      return [generator.linearPath([a, tip, b], opts)];
    }
    case "triangle": {
      const a = wing(Math.PI / 7), b = wing(-Math.PI / 7);
      return [generator.polygon([tip, a, b], { ...opts, fill: ink, fillStyle: "solid" })];
    }
    case "bar": {
      const half = size / 2;
      return [generator.line(tip[0] - uy * half, tip[1] + ux * half, tip[0] + uy * half, tip[1] - ux * half, opts)];
    }
    case "dot": {
      const r = Math.max(6, el.strokeWidth * 3);
      return [generator.circle(tip[0] - ux * r / 2, tip[1] - uy * r / 2, r, { ...opts, fill: ink, fillStyle: "solid" })];
    }
  }
};

/** Builds rough.js drawables for an element in its local coordinate space. */
const buildDrawables = (el: SceneElement, theme: Theme): Drawable[] => {
  const opts = roughOptions(el, theme);
  const { width: w, height: h } = el;
  switch (el.type) {
    case "rectangle": {
      if (el.roundness === "round") {
        const r = Math.min(Math.min(w, h) * 0.25, 32);
        return [generator.path(roundedRectPath(w, h, r), opts)];
      }
      return [generator.rectangle(0, 0, w, h, opts)];
    }
    case "diamond": {
      if (el.roundness === "round") return [generator.path(roundedDiamondPath(w, h), opts)];
      return [generator.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], opts)];
    }
    case "ellipse":
      return [generator.ellipse(w / 2, h / 2, w, h, opts)];
    case "arrow":
    case "line": {
      const pts = el.points;
      const body = el.arrowType === "round" && pts.length > 2
        ? generator.curve(pts, opts)
        : generator.linearPath(pts, opts);
      const n = pts.length;
      return [
        body,
        ...arrowheadDrawables(el, theme, el.startArrowhead, pts[0], pts[1]),
        ...arrowheadDrawables(el, theme, el.endArrowhead, pts[n - 1], pts[n - 2]),
      ];
    }
    default:
      return [];
  }
};

const drawableCache: Record<Theme, WeakMap<SceneElement, Drawable[]>> = { light: new WeakMap(), dark: new WeakMap() };

export const getDrawables = (el: SceneElement, theme: Theme = "light"): Drawable[] => {
  let d = drawableCache[theme].get(el);
  if (!d) {
    d = buildDrawables(el, theme);
    drawableCache[theme].set(el, d);
  }
  return d;
};

/** Outline polygon for a pen stroke, generated by perfect-freehand. */
export const getFreedrawOutline = (el: FreedrawElement): Point[] => {
  const input = el.points.map(([x, y], i) => [x, y, el.pressures[i] ?? 0.5]);
  return getStroke(input, {
    size: el.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: el.pressures.length === 0,
    last: true,
  }) as Point[];
};

export const outlineToSvgPath = (outline: Point[]) => {
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  );
  d.push("Z");
  return d.join(" ");
};

const pathCache = new WeakMap<SceneElement, Path2D>();

export const getFreedrawPath = (el: FreedrawElement) => {
  let p = pathCache.get(el);
  if (!p) {
    p = new Path2D(outlineToSvgPath(getFreedrawOutline(el)));
    pathCache.set(el, p);
  }
  return p;
};

export { generator };
