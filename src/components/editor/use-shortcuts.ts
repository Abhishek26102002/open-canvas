"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";
import { copyAsPng, copySelection, getPointerScene, openFromFile, pasteData, saveToFile, useUI, viewportCenter } from "@/lib/actions";
import { update } from "@/lib/scene/elements";
import type { ToolType } from "@/lib/scene/types";
import { isTextContainer } from "@/lib/scene/types";
import { useEditor } from "@/lib/store";
import { selectTool } from "./toolbar";

const TOOL_KEYS: Record<string, ToolType> = {
  h: "hand",
  v: "selection", "1": "selection",
  r: "rectangle", "2": "rectangle",
  d: "diamond", "3": "diamond",
  o: "ellipse", "4": "ellipse",
  a: "arrow", "5": "arrow",
  l: "line", "6": "line",
  p: "freedraw", "7": "freedraw",
  t: "text", "8": "text",
  "9": "image",
  i: "icon",
  e: "eraser", "0": "eraser",
  k: "laser",
};

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export function useShortcuts() {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.defaultPrevented) return;
      // Leave dialogs and menus to handle their own keys.
      if (document.querySelector("[role=dialog],[role=menu]")) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod) {
        let handled = true;
        if (key === "z" && !e.shiftKey) s.undo();
        else if ((key === "z" && e.shiftKey) || key === "y") s.redo();
        else if (key === "d") s.duplicateSelected();
        else if (key === "a") s.selectAll();
        else if (key === "g" && e.shiftKey) s.ungroup();
        else if (key === "g") s.group();
        else if (e.code === "BracketRight") s.reorder(e.shiftKey ? "front" : "forward");
        else if (e.code === "BracketLeft") s.reorder(e.shiftKey ? "back" : "backward");
        else if (key === "l" && e.shiftKey) s.toggleLock();
        else if (key === "=" || key === "+") s.zoomAt(s.viewport.zoom * 1.2);
        else if (key === "-") s.zoomAt(s.viewport.zoom / 1.2);
        else if (key === "0") s.zoomAt(1);
        else if (key === "'") s.setGrid(!s.grid);
        else if (key === "s") saveToFile();
        else if (key === "o") void openFromFile();
        else if (key === "e" && e.shiftKey) useUI.getState().set({ exportOpen: true });
        else handled = false;
        if (handled) e.preventDefault();
        return;
      }

      if (e.altKey && e.shiftKey && e.code === "KeyD") {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        e.preventDefault();
        return;
      }
      if (e.altKey && e.shiftKey && e.code === "KeyC") {
        void copyAsPng();
        e.preventDefault();
        return;
      }

      const selected = s.elements.filter((el) => s.selectedIds.has(el.id));

      if (e.key === "Delete" || e.key === "Backspace") {
        s.deleteSelected();
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (selected.length) s.select([]);
        else s.setTool("selection");
        return;
      }
      if (e.key === "Enter" && selected.length === 1) {
        const el = selected[0];
        if (el.type === "text") s.setEditingTextId(el.id);
        else if (isTextContainer(el) && !el.locked) {
          // Double-click behavior: edit the existing label or start a new one.
          const canvas = document.querySelector("[data-canvas]");
          canvas?.dispatchEvent(
            new MouseEvent("dblclick", {
              bubbles: true,
              clientX: (el.x + el.width / 2 + s.viewport.scrollX) * s.viewport.zoom + (canvas.getBoundingClientRect().left ?? 0),
              clientY: (el.y + el.height / 2 + s.viewport.scrollY) * s.viewport.zoom + (canvas.getBoundingClientRect().top ?? 0),
            }),
          );
        }
        e.preventDefault();
        return;
      }
      if (e.key.startsWith("Arrow") && selected.length) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        s.setElements(s.elements.map((el) => (s.selectedIds.has(el.id) && !el.locked ? update(el, { x: el.x + dx, y: el.y + dy }) : el)));
        s.commit();
        e.preventDefault();
        return;
      }
      if (e.shiftKey && e.key === "!") return s.zoomToFit();
      if (e.shiftKey && e.key === "@") return s.zoomToFit(true);
      if (e.shiftKey && key === "h" && selected.length) return s.flip("horizontal");
      if (e.shiftKey && key === "v" && selected.length) return s.flip("vertical");
      if (e.key === "?") return useUI.getState().set({ helpOpen: true });
      if (key === "q") return s.setToolLocked(!s.toolLocked);
      if (key === "g" && !e.altKey && !e.shiftKey) return useUI.getState().set({ aiOpen: true });
      if (e.altKey || e.shiftKey) return;
      const tool = TOOL_KEYS[key];
      if (tool) selectTool(tool);
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      if (copySelection(e.clipboardData)) e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      if (copySelection(e.clipboardData)) {
        e.preventDefault();
        useEditor.getState().deleteSelected();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
      void pasteData(e.clipboardData, getPointerScene() ?? viewportCenter());
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
    };
  }, [resolvedTheme, setTheme]);
}
