export type Theme = "light" | "dark";

export const SELECTION_COLOR: Record<Theme, string> = { light: "#0d9488", dark: "#2dd4bf" };
export const HANDLE_FILL: Record<Theme, string> = { light: "#ffffff", dark: "#18181b" };
export const GRID_COLORS: Record<Theme, { minor: string; major: string }> = {
  light: { minor: "rgba(15, 23, 42, 0.05)", major: "rgba(15, 23, 42, 0.1)" },
  dark: { minor: "rgba(255, 255, 255, 0.04)", major: "rgba(255, 255, 255, 0.09)" },
};

const parseHex = (hex: string): [number, number, number] | null => {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};

const rgbToHsl = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
};

const hslToHex = (h: number, s: number, l: number) => {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const cache = new Map<string, string>();

/**
 * Colors are stored as authored for a light canvas. In dark mode we flip their
 * lightness (keeping hue and saturation) so ink stays readable and fills turn
 * into dark tints. Images are never touched.
 */
export const themeColor = (color: string, theme: Theme) => {
  if (theme === "light" || color === "transparent") return color;
  let out = cache.get(color);
  if (out) return out;
  const rgb = parseHex(color);
  if (!rgb) return color;
  const [h, s, l] = rgbToHsl(rgb);
  const nl = Math.min(0.92, Math.max(0.07, 1 - l));
  // Very dark results (inverted pastels) read better slightly desaturated.
  out = hslToHex(h, s * (nl < 0.3 ? 0.55 : 0.9), nl);
  cache.set(color, out);
  return out;
};
