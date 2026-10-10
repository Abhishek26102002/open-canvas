/** Lucide's icon data: a list of SVG child elements drawn in a 24x24 box. */
export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

const num = (v: string | number | undefined) => Number(v ?? 0) || 0;

const pointsToPath = (points: string | number | undefined, close: boolean) => {
  const nums = String(points ?? "").trim().split(/[\s,]+/).map(Number);
  let d = "";
  for (let i = 0; i + 1 < nums.length; i += 2) d += `${i ? "L" : "M"}${nums[i]} ${nums[i + 1]}`;
  return close && d ? `${d}Z` : d;
};

const ellipsePath = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

const rectPath = (x: number, y: number, w: number, h: number, rx: number, ry: number) => {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return (
    `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}` +
    `a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}` +
    `v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
  );
};

/** Flattens an icon's circles, rects, lines etc. into a single SVG path string. */
export const iconNodeToPath = (node: IconNode) =>
  node
    .map(([tag, a]) => {
      switch (tag) {
        case "path":
          return String(a.d ?? "");
        case "circle":
          return ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r));
        case "ellipse":
          return ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
        case "rect": {
          const rx = a.rx ?? a.ry;
          const ry = a.ry ?? a.rx;
          return rectPath(num(a.x), num(a.y), num(a.width), num(a.height), num(rx), num(ry));
        }
        case "line":
          return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
        case "polyline":
          return pointsToPath(a.points, false);
        case "polygon":
          return pointsToPath(a.points, true);
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" ");

/** "ArrowUpRight" -> "arrow up right", for display and search. */
export const iconLabel = (name: string) =>
  name
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .toLowerCase();

const pathCache = new Map<string, Path2D>();

export const getIconPath2D = (d: string) => {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
};
