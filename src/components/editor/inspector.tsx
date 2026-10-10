"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Group,
  Lock,
  LockOpen,
  SendToBack,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useMemo } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BACKGROUND_COLORS, FONT_SIZES, STROKE_COLORS } from "@/lib/scene/constants";
import type { Arrowhead, ArrowType, ElementType, FillStyle, Roundness, ItemStyle, SceneElement, ToolType } from "@/lib/scene/types";
import { useEditor } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ColorPicker } from "./color-picker";
import { Panel } from "./panel";

// ---------------------------------------------------------------------------
// Building blocks

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.25rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Group_({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t px-3.5 py-3 first:border-t-0">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{title}</h3>
      {children}
    </section>
  );
}

interface SegmentOption<T> {
  value: T;
  label: string;
  content: React.ReactNode;
}

/** A pill-shaped segmented control. */
function Segmented<T>({ value, options, onChange }: { value: T; options: SegmentOption<T>[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="flex rounded-lg bg-muted p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Tooltip key={String(o.value)}>
            <TooltipTrigger
              role="radio"
              aria-checked={active}
              aria-label={o.label}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex h-7 flex-1 items-center justify-center rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground",
                active && "bg-background text-foreground shadow-sm",
              )}
            >
              {o.content}
            </TooltipTrigger>
            <TooltipContent side="bottom">{o.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function IconAction({ label, onClick, active, danger, children }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          active && "bg-brand-soft text-brand-soft-foreground",
          danger && "hover:bg-destructive/10 hover:text-destructive",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

const Glyph = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ARROWHEADS: { value: Arrowhead; label: string; glyph: React.ReactNode }[] = [
  { value: null, label: "None", glyph: <Glyph><path d="M4 12h16" strokeWidth={1.75} /></Glyph> },
  { value: "arrow", label: "Open arrow", glyph: <Glyph><path d="M4 12h16M14 6l6 6-6 6" strokeWidth={1.75} /></Glyph> },
  { value: "triangle", label: "Filled arrow", glyph: <Glyph><path d="M4 12h10" strokeWidth={1.75} /><path d="M14 6l6 6-6 6z" fill="currentColor" strokeWidth={1.5} /></Glyph> },
  { value: "bar", label: "Bar", glyph: <Glyph><path d="M4 12h16M20 6v12" strokeWidth={1.75} /></Glyph> },
  { value: "dot", label: "Dot", glyph: <Glyph><path d="M4 12h12" strokeWidth={1.75} /><circle cx="18" cy="12" r="3" fill="currentColor" /></Glyph> },
];

function ArrowheadSelect({ value, flip, onChange }: { value: Arrowhead; flip?: boolean; onChange: (v: Arrowhead) => void }) {
  const current = ARROWHEADS.find((a) => a.value === value) ?? ARROWHEADS[0];
  const glyph = (g: React.ReactNode) => <span className={cn("flex", flip && "rotate-180")}>{g}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 flex-1 items-center justify-between rounded-lg bg-muted px-2 text-xs transition-colors hover:bg-muted/70">
        {glyph(current.glyph)}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-40">
        {ARROWHEADS.map((a) => (
          <DropdownMenuItem key={String(a.value)} onClick={() => onChange(a.value)}>
            {glyph(a.glyph)} {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------

const TOOL_TYPES: Partial<Record<ToolType, ElementType>> = {
  rectangle: "rectangle", diamond: "diamond", ellipse: "ellipse", arrow: "arrow", line: "line", freedraw: "freedraw", text: "text",
};

const TYPE_NAMES: Record<ElementType, string> = {
  rectangle: "Rectangle", diamond: "Diamond", ellipse: "Ellipse", arrow: "Arrow", line: "Line", freedraw: "Sketch", text: "Text", image: "Image", icon: "Icon",
};

/** Which settings to show depends on what's selected or what the active tool draws. */
const useTargets = () => {
  const elements = useEditor((s) => s.elements);
  const selectedIds = useEditor((s) => s.selectedIds);
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  return useMemo(() => {
    const selected = elements.filter((e) => selectedIds.has(e.id));
    const types = selected.length ? [...new Set(selected.map((e) => e.type))] : TOOL_TYPES[tool] ? [TOOL_TYPES[tool]!] : [];
    const labels = elements.filter((e) => e.type === "text" && e.containerId && selectedIds.has(e.containerId));
    return { types, selected, style, labels };
  }, [elements, selectedIds, tool, style]);
};

export function Inspector() {
  const { types, selected, style, labels } = useTargets();
  const s = useEditor.getState();
  const setStyle = useEditor((st) => st.setStyle);
  const editing = useEditor((st) => st.editingTextId);

  if (!types.length) return null;

  // Current values come from the first selected element that has the property.
  const pick = <K extends keyof ItemStyle>(key: K, from: SceneElement[] = selected): ItemStyle[K] => {
    for (const el of from) if (key in el) return (el as unknown as ItemStyle)[key];
    return style[key];
  };

  const has = (...t: ElementType[]) => types.some((x) => t.includes(x));
  const shapes = has("rectangle", "diamond", "ellipse");
  const strokes = has("rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "icon");
  const onlySketch = types.length === 1 && types[0] === "freedraw";
  const roughable = has("rectangle", "diamond", "ellipse", "arrow", "line");
  const fillColor = shapes || has("icon");
  const textual = has("text") || labels.length > 0;
  const textSource = labels.length ? (labels as SceneElement[]) : selected.filter((e) => e.type === "text");
  const fillable = selected.filter((e) => e.type === "rectangle" || e.type === "diamond" || e.type === "ellipse" || e.type === "icon");
  const bg = pick("backgroundColor", fillable);
  const locked = selected.length > 0 && selected.every((e) => e.locked);
  const grouped = selected.some((e) => e.groupIds.length > 0);

  const title = selected.length === 0
    ? `New ${TYPE_NAMES[types[0]].toLowerCase()}`
    : selected.length === 1
      ? TYPE_NAMES[selected[0].type]
      : `${selected.length} elements`;

  return (
    <Panel className="pointer-events-auto flex max-h-[calc(100dvh-8.5rem)] w-64 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{selected.length ? (locked ? "Locked" : "Selected") : "Default style for the next shape"}</p>
        </div>
        {selected.length > 0 && !editing && (
          <div className="flex shrink-0 items-center">
            <IconAction label="Duplicate (⌘D)" onClick={s.duplicateSelected}><Copy className="size-3.5" /></IconAction>
            <IconAction label={locked ? "Unlock (⇧⌘L)" : "Lock (⇧⌘L)"} active={locked} onClick={s.toggleLock}>
              {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            </IconAction>
            <IconAction label="Delete (Del)" danger onClick={s.deleteSelected}><Trash2 className="size-3.5" /></IconAction>
          </div>
        )}
      </header>

      <div className="overflow-y-auto">
        {!has("image") && (
          <Group_ title="Color">
            <Row label={textual && !strokes ? "Text" : "Stroke"}>
              <ColorPicker value={pick("strokeColor")} quick={STROKE_COLORS.slice(0, 5)} onChange={(c) => setStyle({ strokeColor: c })} />
            </Row>
            {fillColor && (
              <Row label="Fill">
                <ColorPicker value={bg} quick={BACKGROUND_COLORS.slice(0, 5)} allowTransparent onChange={(c) => setStyle({ backgroundColor: c })} />
              </Row>
            )}
            {shapes && bg !== "transparent" && (
              <Row label="Pattern">
                <Segmented<FillStyle>
                  value={pick("fillStyle", fillable.filter((e) => e.type !== "icon")) as FillStyle}
                  onChange={(v) => setStyle({ fillStyle: v })}
                  options={[
                    { value: "solid", label: "Solid", content: <Glyph><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" strokeWidth={1.5} /></Glyph> },
                    { value: "hachure", label: "Hatched", content: <Glyph><rect x="5" y="5" width="14" height="14" rx="3" strokeWidth={1.5} /><path d="M8 16l8-8M8 12l4-4M12 16l4-4" strokeWidth={1.2} /></Glyph> },
                    { value: "cross-hatch", label: "Cross-hatched", content: <Glyph><rect x="5" y="5" width="14" height="14" rx="3" strokeWidth={1.5} /><path d="M8 16l8-8M8 12l4-4M12 16l4-4M8 8l8 8M12 8l4 4M8 12l4 4" strokeWidth={1.1} /></Glyph> },
                    { value: "zigzag", label: "Zigzag", content: <Glyph><rect x="5" y="5" width="14" height="14" rx="3" strokeWidth={1.5} /><path d="M8 15l2-4 2 4 2-4 2 4" strokeWidth={1.2} /></Glyph> },
                  ]}
                />
              </Row>
            )}
            <Row label="Opacity">
              <div className="flex items-center gap-2.5">
                <Slider
                  value={[pick("opacity")]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) => setStyle({ opacity: Array.isArray(v) ? v[0] : v })}
                  className="flex-1"
                />
                <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{pick("opacity")}%</span>
              </div>
            </Row>
          </Group_>
        )}

        {strokes && (
          <Group_ title="Stroke">
            <Row label="Width">
              <Segmented
                value={pick("strokeWidth")}
                onChange={(v) => setStyle({ strokeWidth: v })}
                options={[1, 2, 4].map((w, i) => ({
                  value: w,
                  label: ["Fine", "Medium", "Heavy"][i],
                  content: <Glyph><path d="M5 12h14" strokeWidth={w * 0.9 + 0.8} /></Glyph>,
                }))}
              />
            </Row>
            {!onlySketch && (
              <>
                <Row label="Style">
                  <Segmented
                    value={pick("strokeStyle")}
                    onChange={(v) => setStyle({ strokeStyle: v })}
                    options={(["solid", "dashed", "dotted"] as const).map((st) => ({
                      value: st,
                      label: st[0].toUpperCase() + st.slice(1),
                      content: <Glyph><path d="M4 12h16" strokeWidth={2} strokeDasharray={st === "dashed" ? "5 3.5" : st === "dotted" ? "0.5 4" : undefined} /></Glyph>,
                    }))}
                  />
                </Row>
                {roughable && <Row label="Roughness">
                  <Segmented
                    value={pick("roughness")}
                    onChange={(v) => setStyle({ roughness: v })}
                    options={[0, 1, 2].map((r) => ({
                      value: r,
                      label: ["Clean", "Sketchy", "Wild"][r],
                      content: <span>{["Clean", "Sketchy", "Wild"][r]}</span>,
                    }))}
                  />
                </Row>}
              </>
            )}
            {has("rectangle", "diamond") && (
              <Row label="Corners">
                <Segmented<Roundness>
                  value={pick("roundness" as const, selected.filter((e) => e.type === "rectangle" || e.type === "diamond"))}
                  onChange={(v) => setStyle({ roundness: v })}
                  options={[
                    { value: "sharp", label: "Square corners", content: <Glyph><path d="M6 18V6h12" strokeWidth={1.75} /></Glyph> },
                    { value: "round", label: "Rounded corners", content: <Glyph><path d="M6 18v-6a6 6 0 0 1 6-6h6" strokeWidth={1.75} /></Glyph> },
                  ]}
                />
              </Row>
            )}
          </Group_>
        )}

        {has("arrow", "line") && (
          <Group_ title="Connector">
            <Row label="Path">
              <Segmented<ArrowType>
                value={pick("arrowType") as ArrowType}
                onChange={(v) => setStyle({ arrowType: v })}
                options={[
                  { value: "sharp", label: "Straight segments", content: <Glyph><path d="M4 18l6-10 10 8" strokeWidth={1.75} /></Glyph> },
                  { value: "round", label: "Smooth curve", content: <Glyph><path d="M4 18C7 4 15 4 20 16" strokeWidth={1.75} /></Glyph> },
                ]}
              />
            </Row>
            {has("arrow") && (
              <Row label="Ends">
                <div className="flex gap-1.5">
                  <ArrowheadSelect flip value={pick("startArrowhead", selected.filter((e) => e.type === "arrow"))} onChange={(v) => setStyle({ startArrowhead: v })} />
                  <ArrowheadSelect value={pick("endArrowhead", selected.filter((e) => e.type === "arrow"))} onChange={(v) => setStyle({ endArrowhead: v })} />
                </div>
              </Row>
            )}
          </Group_>
        )}

        {textual && (
          <Group_ title="Text">
            <Row label="Font">
              <Segmented
                value={pick("fontFamily", textSource)}
                onChange={(v) => setStyle({ fontFamily: v })}
                options={(["hand", "normal", "code"] as const).map((f) => ({
                  value: f,
                  label: f === "hand" ? "Handwritten" : f === "normal" ? "Sans" : "Mono",
                  content: <span style={{ fontFamily: `var(--font-${f})` }} className="text-[13px]">{f === "code" ? "</>" : "Ag"}</span>,
                }))}
              />
            </Row>
            <Row label="Size">
              <Segmented
                value={pick("fontSize", textSource)}
                onChange={(v) => setStyle({ fontSize: v })}
                options={Object.entries(FONT_SIZES).map(([k, v]) => ({ value: v, label: `${v}px`, content: <span>{k}</span> }))}
              />
            </Row>
            {!labels.length && (
              <Row label="Align">
                <Segmented
                  value={pick("textAlign", textSource)}
                  onChange={(v) => setStyle({ textAlign: v })}
                  options={([["left", TextAlignStart], ["center", TextAlignCenter], ["right", TextAlignEnd]] as const).map(([a, Icon]) => ({
                    value: a,
                    label: a[0].toUpperCase() + a.slice(1),
                    content: <Icon className="size-3.5" />,
                  }))}
                />
              </Row>
            )}
          </Group_>
        )}

        {has("image") && !strokes && !textual && (
          <Group_ title="Image">
            <Row label="Opacity">
              <div className="flex items-center gap-2.5">
                <Slider value={[pick("opacity")]} min={0} max={100} step={5} onValueChange={(v) => setStyle({ opacity: Array.isArray(v) ? v[0] : v })} className="flex-1" />
                <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{pick("opacity")}%</span>
              </div>
            </Row>
          </Group_>
        )}

        {selected.length > 0 && !editing && (
          <Group_ title="Arrange">
            <div className="flex flex-wrap items-center gap-0.5">
              <IconAction label="Send to back (⇧⌘[)" onClick={() => s.reorder("back")}><SendToBack className="size-4" /></IconAction>
              <IconAction label="Send backward (⌘[)" onClick={() => s.reorder("backward")}><ChevronsDown className="size-4" /></IconAction>
              <IconAction label="Bring forward (⌘])" onClick={() => s.reorder("forward")}><ChevronsUp className="size-4" /></IconAction>
              <IconAction label="Bring to front (⇧⌘])" onClick={() => s.reorder("front")}><BringToFront className="size-4" /></IconAction>
              {selected.length > 1 && <IconAction label="Group (⌘G)" onClick={s.group}><Group className="size-4" /></IconAction>}
              {grouped && <IconAction label="Ungroup (⇧⌘G)" onClick={s.ungroup}><Ungroup className="size-4" /></IconAction>}
            </div>
            {selected.length > 1 && (
              <div className="grid grid-cols-8 gap-0.5">
                <IconAction label="Align left" onClick={() => s.align("left")}><AlignStartVertical className="size-4" /></IconAction>
                <IconAction label="Align centers horizontally" onClick={() => s.align("hcenter")}><AlignCenterVertical className="size-4" /></IconAction>
                <IconAction label="Align right" onClick={() => s.align("right")}><AlignEndVertical className="size-4" /></IconAction>
                <IconAction label="Align top" onClick={() => s.align("top")}><AlignStartHorizontal className="size-4" /></IconAction>
                <IconAction label="Align centers vertically" onClick={() => s.align("vcenter")}><AlignCenterHorizontal className="size-4" /></IconAction>
                <IconAction label="Align bottom" onClick={() => s.align("bottom")}><AlignEndHorizontal className="size-4" /></IconAction>
                <IconAction label="Space evenly horizontally" onClick={() => s.distribute("horizontal")}><AlignHorizontalDistributeCenter className="size-4" /></IconAction>
                <IconAction label="Space evenly vertically" onClick={() => s.distribute("vertical")}><AlignVerticalDistributeCenter className="size-4" /></IconAction>
              </div>
            )}
          </Group_>
        )}
      </div>
    </Panel>
  );
}
