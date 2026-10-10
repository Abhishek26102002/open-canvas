-- OpenCanvas live collaboration schema.
-- Run this once in your Supabase project (SQL editor, or `supabase db push` as a migration).
--
-- Access model: anyone who knows a workspace id can open and edit it, like a
-- share link. The tables have RLS enabled with no policies, so they can't be
-- listed or queried directly; the functions below only work on an id you
-- already have.

create table if not exists public.workspaces (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{10,64}$'),
  name text not null default 'Untitled canvas',
  elements jsonb not null default '[]'::jsonb,
  background text not null default '#ffffff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_files (
  workspace_id text not null references public.workspaces (id) on delete cascade,
  file_id text not null,
  mime_type text not null,
  data_url text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, file_id)
);

alter table public.workspaces enable row level security;
alter table public.workspace_files enable row level security;

create or replace function public.get_workspace(p_id text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('id', id, 'name', name, 'elements', elements, 'background', background, 'updated_at', updated_at)
  from workspaces
  where id = p_id;
$$;

create or replace function public.save_workspace(p_id text, p_name text, p_elements jsonb, p_background text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into workspaces (id, name, elements, background, updated_at)
  values (p_id, left(p_name, 200), p_elements, left(p_background, 32), now())
  on conflict (id) do update
    set name = excluded.name,
        elements = excluded.elements,
        background = excluded.background,
        updated_at = now();
$$;

create or replace function public.put_workspace_file(p_workspace text, p_file text, p_mime text, p_data text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into workspace_files (workspace_id, file_id, mime_type, data_url)
  values (p_workspace, p_file, p_mime, p_data)
  on conflict (workspace_id, file_id) do nothing;
$$;

create or replace function public.get_workspace_files(p_workspace text, p_ids text[])
returns table (file_id text, mime_type text, data_url text)
language sql
stable
security definer
set search_path = public
as $$
  select f.file_id, f.mime_type, f.data_url
  from workspace_files f
  where f.workspace_id = p_workspace and f.file_id = any (p_ids);
$$;

grant execute on function public.get_workspace(text) to anon, authenticated;
grant execute on function public.save_workspace(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.put_workspace_file(text, text, text, text) to anon, authenticated;
grant execute on function public.get_workspace_files(text, text[]) to anon, authenticated;
