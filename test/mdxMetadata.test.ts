import {
  isFrontmatterEnvelope,
  isJsonSerializable,
  MDX_METADATA_SCHEMA_VERSION,
  MDX_METADATA_SIDECAR_PATH,
  parseMdxMetadataSidecar,
  validateMdxMetadataSidecar,
} from "../src/index";

const entry = { srcSha: "a".repeat(40), frontmatter: { title: "Hello" } };
const good = { schemaVersion: 1, files: { "/docs/x.mdx": entry } };

describe("the sidecar path", () => {
  it("lives under the artifacts dir inside the sidecar tree", () => {
    expect(MDX_METADATA_SIDECAR_PATH).toBe(".immediately.run/artifacts/mdx-metadata.json");
  });
});

describe("validateMdxMetadataSidecar — the whole file", () => {
  it("accepts what the CLI emitter writes", () => {
    const result = validateMdxMetadataSidecar(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sidecar.files["/docs/x.mdx"]).toEqual(entry);
    expect(result.rejected).toEqual([]);
  });

  // A wrong version means the reader does not know what it is looking at. Honoring
  // the parts it recognizes is exactly the misreading the version exists to prevent.
  it.each([
    ["a newer schemaVersion", { ...good, schemaVersion: 2 }],
    ["a missing schemaVersion", { files: good.files }],
    ["a stringly-typed schemaVersion", { ...good, schemaVersion: "1" }],
  ])("rejects the whole file: %s", (_label, raw) => {
    expect(validateMdxMetadataSidecar(raw)).toEqual({ ok: false, reason: "schema-version" });
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "not a sidecar"],
    ["a number", 7],
  ])("rejects a non-object file: %s", (_label, raw) => {
    expect(validateMdxMetadataSidecar(raw)).toEqual({ ok: false, reason: "not-an-object" });
  });

  it("rejects a file whose `files` is not an object", () => {
    expect(validateMdxMetadataSidecar({ schemaVersion: 1, files: [] })).toEqual({
      ok: false,
      reason: "files-not-an-object",
    });
    expect(validateMdxMetadataSidecar({ schemaVersion: 1 })).toEqual({
      ok: false,
      reason: "files-not-an-object",
    });
  });
});

describe("validateMdxMetadataSidecar — one bad entry", () => {
  // One malformed entry must not cost the repo its whole cached metadata — but it
  // must be REPORTED, or "the cache seeded nothing" is indistinguishable from
  // "there was nothing to seed".
  const withBad = (bad: unknown) => ({
    schemaVersion: 1,
    files: { "/docs/x.mdx": entry, "/docs/bad.mdx": bad },
  });

  it.each([
    ["not an object", "nope", "entry-not-an-object"],
    ["an array", [], "entry-not-an-object"],
    ["no srcSha", { frontmatter: { a: 1 } }, "entry-src-sha"],
    ["an empty srcSha", { srcSha: "", frontmatter: { a: 1 } }, "entry-src-sha"],
    ["a numeric srcSha", { srcSha: 1, frontmatter: { a: 1 } }, "entry-src-sha"],
    ["null frontmatter", { srcSha: "x", frontmatter: null }, "entry-frontmatter"],
    ["array frontmatter", { srcSha: "x", frontmatter: [] }, "entry-frontmatter"],
    ["empty frontmatter", { srcSha: "x", frontmatter: {} }, "entry-frontmatter-empty"],
  ])("drops and reports an entry that is %s", (_label, bad, reason) => {
    const result = validateMdxMetadataSidecar(withBad(bad));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.sidecar.files)).toEqual(["/docs/x.mdx"]);
    expect(result.rejected).toEqual([{ path: "/docs/bad.mdx", reason }]);
  });
});

describe("parseMdxMetadataSidecar — raw text", () => {
  it("parses and validates in one step", () => {
    const result = parseMdxMetadataSidecar(JSON.stringify(good));
    expect(result.ok).toBe(true);
  });

  it("treats unparseable JSON as an unusable file, not a crash", () => {
    expect(parseMdxMetadataSidecar("{ truncated")).toEqual({
      ok: false,
      reason: "not-an-object",
    });
  });

  it("keeps the schema version it accepts pinned", () => {
    expect(MDX_METADATA_SCHEMA_VERSION).toBe(1);
  });
});

describe("the frontmatter envelope", () => {
  it("accepts a plain object and rejects the non-envelopes", () => {
    expect(isFrontmatterEnvelope({ title: "x" })).toBe(true);
    expect(isFrontmatterEnvelope({})).toBe(true); // shape check, not emptiness
    expect(isFrontmatterEnvelope(null)).toBe(false);
    expect(isFrontmatterEnvelope([])).toBe(false);
    expect(isFrontmatterEnvelope("x")).toBe(false);
  });

  it("accepts JSON-serializable values, including nesting", () => {
    expect(isJsonSerializable({ a: 1, b: "x", c: null, d: [1, { e: true }] })).toBe(true);
  });

  it.each([
    ["a function", { a: () => 1 }],
    ["undefined", { a: undefined }],
    // A Date has no own enumerable values, so a naive "check the values" pass calls
    // it serializable — and JSON silently turns it into a STRING.
    ["a Date", { a: new Date(0) }],
    ["a Map", { a: new Map() }],
    ["a class instance", { a: new (class Thing {})() }],
    ["a symbol", { a: Symbol("x") }],
    ["a bigint", { a: BigInt(1) }],
    // JSON.stringify turns these into `null` — a silent VALUE CHANGE, not an error,
    // which is why the producer-side check has to reject them.
    ["NaN", { a: NaN }],
    ["Infinity", { a: Infinity }],
  ])("rejects %s", (_label, value) => {
    expect(isJsonSerializable(value)).toBe(false);
  });

  it("rejects a cycle instead of blowing the stack", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(isJsonSerializable(cyclic)).toBe(false);
  });

  it("does not confuse a repeated (non-cyclic) reference for a cycle", () => {
    const shared = { a: 1 };
    expect(isJsonSerializable({ x: shared, y: shared })).toBe(true);
  });
});
