import {
  APP_ROOT,
  metadataKeyFor,
  stripAppRoot,
  underAppRoot,
} from "../src/index";

// R3-275 — this package now owns `/app` and the two directions across it. The tests
// are written as a REPLICATION of the two implementations being replaced, not as a
// fresh reading of what the helpers "should" do: `sandbox/src/fsLayout.ts` (a
// hand-rolled join) and `sdk/src/urlUtils.ts` (`joinPaths(APP_ROOT, path)`), plus
// the behaviour `sandbox/src/bundler/metadataKey.test.ts` pins. A divergence from
// either one is a failing test here, not a silent choice made in this package.
describe("APP_ROOT — the repo mount point", () => {
  it("is /app", () => {
    expect(APP_ROOT).toBe("/app");
  });
});

describe("underAppRoot — repo-relative → absolute", () => {
  it("accepts a path with no leading slash (manifest entries)", () => {
    expect(underAppRoot("posts/x.mdx")).toBe("/app/posts/x.mdx");
  });

  it("accepts a path with a leading slash (URL subpaths)", () => {
    expect(underAppRoot("/posts/x.mdx")).toBe("/app/posts/x.mdx");
  });

  it("maps the empty path and the root to the same value both old impls produced", () => {
    // sandbox: `''` → `/app` + `/` + `''`; sdk: joinPaths('/app','') → '/app/'.
    expect(underAppRoot("")).toBe("/app/");
    expect(underAppRoot("/")).toBe("/app/");
  });

  it("does NOT detect an already-rooted path — it double-roots, as both impls did", () => {
    // Documented, deliberate: callers pass repo-relative paths. Quietly "fixing"
    // this would hide the caller's bug instead of surfacing it.
    expect(underAppRoot("/app/x")).toBe("/app/app/x");
  });

  it("does not normalize . or .. (no path resolution here)", () => {
    expect(underAppRoot("./x")).toBe("/app/./x");
    expect(underAppRoot("../x")).toBe("/app/../x");
  });
});

describe("stripAppRoot — absolute → repo-relative", () => {
  it("strips the root from a repo path", () => {
    expect(stripAppRoot("/app/posts/x.mdx")).toBe("/posts/x.mdx");
  });

  it("maps the root itself to /", () => {
    expect(stripAppRoot("/app")).toBe("/");
  });

  it("leaves paths outside the repo unchanged (other mounts, node_modules)", () => {
    expect(stripAppRoot("/node_modules/react/index.js")).toBe(
      "/node_modules/react/index.js",
    );
    expect(stripAppRoot("/firestore/notes.md")).toBe("/firestore/notes.md");
  });

  it("does not strip a path that merely shares the prefix characters", () => {
    // `/apple` starts with `/app` as a STRING but is not under the root.
    expect(stripAppRoot("/apple/x")).toBe("/apple/x");
  });

  it("round-trips with underAppRoot for ordinary repo paths", () => {
    for (const p of ["/posts/x.mdx", "/README.md", "/a/b/c/d.tsx"]) {
      expect(stripAppRoot(underAppRoot(p))).toBe(p);
    }
  });
});

describe("metadataKeyFor — the metadata store key space", () => {
  // Replicates sandbox/src/bundler/metadataKey.test.ts exactly: metadata is keyed by
  // the ABSOLUTE module path, never the app-root-stripped URL-space path.
  it("keys by /app/<path>, not the stripped path", () => {
    expect(metadataKeyFor("content/post.mdx")).toBe("/app/content/post.mdx");
    expect(metadataKeyFor("content/post.mdx")).not.toBe("/content/post.mdx");
  });

  it("accepts the sidecar's leading-slash key form unchanged", () => {
    // The cache-zip sidecar writes `/docs/x.mdx`; the reader feeds it straight in.
    expect(metadataKeyFor("/docs/x.mdx")).toBe("/app/docs/x.mdx");
  });

  it("is the same function as underAppRoot — one key space, not two", () => {
    for (const p of ["a.mdx", "/a.mdx", "deeply/nested/a.mdx"]) {
      expect(metadataKeyFor(p)).toBe(underAppRoot(p));
    }
  });
});
