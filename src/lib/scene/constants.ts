import type { ItemStyle } from "./types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;
export const GRID_SIZE = 20;
export const LINE_HEIGHT = 1.25;
export const BOUND_TEXT_PADDING = 6;
export const BINDING_GAP = 6;
export const HANDLE_SIZE = 9;
export const ROTATION_HANDLE_OFFSET = 22;

export const STROKE_COLORS = ["#1f2937", "#dc2626", "#16a34a", "#2563eb", "#d97706", "#9333ea"];
export const BACKGROUND_COLORS = ["transparent", "#fecaca", "#bbf7d0", "#bfdbfe", "#fde68a", "#e9d5ff"];
export const CANVAS_BACKGROUNDS = ["#ffffff", "#f8fafc", "#f0fdfa", "#fefce8", "#fdf2f8", "#f5f5f4"];

export const PALETTE = [
  "#111827", "#374151", "#6b7280", "#d1d5db", "#ffffff", "#78350f",
  "#dc2626", "#ea580c", "#d97706", "#65a30d", "#16a34a", "#0d9488",
  "#0891b2", "#2563eb", "#4f46e5", "#9333ea", "#c026d3", "#db2777",
  "#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#99f6e4", "#bfdbfe",
  "#c7d2fe", "#e9d5ff", "#fbcfe8", "#f5f5f4", "#e7e5e4", "#a8a29e",
];

export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 36 } as const;

export const DEFAULT_STYLE: ItemStyle = {
  strokeColor: "#1f2937",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: "round",
  startArrowhead: null,
  endArrowhead: "arrow",
  arrowType: "round",
  fontSize: 20,
  fontFamily: "hand",
  textAlign: "left",
};
