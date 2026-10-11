import {
  LLM_RELAY_ENDPOINTS,
  LLM_RELAY_METHOD,
  llmRelayEndpointFor,
} from "../src/index";

const rows = LLM_RELAY_ENDPOINTS.map((e) => [e.providerId, e] as const);

describe("the vetted endpoint list", () => {
  it("names each admitted URL once (chat path AND non-chat paths), each origin a bare https origin", () => {
    const admitted = LLM_RELAY_ENDPOINTS.flatMap((e) => [e.path, ...(e.paths ?? [])].map((p) => `${e.origin}${p}`));
    expect(new Set(admitted).size).toBe(admitted.length);
    for (const e of LLM_RELAY_ENDPOINTS) {
      expect(new URL(e.origin).origin).toBe(e.origin);
      expect(e.origin.startsWith("https://")).toBe(true);
      for (const p of [e.path, ...(e.paths ?? [])]) expect(p.startsWith("/")).toBe(true);
    }
  });
});

describe("llmRelayEndpointFor", () => {
  // Every admitted URL of a row — the chat path AND each non-chat path (R3-1127).
  const urlRows = LLM_RELAY_ENDPOINTS.flatMap((e) =>
    [e.path, ...(e.paths ?? [])].map((p) => [`${e.providerId} ${p}`, e, p] as const),
  );

  it.each(urlRows)("admits %s at its exact URL by POST, in any case", (_id, e, p) => {
    expect(llmRelayEndpointFor(`${e.origin}${p}`, LLM_RELAY_METHOD)).toBe(e);
    expect(llmRelayEndpointFor(`${e.origin}${p}`, "post")).toBe(e);
  });

  it.each(urlRows)("refuses %s by any other method", (_id, e, p) => {
    expect(llmRelayEndpointFor(`${e.origin}${p}`, "GET")).toBeNull();
    expect(llmRelayEndpointFor(`${e.origin}${p}`, "PUT")).toBeNull();
  });

  it.each(rows)("refuses anything wider than %s's own URL", (_id, e) => {
    const host = new URL(e.origin).host;
    const parent = e.path.slice(0, e.path.lastIndexOf("/"));
    for (const url of [
      `${e.origin}${e.path}?stream=true`,
      `${e.origin}${e.path}#x`,
      // An empty query or fragment still changes the URL; `search` and `hash` read "" for both.
      `${e.origin}${e.path}?`,
      `${e.origin}${e.path}#`,
      // Each half of userinfo on its own, so neither refusal rides on the other.
      `https://user@${host}${e.path}`,
      `https://:pass@${host}${e.path}`,
      `https://user:pass@${host}${e.path}`,
      `http://${host}${e.path}`,
      `${e.origin}${e.path}/more`,
      `${e.origin}${parent}`,
      `https://example.com${e.path}`,
    ]) {
      expect(llmRelayEndpointFor(url, LLM_RELAY_METHOD)).toBeNull();
    }
  });

  it("tells two products on one origin apart by path", () => {
    const go = LLM_RELAY_ENDPOINTS.find(
      (e) => e.providerId === "llm.chat.opencode-go",
    )!;
    const zen = LLM_RELAY_ENDPOINTS.find(
      (e) => e.providerId === "llm.chat.opencode-zen",
    )!;
    expect(go.origin).toBe(zen.origin);
    expect(llmRelayEndpointFor(`${go.origin}${go.path}`, "POST")).toBe(go);
    expect(llmRelayEndpointFor(`${zen.origin}${zen.path}`, "POST")).toBe(zen);
  });

  it("refuses a string that is not a URL", () => {
    expect(llmRelayEndpointFor("not a url", "POST")).toBeNull();
  });

  it("admits a row's non-chat paths exactly, and nothing wider (R3-1127)", () => {
    const openai = LLM_RELAY_ENDPOINTS.find((e) => e.providerId === "llm.chat.openai")!;
    expect(openai.paths).toContain("/v1/embeddings");
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings", "POST")).toBe(openai);
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings?x", "POST")).toBeNull();
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings/extra", "POST")).toBeNull();
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings", "GET")).toBeNull();
  });
});
