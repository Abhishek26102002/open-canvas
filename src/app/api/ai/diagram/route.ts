import { MAX_IMAGE_LENGTH, MAX_PROMPT_LENGTH, PROVIDERS, type DiagramRequest } from "@/lib/ai/config";
import { AiError, generateDiagramText, parseDiagram } from "@/lib/ai/server";

// Reasoning models can take a while on a large diagram.
export const maxDuration = 120;

const fail = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let body: Partial<DiagramRequest>;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }

  const provider = PROVIDERS.find((p) => p.id === body.provider);
  if (!provider) return fail("Unknown AI provider.", 400);
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const image = typeof body.image === "string" ? body.image : undefined;
  if (!prompt.trim() && !image) return fail("Describe a diagram or attach an image.", 400);
  if (prompt.length > MAX_PROMPT_LENGTH) return fail("That prompt is too long.", 400);
  if (image && (image.length > MAX_IMAGE_LENGTH || !image.startsWith("data:image/"))) return fail("That image is too large or not an image.", 400);
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (provider.needsKey && !apiKey) return fail(`Add your ${provider.label} API key in AI settings.`, 400);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : provider.defaultModel;

  try {
    const { text, model: used } = await generateDiagramText({ provider: provider.id, model, apiKey, prompt, image });
    return Response.json({ diagram: parseDiagram(text), model: used });
  } catch (e) {
    if (e instanceof AiError) return fail(e.message, e.status);
    if (e instanceof DOMException && e.name === "TimeoutError") return fail("The model took too long to answer. Try a smaller diagram.", 504);
    console.error("[ai/diagram]", e instanceof Error ? e.message : e);
    return fail("Something went wrong generating the diagram.", 500);
  }
}
