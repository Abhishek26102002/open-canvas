"use client";

import { toast } from "sonner";
import { create } from "zustand";
import { duplicateElements, newIcon, newId, newImage, newText } from "./scene/elements";
import { downloadBlob, exportToPngBlob, FILE_EXTENSION, parseScene, serializeScene } from "./scene/export";
import { getCommonBounds } from "./scene/math";
import { saveFiles } from "./scene/storage";
import type { BinaryFile, Point, SceneElement } from "./scene/types";
import { fixLabelOrder, useEditor } from "./store";

interface UIState {
  helpOpen: boolean;
  exportOpen: boolean;
  resetOpen: boolean;
  iconsOpen: boolean;
  shareOpen: boolean;
  set: (s: Partial<Omit<UIState, "set">>) => void;
}

export const useUI = create<UIState>()((set) => ({
  helpOpen: false,
  exportOpen: false,
  resetOpen: false,
  iconsOpen: false,
  shareOpen: false,
  set: (s) => set(s),
}));

export const CLIPBOARD_TYPE = "opencanvas/clipboard";

/** Last known pointer position in scene coordinates (paste goes there). */
let pointerScene: Point | null = null;
const pointerListeners = new Set<(p: Point) => void>();
export const setPointerScene = (p: Point) => {
  pointerScene = p;
  for (const l of pointerListeners) l(p);
};
export const onPointerScene = (listener: (p: Point) => void) => {
  pointerListeners.add(listener);
  return () => void pointerListeners.delete(listener);
};
export const getPointerScene = () => pointerScene;

/** Scene coordinates of the viewport center. */
export const viewportCenter = (): Point => {
  const { viewport: v, viewportSize } = useEditor.getState();
  return [viewportSize.width / 2 / v.zoom - v.scrollX, viewportSize.height / 2 / v.zoom - v.scrollY];
};

const readAsDataURL = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const loadImageSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });

export const insertImages = async (blobs: Blob[], at?: Point) => {
  const images = blobs.filter((b) => b.type.startsWith("image/"));
  if (!images.length) return;
  const { style, viewport } = useEditor.getState();
  const [cx, cy] = at ?? viewportCenter();
  const created: SceneElement[] = [];
  const files: BinaryFile[] = [];
  let offset = 0;
  for (const blob of images) {
    try {
      const dataURL = await readAsDataURL(blob);
      const size = await loadImageSize(dataURL);
      const max = 480 / Math.max(viewport.zoom, 0.5);
      const scale = Math.min(1, max / Math.max(size.width, size.height));
      const w = size.width * scale;
      const h = size.height * scale;
      const id = newId();
      files.push({ id, dataURL, mimeType: blob.type });
      created.push(newImage(style, cx - w / 2 + offset, cy - h / 2 + offset, w, h, id));
      offset += 20;
    } catch {
      toast.error("Couldn't load that image");
    }
  }
  if (!created.length) return;
  const s = useEditor.getState();
  s.addFiles(files);
  saveFiles(files);
  s.setElements([...s.elements, ...created]);
  s.select(created.map((e) => e.id));
  s.setTool("selection");
  useEditor.getState().select(created.map((e) => e.id));
  s.commit();
};

/** Drops a Lucide icon in the middle of the view, using the current stroke settings. */
export const insertIcon = (iconName: string, path: string, at?: Point) => {
  const s = useEditor.getState();
  const size = Math.round(64 / Math.min(Math.max(s.viewport.zoom, 0.25), 2));
  const [cx, cy] = at ?? viewportCenter();
  const el = newIcon(s.style, cx - size / 2, cy - size / 2, size, iconName, path);
  s.setElements([...s.elements, el]);
  s.setTool("selection");
  s.select([el.id]);
  s.commit();
};

export const pickFile = (accept: string, multiple = false) =>
  new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });

export const openImagePicker = async () => {
  const files = await pickFile("image/*", true);
  if (files.length) await insertImages(files);
  else useEditor.getState().setTool("selection");
};

/** A filesystem-safe name derived from the drawing's title. */
export const fileBaseName = () => {
  const name = useEditor.getState().name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase();
  return name || "canvas";
};

export const saveToFile = () => {
  const s = useEditor.getState();
  const json = serializeScene(s.elements, s.files, s.viewBackgroundColor);
  downloadBlob(new Blob([json], { type: "application/json" }), `${fileBaseName()}${FILE_EXTENSION}`);
  toast.success("Saved to file");
};

export const loadFromBlob = async (file: Blob) => {
  try {
    const data = parseScene(await file.text());
    useEditor.getState().loadScene(data.elements, data.files ?? {}, data.appState?.viewBackgroundColor);
    if (file instanceof File) useEditor.getState().setName(file.name.replace(/\.[^.]+$/, ""));
    saveFiles(Object.values(data.files ?? {}));
    toast.success("Drawing loaded");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Couldn't open file");
  }
};

export const openFromFile = async () => {
  const [file] = await pickFile(`${FILE_EXTENSION},.json,application/json`);
  if (file) await loadFromBlob(file);
};

const selectionWithLabels = () => {
  const s = useEditor.getState();
  return s.elements.filter(
    (e) => s.selectedIds.has(e.id) || (e.type === "text" && e.containerId && s.selectedIds.has(e.containerId)),
  );
};

export const copySelection = (data: DataTransfer | null) => {
  const els = selectionWithLabels();
  if (!els.length) return false;
  const files = useEditor.getState().files;
  const used = Object.fromEntries(
    els.flatMap((e) => (e.type === "image" && files[e.fileId] ? [[e.fileId, files[e.fileId]]] : [])),
  );
  const payload = JSON.stringify({ type: CLIPBOARD_TYPE, elements: els, files: used });
  if (data) data.setData("text/plain", payload);
  else navigator.clipboard?.writeText(payload);
  return true;
};

export const pasteData = async (data: DataTransfer | null, at: Point) => {
  if (!data) return;
  const images = Array.from(data.files).filter((f) => f.type.startsWith("image/"));
  if (images.length) {
    await insertImages(images, at);
    return;
  }
  const text = data.getData("text/plain");
  if (!text) return;
  const s = useEditor.getState();
  try {
    const parsed = JSON.parse(text);
    if (parsed?.type === CLIPBOARD_TYPE && Array.isArray(parsed.elements)) {
      const els = parsed.elements as SceneElement[];
      const b = getCommonBounds(els);
      const dx = at[0] - (b.minX + b.maxX) / 2;
      const dy = at[1] - (b.minY + b.maxY) / 2;
      const copies = duplicateElements(els, 0).map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
      if (parsed.files) {
        const files = Object.values(parsed.files) as BinaryFile[];
        s.addFiles(files);
        saveFiles(files);
      }
      s.setElements(fixLabelOrder([...s.elements, ...copies]));
      s.select(copies.filter((c) => !(c.type === "text" && c.containerId)).map((c) => c.id));
      s.setTool("selection");
      useEditor.getState().select(copies.filter((c) => !(c.type === "text" && c.containerId)).map((c) => c.id));
      s.commit();
      return;
    }
  } catch {
    // Not our JSON; fall through to plain text.
  }
  const el = newText(s.style, at[0], at[1], text.replace(/\r\n/g, "\n"));
  const placed = { ...el, x: at[0] - el.width / 2, y: at[1] - el.height / 2 };
  s.setElements([...s.elements, placed]);
  s.select([placed.id]);
  s.commit();
};

export const copyAsPng = async () => {
  const s = useEditor.getState();
  const sel = s.elements.filter((e) => s.selectedIds.has(e.id) || (e.type === "text" && e.containerId && s.selectedIds.has(e.containerId)));
  const els = sel.length ? sel : s.elements;
  if (!els.length) return;
  try {
    const blob = await exportToPngBlob(els, s.files, { background: true, backgroundColor: s.viewBackgroundColor, dark: false, scale: 2 });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success("Copied to clipboard as PNG");
  } catch {
    toast.error("Clipboard access was denied");
  }
};
