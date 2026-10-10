import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import { GRID_SIZE, HANDLE_SIZE, LINE_HEIGHT } from "./constants";
import { GRID_COLORS, HANDLE_FILL, SELECTION_COLOR, themeColor, type Theme } from "./theme";
import { getRenderedText, getAbsolutePoints, ICON_VIEWBOX } from "./elements";
import { getHandles, getTransformBox, type HandleType } from "./hittest";
import { getCenter, getElementBounds, polylineMidpoint, type Bounds } from "./math";
import { getDrawables, getFreedrawPath } from "./shapes";
import { getIconPath2D } from "./icons";
import { getFontString } from "./text";
import type { BinaryFile, IconElement, Point, SceneElement, TextElement, Viewport } from "./types";
import { isLinear } from "./types";

// ---------------------------------------------------------------------------
// Image cache

const imageCache = new Map<string, HTMLImageElement>();
let onImageLoad: (() => void) | null = null;
export const setImageLoadCallback = (cb: () => void) => {
  onImageLoad = cb;
};

const getImage = (file: BinaryFile | undefined) => {
  if (!file) return null;
  let img = imageCache.get(file.id);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad?.();
    img.src = file.dataURL;
    imageCache.set(file.id, img);
  }
  return img.complete && img.naturalWidth ? img : null;
};

// ---------------------------------------------------------------------------
// Element drawing

const drawText = (ctx: CanvasRenderingContext2D, el: TextElement, theme: Theme, container?: SceneElement) => {
  const text = getRenderedText(el, container);
  ctx.font = getFontString(el.fontFamily, el.fontSize);
  ctx.fillStyle = themeColor(el.strokeColor, theme);
  ctx.textBaseline = "middle";
  ctx.textAlign = el.textAlign;
  const lineHeight = el.fontSize * LINE_HEIGHT;
  const x = el.textAlign === "center" ? el.width / 2 : el.textAlign === "right" ? el.width : 0;
  text.split("\n").forEach((line, i) => {
    ctx.fillText(line, x, i * lineHeight + lineHeight / 2);
  });
};

const DASHES = { solid: [], dashed: [8, 6], dotted: [1.5, 6] } as const;

/** Lucide icons are 24x24 outlines; scale them to the element box and keep line weight proportional. */
const drawIcon = (ctx: CanvasRenderingContext2D, el: IconElement, theme: Theme) => {
  const sx = el.width / ICON_VIEWBOX;
  const sy = el.height / ICON_VIEWBOX;
  const path = new Path2D();
  path.addPath(getIconPath2D(el.path), new DOMMatrix([sx, 0, 0, sy, 0, 0]));
  if (el.backgroundColor !== "transparent") {
    ctx.fillStyle = themeColor(el.backgroundColor, theme);
    ctx.fill(path);
  }
  const lw = el.strokeWidth * Math.min(sx, sy);
  ctx.strokeStyle = themeColor(el.strokeColor, theme);
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(DASHES[el.strokeStyle].map((d) => (d * lw) / 2));
  ctx.stroke(path);
};

export interface DrawContext {
  rc: RoughCanvas;
  files: Record<string, BinaryFile>;
  byId: Map<string, SceneElement>;
  labels: Map<string, TextElement>;
  theme: Theme;
}

export const drawElement = (ctx: CanvasRenderingContext2D, el: SceneElement, dc: DrawContext, opacity = 1) => {
  ctx.save();
  ctx.globalAlpha = (el.opacity / 100) * opacity;
  if (isLinear(el) || el.type === "freedraw") {
    ctx.translate(el.x, el.y);
  } else {
    const [cx, cy] = getCenter(el);
    ctx.translate(cx, cy);
    ctx.rotate(el.angle);
    ctx.translate(-el.width / 2, -el.height / 2);
  }

  switch (el.type) {
    case "freedraw": {
      ctx.fillStyle = themeColor(el.strokeColor, dc.theme);
      ctx.fill(getFreedrawPath(el));
      break;
    }
    case "text": {
      const container = el.containerId ? dc.byId.get(el.containerId) : undefined;
      drawText(ctx, el, dc.theme, container);
      break;
    }
    case "image": {
      const img = getImage(dc.files[el.fileId]);
      if (img) {
        ctx.drawImage(img, 0, 0, el.width, el.height);
      } else {
        ctx.fillStyle = "rgba(128,128,128,0.15)";
        ctx.fillRect(0, 0, el.width, el.height);
      }
      break;
    }
    case "icon":
      drawIcon(ctx, el, dc.theme);
      break;
    default: {
      const label = isLinear(el) ? dc.labels.get(el.id) : undefined;
      if (label && label.text) {
        // Cut a hole where the arrow label sits so the line doesn't strike through it.
        ctx.beginPath();
        ctx.rect(-1e5, -1e5, 2e5, 2e5);
        ctx.rect(label.x - el.x - 4, label.y - el.y - 2, label.width + 8, label.height + 4);
        ctx.clip("evenodd");
      }
      for (const d of getDrawables(el, dc.theme)) dc.rc.draw(d);
    }
  }
  ctx.restore();
};

// ---------------------------------------------------------------------------
// Scene

export interface RenderOptions {
  elements: SceneElement[];
  files: Record<string, BinaryFile>;
  viewport: Viewport;
  width: number;
  height: number;
  dpr: number;
  background: string | null;
  grid: boolean;
  selectedIds: Set<string>;
  hiddenIds?: Set<string>;
  fadedIds?: Set<string>;
  hoveredBindTarget?: string | null;
  marquee?: Bounds | null;
  editingLinearId?: string | null;
  laser?: { points: Point[]; times: number[] } | null;
  showHandles?: boolean;
  theme?: Theme;
  /** What collaborators have selected, outlined in their color. */
  remoteSelections?: { color: string; ids: string[] }[];
}

const drawGrid = (ctx: CanvasRenderingContext2D, v: Viewport, w: number, h: number, theme: Theme) => {
  const size = GRID_SIZE * v.zoom;
  if (size < 6) return;
  ctx.save();
  ctx.lineWidth = 1;
  const line = (idx: number, horizontal: boolean, pos: number) => {
    ctx.strokeStyle = idx % 5 === 0 ? GRID_COLORS[theme].major : GRID_COLORS[theme].minor;
    const p = Math.round(pos) + 0.5;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
    } else {
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
    }
    ctx.stroke();
  };
  for (let i = Math.floor(-v.scrollX / GRID_SIZE); ; i++) {
    const x = (i * GRID_SIZE + v.scrollX) * v.zoom;
    if (x > w) break;
    line(i, false, x);
  }
  for (let i = Math.floor(-v.scrollY / GRID_SIZE); ; i++) {
    const y = (i * GRID_SIZE + v.scrollY) * v.zoom;
    if (y > h) break;
    line(i, true, y);
  }
  ctx.restore();
};

const strokeRotatedBox = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, angle: number, pad: number) => {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.strokeRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2);
  ctx.restore();
};

const drawHandle = (ctx: CanvasRenderingContext2D, p: Point, zoom: number, kind: HandleType | "point" | "mid", theme: Theme, angle = 0) => {
  const s = HANDLE_SIZE / zoom;
  const accent = SELECTION_COLOR[theme];
  ctx.save();
  ctx.fillStyle = HANDLE_FILL[theme];
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  if (kind === "rotation") {
    ctx.fillStyle = accent;
    ctx.arc(p[0], p[1], s / 2, 0, Math.PI * 2);
  } else if (kind === "point") {
    ctx.arc(p[0], p[1], s / 2, 0, Math.PI * 2);
  } else if (kind === "mid") {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = accent;
    ctx.arc(p[0], p[1], s / 3.2, 0, Math.PI * 2);
  } else if (kind.length === 1) {
    // Edge handles are short pills aligned with their edge.
    const long = s * 1.6;
    const short = s * 0.6;
    const vertical = kind === "e" || kind === "w";
    ctx.translate(p[0], p[1]);
    ctx.rotate(angle);
    const w = vertical ? short : long;
    const h = vertical ? long : short;
    ctx.roundRect(-w / 2, -h / 2, w, h, short / 2);
  } else {
    ctx.arc(p[0], p[1], s / 2, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

/** Points the user can drag to edit a selected arrow/line, plus midpoints to insert new ones. */
export const getLinearHandles = (el: SceneElement) => {
  if (!isLinear(el)) return { points: [] as Point[], mids: [] as Point[] };
  const points = getAbsolutePoints(el);
  const mids: Point[] = [];
  for (let i = 1; i < points.length; i++) mids.push(polylineMidpoint([points[i - 1], points[i]]));
  return { points, mids };
};

const drawSelection = (ctx: CanvasRenderingContext2D, opts: RenderOptions, selected: SceneElement[]) => {
  const { zoom } = opts.viewport;
  const theme = opts.theme ?? "light";
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR[theme];
  ctx.lineWidth = 1 / zoom;
  const pad = 6 / zoom;

  if (selected.length > 1) {
    ctx.save();
    ctx.setLineDash([3 / zoom, 3 / zoom]);
    ctx.globalAlpha = 0.6;
    for (const el of selected) {
      if (isLinear(el) || el.type === "freedraw") {
        const b = getElementBounds(el);
        ctx.strokeRect(b.minX - pad / 2, b.minY - pad / 2, b.maxX - b.minX + pad, b.maxY - b.minY + pad);
      } else strokeRotatedBox(ctx, el.x, el.y, el.width, el.height, el.angle, pad / 2);
    }
    ctx.restore();
  }

  const single = selected.length === 1 ? selected[0] : null;
  if (single && isLinear(single)) {
    const { points, mids } = getLinearHandles(single);
    if (opts.showHandles !== false && !single.locked) {
      if (points.length > 2 || opts.editingLinearId === single.id) {
        const b = getElementBounds(single);
        ctx.save();
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
        ctx.restore();
      }
      mids.forEach((m) => drawHandle(ctx, m, zoom, "mid", theme));
      points.forEach((p) => drawHandle(ctx, p, zoom, "point", theme));
    }
    ctx.restore();
    return;
  }

  const box = getTransformBox(selected);
  if (box) {
    strokeRotatedBox(ctx, box.x, box.y, box.width, box.height, box.angle, pad);
    const locked = selected.some((e) => e.locked);
    if (opts.showHandles !== false && !locked) {
      const handles = getHandles(box, zoom, single?.type === "text");
      for (const [k, p] of Object.entries(handles) as [HandleType, Point][]) drawHandle(ctx, p, zoom, k, theme, box.angle);
    }
  }
  ctx.restore();
};

export const renderScene = (ctx: CanvasRenderingContext2D, opts: RenderOptions) => {
  const { viewport: v, width, height, dpr } = opts;
  const theme = opts.theme ?? "light";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (opts.background) {
    ctx.fillStyle = themeColor(opts.background, theme);
    ctx.fillRect(0, 0, width, height);
  }
  if (opts.grid) drawGrid(ctx, v, width, height, theme);

  ctx.save();
  ctx.scale(v.zoom, v.zoom);
  ctx.translate(v.scrollX, v.scrollY);

  const rc = rough.canvas(ctx.canvas);
  const byId = new Map(opts.elements.map((e) => [e.id, e]));
  const labels = new Map<string, TextElement>();
  for (const el of opts.elements) if (el.type === "text" && el.containerId) labels.set(el.containerId, el);
  const dc: DrawContext = { rc, files: opts.files, byId, labels, theme };

  const view: Bounds = {
    minX: -v.scrollX,
    minY: -v.scrollY,
    maxX: -v.scrollX + width / v.zoom,
    maxY: -v.scrollY + height / v.zoom,
  };

  for (const el of opts.elements) {
    if (opts.hiddenIds?.has(el.id)) continue;
    const b = getElementBounds(el);
    const margin = 50;
    if (b.maxX < view.minX - margin || b.minX > view.maxX + margin || b.maxY < view.minY - margin || b.minY > view.maxY + margin) continue;
    drawElement(ctx, el, dc, opts.fadedIds?.has(el.id) ? 0.25 : 1);
  }

  if (opts.hoveredBindTarget) {
    const t = byId.get(opts.hoveredBindTarget);
    if (t) {
      ctx.save();
      ctx.strokeStyle = SELECTION_COLOR[theme];
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 6 / v.zoom;
      strokeRotatedBox(ctx, t.x, t.y, t.width, t.height, t.angle, 4 / v.zoom);
      ctx.restore();
    }
  }

  if (opts.remoteSelections?.length) {
    ctx.save();
    ctx.lineWidth = 1.5 / v.zoom;
    ctx.setLineDash([5 / v.zoom, 4 / v.zoom]);
    for (const { color, ids } of opts.remoteSelections) {
      ctx.strokeStyle = color;
      for (const id of ids) {
        const el = byId.get(id);
        if (!el) continue;
        if (isLinear(el) || el.type === "freedraw") {
          const b = getElementBounds(el);
          ctx.strokeRect(b.minX - 4 / v.zoom, b.minY - 4 / v.zoom, b.maxX - b.minX + 8 / v.zoom, b.maxY - b.minY + 8 / v.zoom);
        } else strokeRotatedBox(ctx, el.x, el.y, el.width, el.height, el.angle, 4 / v.zoom);
      }
    }
    ctx.restore();
  }

  const selected = opts.elements.filter((e) => opts.selectedIds.has(e.id) && !opts.hiddenIds?.has(e.id));
  if (selected.length) drawSelection(ctx, opts, selected);

  if (opts.marquee) {
    const m = opts.marquee;
    ctx.save();
    ctx.fillStyle = theme === "dark" ? "rgba(45,212,191,0.1)" : "rgba(13,148,136,0.08)";
    ctx.strokeStyle = SELECTION_COLOR[theme];
    ctx.lineWidth = 1 / v.zoom;
    ctx.fillRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY);
    ctx.strokeRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY);
    ctx.restore();
  }

  if (opts.laser && opts.laser.points.length > 1) {
    const now = performance.now();
    const pts = opts.laser.points;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < pts.length; i++) {
      const age = (now - opts.laser.times[i]) / 1000;
      const alpha = Math.max(0, 1 - age);
      if (alpha <= 0) continue;
      ctx.strokeStyle = `rgba(255, 40, 40, ${alpha})`;
      ctx.lineWidth = (4 * (0.4 + alpha * 0.6)) / v.zoom;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
      ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
};

/** Renders elements onto a fresh canvas sized to their bounds (used for export). */
export const renderToCanvas = (
  elements: SceneElement[],
  files: Record<string, BinaryFile>,
  opts: { scale: number; padding: number; background: string | null; theme?: Theme },
) => {
  const canvas = document.createElement("canvas");
  if (!elements.length) {
    canvas.width = canvas.height = 1;
    return canvas;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const w = maxX - minX + opts.padding * 2;
  const h = maxY - minY + opts.padding * 2;
  canvas.width = Math.ceil(w * opts.scale);
  canvas.height = Math.ceil(h * opts.scale);
  const ctx = canvas.getContext("2d")!;
  renderScene(ctx, {
    elements,
    files,
    viewport: { scrollX: -minX + opts.padding, scrollY: -minY + opts.padding, zoom: 1 },
    width: w,
    height: h,
    dpr: opts.scale,
    background: opts.background,
    theme: opts.theme,
    grid: false,
    selectedIds: new Set(),
  });
  return canvas;
};
