"use client";

import { CircleHelp, Cloud, Minus, Plus, Redo2, Undo2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TOOL_HINTS } from "./toolbar";
import { useUI } from "@/lib/actions";
import { useCollab } from "@/lib/collab/session";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Panel } from "./panel";

function BarButton({ label, onClick, disabled, children, className }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg text-foreground/75 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent",
          className,
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function ZoomMenu() {
  const zoom = useEditor((s) => s.viewport.zoom);
  const zoomAt = useEditor((s) => s.zoomAt);
  const zoomToFit = useEditor((s) => s.zoomToFit);
  const hasSelection = useEditor((s) => s.selectedIds.size > 0);
  return (
    <div className="flex items-center">
      <BarButton label="Zoom out" onClick={() => zoomAt(zoom / 1.2)}>
        <Minus className="size-4" />
      </BarButton>
      <DropdownMenu>
        <DropdownMenuTrigger className="h-8 w-14 rounded-lg text-xs font-medium tabular-nums transition-colors hover:bg-muted" aria-label="Zoom options">
          {Math.round(zoom * 100)}%
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" className="w-48">
          <DropdownMenuItem onClick={() => zoomToFit()}>
            Fit everything <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasSelection} onClick={() => zoomToFit(true)}>
            Fit selection <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {[0.5, 1, 2].map((z) => (
            <DropdownMenuItem key={z} onClick={() => zoomAt(z)}>
              {z * 100}%{z === 1 && <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <BarButton label="Zoom in" onClick={() => zoomAt(zoom * 1.2)}>
        <Plus className="size-4" />
      </BarButton>
    </div>
  );
}

export function BottomBar() {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0 || s.elements !== s.committed.elements);
  const canRedo = useEditor((s) => s.future.length > 0);
  const count = useEditor((s) => s.elements.filter((e) => !(e.type === "text" && e.containerId)).length);
  const tool = useEditor((s) => s.tool);
  const ui = useUI((s) => s.set);
  const shared = useCollab((s) => s.workspaceId !== null);

  return (
    <>
      <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden">
        <Cloud className="size-3.5" />
        {shared ? "Shared workspace" : "Saved in this browser"} · {count} {count === 1 ? "element" : "elements"}
      </div>

      {TOOL_HINTS[tool] && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center max-md:hidden">
          <div className="rounded-full bg-foreground/85 px-3 py-1 text-xs text-background">{TOOL_HINTS[tool]}</div>
        </div>
      )}

      <Panel className="pointer-events-auto absolute right-3 bottom-3 flex items-center gap-0.5 p-1">
        <BarButton label="Undo (⌘Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 className="size-4" />
        </BarButton>
        <BarButton label="Redo (⇧⌘Z)" onClick={redo} disabled={!canRedo}>
          <Redo2 className="size-4" />
        </BarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ZoomMenu />
        <div className="mx-1 h-5 w-px bg-border" />
        <BarButton label="Shortcuts (?)" onClick={() => ui({ helpOpen: true })}>
          <CircleHelp className="size-4" />
        </BarButton>
      </Panel>
    </>
  );
}
