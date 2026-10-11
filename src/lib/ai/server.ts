import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  resolveFreeModel,
  type DiagramEdge,
  type DiagramNode,
  type DiagramRequest,
  type DiagramSpec,
  type ModelOption,
  type ProviderId,
  type NodeColor,
  type NodeShape,
} from "./config";

export class AiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You turn requests into diagrams for a whiteboard app. Reply with one JSON object and nothing else - no prose, no code fences.

Format:
{
  "title": "short title",
  "direction": "TB" | "LR",
  "nodes": [{ "id": "n1", "label": "text shown", "shape": "rectangle" | "ellipse" | "diamond" | "text", "color": "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" }],
  "edges": [{ "from": "n1", "to": "n2", "label": "optional", "dashed": false, "arrow": "end" | "both" | "none" }]
}

Rules:
- Every edge's "from" and "to" must be node ids.
- Keep labels short (under 6 words). Use "\\n" for a line break.
- Shapes: ellipse for start/end, diamond for decisions, rectangle for steps and components, "text" for a free-floating caption.
- Use color to group related nodes; keep it to 2-4 colors.
- "direction": "TB" for flows and hierarchies, "LR" for pipelines and timelines.
- Up to 40 nodes. Prefer clarity over completeness.`;

const IMAGE_RULES = `
The user attached an image. Recreate the diagram in it as faithfully as you can:
- Read every box, label and connector; keep the original wording.
- Match shapes and colors to what you see.
- Add "x", "y", "w", "h" to every node: its box in the image, scaled so the image is 1000 units wide (y grows downward, same scale).
- If the image is a photo or sketch rather than a diagram, draw a clean diagram of its structure instead.`;

const buildUserText = (req: DiagramRequest) => req.prompt.trim() || "Recreate this diagram.";

/** Splits a data URL into its MIME type and base64 payload. */
const parseDataUrl = (url: string) => {
  const m = url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new AiError("Unsupported image. Use PNG, JPEG, GIF or WebP.", 400);
  return { mediaType: m[1] as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: m[2] };
};

// ---------------------------------------------------------------------------
// Providers

/** OpenRouter, OpenAI and Gemini (via its OpenAI-compatible endpoint) share the chat-completions format. */
async function chatCompletions(url: string, key: string, model: string, req: DiagramRequest, extraHeaders: Record<string, string> = {}, jsonMode = false) {
  const content: unknown[] = [{ type: "text", text: buildUserText(req) }];
  if (req.image) content.push({ type: "image_url", image_url: { url: req.image } });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + (req.image ? IMAGE_RULES : "") },
        { role: "user", content },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(110_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Gemini wraps its error in an array.
    const msg: string = (Array.isArray(body) ? body[0] : body)?.error?.message ?? `Request failed (${res.status})`;
    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) throw new AiError("That API key was rejected.", 401);
    if (res.status === 404 || /not found|does not exist|not supported/i.test(msg)) {
      throw new AiError(`Model "${model}" isn't available for this key. Open the model settings and pick one from "Show available models".`, 400);
    }
    throw new AiError(msg, res.status === 429 ? 429 : 502);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new AiError("The model returned an empty answer. Try again.");
  return text;
}

/** Claude 5-family models that accept server-side refusal fallbacks. */
const supportsFallbacks = (model: string) => /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model);

async function callAnthropic(key: string, model: string, req: DiagramRequest) {
  const client = new Anthropic({ apiKey: key, timeout: 110_000, maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) {
    const { mediaType, data } = parseDataUrl(req.image);
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  }
  content.push({ type: "text", text: buildUserText(req) });
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT + (req.image ? IMAGE_RULES : ""),
      messages: [{ role: "user", content }],
      output_config: { effort: "medium" },
      ...(supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") throw new AiError("Claude declined this request.", 422);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (!text.trim()) throw new AiError("Claude returned an empty answer. Try again.");
    return text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("That Claude API key was rejected.", 401);
    if (e instanceof Anthropic.RateLimitError) throw new AiError("Claude is rate limiting this key. Try again shortly.", 429);
    if (e instanceof Anthropic.NotFoundError) throw new AiError(`Model "${model}" isn't available for this key. Open the model settings and pick one from "Show available models".`, 400);
    if (e instanceof Anthropic.APIError) throw new AiError(e.message, 502);
    throw e;
  }
}

export async function generateDiagramText(req: DiagramRequest): Promise<{ text: string; model: string }> {
  switch (req.provider) {
    case "free": {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new AiError("The free model isn't configured on this server. Add your own API key in AI settings.", 503);
      // The server key only ever runs allow-listed free models, whatever the client asks for.
      const model = resolveFreeModel(req.model, !!req.image);
      return { text: await chatCompletions("https://openrouter.ai/api/v1/chat/completions", key, model, req, openRouterHeaders()), model };
    }
    case "openrouter": {
      const model = req.model!;
      return { text: await chatCompletions("https://openrouter.ai/api/v1/chat/completions", req.apiKey!, model, req, openRouterHeaders()), model };
    }
    case "openai": {
      const model = req.model!;
      return { text: await chatCompletions("https://api.openai.com/v1/chat/completions", req.apiKey!, model, req, {}, true), model };
    }
    case "gemini": {
      const model = req.model!;
      return { text: await chatCompletions("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", req.apiKey!, model, req, {}, true), model };
    }
    case "anthropic": {
      const model = req.model!;
      return { text: await callAnthropic(req.apiKey!, model, req), model };
    }
  }
}

const openRouterHeaders = () => ({
  "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://opencanvas-ochre.vercel.app",
  "X-Title": "OpenCanvas",
});

// ---------------------------------------------------------------------------
// Parsing: models wrap JSON in prose or fences, and get fields slightly wrong.

const SHAPES = new Set<NodeShape>(["rectangle", "ellipse", "diamond", "text"]);
const COLORS = new Set<NodeColor>(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"]);
const COLOR_ALIASES: Record<string, NodeColor> = { grey: "gray", black: "gray", white: "gray", cyan: "teal", violet: "purple", magenta: "pink", amber: "yellow", lime: "green", indigo: "blue" };

/** Pulls the outermost {...} out of a reply, ignoring fences and reasoning text around it. */
const extractJson = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("The model didn't return a diagram. Try rephrasing.");
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    throw new AiError("The model returned malformed JSON. Try again.");
  }
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");

export function parseDiagram(text: string): DiagramSpec {
  const raw = extractJson(text);
  const rawNodes: unknown[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const nodes: DiagramNode[] = [];
  const ids = new Set<string>();
  for (const n of rawNodes.slice(0, 80)) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    const id = str(o.id, 64) || `n${nodes.length + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const shape = str(o.shape).toLowerCase();
    const colorName = str(o.color).toLowerCase();
    const color = (COLORS.has(colorName as NodeColor) ? colorName : COLOR_ALIASES[colorName]) as NodeColor | undefined;
    nodes.push({
      id,
      label: str(o.label ?? o.text ?? o.name).replace(/\\n/g, "\n"),
      shape: SHAPES.has(shape as NodeShape) ? (shape as NodeShape) : shape === "circle" || shape === "oval" ? "ellipse" : "rectangle",
      color,
      x: num(o.x),
      y: num(o.y),
      w: num(o.w ?? o.width),
      h: num(o.h ?? o.height),
    });
  }
  if (!nodes.length) throw new AiError("The model returned an empty diagram. Try describing it in more detail.");

  const rawEdges: unknown[] = Array.isArray(raw?.edges) ? raw.edges : [];
  const edges: DiagramEdge[] = [];
  for (const e of rawEdges.slice(0, 160)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const from = str(o.from ?? o.source, 64);
    const to = str(o.to ?? o.target, 64);
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const arrow = o.arrow === "both" || o.arrow === "none" ? o.arrow : "end";
    edges.push({ from, to, label: str(o.label, 80) || undefined, dashed: o.dashed === true, arrow });
  }

  return {
    title: str(raw?.title, 120) || undefined,
    direction: raw?.direction === "LR" ? "LR" : "TB",
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Model lists, so users can pick a model their key can actually use.

/** Model families that can't answer a chat prompt with text. */
const NOT_CHAT = /embed|tts|audio|realtime|transcribe|whisper|dall-e|imagen|veo|image|moderation|search|aqa|davinci|babbage|computer-use/i;

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg: string = (Array.isArray(body) ? body[0] : body)?.error?.message ?? `Request failed (${res.status})`;
    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) throw new AiError("That API key was rejected.", 401);
    throw new AiError(msg, 502);
  }
  return body;
}

export async function listModels(provider: ProviderId, apiKey: string): Promise<ModelOption[]> {
  switch (provider) {
    case "free":
      return [];
    case "gemini": {
      const models: ModelOption[] = [];
      let pageToken = "";
      // The key goes in a header, never the URL, so it can't end up in logs.
      for (let page = 0; page < 5; page++) {
        const body = await getJson(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
          { "x-goog-api-key": apiKey },
        );
        for (const m of body?.models ?? []) {
          if (!m?.supportedGenerationMethods?.includes("generateContent")) continue;
          const id = String(m.name).replace(/^models\//, "");
          if (!NOT_CHAT.test(id)) models.push({ id, label: m.displayName });
        }
        pageToken = body?.nextPageToken ?? "";
        if (!pageToken) break;
      }
      return models;
    }
    case "openai": {
      const body = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
      return (body?.data ?? [])
        .map((m: { id: string; created?: number }) => m)
        .filter((m: { id: string }) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !NOT_CHAT.test(m.id))
        .sort((a: { created?: number }, b: { created?: number }) => (b.created ?? 0) - (a.created ?? 0))
        .map((m: { id: string }) => ({ id: m.id }));
    }
    case "openrouter": {
      const body = await getJson("https://openrouter.ai/api/v1/models", { Authorization: `Bearer ${apiKey}` });
      return (body?.data ?? [])
        .filter((m: { architecture?: { output_modalities?: string[] } }) => m.architecture?.output_modalities?.includes("text") ?? true)
        .map((m: { id: string; name?: string }) => ({ id: m.id, label: m.name }));
    }
    case "anthropic": {
      const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
      try {
        const models: ModelOption[] = [];
        for await (const m of client.models.list({ limit: 100 })) models.push({ id: m.id, label: m.display_name });
        return models;
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError("That API key was rejected.", 401);
        if (e instanceof Anthropic.APIError) throw new AiError(e.message, 502);
        throw e;
      }
    }
  }
}
