"use client";

import { Loader2, Search } from "lucide-react";
import { createElement, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { insertIcon, useUI } from "@/lib/actions";
import { iconLabel, iconNodeToPath, type IconNode } from "@/lib/scene/icons";
import { cn } from "@/lib/utils";

const RECENT_KEY = "opencanvas:recent-icons";
const MAX_RESULTS = 280;

type IconSet = Record<string, IconNode>;

// The full Lucide set is ~2k icons, so it's only loaded when the picker opens.
let iconSet: IconSet | null = null;
let loading: Promise<IconSet> | null = null;
const loadIcons = () => {
  loading ??= import("lucide").then((m) => (iconSet = m.icons as unknown as IconSet));
  return loading;
};

const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
};

const pushRecent = (name: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, 16)));
  } catch {}
};

function IconGlyph({ node, className }: { node: IconNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

function IconButton({ name, node, onPick }: { name: string; node: IconNode; onPick: (name: string) => void }) {
  return (
    <button
      type="button"
      title={iconLabel(name)}
      aria-label={iconLabel(name)}
      onClick={() => onPick(name)}
      className="flex aspect-square items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-brand-soft hover:text-brand-soft-foreground focus-visible:outline-2 focus-visible:outline-brand"
    >
      <IconGlyph node={node} className="size-5" />
    </button>
  );
}

function IconBrowser({ onPick }: { onPick: (name: string) => void }) {
  const [icons, setIcons] = useState<IconSet | null>(iconSet);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [recent] = useState(readRecent);

  useEffect(() => {
    if (!icons) void loadIcons().then(setIcons);
  }, [icons]);

  const index = useMemo(() => (icons ? Object.keys(icons).map((name) => ({ name, label: iconLabel(name) })) : []), [icons]);
  const results = useMemo(() => {
    const terms = deferred.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return index;
    const compact = terms.join("");
    return index
      .filter(({ label }) => terms.every((t) => label.includes(t)) || label.replace(/ /g, "").includes(compact))
      .sort((a, b) => Number(!b.label.startsWith(terms[0])) - Number(!a.label.startsWith(terms[0])) || a.label.length - b.label.length);
  }, [index, deferred]);

  const recentIcons = icons && !deferred ? recent.filter((n) => icons[n]) : [];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) onPick(results[0].name);
          }}
          placeholder="Search icons, e.g. database, user, cloud"
          className="h-9 w-full rounded-lg border bg-transparent pr-3 pl-8 text-sm outline-none focus:border-brand"
        />
      </div>

      {!icons ? (
        <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading icons…
        </div>
      ) : (
        <div className="-mx-1 h-[min(26rem,55dvh)] overflow-y-auto px-1">
          {recentIcons.length > 0 && (
            <section className="mb-3">
              <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Recent</h3>
              <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
                {recentIcons.map((n) => (
                  <IconButton key={n} name={n} node={icons[n]} onPick={onPick} />
                ))}
              </div>
            </section>
          )}
          <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {deferred ? `${results.length} ${results.length === 1 ? "match" : "matches"}` : `All icons · ${index.length}`}
          </h3>
          {results.length ? (
            <div className={cn("grid grid-cols-8 gap-1 sm:grid-cols-10", query !== deferred && "opacity-60")}>
              {results.slice(0, MAX_RESULTS).map(({ name }) => (
                <IconButton key={name} name={name} node={icons[name]} onPick={onPick} />
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No icons match “{deferred}”.</p>
          )}
          {results.length > MAX_RESULTS && (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Showing {MAX_RESULTS} of {results.length}. Keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function IconPicker() {
  const open = useUI((s) => s.iconsOpen);
  const set = useUI((s) => s.set);

  const pick = (name: string) => {
    const node = iconSet?.[name];
    if (!node) return;
    pushRecent(name);
    insertIcon(name, iconNodeToPath(node));
    set({ iconsOpen: false });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => set({ iconsOpen: o })}>
      <DialogContent className="gap-3 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Icon library</DialogTitle>
          <DialogDescription>Every Lucide icon, inserted as a vector you can resize, recolor and connect arrows to.</DialogDescription>
        </DialogHeader>
        {open && <IconBrowser onPick={pick} />}
      </DialogContent>
    </Dialog>
  );
}
