// The app-root path space — one definition of where a repository lives inside the
// sandbox filesystem, and how a repo-relative path maps into and out of it.
// (PLATFORM_LAYERING_SPEC §3 / S2, R3-275.)
//
// This was declared independently in `sandbox/src/fsLayout.ts` and
// `sdk/src/urlUtils.ts` — two spellings of `/app` plus two `underAppRoot`
// implementations, one hand-rolled and one over the SDK's `joinPaths`. They agree
// today; nothing made them agree, and the metadata key space (below) is derived from
// this constant on both sides, so a drift here silently splits the key space in two.

/**
 * Mount point of the repository inside the sandbox filesystem.
 *
 * The sandbox fs is rooted at `/` so app code can reach the whole tree — the repo
 * plus dynamically-added mounts such as a Firestore-backed space — with the repo
 * mounted here. URL subpaths are repo-relative and resolve under this root.
 */
export const APP_ROOT = "/app";

/**
 * Resolve a repo-relative path to its absolute sandbox path.
 *
 * Accepts the path with or without a leading slash (URL subpaths carry one, manifest
 * entries do not). It does NOT normalize `.`/`..` and does NOT detect an
 * already-rooted path: `underAppRoot("/app/x")` is `"/app/app/x"`, matching both
 * implementations this replaces — callers pass repo-relative paths, and quietly
 * "fixing" a double root would hide the bug rather than surface it.
 */
export function underAppRoot(repoRelativePath: string): string {
  const suffix = repoRelativePath.startsWith("/")
    ? repoRelativePath
    : `/${repoRelativePath}`;
  return `${APP_ROOT}${suffix}`;
}

/**
 * Map an absolute sandbox path back to the repo-relative path apps and the URL space
 * think in (`/app/posts/x.mdx` → `/posts/x.mdx`).
 *
 * The app root itself maps to `/`. Paths OUTSIDE the repo (`/node_modules/...`, other
 * mounts) are returned unchanged — this is a projection, not an assertion, because
 * the sandbox fs legitimately holds paths that were never repo-relative. A path that
 * merely starts with the same characters (`/apple/x`) is not under the root and is
 * returned unchanged.
 */
export function stripAppRoot(path: string): string {
  if (path === APP_ROOT) return "/";
  return path.startsWith(`${APP_ROOT}/`) ? path.slice(APP_ROOT.length) : path;
}

/**
 * The key a file's MDX frontmatter is stored under in the runtime metadata store
 * (MDX_CONTENT_COLLECTIONS_SPEC §2).
 *
 * It is the file's **absolute module/fs path** — the same identifier
 * `module.dynamicImport`, `fs`, and the SDK's `<Include>` use — deliberately NOT the
 * app-root-stripped URL-space path. Keeping metadata in the file space is what lets
 * an app read a file's metadata and render that same file by the same path. The
 * sandbox pins this in `bundler/metadataKey.test.ts`; the cache-zip sidecar stores
 * repo-relative keys and translates them through here on read.
 */
export function metadataKeyFor(repoRelativePath: string): string {
  return underAppRoot(repoRelativePath);
}
