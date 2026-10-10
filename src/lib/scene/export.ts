import rough from "roughjs";
import { LINE_HEIGHT } from "./constants";
import { getRenderedText, ICON_VIEWBOX } from "./elements";
import { getCenter, getCommonBounds } from "./math";
import { renderToCanvas } from "./render";
import { getDrawables, getFreedrawOutline, outlineToSvgPath } from "./shapes";
import { getFontFamily } from "./text";
import type { BinaryFile, SceneElement } from "./types";
import { isLinear } from "./types";
import { themeColor, type Theme } from "./theme";

export const FILE_TYPE = "opencanvas";
export const FILE_EXTENSION = ".opencanvas";
/** Files saved before the rename are still accepted. */
const LEGACY_FILE_TYPES = ["excile"];

export interface SceneFile {
  type: typeof FILE_TYPE;
  version: 1;
  elements: SceneElement[];
  files: Record<string, BinaryFile>;
  appState: { viewBackgroundColor: string };
}

export const serializeScene = (elements: SceneElement[], files: Record<string, BinaryFile>, viewBackgroundColor: string) => {
  const used = new Set(elements.flatMap((e) => (e.type === "image" ? [e.fileId] : [])));
  const data: SceneFile = {
    type: FILE_TYPE,
    version: 1,
    elements,
    files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))),
    appState: { viewBackgroundColor },
  };
  return JSON.stringify(data, null, 2);
};

export const parseScene = (json: string): SceneFile => {
  const data = JSON.parse(json);
  if (!(data?.type === FILE_TYPE || LEGACY_FILE_TYPES.includes(data?.type)) || !Array.isArray(data.elements)) {
    throw new Error("Not a valid OpenCanvas file");
  }
  return data as SceneFile;
};

export const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export interface ExportOptions {
  background: boolean;
  backgroundColor: string;
  dark: boolean;
  scale: number;
  padding?: number;
}

export const exportToCanvas = (elements: SceneElement[], files: Record<string, BinaryFile>, opts: ExportOptions) =>
  renderToCanvas(elements, files, {
    scale: opts.scale,
    padding: opts.padding ?? 10,
    background: opts.background ? opts.backgroundColor : null,
    theme: opts.dark ? "dark" : "light",
  });

export const exportToPngBlob = (elements: SceneElement[], files: Record<string, BinaryFile>, opts: ExportOptions) =>
  new Promise<Blob>((resolve, reject) => {
    exportToCanvas(elements, files, opts).toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/png");
  });

const SVG_NS = "http://www.w3.org/2000/svg";

export const exportToSvg = (elements: SceneElement[], files: Record<string, BinaryFile>, opts: ExportOptions) => {
  const padding = opts.padding ?? 10;
  const theme: Theme = opts.dark ? "dark" : "light";
  const b = getCommonBounds(elements);
  const width = b.maxX - b.minX + padding * 2;
  const height = b.maxY - b.minY + padding * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width * opts.scale));
  svg.setAttribute("height", String(height * opts.scale));
  if (opts.background) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", themeColor(opts.backgroundColor, theme));
    svg.appendChild(rect);
  }
  const rs = rough.svg(svg);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const ox = -b.minX + padding;
  const oy = -b.minY + padding;

  for (const el of elements) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("opacity", String(el.opacity / 100));
    if (isLinear(el) || el.type === "freedraw") {
      g.setAttribute("transform", `translate(${el.x + ox} ${el.y + oy})`);
    } else {
      const [cx, cy] = getCenter(el);
      g.setAttribute(
        "transform",
        `translate(${cx + ox} ${cy + oy}) rotate(${(el.angle * 180) / Math.PI}) translate(${-el.width / 2} ${-el.height / 2})`,
      );
    }
    if (el.type === "freedraw") {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", outlineToSvgPath(getFreedrawOutline(el)));
      path.setAttribute("fill", themeColor(el.strokeColor, theme));
      g.appendChild(path);
    } else if (el.type === "text") {
      const container = el.containerId ? byId.get(el.containerId) : undefined;
      const lines = getRenderedText(el, container).split("\n");
      const lh = el.fontSize * LINE_HEIGHT;
      const anchor = el.textAlign === "center" ? "middle" : el.textAlign === "right" ? "end" : "start";
      const x = el.textAlign === "center" ? el.width / 2 : el.textAlign === "right" ? el.width : 0;
      lines.forEach((line, i) => {
        const t = document.createElementNS(SVG_NS, "text");
        t.setAttribute("x", String(x));
        t.setAttribute("y", String(i * lh + lh / 2));
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("text-anchor", anchor);
        t.setAttribute("font-family", getFontFamily(el.fontFamily));
        t.setAttribute("font-size", `${el.fontSize}px`);
        t.setAttribute("fill", themeColor(el.strokeColor, theme));
        t.setAttribute("style", "white-space: pre");
        t.textContent = line;
        g.appendChild(t);
      });
    } else if (el.type === "image") {
      const file = files[el.fileId];
      if (file) {
        const img = document.createElementNS(SVG_NS, "image");
        img.setAttribute("href", file.dataURL);
        img.setAttribute("width", String(el.width));
        img.setAttribute("height", String(el.height));
        g.appendChild(img);
      }
    } else if (el.type === "icon") {
      const sx = el.width / ICON_VIEWBOX;
      const sy = el.height / ICON_VIEWBOX;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", el.path);
      path.setAttribute("transform", `scale(${sx} ${sy})`);
      path.setAttribute("fill", el.backgroundColor === "transparent" ? "none" : themeColor(el.backgroundColor, theme));
      path.setAttribute("stroke", themeColor(el.strokeColor, theme));
      // Stroke width is in icon units here, so it scales along with the icon.
      path.setAttribute("stroke-width", String((el.strokeWidth * Math.min(sx, sy)) / Math.max(sx, sy)));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (el.strokeStyle !== "solid") path.setAttribute("stroke-dasharray", el.strokeStyle === "dashed" ? "4 3" : "0.75 3");
      g.appendChild(path);
    } else {
      for (const d of getDrawables(el, theme)) g.appendChild(rs.draw(d));
    }
    svg.appendChild(g);
  }
  return svg;
};

export const copyPngToClipboard = async (elements: SceneElement[], files: Record<string, BinaryFile>, opts: ExportOptions) => {
  const blob = await exportToPngBlob(elements, files, opts);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
};
