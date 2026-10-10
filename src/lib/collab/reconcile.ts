import type { SceneElement } from "../scene/types";

/**
 * One element change on the wire. `el: null` is a deletion (tombstone).
 * `v` is the element's shared version and `n` a random tie-breaker for two
 * peers that changed the same element from the same version.
 */
export interface WireChange {
  id: string;
  el: SceneElement | null;
  v: number;
  n: number;
}

export interface ElementsMessage {
  changes: WireChange[];
  /** Sender's z-order. */
  order: string[];
}

interface Entry {
  /** The object last sent or received; identity tells us if it changed since. */
  el: SceneElement | null;
  v: number;
  n: number;
}

const nonce = () => Math.floor(Math.random() * 2 ** 31);
/** Copies loaded from storage lose every tie against a live edit. */
const STORED = 2 ** 31;

/** Remote wins on a higher version, or the lower nonce on a tie. */
const remoteWins = (local: Entry | undefined, c: WireChange) => !local || c.v > local.v || (c.v === local.v && c.n < local.n);

/**
 * Element-level last-writer-wins sync. Local element versions are only
 * hints: undo can bring back an object with an older version, so outgoing
 * versions are always bumped past what peers have already seen.
 */
export class SyncEngine {
  private shadow = new Map<string, Entry>();
  private lastOrder: string[] = [];

  /** Starts from a scene everyone already agrees on (e.g. loaded from the database). */
  init(elements: SceneElement[]) {
    this.shadow.clear();
    for (const el of elements) this.shadow.set(el.id, { el, v: el.version, n: STORED });
    this.lastOrder = elements.map((e) => e.id);
  }

  /** Collects local changes since the last call. Returns null when there's nothing to send. */
  diff(elements: SceneElement[]): ElementsMessage | null {
    const changes: WireChange[] = [];
    const seen = new Set<string>();
    for (const el of elements) {
      seen.add(el.id);
      const prev = this.shadow.get(el.id);
      if (prev && prev.el === el) continue;
      const v = Math.max(el.version, (prev?.v ?? 0) + 1);
      const n = nonce();
      this.shadow.set(el.id, { el, v, n });
      changes.push({ id: el.id, el: v === el.version ? el : { ...el, version: v }, v, n });
    }
    for (const [id, prev] of this.shadow) {
      if (!prev.el || seen.has(id)) continue;
      const v = prev.v + 1;
      const n = nonce();
      this.shadow.set(id, { el: null, v, n });
      changes.push({ id, el: null, v, n });
    }
    const order = elements.map((e) => e.id);
    const orderChanged = order.length !== this.lastOrder.length || order.some((id, i) => id !== this.lastOrder[i]);
    this.lastOrder = order;
    if (!changes.length && !orderChanged) return null;
    return { changes, order };
  }

  /** Everything we know, including deletions, for a peer that just joined. */
  snapshot(elements: SceneElement[]): ElementsMessage {
    this.diff(elements);
    const changes: WireChange[] = [];
    for (const [id, e] of this.shadow) changes.push({ id, el: e.el && e.el.version !== e.v ? { ...e.el, version: e.v } : e.el, v: e.v, n: e.n });
    return { changes, order: elements.map((e) => e.id) };
  }

  /**
   * Accepts the remote changes that win against ours and returns a function
   * that merges them into any element list (the live scene or a history entry).
   */
  receive(msg: ElementsMessage) {
    const upserts = new Map<string, SceneElement>();
    const removes = new Set<string>();
    const added = new Set<string>();
    for (const c of msg.changes) {
      const local = this.shadow.get(c.id);
      if (!remoteWins(local, c)) continue;
      if (c.el && !local?.el) added.add(c.id);
      this.shadow.set(c.id, { el: c.el, v: c.v, n: c.n });
      if (c.el) upserts.set(c.id, c.el);
      else removes.add(c.id);
    }
    const changed = upserts.size > 0 || removes.size > 0 || !sameRelativeOrder(this.lastOrder, msg.order);
    const merge = (elements: SceneElement[], applyOrder: boolean) =>
      mergeElements(elements, upserts, removes, added, applyOrder ? msg.order : null);
    return { changed, upserts, removes, merge };
  }

  /**
   * After remote changes are applied, the scene may re-derive some elements
   * (bound arrows, label layout). Those are adopted as-is rather than sent
   * back out, which would make peers ping-pong over tiny differences.
   */
  absorb(elements: SceneElement[]) {
    const seen = new Set<string>();
    for (const el of elements) {
      seen.add(el.id);
      const prev = this.shadow.get(el.id);
      if (prev?.el === el) continue;
      this.shadow.set(el.id, prev ? { ...prev, el } : { el, v: el.version, n: STORED });
    }
    for (const [id, prev] of this.shadow) if (prev.el && !seen.has(id)) this.shadow.set(id, { ...prev, el: null });
    this.lastOrder = elements.map((e) => e.id);
  }

  /** Shared version of an element (what the database should store). */
  versionOf(el: SceneElement) {
    return this.shadow.get(el.id)?.v ?? el.version;
  }
}

/** Whether the ids both lists share appear in the same sequence. */
const sameRelativeOrder = (a: string[], b: string[]) => {
  const inB = new Set(b);
  const common = a.filter((id) => inB.has(id));
  const inA = new Set(common);
  let i = 0;
  for (const id of b) if (inA.has(id) && common[i++] !== id) return false;
  return true;
};

/**
 * Applies upserts/removals to a list. New elements are added at the end; when
 * a remote order is given, elements both sides know are rearranged into it
 * while local-only elements keep their slots.
 */
export const mergeElements = (
  elements: SceneElement[],
  upserts: Map<string, SceneElement>,
  removes: Set<string>,
  added: Set<string>,
  order: string[] | null,
) => {
  const present = new Set<string>();
  const list: SceneElement[] = [];
  for (const el of elements) {
    if (removes.has(el.id)) continue;
    present.add(el.id);
    list.push(upserts.get(el.id) ?? el);
  }
  for (const [id, el] of upserts) {
    // History entries only gain elements that are brand new to us.
    if (!present.has(id) && (order || added.has(id))) list.push(el);
  }
  if (!order) return list;
  const idx = new Map(order.map((id, i) => [id, i]));
  const known = list.filter((e) => idx.has(e.id)).sort((a, b) => idx.get(a.id)! - idx.get(b.id)!);
  let k = 0;
  return list.map((e) => (idx.has(e.id) ? known[k++] : e));
};
