// The host LLM relay's authority (LLM_AND_AGENTS_SPEC §2.2.1 E8).
//
// A `backend-proxied` provider's request goes from the browser to the backend's
// `/net-fetch-stream`, which forwards it upstream with the user's own key. That route
// refuses any destination the user has not granted to the calling app — the right rule for
// an app's `net:fetch`, and one the host's own `llm.chat` path can never meet, because no app
// holds a grant for a provider the host chose. So host LLM traffic needs a second, narrower
// authority, and this list is it: a request whose URL is exactly one of these endpoints may
// be relayed without a per-app grant. Every other destination still needs one.
//
// Two enforcement points read it — the backend relay, and site-main's catalogue test, which
// fails when a `backend-proxied` row has no endpoint here — so it lives in this package for
// the reason the telemetry registry does: two copies drift.

export interface LlmRelayEndpoint {
  /** The site-main catalogue row this endpoint serves. */
  providerId: string;
  /** A bare https origin. */
  origin: string;
  /** The exact request path. Matching is exact, never by prefix. */
  path: string;
  /** The row's NON-CHAT paths (LLM_AND_AGENTS_SPEC §4.4; embeddings first — e.g.
   *  `/v1/embeddings`), vetted exactly like `path`. Absent on a chat-only row. */
  paths?: readonly string[];
}

export const LLM_RELAY_ENDPOINTS: readonly LlmRelayEndpoint[] = [
  {
    providerId: "llm.chat.openai",
    origin: "https://api.openai.com",
    path: "/v1/chat/completions",
    // The first non-chat path (R3-1127): OpenAI's documented embeddings endpoint.
    paths: ["/v1/embeddings"],
  },
  {
    providerId: "llm.chat.opencode-go",
    origin: "https://opencode.ai",
    path: "/zen/go/v1/chat/completions",
  },
  {
    providerId: "llm.chat.opencode-zen",
    origin: "https://opencode.ai",
    path: "/zen/v1/chat/completions",
  },
  {
    providerId: "llm.chat.zai-coding",
    origin: "https://api.z.ai",
    path: "/api/coding/paas/v4/chat/completions",
  },
  // The probed-proxied batch (providerCors.json 2026-10-11): cerebras answers the
  // preflight but strips ACAO from the error reply; moonshotai/baseten/ollama-cloud answer
  // no ACAO at all; minimax's preflight refuses the anthropic auth headers.
  {
    providerId: "llm.chat.cerebras",
    origin: "https://api.cerebras.ai",
    path: "/v1/chat/completions",
  },
  {
    providerId: "llm.chat.moonshotai",
    origin: "https://api.moonshot.ai",
    path: "/v1/chat/completions",
  },
  {
    providerId: "llm.chat.baseten",
    origin: "https://inference.baseten.co",
    path: "/v1/chat/completions",
  },
  {
    providerId: "llm.chat.ollama-cloud",
    origin: "https://ollama.com",
    path: "/v1/chat/completions",
    // Ollama's OpenAI-compatible embeddings endpoint (documented; the site-main overlay
    // offers nomic-embed-text on this row — without this path every call would be
    // relay-refused AFTER consent).
    paths: ["/v1/embeddings"],
    // Ollama's OpenAI-compatible embeddings endpoint (documented; the site-main overlay
    // offers nomic-embed-text on this row — without this path every call would be
    // relay-refused AFTER consent).
    paths: ["/v1/embeddings"],
  },
  {
    providerId: "llm.chat.minimax",
    origin: "https://api.minimax.io",
    path: "/anthropic/v1/messages",
  },
];

/** Every vetted path — chat completions and the non-chat kinds (§4.4) alike — is a POST
 *  JSON call, so the relay carries exactly one method for them. */
export const LLM_RELAY_METHOD = "POST";

/**
 * The vetted endpoint `url` names, or `null`.
 *
 * The whole normalized URL must equal the row's: OpenCode Go and Zen share an origin and differ
 * only by path, so a prefix or origin match would admit more than any row names. Comparing the
 * full `href` also refuses userinfo, a query and a fragment — even an empty `?` or `#`, which
 * the `search` and `hash` fields report as "" — since none is part of a vetted call.
 */
export function llmRelayEndpointFor(
  url: string,
  method: string,
): LlmRelayEndpoint | null {
  if (method.toUpperCase() !== LLM_RELAY_METHOD) return null;
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    return null;
  }
  return (
    LLM_RELAY_ENDPOINTS.find(
      (e) =>
        href === `${e.origin}${e.path}` ||
        (e.paths ?? []).some((p) => href === `${e.origin}${p}`),
    ) ?? null
  );
}
