# OpenCanvas

A hand-drawn style infinite whiteboard (open-source whiteboard), built with Next.js 16, shadcn/ui (Base UI), Tailwind v4, lucide-react, rough.js and perfect-freehand.

```bash
npm install
npm run dev   # http://localhost:3000
```

## Live collaboration

Click **Share** to turn your canvas into a shared workspace at `/workspace/<code>`. Send the link or just the code; anyone who opens it edits the same canvas live and sees everyone's cursors and selections.

It runs on Supabase (Realtime broadcast/presence plus two tables). To enable it:

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon (publishable) key.
4. Restart `npm run dev`.

Without these variables everything else works; the Share dialog shows these steps instead.

## Structure

| Path | What it does |
| --- | --- |
| `src/lib/scene/types.ts` | Element model (shapes, arrows/lines, freedraw, text, image) |
| `src/lib/scene/elements.ts` | Element factories, arrow bindings, bound labels, `normalizeScene` |
| `src/lib/scene/shapes.ts` | rough.js / perfect-freehand drawables (cached per element object) |
| `src/lib/scene/icons.ts` | Converts Lucide icon data into vector paths for icon elements |
| `src/lib/collab/reconcile.ts` | Sync engine: per-element versions, tombstones, z-order merge |
| `src/lib/collab/session.ts` | Supabase channel, presence, cursors, saving the shared workspace |
| `src/lib/scene/render.ts` | Canvas renderer: scene, grid, selection, handles, laser |
| `src/lib/scene/hittest.ts` | Hit testing and transform handles |
| `src/lib/scene/export.ts` | `.opencanvas` JSON, PNG, SVG, clipboard export |
| `src/lib/scene/storage.ts` | localStorage autosave + IndexedDB for images |
| `src/lib/store.ts` | Zustand editor store: elements, selection, history, viewport, actions |
| `src/components/editor/canvas.tsx` | Pointer interactions (draw, select, move, resize, rotate, bind, erase, pan) |
| `src/components/editor/*` | Toolbar, properties panel, menu, dialogs, text editor, shortcuts |

Elements are immutable: every change creates a new object (`update()` bumps `version`), which keeps undo/redo cheap and lets render caches key on object identity.

## Roadmap

- Phase 2: Supabase auth + cloud-saved drawings, shareable links, realtime collaboration (presence cursors)
- Frames, shape library, elbow arrows, mermaid/AI diagram generation, embeds
