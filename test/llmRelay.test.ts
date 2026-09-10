import { LLM_RELAY_ENDPOINTS, LLM_RELAY_METHOD, llmRelayEndpointFor } from "../src/index";

const rows = LLM_RELAY_ENDPOINTS.map((e) => [e.providerId, e] as const);

describe("the vetted endpoint list", () => {
  it("names each (origin, path) once, each origin a bare https origin", () => {
    const pairs = LLM_RELAY_ENDPOINTS.map((e) => `${e.origin}${e.path}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const e of LLM_RELAY_ENDPOINTS) {
      expect(new URL(e.origin).origin).toBe(e.origin);
      expect(e.origin.startsWith("https://")).toBe(true);
      expect(e.path.startsWith("/")).toBe(true);
    }
  });
});

describe("llmRelayEndpointFor", () => {
  it.each(rows)("admits %s at its exact URL by POST, in any case", (_id, e) => {
    expect(llmRelayEndpointFor(`${e.origin}${e.path}`, LLM_RELAY_METHOD)).toBe(e);
    expect(llmRelayEndpointFor(`${e.origin}${e.path}`, "post")).toBe(e);
  });

  it.each(rows)("refuses %s by any other method", (_id, e) => {
    expect(llmRelayEndpointFor(`${e.origin}${e.path}`, "GET")).toBeNull();
    expect(llmRelayEndpointFor(`${e.origin}${e.path}`, "PUT")).toBeNull();
  });

  it.each(rows)("refuses anything wider than %s's own URL", (_id, e) => {
    const host = new URL(e.origin).host;
    const parent = e.path.slice(0, e.path.lastIndexOf("/"));
    for (const url of [
      `${e.origin}${e.path}?stream=true`,
      `${e.origin}${e.path}#x`,
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
    const go = LLM_RELAY_ENDPOINTS.find((e) => e.providerId === "llm.chat.opencode-go")!;
    const zen = LLM_RELAY_ENDPOINTS.find((e) => e.providerId === "llm.chat.opencode-zen")!;
    expect(go.origin).toBe(zen.origin);
    expect(llmRelayEndpointFor(`${go.origin}${go.path}`, "POST")).toBe(go);
    expect(llmRelayEndpointFor(`${zen.origin}${zen.path}`, "POST")).toBe(zen);
  });

  it("refuses a string that is not a URL", () => {
    expect(llmRelayEndpointFor("not a url", "POST")).toBeNull();
  });
});
