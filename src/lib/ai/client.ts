"use client";

import { create } from "zustand";
import { viewportCenter } from "../actions";
import { useEditor, fixLabelOrder } from "../store";
import { buildDiagram } from "./build";
import { getProvider, type DiagramSpec, type ProviderId } from "./config";

const STORAGE_KEY = "opencanvas:ai";

interface AiSettings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
}

interface AiSettingsState extends AiSettings {
  update: (changes: Partial<AiSettings>) => void;
  setKey: (provider: ProviderId, key: string) => void;
  setModel: (provider: ProviderId, model: string) => void;
}

const load = (): AiSettings => {
  const fallback: AiSettings = { provider: "free", keys: {}, models: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};

const persist = ({ provider, keys, models }: AiSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, keys, models }));
  } catch {
    // Private mode or storage disabled: settings last for this visit only.
  }
};

/** Provider choice and the user's own API keys. Keys live only in this browser. */
export const useAiSettings = create<AiSettingsState>()((set, get) => ({
  provider: "free",
  keys: {},
  models: {},
  update: (changes) => {
    set(changes);
    persist(get());
  },
  setKey: (provider, key) => get().update({ keys: { ...get().keys, [provider]: key } }),
  setModel: (provider, model) => get().update({ models: { ...get().models, [provider]: model } }),
}));

let hydrated = false;
export const hydrateAiSettings = () => {
  if (hydrated) return;
  hydrated = true;
  useAiSettings.setState(load());
};

/** Downscales an image to a JPEG data URL small enough to send to a model. */
export const prepareImage = (src: string, maxEdge = 1600) =>
  new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d")!;
      // Transparent areas would turn black in a JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = src;
  });

export async function requestDiagram(prompt: string, image: string | undefined, signal: AbortSignal) {
  const { provider, keys, models } = useAiSettings.getState();
  const info = getProvider(provider);
  const res = await fetch("/api/ai/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      prompt,
      image,
      apiKey: info.needsKey ? keys[provider] : undefined,
      model: models[provider] || info.defaultModel,
    }),
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as { diagram: DiagramSpec; model: string };
}

/** Drops a generated diagram into the middle of the view and selects it. */
export function insertDiagram(spec: DiagramSpec) {
  const s = useEditor.getState();
  const created = buildDiagram(spec, s.style, viewportCenter());
  s.setElements(fixLabelOrder([...s.elements, ...created]));
  s.setTool("selection");
  const ids = new Set(created.map((e) => e.id));
  useEditor.getState().select(useEditor.getState().elements.filter((e) => ids.has(e.id) && !(e.type === "text" && e.containerId)).map((e) => e.id));
  s.commit();

  // Zoom out only if the diagram doesn't fit the current view.
  const { viewport: v, viewportSize, elements } = useEditor.getState();
  const mine = elements.filter((e) => ids.has(e.id));
  const minX = Math.min(...mine.map((e) => e.x));
  const minY = Math.min(...mine.map((e) => e.y));
  const maxX = Math.max(...mine.map((e) => e.x + e.width));
  const maxY = Math.max(...mine.map((e) => e.y + e.height));
  if ((maxX - minX) * v.zoom > viewportSize.width - 160 || (maxY - minY) * v.zoom > viewportSize.height - 200) {
    useEditor.getState().zoomToFit(true);
  }
  return created.length;
}
