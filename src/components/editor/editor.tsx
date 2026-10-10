"use client";

import { useCallback, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { connectWorkspace } from "@/lib/collab/session";
import { loadFiles, loadPrefs, loadScene, savePrefs, saveScene } from "@/lib/scene/storage";
import { useEditor } from "@/lib/store";
import { PeerAvatars, RemoteCursors, WorkspaceGate } from "./collaborators";
import { IconPicker } from "./icon-picker";
import { ShareDialog } from "./share-dialog";
import { Canvas } from "./canvas";
import { ContextMenu } from "./context-menu";
import { ExportDialog, HelpDialog, ResetDialog } from "./dialogs";
import { BottomBar } from "./bottom-bar";
import { Inspector } from "./inspector";
import { TextEditor } from "./text-editor";
import { ToolDock } from "./toolbar";
import { TopBar } from "./top-bar";
import { useShortcuts } from "./use-shortcuts";
import { Welcome } from "./welcome";

/** Tool preferences are per browser, in both local and shared canvases. */
function usePrefs() {
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.hydrated && (s.grid !== prev.grid || s.toolLocked !== prev.toolLocked)) savePrefs({ grid: s.grid, toolLocked: s.toolLocked });
      }),
    [],
  );
}

/** Joins a shared workspace; it loads from and saves to the server instead of this browser. */
function useWorkspace(id: string) {
  useEffect(() => connectWorkspace(id), [id]);
}

/** Loads the last scene from local storage and autosaves changes. */
function useLocalPersistence() {
  useEffect(() => {
    const scene = loadScene();
    const prefs = loadPrefs();
    useEditor.getState().hydrate({
      name: scene?.name ?? "Untitled canvas",
      elements: scene?.elements ?? [],
      viewport: scene?.viewport ?? { scrollX: 0, scrollY: 0, zoom: 1 },
      viewBackgroundColor: scene?.viewBackgroundColor ?? "#ffffff",
      files: {},
      grid: prefs.grid ?? false,
      toolLocked: prefs.toolLocked ?? false,
    });
    loadFiles().then((files) => useEditor.getState().addFiles(Object.values(files)));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.hydrated) return;
      if (s.elements === prev.elements && s.viewport === prev.viewport && s.viewBackgroundColor === prev.viewBackgroundColor && s.name === prev.name) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useEditor.getState();
        saveScene({ name: st.name, elements: st.elements, viewport: st.viewport, viewBackgroundColor: st.viewBackgroundColor });
      }, 300);
    });
    const flush = () => {
      const st = useEditor.getState();
      if (st.hydrated) saveScene({ name: st.name, elements: st.elements, viewport: st.viewport, viewBackgroundColor: st.viewBackgroundColor });
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      unsub();
      clearTimeout(timer);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);
}

function LocalCanvas() {
  useLocalPersistence();
  return null;
}

function SharedCanvas({ id }: { id: string }) {
  useWorkspace(id);
  return null;
}

export function Editor({ workspaceId }: { workspaceId?: string }) {
  usePrefs();
  useShortcuts();
  const hydrated = useEditor((s) => s.hydrated);
  const [menu, setMenu] = useState<{ x: number; y: number; scene: [number, number] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <TooltipProvider delay={400}>
      <main
        className="fixed inset-0 overflow-hidden bg-background select-none"
        onContextMenu={(e) => {
          e.preventDefault();
          if (!(e.target instanceof HTMLCanvasElement)) return;
          const { viewport: v } = useEditor.getState();
          const rect = e.target.getBoundingClientRect();
          setMenu({
            x: e.clientX,
            y: e.clientY,
            scene: [(e.clientX - rect.left) / v.zoom - v.scrollX, (e.clientY - rect.top) / v.zoom - v.scrollY],
          });
        }}
      >
        {workspaceId ? <SharedCanvas id={workspaceId} /> : <LocalCanvas />}
        <Canvas />
        {workspaceId && <RemoteCursors />}
        <TextEditor />
        {hydrated && <Welcome />}
        <TopBar workspaceId={workspaceId} presence={workspaceId ? <PeerAvatars /> : null} />
        <ToolDock />
        <div className="pointer-events-none absolute top-[4.25rem] right-3 hidden md:block">
          <Inspector />
        </div>
        <BottomBar />
        {menu && <ContextMenu at={menu} onClose={closeMenu} />}
        <ExportDialog />
        <HelpDialog />
        <ResetDialog />
        <IconPicker />
        <ShareDialog workspaceId={workspaceId} />
        {workspaceId && <WorkspaceGate />}
      </main>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
