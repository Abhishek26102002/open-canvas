"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BinaryFile, SceneElement } from "../scene/types";

// Read literally so Next.js can inline them into the client bundle.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const collabConfigured = Boolean(SUPABASE_URL && KEY);

let client: SupabaseClient | null = null;
export const getSupabase = () => {
  if (!collabConfigured) return null;
  client ??= createClient(SUPABASE_URL!, KEY!, { auth: { persistSession: false } });
  return client;
};

export const workspaceUrl = (id: string) => `${window.location.origin}/workspace/${id}`;

export interface WorkspaceRecord {
  id: string;
  name: string;
  elements: SceneElement[];
  background: string;
}

const db = () => {
  const sb = getSupabase();
  if (!sb) throw new Error("Live collaboration isn't configured");
  return sb;
};

export const fetchWorkspace = async (id: string) => {
  const { data, error } = await db().rpc("get_workspace", { p_id: id });
  if (error) throw error;
  return (data ?? null) as WorkspaceRecord | null;
};

export const saveWorkspace = async (w: WorkspaceRecord) => {
  const { error } = await db().rpc("save_workspace", {
    p_id: w.id,
    p_name: w.name,
    p_elements: w.elements,
    p_background: w.background,
  });
  if (error) throw error;
};

export const uploadFile = async (workspaceId: string, file: BinaryFile) => {
  const { error } = await db().rpc("put_workspace_file", {
    p_workspace: workspaceId,
    p_file: file.id,
    p_mime: file.mimeType,
    p_data: file.dataURL,
  });
  if (error) throw error;
};

export const fetchFiles = async (workspaceId: string, ids: string[]): Promise<BinaryFile[]> => {
  if (!ids.length) return [];
  const { data, error } = await db().rpc("get_workspace_files", { p_workspace: workspaceId, p_ids: ids });
  if (error) throw error;
  return ((data ?? []) as { file_id: string; mime_type: string; data_url: string }[]).map((f) => ({
    id: f.file_id,
    mimeType: f.mime_type,
    dataURL: f.data_url,
  }));
};
