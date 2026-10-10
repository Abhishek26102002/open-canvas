"use client";

import { CloudOff, Loader2, SearchX, Settings2 } from "lucide-react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUI } from "@/lib/actions";
import { useCollab, type CollabStatus } from "@/lib/collab/session";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Other people's pointers, drawn over the canvas in screen space. */
export function RemoteCursors() {
  const peers = useCollab((s) => s.peers);
  const cursors = useCollab((s) => s.cursors);
  const v = useEditor((s) => s.viewport);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {peers.map((peer) => {
        const p = cursors[peer.id];
        if (!p) return null;
        const x = (p[0] + v.scrollX) * v.zoom;
        const y = (p[1] + v.scrollY) * v.zoom;
        return (
          <div key={peer.id} className="absolute top-0 left-0 transition-transform duration-75 ease-linear" style={{ transform: `translate(${x}px, ${y}px)` }}>
            <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm" aria-hidden>
              <path d="M2 1.5 15.5 7.8 9 9.4 6.6 15.8z" fill={peer.color} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span className="absolute top-4 left-3.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-sm" style={{ background: peer.color }}>
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_LABEL: Partial<Record<CollabStatus, string>> = {
  loading: "Loading workspace…",
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
};

/** Avatars of everyone in the session, plus connection state. */
export function PeerAvatars() {
  const status = useCollab((s) => s.status);
  const me = useCollab((s) => s.me);
  const peers = useCollab((s) => s.peers);
  const open = () => useUI.getState().set({ shareOpen: true });
  if (!STATUS_LABEL[status] || !me) return null;
  const shown = [me, ...peers].slice(0, 4);
  const extra = peers.length + 1 - shown.length;
  return (
    <Tooltip>
      <TooltipTrigger onClick={open} aria-label="People in this session" className="flex h-8 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-muted">
        <span className={cn("size-2 rounded-full", status === "connected" ? "bg-emerald-500" : "animate-pulse bg-amber-500")} />
        <span className="flex -space-x-1.5">
          {shown.map((p) => (
            <span
              key={p.id}
              className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-surface"
              style={{ background: p.color }}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {extra > 0 && <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-surface">+{extra}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {STATUS_LABEL[status]} · {peers.length + 1} {peers.length ? "people" : "person"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Blocks the editor while a workspace loads, or explains why it can't. */
export function WorkspaceGate() {
  const status = useCollab((s) => s.status);
  const id = useCollab((s) => s.workspaceId);
  if (status !== "loading" && status !== "not-found" && status !== "error" && status !== "unconfigured") return null;

  const content = {
    loading: { icon: Loader2, title: "Opening workspace…", body: "Fetching the latest version of this canvas." },
    "not-found": { icon: SearchX, title: "Workspace not found", body: `There's no shared canvas with the code ${id}. Check the link or ask for a new one.` },
    error: { icon: CloudOff, title: "Couldn't reach the server", body: "Check your connection and reload the page to try again." },
    unconfigured: {
      icon: Settings2,
      title: "Live sessions aren't set up",
      body: "This copy of OpenCanvas has no Supabase project configured. See .env.example and supabase/schema.sql.",
    },
  }[status];
  const Icon = content.icon;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Icon className={cn("size-8 text-muted-foreground", status === "loading" && "animate-spin")} />
        <h2 className="text-base font-semibold">{content.title}</h2>
        <p className="text-sm text-muted-foreground">{content.body}</p>
        {status !== "loading" && (
          <Link href="/" className="mt-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:opacity-90">
            Go to my canvas
          </Link>
        )}
      </div>
    </div>
  );
}
