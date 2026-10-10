"use client";

import { ArrowUpRight, FolderOpen, Keyboard, RectangleHorizontal, Type, type LucideIcon } from "lucide-react";
import { openFromFile, useUI } from "@/lib/actions";
import type { ToolType } from "@/lib/scene/types";
import { useEditor } from "@/lib/store";
import { selectTool } from "./toolbar";
import { Logo } from "./top-bar";

const STARTERS: { tool: ToolType; icon: LucideIcon; label: string; key: string }[] = [
  { tool: "rectangle", icon: RectangleHorizontal, label: "Draw a shape", key: "R" },
  { tool: "arrow", icon: ArrowUpRight, label: "Connect with arrows", key: "A" },
  { tool: "text", icon: Type, label: "Write some text", key: "T" },
];

/** Empty-state card shown until the first element is drawn. */
export function Welcome() {
  const empty = useEditor((s) => s.elements.length === 0);
  const tool = useEditor((s) => s.tool);
  if (!empty || tool !== "selection") return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-dashed bg-background/70 p-6 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Logo className="size-10" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Start a new canvas</h1>
            <p className="text-sm text-muted-foreground">Everything stays in this browser until you export it.</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {STARTERS.map(({ tool: t, icon: Icon, label, key }) => (
            <button
              key={t}
              type="button"
              onClick={() => selectTool(t)}
              className="group flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-brand-soft hover:text-brand-soft-foreground"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-muted group-hover:bg-background">
                <Icon className="size-4" />
              </span>
              {label}
              <kbd className="ml-auto rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{key}</kbd>
            </button>
          ))}
        </div>
        <div className="flex gap-2 border-t pt-4">
          <button type="button" onClick={() => void openFromFile()} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs transition-colors hover:bg-muted">
            <FolderOpen className="size-3.5" /> Open file
          </button>
          <button type="button" onClick={() => useUI.getState().set({ helpOpen: true })} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs transition-colors hover:bg-muted">
            <Keyboard className="size-3.5" /> Shortcuts
          </button>
        </div>
      </div>
    </div>
  );
}
