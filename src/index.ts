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

// ── The content contract (R3-275, PLATFORM_LAYERING_SPEC §3 / S2) ─────────────
// The app-root path space, the metadata key derivation, the frontmatter envelope,
// and the `mdx-metadata.json` sidecar schema + validator. Each of these was
// previously declared independently on both sides of the sandbox↔SDK seam.
export { APP_ROOT, underAppRoot, stripAppRoot, metadataKeyFor } from "./appRoot";
export type { Frontmatter, JsonValue } from "./frontmatter";
export { isFrontmatterEnvelope, isJsonSerializable } from "./frontmatter";
export {
  MDX_METADATA_SIDECAR_PATH,
  MDX_METADATA_SCHEMA_VERSION,
  validateMdxMetadataSidecar,
  parseMdxMetadataSidecar,
} from "./mdxMetadata";
export type {
  MdxMetadataFileEntry,
  MdxMetadataSidecar,
  MdxMetadataRejection,
  MdxMetadataValidation,
} from "./mdxMetadata";

// ── The shared telemetry event registry (PLATFORM_TELEMETRY_SPEC §5, R3-344) ──
// ONE vocabulary imported by both the host producer (site-main) and the backend
// ingest validator, because the security-events stream drifted exactly this way and
// rejected ~100% of its batches for months (R3-343).
export type {
  TelemetryTier,
  TelemetryEventClass,
  TelemetryEventDef,
  TelemetryEventName,
  TelemetryEvent,
  TelemetryBatch,
  TelemetryBatchResult,
} from "./telemetry";
export {
  TELEMETRY_EVENTS,
  TELEMETRY_MAX_PROP_KEYS,
  TELEMETRY_MAX_STR,
  TELEMETRY_MAX_BATCH,
  TELEMETRY_MAX_FRAMES,
  telemetryEventNames,
  telemetryEventDef,
  validateTelemetryEvent,
  validateTelemetryBatch,
} from "./telemetry";

// ── The app-analytics vocabulary contract (APP_ANALYTICS_SPEC §3/§5, R3-350) ──
// Shared for the same reason the telemetry registry is: the host validates every app
// event before batching and the backend validates the batch at ingest, and two
// implementations of "is this event in the declared vocabulary" would drift exactly the
// way R3-343's two vocabularies did.
export type {
  AppPropType,
  AppPropDecl,
  AppEventDecl,
  AppAnalyticsVocabulary,
  AppAnalyticsEvent,
} from "./appAnalytics";
export {
  APP_VOCAB_MAX_SHAPES,
  APP_MAX_PROPS_PER_EVENT,
  APP_MAX_STR,
  APP_MAX_EVENTS_PER_USER_PER_DAY,
  APP_MAX_EVENT_NAMES,
  APP_MAX_ROUTES,
  vocabularyShapeCount,
  vocabularyBits,
  validateVocabulary,
  canonicalVocabulary,
  vocabularyHash,
  matchRoutePattern,
  validateAppEvent,
} from "./appAnalytics";

// ── The shared security-events registry (SECURITY_EVENTS_STREAM_SPEC §5.5, R3-343) ──
// The stream this package's telemetry registry was modelled on. It kept its own
// vocabulary in the CONSUMER (a `KIND_PREFIXES` list in the backend), it drifted from
// the producers in site-main, and validation is fail-closed — so the operator stream
// rejected ~100% of its batches for months while looking merely quiet. Same fix,
// applied to the original: one closed table of EXACT kinds, imported by both sides,
// with a two-way drift check in each repo.
export type {
  SecuritySeverity,
  SecurityEventClass,
  SecurityEventDef,
  SecurityEventKind,
  SecurityEvent,
  SecurityEventBatch,
  SecurityRejection,
  SecurityBatchResult,
} from "./securityEvents";
export {
  SECURITY_EVENT_KINDS,
  SECURITY_MAX_BATCH,
  SECURITY_DETAIL_MAX_KEYS,
  SECURITY_DETAIL_MAX_STR,
  securityEventKinds,
  securityEventDef,
  classifySecurityKind,
  classifySecuritySeverity,
  validateSecurityEvent,
  validateSecurityBatch,
} from "./securityEvents";
