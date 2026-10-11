"use client";

import { Copy, Download, FileCode } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fileBaseName, useUI } from "@/lib/actions";
import { copyPngToClipboard, downloadBlob, exportToCanvas, exportToPngBlob, exportToSvg, type ExportOptions } from "@/lib/scene/export";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-brand" : "bg-muted-foreground/30")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-4.5" : "left-0.5")} />
      </button>
    </label>
  );
}


export function ExportDialog() {
  const open = useUI((s) => s.exportOpen);
  const set = useUI((s) => s.set);
  const elements = useEditor((s) => s.elements);
  const selectedIds = useEditor((s) => s.selectedIds);
  const files = useEditor((s) => s.files);
  const viewBg = useEditor((s) => s.viewBackgroundColor);
  const [background, setBackground] = useState(true);
  const [dark, setDark] = useState(false);
  const [onlySelected, setOnlySelected] = useState(true);
  const [scale, setScale] = useState(2);
  const preview = useRef<HTMLDivElement>(null);

  const hasSelection = selectedIds.size > 0;
  const targets = useMemo(() => {
    if (!hasSelection || !onlySelected) return elements;
    return elements.filter((e) => selectedIds.has(e.id) || (e.type === "text" && e.containerId && selectedIds.has(e.containerId)));
  }, [elements, selectedIds, hasSelection, onlySelected]);
  const opts: ExportOptions = { background, backgroundColor: viewBg, dark, scale };

  useEffect(() => {
    if (!open) return;
    // Wait for the dialog to mount before drawing the preview.
    const id = requestAnimationFrame(() => {
      const el = preview.current;
      if (!el) return;
      el.replaceChildren();
      if (!targets.length) return;
      const canvas = exportToCanvas(targets, files, { ...opts, scale: 1 });
      canvas.className = "max-h-full max-w-full object-contain";
      el.appendChild(canvas);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targets, files, background, dark, viewBg]);


  return (
    <Dialog open={open} onOpenChange={(o) => set({ exportOpen: o })}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export image</DialogTitle>
          <DialogDescription>Download as PNG or SVG, or copy straight to your clipboard.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <div
            ref={preview}
            className="flex h-64 items-center justify-center overflow-hidden rounded-lg border p-3"
            style={{ background: "repeating-conic-gradient(var(--muted) 0% 25%, var(--background) 0% 50%) 50% / 16px 16px" }}
          />
          <div className="flex flex-col gap-3">
            <Toggle label="Background" checked={background} onChange={setBackground} />
            <Toggle label="Dark mode" checked={dark} onChange={setDark} />
            {hasSelection && <Toggle label="Only selected" checked={onlySelected} onChange={setOnlySelected} />}
            <div className="flex items-center justify-between text-sm">
              Scale
              <div className="flex gap-1">
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScale(s)}
                    className={cn("h-7 w-9 rounded-md border text-xs", scale === s && "border-brand bg-brand-soft text-brand-soft-foreground")}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!targets.length}
            onClick={async () => {
              try {
                await copyPngToClipboard(targets, files, opts);
                toast.success("Copied PNG to clipboard");
              } catch {
                toast.error("Clipboard access was denied");
              }
            }}
          >
            <Copy /> Copy PNG
          </Button>
          <Button
            variant="outline"
            disabled={!targets.length}
            onClick={() => {
              const svg = exportToSvg(targets, files, opts);
              downloadBlob(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${fileBaseName()}.svg`);
            }}
          >
            <FileCode /> SVG
          </Button>
          <Button
            disabled={!targets.length}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={async () => downloadBlob(await exportToPngBlob(targets, files, opts), `${fileBaseName()}.png`)}
          >
            <Download /> PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Tools",
    [
      ["Hand (pan)", "H"],
      ["Selection", "V / 1"],
      ["Rectangle", "R / 2"],
      ["Diamond", "D / 3"],
      ["Ellipse", "O / 4"],
      ["Arrow", "A / 5"],
      ["Line", "L / 6"],
      ["Draw", "P / 7"],
      ["Text", "T / 8"],
      ["Insert image", "9"],
      ["Icon library", "I"],
      ["Generate with AI", "G"],
      ["Eraser", "E / 0"],
      ["Laser pointer", "K"],
      ["Keep tool active", "Q"],
    ],
  ],
  [
    "Editor",
    [
      ["Undo / Redo", "⌘Z / ⇧⌘Z"],
      ["Copy / Cut / Paste", "⌘C / ⌘X / ⌘V"],
      ["Duplicate", "⌘D or Alt+drag"],
      ["Select all", "⌘A"],
      ["Delete", "Del / ⌫"],
      ["Group / Ungroup", "⌘G / ⇧⌘G"],
      ["Bring forward / to front", "⌘] / ⇧⌘]"],
      ["Send backward / to back", "⌘[ / ⇧⌘["],
      ["Lock / unlock", "⇧⌘L"],
      ["Flip horizontal / vertical", "⇧H / ⇧V"],
      ["Copy as PNG", "⇧⌥C"],
      ["Edit text / label", "Enter or double-click"],
      ["Nudge", "Arrows (⇧ for 10px)"],
    ],
  ],
  [
    "View",
    [
      ["Pan", "Space+drag, wheel, middle mouse"],
      ["Zoom", "⌘+wheel, pinch, ⌘+ / ⌘−"],
      ["Reset zoom", "⌘0"],
      ["Zoom to fit", "⇧1"],
      ["Zoom to selection", "⇧2"],
      ["Toggle grid", "⌘'"],
      ["Dark mode", "⇧⌥D"],
      ["Save / Open", "⌘S / ⌘O"],
      ["Export image", "⇧⌘E"],
    ],
  ],
];

export function HelpDialog() {
  const open = useUI((s) => s.helpOpen);
  const set = useUI((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => set({ helpOpen: o })}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Hold Shift while drawing to constrain proportions and angles; hold Alt to draw from the center.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-3">
          {SHORTCUTS.map(([title, items]) => (
            <div key={title} className="flex flex-col gap-1">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
              {items.map(([label, keys]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-dashed py-1 text-xs last:border-0">
                  <span>{label}</span>
                  <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResetDialog() {
  const open = useUI((s) => s.resetOpen);
  const set = useUI((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => set({ resetOpen: o })}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear canvas</DialogTitle>
          <DialogDescription>This removes everything on the canvas. You can still undo it.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => set({ resetOpen: false })}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const s = useEditor.getState();
              s.setElements([]);
              s.select([]);
              s.commit();
              s.setViewport({ scrollX: 0, scrollY: 0, zoom: 1 });
              set({ resetOpen: false });
            }}
          >
            Clear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
