import {
  SIDECAR_DIR,
  SIDECAR_PREFIX,
  CONTRIBUTE_MANIFEST_PATH,
  ARTIFACTS_DIR,
  PACKAGES_DIR,
  isUnderSidecar,
} from "../src/index";

describe("platform sidecar vocabulary", () => {
  it("pins the canonical literals (a change here is a deliberate cross-repo rename)", () => {
    expect(SIDECAR_DIR).toBe(".immediately.run");
    expect(SIDECAR_PREFIX).toBe(".immediately.run/");
    expect(CONTRIBUTE_MANIFEST_PATH).toBe(".immediately.run/contribute-manifest.json");
    expect(ARTIFACTS_DIR).toBe(".immediately.run/artifacts");
    expect(PACKAGES_DIR).toBe(".immediately.run/packages");
  });

  it("derives every sub-path from the one base dir (no independent literal)", () => {
    for (const p of [SIDECAR_PREFIX, CONTRIBUTE_MANIFEST_PATH, ARTIFACTS_DIR, PACKAGES_DIR]) {
      expect(p.startsWith(`${SIDECAR_DIR}/`)).toBe(true);
    }
  });
});

describe("isUnderSidecar", () => {
  it("matches the sidecar dir itself and anything beneath it", () => {
    expect(isUnderSidecar(".immediately.run")).toBe(true);
    expect(isUnderSidecar(".immediately.run/contribute-manifest.json")).toBe(true);
    expect(isUnderSidecar(".immediately.run/artifacts/transpiled/src/App.tsx.js")).toBe(true);
  });

  it("normalizes a leading slash or ./ (Sandpack / overlay paths)", () => {
    expect(isUnderSidecar("/.immediately.run/contribute-manifest.json")).toBe(true);
    expect(isUnderSidecar("./.immediately.run/artifacts/index.json")).toBe(true);
  });

  it("does not match ordinary repo content or look-alike names", () => {
    expect(isUnderSidecar("src/App.tsx")).toBe(false);
    expect(isUnderSidecar("README.md")).toBe(false);
    // a file whose name merely starts with the dir name but is not the dir
    expect(isUnderSidecar(".immediately.run.bak")).toBe(false);
  });
});
