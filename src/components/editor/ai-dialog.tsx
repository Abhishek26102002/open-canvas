"use client";

import { ChevronDown, ExternalLink, ImagePlus, KeyRound, LoaderCircle, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pickFile, useUI } from "@/lib/actions";
import { hydrateAiSettings, insertDiagram, prepareImage, requestDiagram, useAiSettings } from "@/lib/ai/client";
import { FREE_MODELS, getProvider, MAX_PROMPT_LENGTH, PROVIDERS, resolveFreeModel } from "@/lib/ai/config";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "User sign-up flow with email verification",
  "Microservices architecture for an online store",
  "CI/CD pipeline from commit to production",
  "Org chart for a 12-person startup",
];

const readFile = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** The image element currently selected on the canvas, if exactly one. */
const selectedImageUrl = () => {
  const s = useEditor.getState();
  const sel = s.elements.filter((e) => s.selectedIds.has(e.id));
  if (sel.length !== 1 || sel[0].type !== "image") return null;
  return s.files[sel[0].fileId]?.dataURL ?? null;
};

function ModelSettings() {
  const { provider, keys, models, update, setKey, setModel } = useAiSettings();
  const info = getProvider(provider);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => update({ provider: p.id })}
            className={cn(
              "rounded-md border bg-background px-2 py-1.5 text-xs transition-colors hover:border-brand/60",
              provider === p.id && "border-brand bg-brand-soft text-brand-soft-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {info.needsKey ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={keys[provider] ?? ""}
              onChange={(e) => setKey(provider, e.target.value)}
              placeholder={info.keyHint}
              className="h-8 rounded-md border bg-background px-2 font-mono text-xs font-normal outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Model
            <input
              spellCheck={false}
              value={models[provider] ?? ""}
              onChange={(e) => setModel(provider, e.target.value)}
              placeholder={info.defaultModel}
              className="h-8 rounded-md border bg-background px-2 font-mono text-xs font-normal outline-none focus:border-brand"
            />
          </label>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            Your key stays in this browser and only passes through our server on its way to the provider.
            {info.keyUrl && (
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2">
                Get a key <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        </>
      ) : (
        <>
          <div role="radiogroup" aria-label="Free model" className="flex flex-col gap-0.5">
            {FREE_MODELS.map((m) => {
              const active = (models.free || info.defaultModel) === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setModel("free", m.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-background",
                    active && "bg-background ring-1 ring-brand",
                  )}
                >
                  <span className={cn("size-2 rounded-full border", active ? "border-brand bg-brand" : "border-muted-foreground/40")} />
                  <span className="font-medium">{m.label}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground max-sm:hidden">{m.id}</span>
                  {m.vision && <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">reads images</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            No key needed. Text-only models hand attached images to Nemotron 3 Nano Omni. Free models can be slow and rate limited; add your own key for faster
            results.
          </p>
        </>
      )}
    </div>
  );
}

export function AiDialog() {
  const open = useUI((s) => s.aiOpen);
  const set = useUI((s) => s.set);
  const provider = useAiSettings((s) => s.provider);
  const hasKey = useAiSettings((s) => !!s.keys[s.provider]?.trim());
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const info = getProvider(provider);
  const freeModel = useAiSettings((s) => s.models.free);
  const modelLabel = provider === "free" ? FREE_MODELS.find((m) => m.id === resolveFreeModel(freeModel, !!image))!.label : info.label;

  useEffect(() => {
    if (!open) return;
    hydrateAiSettings();
    // Opening with an image selected means "recreate this".
    const fromCanvas = selectedImageUrl();
    if (fromCanvas) void prepareImage(fromCanvas).then(setImage).catch(() => {});
  }, [open]);

  const attach = async (file: Blob | undefined) => {
    if (!file?.type.startsWith("image/")) return;
    try {
      setImage(await prepareImage(await readFile(file)));
    } catch {
      toast.error("Couldn't read that image");
    }
  };

  const close = (o: boolean) => {
    if (o) return set({ aiOpen: true });
    abort.current?.abort();
    set({ aiOpen: false });
  };

  const generate = async () => {
    if (busy || (!prompt.trim() && !image)) return;
    if (info.needsKey && !hasKey) {
      setShowSettings(true);
      toast.error(`Add your ${info.label} API key first`);
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const { diagram } = await requestDiagram(prompt, image ?? undefined, controller.signal);
      const count = insertDiagram(diagram);
      toast.success(`Added ${diagram.nodes.length} shapes${diagram.title ? ` · ${diagram.title}` : ""}`, { description: count ? "Everything is selected, so you can move it as one." : undefined });
      setPrompt("");
      setImage(null);
      set({ aiOpen: false });
    } catch (e) {
      if (controller.signal.aborted) return;
      toast.error(e instanceof Error ? e.message : "Couldn't generate the diagram");
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-brand text-brand-foreground">
              <Sparkles className="size-3.5" />
            </span>
            Generate a diagram
          </DialogTitle>
          <DialogDescription>Describe what you need, or attach a picture of a diagram to redraw it as editable shapes.</DialogDescription>
        </DialogHeader>

        <div
          className={cn("relative flex flex-col rounded-lg border bg-background transition-colors focus-within:border-brand", dragging && "border-brand bg-brand-soft/40")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void attach(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")));
          }}
        >
          <textarea
            autoFocus
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void generate();
              }
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
              if (file) {
                e.preventDefault();
                void attach(file);
              }
            }}
            placeholder={image ? "Optional: anything to change? e.g. “use blue for services”" : "e.g. Checkout flow: cart → shipping → payment, with a retry path when payment fails"}
            className="min-h-28 resize-none rounded-lg bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
          <div className="flex items-end justify-between gap-2 p-2 pt-0">
            {image ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Reference" className="h-16 max-w-40 rounded-md border object-contain" />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => setImage(null)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background shadow-sm hover:bg-muted"
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={async () => void attach((await pickFile("image/*"))[0])}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ImagePlus className="size-3.5" /> Attach image <span className="max-sm:hidden">· or paste / drop</span>
              </button>
            )}
            <span className="text-[11px] text-muted-foreground max-sm:hidden">⌘↵ to generate</span>
          </div>
        </div>

        {!prompt && !image && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={showSettings}
          >
            <KeyRound className="size-3.5" />
            Model: <span className="font-medium text-foreground">{modelLabel}</span>
            {info.needsKey && !hasKey && <span className="text-destructive">· key needed</span>}
            <ChevronDown className={cn("size-3.5 transition-transform", showSettings && "rotate-180")} />
          </button>
          {showSettings && <ModelSettings />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {busy ? "Stop" : "Cancel"}
          </Button>
          <Button disabled={busy || (!prompt.trim() && !image)} onClick={() => void generate()} className="bg-brand text-brand-foreground hover:bg-brand/90">
            {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {busy ? "Drawing…" : image ? "Recreate diagram" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
