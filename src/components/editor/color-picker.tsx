"use client";

import { Pipette } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PALETTE } from "@/lib/scene/constants";
import { themeColor } from "@/lib/scene/theme";
import { cn } from "@/lib/utils";

const CHECKER = "repeating-conic-gradient(#d4d4d8 0% 25%, #fafafa 0% 50%) 50% / 8px 8px";

/** A round color chip. Shows the color the way the canvas renders it in the current theme. */
export function Swatch({ color, active, onClick, className }: { color: string; active?: boolean; onClick?: () => void; className?: string }) {
  const { resolvedTheme } = useTheme();
  const shown = themeColor(color, resolvedTheme === "dark" ? "dark" : "light");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={color === "transparent" ? "No fill" : color}
      aria-pressed={active}
      title={color === "transparent" ? "No fill" : color}
      className={cn(
        "relative size-6 shrink-0 rounded-full ring-1 ring-black/10 ring-inset transition-transform hover:scale-110 dark:ring-white/15",
        active && "outline-2 outline-offset-2 outline-brand",
        className,
      )}
      style={{ background: color === "transparent" ? CHECKER : shown }}
    >
      {color === "transparent" && <span className="absolute inset-0 m-auto h-px w-full rotate-45 bg-red-500/80" />}
    </button>
  );
}

/** Quick swatches plus a popover with the full palette and a hex input. */
export function ColorPicker({
  value,
  quick,
  onChange,
  allowTransparent,
}: {
  value: string;
  quick: string[];
  onChange: (c: string) => void;
  allowTransparent?: boolean;
}) {
  const [hex, setHex] = useState(value);
  const palette = allowTransparent ? ["transparent", ...PALETTE.slice(0, -1)] : PALETTE;
  const custom = !quick.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {quick.map((c) => (
        <Swatch key={c} color={c} active={value === c} onClick={() => onChange(c)} />
      ))}
      <Popover onOpenChange={(open) => open && setHex(value)}>
        <PopoverTrigger
          className={cn(
            "flex size-6 items-center justify-center rounded-full border border-dashed text-muted-foreground transition-colors hover:border-brand hover:text-brand",
            custom && "border-solid border-brand text-brand",
          )}
          aria-label="More colors"
        >
          <Pipette className="size-3" />
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-60">
          <div className="grid grid-cols-6 gap-2">
            {palette.map((c) => (
              <Swatch key={c} color={c} active={value === c} onClick={() => onChange(c)} className="size-7" />
            ))}
          </div>
          <div className="flex items-center gap-2 border-t pt-2.5">
            <span className="text-xs text-muted-foreground">#</span>
            <input
              value={hex.replace(/^#/, "")}
              onChange={(e) => {
                const v = `#${e.target.value.replace(/^#/, "").trim()}`;
                setHex(v);
                if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) onChange(v);
              }}
              maxLength={7}
              spellCheck={false}
              className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs uppercase outline-none focus:border-brand"
              aria-label="Hex color"
            />
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="size-7 cursor-pointer rounded-md border bg-transparent p-0.5"
              aria-label="System color picker"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
