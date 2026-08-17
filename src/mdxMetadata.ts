// The `mdx-metadata.json` sidecar — schema + one validator, shared by the side that
// WRITES it (the CLI's cache-zip step) and the side that READS it (the sandbox's
// artifact store). PLATFORM_LAYERING_SPEC §3 / S2, MDX_CONTENT_COLLECTIONS_SPEC §1.3.
//
// Before this, the writer built the object from its own literal shape and the reader
// re-validated it with a hand-written chain of `typeof` checks. Two independent
// readings of one format: the reader could tighten a check the writer never learned
// about, and every entry it silently dropped looked exactly like "this repo has no
// frontmatter".

import { ARTIFACTS_DIR } from "./index";
import type { Frontmatter } from "./frontmatter";

/** Root-relative path of the frontmatter sidecar inside a cache zip. */
export const MDX_METADATA_SIDECAR_PATH = `${ARTIFACTS_DIR}/mdx-metadata.json`;

/** The only schema version that exists. Bumping it is a coordinated change: an
 *  older reader must reject the newer file rather than misread it, which is exactly
 *  what the version check below does. */
export const MDX_METADATA_SCHEMA_VERSION = 1;

/** One file's entry: the source blob it was derived from, and the frontmatter. */
export interface MdxMetadataFileEntry {
  /** Git blob sha of the SOURCE the frontmatter was parsed from. The reader honors
   *  the entry only when this still equals the manifest's sha for that path — the
   *  binding that makes a stale sidecar inert rather than wrong. */
  srcSha: string;
  /** The parsed frontmatter. Never empty: both sides drop zero-key frontmatter. */
  frontmatter: Frontmatter;
}

/** The sidecar file. Keys are repo-relative paths WITH a leading slash (`/docs/x.mdx`);
 *  the reader translates them into the absolute metadata key space via `metadataKeyFor`. */
export interface MdxMetadataSidecar {
  schemaVersion: typeof MDX_METADATA_SCHEMA_VERSION;
  files: Record<string, MdxMetadataFileEntry>;
}

/** Why a sidecar (or one of its entries) was rejected. Typed so a caller can log the
 *  distinction instead of collapsing every rejection into "no metadata". */
export type MdxMetadataRejection =
  | "not-an-object"
  | "schema-version"
  | "files-not-an-object"
  | "entry-not-an-object"
  | "entry-src-sha"
  | "entry-frontmatter"
  | "entry-frontmatter-empty";

export type MdxMetadataValidation =
  | { ok: true; sidecar: MdxMetadataSidecar; rejected: { path: string; reason: MdxMetadataRejection }[] }
  | { ok: false; reason: MdxMetadataRejection };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validate a parsed sidecar.
 *
 * **Structure only.** Entry-level CONFINEMENT — the path names a manifest member, is
 * not in the dirty set, and its `srcSha` matches — stays with the reader, which is
 * the only side holding the manifest and the writable-layer view. This validator
 * answers "is this the format?", never "may I trust this entry?".
 *
 * A malformed FILE is rejected whole (`ok: false`): a wrong `schemaVersion` means the
 * reader does not know what it is looking at, so honoring the parts it recognizes
 * would be the misreading the version exists to prevent. A malformed ENTRY inside a
 * well-formed file is dropped and REPORTED in `rejected` — one bad file must not cost
 * a repo its whole cached metadata, but a silent drop is how "the cache seeded
 * nothing" becomes indistinguishable from "there was nothing to seed".
 */
export function validateMdxMetadataSidecar(raw: unknown): MdxMetadataValidation {
  if (!isPlainObject(raw)) return { ok: false, reason: "not-an-object" };
  if (raw.schemaVersion !== MDX_METADATA_SCHEMA_VERSION) {
    return { ok: false, reason: "schema-version" };
  }
  if (!isPlainObject(raw.files)) return { ok: false, reason: "files-not-an-object" };

  const files: Record<string, MdxMetadataFileEntry> = {};
  const rejected: { path: string; reason: MdxMetadataRejection }[] = [];

  for (const [path, value] of Object.entries(raw.files)) {
    if (!isPlainObject(value)) {
      rejected.push({ path, reason: "entry-not-an-object" });
      continue;
    }
    if (typeof value.srcSha !== "string" || value.srcSha.length === 0) {
      rejected.push({ path, reason: "entry-src-sha" });
      continue;
    }
    if (!isPlainObject(value.frontmatter)) {
      rejected.push({ path, reason: "entry-frontmatter" });
      continue;
    }
    if (Object.keys(value.frontmatter).length === 0) {
      // Both producers drop zero-key frontmatter, so an empty one here means the
      // file was written by something that does not share the contract.
      rejected.push({ path, reason: "entry-frontmatter-empty" });
      continue;
    }
    files[path] = {
      srcSha: value.srcSha,
      frontmatter: value.frontmatter as Frontmatter,
    };
  }

  return {
    ok: true,
    sidecar: { schemaVersion: MDX_METADATA_SCHEMA_VERSION, files },
    rejected,
  };
}

/**
 * Parse + validate raw sidecar TEXT. Unparseable JSON is `not-an-object`: from the
 * reader's position a truncated file and a file full of the wrong thing are the same
 * event — the sidecar cannot be used, fall back to a live scan.
 */
export function parseMdxMetadataSidecar(text: string): MdxMetadataValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-an-object" };
  }
  return validateMdxMetadataSidecar(parsed);
}
