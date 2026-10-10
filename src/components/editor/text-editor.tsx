"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { LINE_HEIGHT } from "@/lib/scene/constants";
import { getContainerTextWidth, update } from "@/lib/scene/elements";
import { getCenter } from "@/lib/scene/math";
import { getFontFamily, measureText } from "@/lib/scene/text";
import type { TextElement } from "@/lib/scene/types";
import { isLinear } from "@/lib/scene/types";
import { themeColor } from "@/lib/scene/theme";
import { useEditor } from "@/lib/store";

/** A textarea laid over the canvas while a text element is being edited. */
export function TextEditor() {
  const editingId = useEditor((s) => s.editingTextId);
  const element = useEditor((s) => (s.editingTextId ? (s.elements.find((e) => e.id === s.editingTextId) as TextElement | undefined) : undefined));
  const container = useEditor((s) => (element?.containerId ? s.elements.find((e) => e.id === element.containerId) : undefined));
  const viewport = useEditor((s) => s.viewport);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!editingId) return;
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, [editingId]);

  if (!element) return null;

  const commit = () => {
    const s = useEditor.getState();
    const el = s.elements.find((e) => e.id === element.id) as TextElement | undefined;
    s.setEditingTextId(null);
    if (!el) return;
    if (!el.text.trim()) {
      s.setElements(s.elements.filter((e) => e.id !== el.id));
    } else if (!el.containerId) {
      s.select([el.id]);
    }
    s.commit();
  };

  const onChange = (value: string) => {
    const s = useEditor.getState();
    const el = s.elements.find((e) => e.id === element.id) as TextElement | undefined;
    if (!el) return;
    const size = el.containerId ? {} : measureText(value || " ", el.fontFamily, el.fontSize);
    s.setElements(s.elements.map((e) => (e.id === el.id ? update(el, { text: value, ...size }) : e)));
  };

  const { zoom, scrollX, scrollY } = viewport;
  const ink = themeColor(element.strokeColor, resolvedTheme === "dark" ? "dark" : "light");
  const lineHeight = element.fontSize * LINE_HEIGHT;
  let left: number, top: number, width: number;
  const height = Math.max(element.height, lineHeight);
  if (container) {
    width = isLinear(container) ? Math.max(element.width + element.fontSize, 60) : getContainerTextWidth(container);
    const [cx, cy] = isLinear(container) ? [element.x + element.width / 2, element.y + element.height / 2] : getCenter(container);
    left = cx - width / 2;
    top = cy - height / 2;
  } else {
    width = element.width + element.fontSize;
    left = element.x;
    top = element.y;
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <textarea
        ref={ref}
        value={element.text}
        spellCheck={false}
        wrap={container ? "soft" : "off"}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            ref.current?.blur();
          }
        }}
        className="pointer-events-auto absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
        style={{
          left: (left + scrollX) * zoom,
          top: (top + scrollY) * zoom,
          width: width * zoom,
          height: height * zoom + 2,
          transform: `rotate(${element.angle}rad)`,
          transformOrigin: "center",
          font: `${element.fontSize * zoom}px ${getFontFamily(element.fontFamily)}`,
          lineHeight: LINE_HEIGHT,
          color: ink,
          opacity: element.opacity / 100,
          textAlign: element.textAlign,
          whiteSpace: container ? "pre-wrap" : "pre",
          wordBreak: container ? "break-word" : "normal",
          caretColor: ink,
        }}
      />
    </div>
  );
}
