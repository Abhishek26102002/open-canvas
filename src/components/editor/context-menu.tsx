"use client";

import { useEffect, useRef } from "react";
import { copyAsPng, copySelection, pasteData, useUI } from "@/lib/actions";
import { useEditor } from "@/lib/store";

interface Item {
  label: string;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
}

export function ContextMenu({ at, onClose }: { at: { x: number; y: number; scene: [number, number] } | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useEditor();

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("wheel", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("wheel", close, true);
    };
  }, [at, onClose]);

  if (!at) return null;

  const selected = s.elements.filter((e) => s.selectedIds.has(e.id));
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      await pasteData(dt, at.scene);
    } catch {
      // Clipboard read can be denied; Ctrl+V still works.
    }
  };

  const groups: Item[][] = selected.length
    ? [
        [
          { label: "Cut", shortcut: "⌘X", action: () => { copySelection(null); s.deleteSelected(); } },
          { label: "Copy", shortcut: "⌘C", action: () => copySelection(null) },
          { label: "Paste", shortcut: "⌘V", action: paste },
          { label: "Copy as PNG", shortcut: "⇧⌥C", action: copyAsPng },
        ],
        [
          ...(selected.length > 1 ? [{ label: "Group selection", shortcut: "⌘G", action: s.group }] : []),
          ...(selected.some((e) => e.groupIds.length) ? [{ label: "Ungroup", shortcut: "⇧⌘G", action: s.ungroup }] : []),
          { label: "Flip horizontal", shortcut: "⇧H", action: () => s.flip("horizontal") },
          { label: "Flip vertical", shortcut: "⇧V", action: () => s.flip("vertical") },
        ],
        [
          { label: "Send backward", shortcut: "⌘[", action: () => s.reorder("backward") },
          { label: "Bring forward", shortcut: "⌘]", action: () => s.reorder("forward") },
          { label: "Send to back", shortcut: "⇧⌘[", action: () => s.reorder("back") },
          { label: "Bring to front", shortcut: "⇧⌘]", action: () => s.reorder("front") },
        ],
        [
          { label: "Duplicate", shortcut: "⌘D", action: s.duplicateSelected },
          { label: selected.every((e) => e.locked) ? "Unlock" : "Lock", shortcut: "⇧⌘L", action: s.toggleLock },
          { label: "Delete", shortcut: "Del", action: s.deleteSelected, danger: true },
        ],
      ]
    : [
        [
          { label: "Paste", shortcut: "⌘V", action: paste },
          { label: "Select all", shortcut: "⌘A", action: s.selectAll },
        ],
        [
          { label: s.grid ? "Hide grid" : "Show grid", shortcut: "⌘'", action: () => s.setGrid(!s.grid) },
          { label: "Zoom to fit", shortcut: "⇧1", action: () => s.zoomToFit() },
          { label: "Unlock all", action: () => {
            s.setElements(s.elements.map((e) => (e.locked ? { ...e, locked: false, version: e.version + 1 } : e)));
            s.commit();
          } },
        ],
        [{ label: "Keyboard shortcuts", shortcut: "?", action: () => useUI.getState().set({ helpOpen: true }) }],
      ];

  const left = Math.min(at.x, window.innerWidth - 230);
  const top = Math.min(at.y, window.innerHeight - 420);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left, top: Math.max(8, top) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {groups.map((items, gi) => (
        <div key={gi} className={gi > 0 ? "mt-1 border-t pt-1" : undefined}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-accent ${item.danger ? "text-destructive" : ""}`}
              onClick={() => {
                item.action();
                onClose();
              }}
            >
              {item.label}
              {item.shortcut && <span className="text-xs text-muted-foreground">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
