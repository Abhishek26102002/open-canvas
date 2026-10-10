"use client";

import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  ImageIcon,
  Lock,
  LockOpen,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  Shapes,
  Slash,
  Type,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openImagePicker, useUI } from "@/lib/actions";
import type { ToolType } from "@/lib/scene/types";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Panel } from "./panel";

interface ToolDef {
  type: ToolType;
  icon: LucideIcon;
  label: string;
  keys: string[];
}

/** Tools grouped by purpose: navigate, shapes, connectors, content, utilities. */
export const TOOL_GROUPS: ToolDef[][] = [
  [
    { type: "selection", icon: MousePointer2, label: "Select", keys: ["V", "1"] },
    { type: "hand", icon: Hand, label: "Pan", keys: ["H"] },
  ],
  [
    { type: "rectangle", icon: RectangleHorizontal, label: "Rectangle", keys: ["R", "2"] },
    { type: "diamond", icon: Diamond, label: "Diamond", keys: ["D", "3"] },
    { type: "ellipse", icon: Circle, label: "Ellipse", keys: ["O", "4"] },
  ],
  [
    { type: "arrow", icon: ArrowUpRight, label: "Arrow", keys: ["A", "5"] },
    { type: "line", icon: Slash, label: "Line", keys: ["L", "6"] },
  ],
  [
    { type: "freedraw", icon: PenLine, label: "Pen", keys: ["P", "7"] },
    { type: "text", icon: Type, label: "Text", keys: ["T", "8"] },
    { type: "image", icon: ImageIcon, label: "Image", keys: ["9"] },
    { type: "icon", icon: Shapes, label: "Icon library", keys: ["I"] },
  ],
  [
    { type: "eraser", icon: Eraser, label: "Eraser", keys: ["E", "0"] },
    { type: "laser", icon: WandSparkles, label: "Laser pointer", keys: ["K"] },
  ],
];

export const TOOL_HINTS: Partial<Record<ToolType, string>> = {
  hand: "Drag to move around · Space+drag works with any tool",
  rectangle: "Drag to draw · Shift for a square · Alt to draw from the center",
  diamond: "Drag to draw · Shift keeps proportions",
  ellipse: "Drag to draw · Shift for a circle",
  arrow: "Drag, or click to place points · Drop on a shape to connect",
  line: "Drag, or click to place points · Enter to finish",
  freedraw: "Drag to sketch freely",
  text: "Click to type · Click a shape to label it",
  eraser: "Drag across elements to erase them",
  laser: "Drag to point things out · The trail fades",
};

export const selectTool = (tool: ToolType) => {
  const s = useEditor.getState();
  s.setEditingTextId(null);
  // The icon library is a picker, not a drawing mode.
  if (tool === "icon") {
    useUI.getState().set({ iconsOpen: true });
    return;
  }
  s.setTool(tool);
  if (tool === "image") void openImagePicker();
};

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-background/20 px-1 font-mono text-[10px] leading-4 opacity-80">{children}</kbd>;
}

function DockButton({
  active,
  label,
  keys,
  onClick,
  children,
  badge = true,
}: {
  active?: boolean;
  label: string;
  keys: string[];
  onClick: () => void;
  children: React.ReactNode;
  badge?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/75 transition-colors hover:bg-foreground/8 hover:text-foreground",
          active && "bg-brand text-brand-foreground shadow-sm hover:bg-brand hover:text-brand-foreground",
        )}
      >
        {children}
        {badge && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-[2px] bottom-px font-mono text-[7px] leading-none font-medium tracking-tight text-muted-foreground max-sm:hidden",
              active && "text-brand-foreground/80",
            )}
          >
            {keys.join("/")}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-sm:hidden">
        {label}
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** Tool dock: a vertical rail on the left on desktop, a bottom bar on phones. */
export function ToolDock() {
  const tool = useEditor((s) => s.tool);
  const locked = useEditor((s) => s.toolLocked);
  const setLocked = useEditor((s) => s.setToolLocked);

  return (
    <Panel
      className={cn(
        "pointer-events-auto absolute flex gap-0.5 bg-surface/55 p-1 shadow-none ring-1 ring-foreground/8",
        "max-sm:inset-x-3 max-sm:bottom-16 max-sm:justify-between max-sm:overflow-x-auto",
        "sm:top-1/2 sm:left-3 sm:-translate-y-1/2 sm:flex-col",
      )}
    >
      {TOOL_GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <div className="mx-0.5 shrink-0 bg-foreground/10 max-sm:w-px sm:my-0.5 sm:h-px" />}
          {group.map((t) => {
            const Icon = t.icon;
            return (
              <DockButton key={t.type} label={t.label} keys={t.keys} active={tool === t.type} onClick={() => selectTool(t.type)}>
                <Icon className="size-4 sm:-translate-y-[2px]" strokeWidth={1.75} />
              </DockButton>
            );
          })}
        </Fragment>
      ))}
      <div className="mx-0.5 shrink-0 bg-foreground/10 max-sm:w-px sm:my-0.5 sm:h-px" />
      <DockButton label={locked ? "Tool stays active" : "Keep tool active"} keys={["Q"]} active={false} onClick={() => setLocked(!locked)}>
        {locked ? <Lock className="size-3.5 text-brand sm:-translate-y-[2px]" /> : <LockOpen className="size-3.5 sm:-translate-y-[2px]" />}
      </DockButton>
    </Panel>
  );
}
