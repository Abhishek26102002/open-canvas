import { LINE_HEIGHT } from "./constants";
import type { FontFamily } from "./types";

const FALLBACKS: Record<FontFamily, string> = {
  hand: "'Shantell Sans', 'Comic Sans MS', cursive",
  normal: "Nunito, system-ui, sans-serif",
  code: "ui-monospace, Menlo, monospace",
};

const VARS: Record<FontFamily, string> = {
  hand: "--font-hand",
  normal: "--font-normal",
  code: "--font-code",
};

const cache: Partial<Record<FontFamily, string>> = {};

/** Resolves the CSS font-family that next/font generated for each font slot. */
export const getFontFamily = (family: FontFamily) => {
  if (cache[family]) return cache[family]!;
  if (typeof document === "undefined") return FALLBACKS[family];
  const value = getComputedStyle(document.body).getPropertyValue(VARS[family]).trim();
  cache[family] = value || FALLBACKS[family];
  return cache[family]!;
};

export const getFontString = (family: FontFamily, size: number) => `${size}px ${getFontFamily(family)}`;

let measureCtx: CanvasRenderingContext2D | null = null;
const getMeasureCtx = () => {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx!;
};

export const measureLine = (line: string, font: string) => {
  const ctx = getMeasureCtx();
  ctx.font = font;
  return ctx.measureText(line).width;
};

export const measureText = (text: string, family: FontFamily, size: number) => {
  const font = getFontString(family, size);
  const lines = text.split("\n");
  const width = Math.max(...lines.map((l) => measureLine(l, font)), 1);
  return { width: Math.ceil(width), height: lines.length * size * LINE_HEIGHT };
};

/** Word-wraps text to fit maxWidth. Long words are broken by character. */
export const wrapText = (text: string, family: FontFamily, size: number, maxWidth: number) => {
  const font = getFontString(family, size);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureLine(candidate, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      if (measureLine(word, font) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        if (measureLine(chunk + ch, font) > maxWidth && chunk) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out.join("\n");
};

export const resetFontCache = () => {
  for (const key of Object.keys(cache) as FontFamily[]) delete cache[key];
};
