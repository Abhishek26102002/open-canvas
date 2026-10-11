import { newLinear, newShape, newText } from "../scene/elements";
import { measureText } from "../scene/text";
import type { ItemStyle, LinearElement, SceneElement } from "../scene/types";
import type { DiagramNode, DiagramSpec, NodeColor } from "./config";

/** Stroke and fill per color name, taken from the editor palette. */
const COLORS: Record<NodeColor, [string, string]> = {
  gray: ["#374151", "#e7e5e4"],
  red: ["#dc2626", "#fecaca"],
  orange: ["#ea580c", "#fed7aa"],
  yellow: ["#d97706", "#fde68a"],
  green: ["#16a34a", "#bbf7d0"],
  teal: ["#0d9488", "#99f6e4"],
  blue: ["#2563eb", "#bfdbfe"],
  purple: ["#9333ea", "#e9d5ff"],
  pink: ["#db2777", "#fbcfe8"],
};

/** Scene units per unit of the model's 1000-wide image space. */
const IMAGE_SCALE = 1.2;
const NODE_GAP = 56;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Size that comfortably fits a node's label inside its shape. */
const fitSize = (node: DiagramNode, style: ItemStyle) => {
  const { width, height } = measureText(node.label || " ", style.fontFamily, style.fontSize);
  const w = Math.min(Math.max(width + 48, 128), 260);
  // Wrapped lines push the height up when the label is wider than the cap.
  const lines = Math.ceil((width + 48) / 260);
  const h = Math.max(height * lines + 32, 64);
  if (node.shape === "ellipse") return { w: w * 1.25, h: Math.max(h * 1.2, 72) };
  if (node.shape === "diamond") return { w: w * 1.5, h: Math.max(h * 1.6, 96) };
  if (node.shape === "text") return { w: width, h: height };
  return { w, h };
};

/**
 * Layered layout: ranks by longest path from the roots, ordered within each
 * rank by the average position of neighbors to reduce crossings.
 */
function autoLayout(spec: DiagramSpec, sizes: Map<string, { w: number; h: number }>) {
  const ids = spec.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const inn = new Map<string, string[]>(ids.map((id) => [id, []]));

  // Drop back edges so cycles don't break ranking.
  const state = new Map<string, 1 | 2>();
  const forward: [string, string][] = [];
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of spec.edges) adj.get(e.from)!.push(e.to);
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of adj.get(id)!) {
      if (state.get(to) === 1) continue;
      forward.push([id, to]);
      if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  for (const [a, b] of forward) {
    out.get(a)!.push(b);
    inn.get(b)!.push(a);
  }

  const rank = new Map<string, number>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    rank.set(id, 0);
    const r = Math.max(0, ...inn.get(id)!.map((p) => rankOf(p) + 1));
    rank.set(id, r);
    return r;
  };
  ids.forEach(rankOf);

  const layers: string[][] = [];
  for (const id of ids) (layers[rank.get(id)!] ??= []).push(id);

  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  index();
  const sweep = (down: boolean) => {
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of order) {
      const key = (id: string) => {
        const ns = down ? inn.get(id)! : out.get(id)!;
        return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!;
      };
      layer.sort((a, b) => key(a) - key(b));
      layer.forEach((id, i) => pos.set(id, i));
    }
  };
  for (let i = 0; i < 4; i++) sweep(i % 2 === 0);

  const lr = spec.direction === "LR";
  const rankGap = spec.edges.some((e) => e.label) ? 120 : 84;
  const boxes = new Map<string, Box>();
  let along = 0;
  for (const layer of layers) {
    if (!layer) continue;
    const thickness = Math.max(...layer.map((id) => (lr ? sizes.get(id)!.w : sizes.get(id)!.h)));
    const span = layer.reduce((s, id) => s + (lr ? sizes.get(id)!.h : sizes.get(id)!.w), 0) + NODE_GAP * (layer.length - 1);
    let across = -span / 2;
    for (const id of layer) {
      const { w, h } = sizes.get(id)!;
      boxes.set(id, lr
        ? { x: along + (thickness - w) / 2, y: across, w, h }
        : { x: across, y: along + (thickness - h) / 2, w, h });
      across += (lr ? h : w) + NODE_GAP;
    }
    along += thickness + rankGap;
  }
  return boxes;
}

/** Converts the model's diagram into canvas elements centered on `center`. */
export function buildDiagram(spec: DiagramSpec, baseStyle: ItemStyle, center: [number, number]): SceneElement[] {
  const style: ItemStyle = { ...baseStyle, fontSize: Math.min(baseStyle.fontSize, 20), opacity: 100 };
  const sizes = new Map(spec.nodes.map((n) => [n.id, fitSize(n, style)]));

  // Image mode: the model placed every node; keep its layout.
  const placed = spec.nodes.every((n) => n.x !== undefined && n.y !== undefined);
  const boxes = placed
    ? new Map(
        spec.nodes.map((n) => {
          const fit = sizes.get(n.id)!;
          const w = n.w ? Math.max(n.w * IMAGE_SCALE, n.shape === "text" ? fit.w : 60) : fit.w;
          const h = n.h ? Math.max(n.h * IMAGE_SCALE, n.shape === "text" ? fit.h : 40) : fit.h;
          return [n.id, { x: n.x! * IMAGE_SCALE, y: n.y! * IMAGE_SCALE, w, h }];
        }),
      )
    : autoLayout(spec, sizes);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const titleHeight = spec.title ? 64 : 0;
  const dx = center[0] - (minX + maxX) / 2;
  const dy = center[1] - (minY + maxY + titleHeight) / 2 + titleHeight;

  const elements: SceneElement[] = [];
  const created = new Map<string, SceneElement>();

  if (spec.title) {
    const title = newText({ ...style, fontSize: 28, textAlign: "center" }, 0, 0, spec.title);
    elements.push({ ...title, x: center[0] - title.width / 2, y: minY + dy - titleHeight });
  }

  for (const node of spec.nodes) {
    const b = boxes.get(node.id)!;
    const [stroke, fill] = node.color ? COLORS[node.color] : [style.strokeColor, "transparent"];
    const nodeStyle = { ...style, strokeColor: stroke, backgroundColor: fill };
    const x = b.x + dx;
    const y = b.y + dy;
    if (node.shape === "text") {
      const t = newText({ ...nodeStyle, textAlign: "center" }, 0, 0, node.label);
      const el = { ...t, x: x + (b.w - t.width) / 2, y: y + (b.h - t.height) / 2 };
      elements.push(el);
      created.set(node.id, el);
      continue;
    }
    const shape = { ...newShape(node.shape ?? "rectangle", nodeStyle, x, y), width: b.w, height: b.h };
    elements.push(shape);
    created.set(node.id, shape);
    // Label text stays dark on pastel fills; position is fixed up by normalizeScene.
    if (node.label) elements.push(newText({ ...nodeStyle, strokeColor: node.color ? "#1f2937" : stroke }, x, y, node.label, shape.id));
  }

  for (const edge of spec.edges) {
    const a = created.get(edge.from)!;
    const b = created.get(edge.to)!;
    const [ax, ay] = [a.x + a.width / 2, a.y + a.height / 2];
    const [bx, by] = [b.x + b.width / 2, b.y + b.height / 2];
    const arrow: LinearElement = {
      ...newLinear("arrow", { ...style, strokeStyle: edge.dashed ? "dashed" : "solid" }, ax, ay),
      points: [[0, 0], [bx - ax, by - ay]],
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
      startArrowhead: edge.arrow === "both" ? "arrow" : null,
      endArrowhead: edge.arrow === "none" ? null : "arrow",
      startBinding: { elementId: a.id },
      endBinding: { elementId: b.id },
    };
    elements.push(arrow);
    if (edge.label) elements.push(newText({ ...style, fontSize: Math.max(style.fontSize - 4, 14) }, ax, ay, edge.label, arrow.id));
  }

  return elements;
}
