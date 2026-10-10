"use client";

import { Check, Copy, Link2, Loader2, LogIn, LogOut, Radio, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUI } from "@/lib/actions";
import { collabConfigured, workspaceUrl } from "@/lib/collab/api";
import { newWorkspaceId, parseWorkspaceInput } from "@/lib/collab/ids";
import { createWorkspaceFromCanvas, useCollab } from "@/lib/collab/session";
import { loadIdentity } from "@/lib/collab/identity";
import { cn } from "@/lib/utils";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>;
}

function NameField() {
  const me = useCollab((s) => s.me);
  const setMyName = useCollab((s) => s.setMyName);
  const [fallback] = useState(loadIdentity);
  const who = me ?? { ...fallback, id: "" };
  return (
    <label className="flex flex-col gap-1.5">
      <SectionTitle>Your name</SectionTitle>
      <div className="flex h-9 items-center gap-2 rounded-lg border px-2.5 focus-within:border-brand">
        <span className="size-3 shrink-0 rounded-full" style={{ background: who.color }} />
        <input
          defaultValue={who.name}
          onChange={(e) => e.target.value.trim() && setMyName(e.target.value.trim())}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          spellCheck={false}
          aria-label="Your name"
        />
      </div>
    </label>
  );
}

function CopyField({ workspaceId }: { workspaceId: string }) {
  const [mode, setMode] = useState<"link" | "code">("link");
  const [copied, setCopied] = useState(false);
  const value = mode === "link" ? workspaceUrl(workspaceId) : workspaceId;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(mode === "link" ? "Link copied" : "Code copied");
    } catch {
      toast.error("Clipboard access was denied");
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SectionTitle>Invite people</SectionTitle>
        <div role="radiogroup" aria-label="Share as" className="flex rounded-md bg-muted p-0.5 text-xs">
          {(["link", "code"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded px-2 py-0.5 text-muted-foreground transition-colors", mode === m && "bg-background text-foreground shadow-sm")}
            >
              {m === "link" ? "Link" : "Code"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={mode === "link" ? "Share link" : "Share code"}
          className={cn("h-9 min-w-0 flex-1 rounded-lg border bg-muted/50 px-2.5 text-sm outline-none", mode === "code" && "font-mono tracking-wide")}
        />
        <Button onClick={copy} className="h-9 bg-brand text-brand-foreground hover:bg-brand/90">
          {copied ? <Check /> : <Copy />} Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "link" ? "Anyone with this link can view and edit live." : "Others can paste this code in Share → Join a session."}
      </p>
    </div>
  );
}

function People() {
  const me = useCollab((s) => s.me);
  const peers = useCollab((s) => s.peers);
  const people = [...(me ? [{ ...me, you: true }] : []), ...peers.map((p) => ({ ...p, you: false }))];
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle>Here now · {people.length}</SectionTitle>
      <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: p.color }}>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            {p.name}
            {p.you && <span className="text-xs text-muted-foreground">(you)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SetupHelp() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">Live sessions use a free Supabase project to relay changes and store shared canvases. To turn them on:</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
        <li>Create a project at supabase.com.</li>
        <li>
          Run <code className="rounded bg-muted px-1 font-mono text-xs">supabase/schema.sql</code> in its SQL editor.
        </li>
        <li>
          Copy <code className="rounded bg-muted px-1 font-mono text-xs">.env.example</code> to{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">.env.local</code> and fill in the URL and anon key.
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </div>
  );
}

function JoinForm({ onJoin }: { onJoin: (id: string) => void }) {
  const [value, setValue] = useState("");
  const id = parseWorkspaceInput(value);
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (id) onJoin(id);
      }}
    >
      <SectionTitle>Join a session</SectionTitle>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a link or code"
          aria-label="Link or code"
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-lg border bg-transparent px-2.5 text-sm outline-none focus:border-brand"
        />
        <Button type="submit" variant="outline" className="h-9" disabled={!id}>
          <LogIn /> Join
        </Button>
      </div>
      {value && !id && <p className="text-xs text-destructive">That doesn&apos;t look like a link or code.</p>}
    </form>
  );
}

export function ShareDialog({ workspaceId }: { workspaceId?: string }) {
  const open = useUI((s) => s.shareOpen);
  const set = useUI((s) => s.set);
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const id = await createWorkspaceFromCanvas(newWorkspaceId());
      // Keep the dialog open so the link can be copied right away.
      router.push(`/workspace/${id}`);
    } catch {
      toast.error("Couldn't start a live session. Check your Supabase setup.");
    } finally {
      setStarting(false);
    }
  };

  const join = (id: string) => {
    if (id === workspaceId) return set({ shareOpen: false });
    set({ shareOpen: false });
    router.push(`/workspace/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => set({ shareOpen: o })}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {workspaceId ? <Radio className="size-4 text-brand" /> : <Users className="size-4" />}
            {workspaceId ? "Live session" : "Collaborate live"}
          </DialogTitle>
          <DialogDescription>
            {workspaceId
              ? "Everyone in this workspace sees changes and cursors as they happen."
              : "Share this canvas so others can draw on it with you in real time."}
          </DialogDescription>
        </DialogHeader>

        {!collabConfigured ? (
          <SetupHelp />
        ) : workspaceId ? (
          <>
            <CopyField workspaceId={workspaceId} />
            <NameField />
            <People />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-xl border bg-brand-soft/40 p-3.5">
              <p className="text-sm">
                Your current canvas becomes a shared workspace with its own link. The copy saved in this browser stays as it is.
              </p>
              <NameField />
              <Button onClick={start} disabled={starting} className="h-9 bg-brand text-brand-foreground hover:bg-brand/90">
                {starting ? <Loader2 className="animate-spin" /> : <Link2 />} Start live session
              </Button>
            </div>
            <JoinForm onJoin={join} />
          </>
        )}

        {workspaceId && collabConfigured && (
          <div className="border-t pt-4">
            <JoinForm onJoin={join} />
          </div>
        )}
        {workspaceId && (
          <button
            type="button"
            onClick={() => {
              set({ shareOpen: false });
              router.push("/");
            }}
            className="-mt-2 flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-3.5" /> Leave and go back to my own canvas
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
