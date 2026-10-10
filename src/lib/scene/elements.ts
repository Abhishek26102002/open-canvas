import { nanoid } from "nanoid";
import { BINDING_GAP, BOUND_TEXT_PADDING, LINE_HEIGHT } from "./constants";
import { getCenter, getPointsBounds, polylineMidpoint, rotate } from "./math";
import { measureText, wrapText } from "./text";
import type {
  ItemStyle,
  LinearElement,
  Point,
  SceneElement,
  TextElement,
} from "./types";
import { isLinear, isShape } from "./types";

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export const newId = () => nanoid(12);

const base = (style: ItemStyle, x: number, y: number) => ({
  id: newId(),
  x,
  y,
  width: 0,
  height: 0,
  angle: 0,
  strokeColor: style.strokeColor,
  backgroundColor: style.backgroundColor,
  fillStyle: style.fillStyle,
  strokeWidth: style.strokeWidth,
  strokeStyle: style.strokeStyle,
  roughness: style.roughness,
  opacity: style.opacity,
  roundness: style.roundness,
  seed: randomSeed(),
  version: 1,
  groupIds: [] as string[],
  locked: false,
});

export const newShape = (type: "rectangle" | "diamond" | "ellipse", style: ItemStyle, x: number, y: number): SceneElement => ({
  ...base(style, x, y),
  type,
});

export const newLinear = (type: "arrow" | "line", style: ItemStyle, x: number, y: number): LinearElement => ({
  ...base(style, x, y),
  type,
  // Background fill only makes sense for closed shapes.
  backgroundColor: "transparent",
  roundness: style.arrowType === "round" ? "round" : "sharp",
  points: [[0, 0], [0, 0]],
  startArrowhead: type === "arrow" ? style.startArrowhead : null,
  endArrowhead: type === "arrow" ? style.endArrowhead : null,
  startBinding: null,
  endBinding: null,
  arrowType: style.arrowType,
});

export const newFreedraw = (style: ItemStyle, x: number, y: number): SceneElement => ({
  ...base(style, x, y),
  type: "freedraw",
  backgroundColor: "transparent",
  points: [[0, 0]],
  pressures: [],
});

export const newText = (style: ItemStyle, x: number, y: number, text = "", containerId: string | null = null): TextElement => {
  const { width, height } = measureText(text || " ", style.fontFamily, style.fontSize);
  return {
    ...base(style, x, y),
    type: "text",
    backgroundColor: "transparent",
    width,
    height,
    text,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    textAlign: containerId ? "center" : style.textAlign,
    containerId,
  };
};

export const newImage = (style: ItemStyle, x: number, y: number, width: number, height: number, fileId: string): SceneElement => ({
  ...base(style, x, y),
  type: "image",
  backgroundColor: "transparent",
  strokeColor: "transparent",
  width,
  height,
  fileId,
});

export const ICON_VIEWBOX = 24;

export const newIcon = (style: ItemStyle, x: number, y: number, size: number, iconName: string, path: string): SceneElement => ({
  ...base(style, x, y),
  type: "icon",
  backgroundColor: "transparent",
  roughness: 0,
  width: size,
  height: size,
  iconName,
  path,
});

/** Returns a copy of the element with the given changes and a bumped version. */
export const update = <T extends SceneElement>(el: T, changes: Partial<T>): T => ({
  ...el,
  ...changes,
  version: el.version + 1,
});

/** Shifts a linear/freedraw element so points[0] is at the origin and recomputes its size. */
export const normalizePoints = <T extends SceneElement & { points: Point[] }>(el: T): T => {
  const [ox, oy] = el.points[0];
  const points = el.points.map(([x, y]) => [x - ox, y - oy] as Point);
  const b = getPointsBounds(points);
  return update(el, {
    x: el.x + ox,
    y: el.y + oy,
    points,
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  } as Partial<T>);
};

export const getAbsolutePoints = (el: LinearElement): Point[] => el.points.map(([x, y]) => [el.x + x, el.y + y]);

// ---------------------------------------------------------------------------
// Bound text (labels inside shapes and on arrows)

const wrapCache = new Map<string, string>();

export const getContainerTextWidth = (container: SceneElement) => {
  if (isLinear(container)) return 240;
  const factor = container.type === "ellipse" ? 0.7 : container.type === "diamond" ? 0.5 : 1;
  return Math.max(container.width * factor - BOUND_TEXT_PADDING * 2, 20);
};

/** The text actually drawn, wrapped to the container width when bound. */
export const getRenderedText = (text: TextElement, container?: SceneElement) => {
  if (!container) return text.text;
  const maxWidth = getContainerTextWidth(container);
  const key = `${text.text}|${text.fontFamily}|${text.fontSize}|${maxWidth}`;
  let wrapped = wrapCache.get(key);
  if (wrapped === undefined) {
    wrapped = wrapText(text.text, text.fontFamily, text.fontSize, maxWidth);
    if (wrapCache.size > 2000) wrapCache.clear();
    wrapCache.set(key, wrapped);
  }
  return wrapped;
};

const layoutBoundText = (text: TextElement, container: SceneElement): { text: TextElement; container: SceneElement } => {
  const rendered = getRenderedText(text, container);
  const { width, height } = measureText(rendered || " ", text.fontFamily, text.fontSize);
  let nextContainer = container;
  let cx: number, cy: number;
  if (isLinear(container)) {
    const mid = polylineMidpoint(getAbsolutePoints(container));
    [cx, cy] = mid;
  } else {
    // Grow the container if the label no longer fits.
    const factor = container.type === "ellipse" ? 0.7 : container.type === "diamond" ? 0.5 : 1;
    const needed = height / factor + BOUND_TEXT_PADDING * 2;
    if (needed > container.height + 0.5) {
      nextContainer = update(container, { height: needed });
    }
    [cx, cy] = getCenter(nextContainer);
  }
  const angle = isLinear(container) ? 0 : container.angle;
  const x = cx - width / 2;
  const y = cy - height / 2;
  if (text.x === x && text.y === y && text.width === width && text.height === height && text.angle === angle) {
    return { text, container: nextContainer };
  }
  return { text: update(text, { x, y, width, height, angle, textAlign: "center" }), container: nextContainer };
};

// ---------------------------------------------------------------------------
// Arrow bindings

/** Distance from center to the element outline along direction (dx, dy), in local space. */
const outlineDistance = (el: SceneElement, dx: number, dy: number) => {
  const a = el.width / 2;
  const b = el.height / 2;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  if (el.type === "ellipse") {
    return 1 / Math.sqrt((ux * ux) / (a * a || 1) + (uy * uy) / (b * b || 1));
  }
  if (el.type === "diamond") {
    return 1 / (Math.abs(ux) / (a || 1) + Math.abs(uy) / (b || 1));
  }
  const tx = Math.abs(ux) > 1e-9 ? a / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-9 ? b / Math.abs(uy) : Infinity;
  return Math.min(tx, ty);
};

/** The point where an arrow coming from `from` should touch `target`. */
export const getBindingPoint = (target: SceneElement, from: Point): Point => {
  const [cx, cy] = getCenter(target);
  // Work in the target's unrotated space.
  const [lx, ly] = rotate(from[0], from[1], cx, cy, -target.angle);
  let dx = lx - cx;
  let dy = ly - cy;
  if (Math.hypot(dx, dy) < 1e-6) {
    dx = 0;
    dy = -1;
  }
  const len = Math.hypot(dx, dy);
  const d = outlineDistance(target, dx, dy) + BINDING_GAP;
  const px = cx + (dx / len) * d;
  const py = cy + (dy / len) * d;
  return rotate(px, py, cx, cy, target.angle);
};

const updateArrowBindings = (arrow: LinearElement, byId: Map<string, SceneElement>): LinearElement => {
  const start = arrow.startBinding ? byId.get(arrow.startBinding.elementId) : undefined;
  const end = arrow.endBinding ? byId.get(arrow.endBinding.elementId) : undefined;
  if (!start && !end) {
    if (arrow.startBinding || arrow.endBinding) return update(arrow, { startBinding: null, endBinding: null });
    return arrow;
  }
  const pts = getAbsolutePoints(arrow);
  const n = pts.length;
  if (start) {
    const ref = n === 2 && end ? getCenter(end) : pts[1];
    pts[0] = getBindingPoint(start, ref);
  }
  if (end) {
    const ref = n === 2 && start ? getCenter(start) : pts[n - 2];
    pts[n - 1] = getBindingPoint(end, ref);
  }
  const same = pts.every(([x, y], i) => Math.abs(x - arrow.x - arrow.points[i][0]) < 0.01 && Math.abs(y - arrow.y - arrow.points[i][1]) < 0.01);
  const startBinding = start ? arrow.startBinding : null;
  const endBinding = end ? arrow.endBinding : null;
  if (same && startBinding === arrow.startBinding && endBinding === arrow.endBinding) return arrow;
  return normalizePoints(
    update(arrow, {
      x: 0,
      y: 0,
      points: pts,
      startBinding,
      endBinding,
    }),
  );
};

/**
 * Keeps derived state consistent: arrows follow the shapes they are bound to,
 * labels stay centered in their containers, and orphaned labels are removed.
 */
export const normalizeScene = (elements: SceneElement[]): SceneElement[] => {
  let changed = false;
  const byId = new Map(elements.map((e) => [e.id, e]));
  let next = elements.map((el) => {
    if (el.type !== "arrow") return el;
    const updated = updateArrowBindings(el, byId);
    if (updated !== el) {
      changed = true;
      byId.set(updated.id, updated);
    }
    return updated;
  });

  const result: SceneElement[] = [];
  for (const el of next) {
    if (el.type === "text" && el.containerId) {
      const container = byId.get(el.containerId);
      if (!container) {
        changed = true;
        continue;
      }
      const laid = layoutBoundText(el, container);
      if (laid.text !== el) changed = true;
      if (laid.container !== container) {
        changed = true;
        byId.set(container.id, laid.container);
      }
      result.push(laid.text);
      continue;
    }
    result.push(el);
  }
  if (!changed) return elements;
  next = result.map((el) => byId.get(el.id) && el.type !== "text" ? byId.get(el.id)! : el);
  return next;
};

export const getBoundText = (elements: SceneElement[], containerId: string) =>
  elements.find((e): e is TextElement => e.type === "text" && e.containerId === containerId);

/** Fresh copies with new ids; groups, bindings and labels are remapped consistently. */
export const duplicateElements = (elements: SceneElement[], offset: number) => {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const el of elements) idMap.set(el.id, newId());
  return elements.map((el) => {
    const copy = {
      ...el,
      id: idMap.get(el.id)!,
      x: el.x + offset,
      y: el.y + offset,
      seed: randomSeed(),
      version: 1,
      groupIds: el.groupIds.map((g) => {
        if (!groupMap.has(g)) groupMap.set(g, newId());
        return groupMap.get(g)!;
      }),
    } as SceneElement;
    if (copy.type === "text" && copy.containerId) {
      copy.containerId = idMap.get(copy.containerId) ?? null;
    }
    if (isLinear(copy)) {
      copy.startBinding = copy.startBinding && idMap.has(copy.startBinding.elementId) ? { elementId: idMap.get(copy.startBinding.elementId)! } : null;
      copy.endBinding = copy.endBinding && idMap.has(copy.endBinding.elementId) ? { elementId: idMap.get(copy.endBinding.elementId)! } : null;
    }
    return copy;
  });
};

/** Height of a single text line, used for the editor caret. */
export const lineHeightPx = (fontSize: number) => fontSize * LINE_HEIGHT;

export { isShape };
