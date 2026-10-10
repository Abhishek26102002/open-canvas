import { customAlphabet } from "nanoid";

/** 20 letters/digits, e.g. "UsLe5aDeUBWRq9W8mjA2". */
export const newWorkspaceId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 20);

export const WORKSPACE_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;

/** Accepts a bare code or a pasted link and returns the workspace id. */
export const parseWorkspaceInput = (input: string) => {
  const text = input.trim();
  const fromUrl = text.match(/workspace\/([A-Za-z0-9_-]+)/)?.[1];
  const id = fromUrl ?? text;
  return WORKSPACE_ID_RE.test(id) ? id : null;
};
