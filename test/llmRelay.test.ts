import {
  LLM_RELAY_ENDPOINTS,
  LLM_RELAY_METHOD,
  llmRelayEndpointFor,
} from "../src/index";

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
  // Every admitted URL of a row — the chat path and each non-chat path (§4.4).
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

  it.each(urlRows)("refuses anything wider than %s's own URL", (_id, e, p) => {
    const host = new URL(e.origin).host;
    const parent = p.slice(0, p.lastIndexOf("/"));
    for (const url of [
      `${e.origin}${p}?stream=true`,
      `${e.origin}${p}#x`,
      // An empty query or fragment still changes the URL; `search` and `hash` read "" for both.
      `${e.origin}${p}?`,
      `${e.origin}${p}#`,
      // Each half of userinfo on its own, so neither refusal rides on the other.
      `https://user@${host}${p}`,
      `https://:pass@${host}${p}`,
      `https://user:pass@${host}${p}`,
      `http://${host}${p}`,
      `${e.origin}${p}/more`,
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

  it("admits a row's non-chat paths exactly, and nothing wider", () => {
    const openai = LLM_RELAY_ENDPOINTS.find((e) => e.providerId === "llm.chat.openai")!;
    expect(openai.paths).toContain("/v1/embeddings");
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings", "POST")).toBe(openai);
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings?x", "POST")).toBeNull();
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings/extra", "POST")).toBeNull();
    expect(llmRelayEndpointFor("https://api.openai.com/v1/embeddings", "GET")).toBeNull();
  });
});
