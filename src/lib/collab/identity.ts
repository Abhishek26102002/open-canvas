"use client";

import { nanoid } from "nanoid";

const KEY = "opencanvas:user";

export const PEER_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

const ADJECTIVES = ["Swift", "Quiet", "Bright", "Clever", "Brave", "Calm", "Lucky", "Sunny", "Bold", "Witty"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Fox", "Koala", "Heron", "Lynx", "Orca", "Badger", "Gecko"];

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export interface Identity {
  name: string;
  color: string;
}

export const loadIdentity = (): Identity => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved?.name && saved?.color) return saved;
  } catch {}
  const identity = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PEER_COLORS) };
  saveIdentity(identity);
  return identity;
};

export const saveIdentity = (identity: Identity) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {}
};

/** Per tab, so the same person in two tabs shows up as two cursors. */
export const sessionUserId = nanoid(10);
