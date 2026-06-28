// @immediately-run/platform-constants — the single source of truth for cross-repo
// platform vocabulary.
//
// These values were previously DUPLICATED as raw string literals in three repos:
//   - cli      (the cache-zip emitter: MANIFEST_SIDECAR_ENTRY, artifact/package staging)
//   - sandbox  (the bundler readers: MANIFEST_SIDECAR_PATH, BUNDLED_PACKAGES_DIR)
//   - site-main (the contribute diff / integrity allowlist: PLATFORM_SIDECAR_INFRA_PREFIX)
//
// Because the literal was copied, the `.tinkerable/` → `.immediately.run/` rename had to
// land in all three repos in lockstep (cli #12 / sandbox #30 / site-main #117). Owning the
// vocabulary here means a future rename or extension touches ONE package, and every
// consumer that imports it moves together by a version bump — not a hand-synced literal.
// (R3-104; ways_of_working §7 "single-source the cross-repo shared vocabularies".)

/**
 * The platform sidecar directory carried inside a cache zip, appended OUTSIDE the git
 * tree: the contribute manifest, the pre-transpiled artifacts, and the bundled package
 * content. Root-relative, NO leading slash. (Renamed from `.tinkerable/` 2026-06-16.)
 */
export const SIDECAR_DIR = ".immediately.run";

/** The sidecar dir as a path PREFIX (trailing slash) for "is this under the sidecar?"
 *  comparisons. */
export const SIDECAR_PREFIX = `${SIDECAR_DIR}/`;

/** Root-relative path of the contribute-manifest sidecar (no leading slash — cache-zip
 *  entries are root-relative). Add a leading `/` for the sandbox's app-rooted form. */
export const CONTRIBUTE_MANIFEST_PATH = `${SIDECAR_DIR}/contribute-manifest.json`;

/** Root-relative directory of the pre-transpiled artifacts (`PRETRANSPILED_ARTIFACTS_SPEC §4`). */
export const ARTIFACTS_DIR = `${SIDECAR_DIR}/artifacts`;

/** Root-relative directory of the bundled-package content (R3-49a). */
export const PACKAGES_DIR = `${SIDECAR_DIR}/packages`;

/**
 * True when a path is the sidecar directory itself or anything under it. Accepts a
 * repo-relative path with an optional leading `/` or `./` (Sandpack/overlay paths are
 * slash-prefixed) — the prefix is normalized away before comparison.
 */
export function isUnderSidecar(path: string): boolean {
  const rel = path.replace(/^\.?\//, "");
  return rel === SIDECAR_DIR || rel.startsWith(SIDECAR_PREFIX);
}
