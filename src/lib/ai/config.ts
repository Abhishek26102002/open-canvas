/** Shared between the browser and the /api/ai/diagram route. */

export type ProviderId = "free" | "openrouter" | "openai" | "anthropic";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Model used when the user hasn't typed one. */
  defaultModel: string;
  /** Free tier runs on the server's key; the rest need the user's own key. */
  needsKey: boolean;
  keyHint?: string;
  keyUrl?: string;
}

export interface FreeModel {
  id: string;
  label: string;
  /** Accepts image input. */
  vision: boolean;
}

/**
 * Free OpenRouter models served with the app's own key. The server only runs
 * models on this list, so the key can't be spent on paid ones.
 */
export const FREE_MODELS: FreeModel[] = [
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra", vision: false },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", label: "Nemotron 3 Nano Omni", vision: true },
  { id: "dots-studio/dots-3-note-preview:free", label: "Dots3 Note", vision: true },
  { id: "openrouter/free", label: "Auto (any free model)", vision: true },
  { id: "apodex/apodex-1.1-mini:free", label: "Apodex 1.1 Mini", vision: false },
  { id: "cohere/north-mini-code:free", label: "Cohere North Mini", vision: false },
  { id: "liquid/lfm-2.5-2.6b:free", label: "Liquid LFM 2.5", vision: false },
];

export const FREE_TEXT_MODEL = FREE_MODELS[0].id;
/** Text-only free models hand images to this one. */
export const FREE_VISION_MODEL = FREE_MODELS[1].id;

/** The free model that will actually run, given whether an image is attached. */
export const resolveFreeModel = (requested: string | undefined, hasImage: boolean) => {
  const model = FREE_MODELS.find((m) => m.id === requested) ?? FREE_MODELS[0];
  return hasImage && !model.vision ? FREE_VISION_MODEL : model.id;
};

export const PROVIDERS: ProviderInfo[] = [
  { id: "free", label: "Free models", defaultModel: FREE_TEXT_MODEL, needsKey: false },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "anthropic/claude-sonnet-5.5",
    needsKey: true,
    keyHint: "sk-or-…",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    defaultModel: "gpt-6.1-sol",
    needsKey: true,
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    defaultModel: "claude-opus-5-5",
    needsKey: true,
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
];

export const getProvider = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

export interface DiagramRequest {
  provider: ProviderId;
  model?: string;
  apiKey?: string;
  prompt: string;
  /** Data URL of a reference image to recreate. */
  image?: string;
}

export const MAX_PROMPT_LENGTH = 4000;
/** Data URLs over this are rejected; the client downsizes images well below it. */
export const MAX_IMAGE_LENGTH = 3_500_000;

// ---------------------------------------------------------------------------
// The diagram format the model returns. Kept small so weaker models get it right.

export type NodeShape = "rectangle" | "ellipse" | "diamond" | "text";
export type NodeColor = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";

export interface DiagramNode {
  id: string;
  label: string;
  shape?: NodeShape;
  color?: NodeColor;
  /** Optional layout box in a 1000-unit-wide space (image mode). */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  /** "none" draws a plain line, "both" puts heads on both ends. */
  arrow?: "end" | "both" | "none";
}

export interface DiagramSpec {
  title?: string;
  direction?: "TB" | "LR";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
