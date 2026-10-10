"use client";

import { ChevronDown, CircleHelp, Download, FolderOpen, Grid3x3, ImageDown, Monitor, Moon, Save, Share2, Shapes, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openFromFile, saveToFile, useUI } from "@/lib/actions";
import { CANVAS_BACKGROUNDS } from "@/lib/scene/constants";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Swatch } from "./color-picker";
import { Panel } from "./panel";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="2" y="2" width="28" height="28" rx="8" className="fill-brand" />
      <path d="M9 21c2.5-7 5.5-10 8-10 3 0 2 6 6 6" fill="none" strokeWidth="2.6" strokeLinecap="round" className="stroke-brand-foreground" />
      <circle cx="23" cy="11" r="2.2" className="fill-brand-foreground" />
    </svg>
  );
}

const subscribeNoop = () => () => {};
/** True once running in the browser; theme is unknown during server render. */
const useMounted = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const options = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ] as const;
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-muted p-0.5">
      {options.map(({ value, icon: Icon, label }) => {
        const active = mounted && theme === value;
        return (
          <Tooltip key={value}>
            <TooltipTrigger
              role="radio"
              aria-checked={active}
              aria-label={`${label} theme`}
              onClick={() => setTheme(value)}
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
                active && "bg-background text-foreground shadow-sm",
              )}
            >
              <Icon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function TopBar({ workspaceId, presence }: { workspaceId?: string; presence?: React.ReactNode }) {
  const ui = useUI((s) => s.set);
  const { resolvedTheme, setTheme } = useTheme();
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const grid = useEditor((s) => s.grid);
  const setGrid = useEditor((s) => s.setGrid);
  const bg = useEditor((s) => s.viewBackgroundColor);
  const setBg = useEditor((s) => s.setViewBackgroundColor);

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
      <Panel className="pointer-events-auto flex h-11 min-w-0 items-center gap-1 pr-2 pl-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-muted" aria-label="App menu">
            <Logo className="size-6" />
            <span className="text-sm font-semibold tracking-tight max-sm:hidden">OpenCanvas</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>File</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void openFromFile()}>
                <FolderOpen /> Open…
                <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveToFile}>
                <Save /> Save as file
                <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => ui({ exportOpen: true })}>
                <ImageDown /> Export image…
                <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Insert</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => ui({ iconsOpen: true })}>
                <Shapes /> Icon…
                <DropdownMenuShortcut>I</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => ui({ shareOpen: true })}>
                <Share2 /> {workspaceId ? "Share link" : "Start live session"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setGrid(!grid)}>
                <Grid3x3 /> {grid ? "Hide grid" : "Show grid"}
                <DropdownMenuShortcut>⌘&apos;</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem className="md:hidden" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                {resolvedTheme === "dark" ? <Sun /> : <Moon />} {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => ui({ helpOpen: true })}>
                <CircleHelp /> Keyboard shortcuts
                <DropdownMenuShortcut>?</DropdownMenuShortcut>
              </DropdownMenuItem>
              <div className="flex flex-wrap gap-2 px-1.5 pt-1 pb-2">
                {CANVAS_BACKGROUNDS.map((c) => (
                  <Swatch key={c} color={c} active={bg === c} onClick={() => setBg(c)} className="size-5" />
                ))}
              </div>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => ui({ resetOpen: true })} variant="destructive">
              <Trash2 /> Clear canvas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mx-1 h-5 w-px bg-border" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setName("Untitled canvas")}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Canvas name"
          spellCheck={false}
          className="h-8 w-40 min-w-0 truncate rounded-md bg-transparent px-1.5 text-sm text-muted-foreground outline-none hover:bg-muted focus:bg-muted focus:text-foreground sm:w-52"
        />
      </Panel>

      <Panel className="pointer-events-auto flex h-11 items-center gap-1.5 px-1.5">
        {presence}
        <div className="max-md:hidden">
          <ThemeSwitch />
        </div>
        <Tooltip>
          <TooltipTrigger
            onClick={() => ui({ exportOpen: true })}
            aria-label="Export image"
            className="flex size-8 items-center justify-center rounded-lg text-foreground/75 transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Export image (⇧⌘E)</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={() => ui({ shareOpen: true })}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
        >
          <Share2 className="size-4" />
          <span className="max-sm:hidden">Share</span>
        </button>
      </Panel>
    </div>
  );
}
