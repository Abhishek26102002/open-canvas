import { PROVIDERS } from "@/lib/ai/config";
import { AiError, listModels } from "@/lib/ai/server";

const fail = (message: string, status: number) => Response.json({ error: message }, { status });

/** Lists the models a user's key can use. POST so the key travels in the body, not the URL. */
export async function POST(request: Request) {
  let body: { provider?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }
  const provider = PROVIDERS.find((p) => p.id === body.provider);
  if (!provider) return fail("Unknown AI provider.", 400);
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (provider.needsKey && !apiKey) return fail(`Add your ${provider.label} API key first.`, 400);

  try {
    return Response.json({ models: await listModels(provider.id, apiKey) });
  } catch (e) {
    if (e instanceof AiError) return fail(e.message, e.status);
    if (e instanceof DOMException && e.name === "TimeoutError") return fail("The provider took too long to answer.", 504);
    console.error("[ai/models]", e instanceof Error ? e.message : e);
    return fail("Couldn't load the model list.", 500);
  }
}
