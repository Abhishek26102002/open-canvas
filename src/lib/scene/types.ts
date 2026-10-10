export type Point = [number, number];

export type ToolType =
  | "hand"
  | "selection"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "icon"
  | "eraser"
  | "laser";

export type ElementType =
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "icon";

export type FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Roundness = "sharp" | "round";
export type Arrowhead = "arrow" | "triangle" | "bar" | "dot" | null;
export type ArrowType = "sharp" | "round";
export type FontFamily = "hand" | "normal" | "code";
export type TextAlign = "left" | "center" | "right";

export interface Binding {
  elementId: string;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: Roundness;
  seed: number;
  version: number;
  groupIds: string[];
  locked: boolean;
}

export interface ShapeElement extends BaseElement {
  type: "rectangle" | "diamond" | "ellipse";
}

export interface LinearElement extends BaseElement {
  type: "arrow" | "line";
  /** Points relative to (x, y). points[0] is always [0, 0]. */
  points: Point[];
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  startBinding: Binding | null;
  endBinding: Binding | null;
  arrowType: ArrowType;
}

export interface FreedrawElement extends BaseElement {
  type: "freedraw";
  points: Point[];
  pressures: number[];
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  /** Shape or arrow this text is a label of. */
  containerId: string | null;
}

export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string;
}

export interface IconElement extends BaseElement {
  type: "icon";
  /** Lucide icon name, e.g. "ArrowUpRight". */
  iconName: string;
  /** SVG path data in the icon's 24x24 coordinate space. */
  path: string;
}

export type SceneElement =
  | ShapeElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement
  | IconElement;

export interface BinaryFile {
  id: string;
  dataURL: string;
  mimeType: string;
}

export interface ItemStyle {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: Roundness;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  arrowType: ArrowType;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export const isLinear = (el: SceneElement): el is LinearElement =>
  el.type === "arrow" || el.type === "line";

export const isShape = (el: SceneElement): el is ShapeElement =>
  el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse";

export const isText = (el: SceneElement): el is TextElement => el.type === "text";

/** Elements that can hold a bound text label. */
export const isTextContainer = (el: SceneElement) => isShape(el) || isLinear(el);

/** Elements arrows can attach to. */
export const isBindable = (el: SceneElement) =>
  isShape(el) || el.type === "image" || el.type === "icon" || (el.type === "text" && !el.containerId);
