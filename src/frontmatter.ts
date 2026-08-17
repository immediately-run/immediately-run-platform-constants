// The frontmatter envelope — the typed shape both sides of the content contract
// exchange, with the values left OPEN (PLATFORM_LAYERING_SPEC §3 / S2 + its §6
// decision; MDX_CONTENT_COLLECTIONS_SPEC).
//
// The envelope is typed; the CONTENTS are not. Corpus keys belong to the corpus:
// `title`, `status`, `topics`, and whatever a given wiki invents next are its
// business, and a schema here would make every new key a cross-repo release. What
// the platform does commit to is the envelope: string keys, JSON-serializable
// values, and the identity semantics the emitter guarantees.

/** A value that survives `JSON.parse(JSON.stringify(v))` unchanged. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * One file's parsed frontmatter.
 *
 * **Values are JSON-serializable, always.** Frontmatter crosses the sandbox↔host
 * postMessage boundary and is written to the `mdx-metadata.json` sidecar, so a
 * `Date`, a function, or a `undefined`-valued key either throws on the wire or
 * silently disappears through JSON. The YAML parser is what enforces this in
 * practice (it yields plain JSON values); the type states the contract so a producer
 * that builds frontmatter programmatically cannot claim otherwise.
 *
 * **Emitter identity semantics.** The metadata store hands out the SAME object
 * reference for a given file until that file's frontmatter changes, and emits a NEW
 * object when it does. Consumers may therefore use reference equality as a
 * change signal (React deps, memo keys) — but must treat the object as **frozen in
 * spirit**: mutating it edits every other consumer's copy, and the next emission
 * replaces it wholesale rather than merging.
 *
 * An **empty** frontmatter is not stored at all. Both the runtime scan and the CLI
 * emitter drop a file whose parsed frontmatter has zero keys, so `{}` never appears
 * as a value — absence and emptiness are the same state, and a consumer that
 * distinguishes them is relying on something neither side provides.
 */
export type Frontmatter = Record<string, JsonValue>;

/**
 * True when `value` is a plain object usable as a {@link Frontmatter} envelope:
 * a non-null, non-array object. Deliberately shallow — this checks the ENVELOPE,
 * not the values, because the values are open by design. Use
 * {@link isJsonSerializable} when a producer needs the deeper guarantee.
 */
export function isFrontmatterEnvelope(value: unknown): value is Frontmatter {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when `value` round-trips through JSON unchanged in shape — no functions, no
 * `undefined`, no `Date`, no cycles, no non-finite numbers.
 *
 * For a PRODUCER (the CLI emitter, an authoring tool) to check what it is about to
 * write. The consume side does not re-run this: it reads JSON, so anything it parsed
 * is serializable by construction.
 */
export function isJsonSerializable(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      // JSON has no NaN/Infinity — `JSON.stringify` turns both into `null`, which is
      // a silent value change, not an error.
      return Number.isFinite(value);
    case "object":
      break;
    default:
      return false; // function, undefined, symbol, bigint
  }
  if (seen.has(value)) return false; // cycle
  if (!Array.isArray(value)) {
    // A `Date` (and any class instance with a `toJSON`, a `Map`, a `Set`) is an
    // object whose OWN enumerable values are often empty — checking them alone says
    // "serializable" for a value JSON silently turns into a string, or into `{}`.
    // Only a plain object round-trips as itself.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
  }
  seen.add(value);
  const ok = Array.isArray(value)
    ? value.every((v) => isJsonSerializable(v, seen))
    : Object.values(value as Record<string, unknown>).every((v) =>
        isJsonSerializable(v, seen),
      );
  seen.delete(value);
  return ok;
}
