// The app-analytics vocabulary contract (APP_ANALYTICS_SPEC §3 / §5, R3-350).
//
// PURE, and shared by both sides for the same reason the telemetry registry is: the
// host validates every app event before batching, the backend validates the batch at
// ingest, and two implementations of "is this event in the declared vocabulary" would
// drift exactly the way R3-343's two vocabularies did.
//
// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS IS A BOUNDED EGRESS CHANNEL. THIS FILE STATES THE BOUND.
// ─────────────────────────────────────────────────────────────────────────────
//
// An analytics API is a user-blessed path from inside the sandbox to a server. **It is
// a covert channel with a capacity, not a channel with no content**, and §5 states the
// capacity instead of denying it.
//
// The earlier draft claimed enumerations make the channel "structurally content-free"
// and chunking "impossible, not merely slow". **Both were false, by the draft's own
// argument**: a rate limit changes how long exfiltration takes, not whether it works,
// and an unbounded declared alphabet is an unbounded primitive with a throughput
// divisor. Per event the channel carries `log2(names × Π ranges)` bits and **the app
// declares both factors** — 256 names is a byte per event, plus 8 properties of 16 enum
// values each reaches ~40 bits per event, which at the reused per-app rate limits is an
// API key in seconds and a private key in minutes.
//
// So the control is a **lifetime bit budget per (app, user)**, not a per-window event
// count: the vocabulary cross-product is capped at 2^12 distinct emit-shapes, and there
// is a per-user daily cap. The enumeration rule only bounds per-event capacity; the
// budget is what bounds the channel.
//
// §12 keeps the residual honest and so does this file: **the channel is bounded, not
// closed.** A determined publisher can move a small secret slowly within the budget.

/** A declared property type. Scalars only — an object or array has no bound. */
export type AppPropType = "enum" | "number" | "boolean";

export interface AppPropDecl {
  type: AppPropType;
  /**
   * For `enum`: the permitted values. **A string property MUST be a bounded
   * enumeration, never a free string** — that is the difference between a bound that
   * is computed and one that is hoped for, and §12 predicts it will be the first thing
   * a publisher asks to relax.
   */
  values?: readonly string[];
  /** For `number`: the inclusive range. Out-of-range REJECTS the event. */
  min?: number;
  max?: number;
}

export interface AppEventDecl {
  /** Per-event declared property set. An undeclared key rejects the event. */
  props?: Readonly<Record<string, AppPropDecl>>;
}

export interface AppAnalyticsVocabulary {
  /** Declared event names, namespaced to the app. */
  events: Readonly<Record<string, AppEventDecl>>;
  /**
   * Declared ROUTE PATTERNS, e.g. `/patients/:id`.
   *
   * §3.1: a raw path is content — `/patients/12345` is not a page name — and
   * collecting raw paths from unaccountable publishers is not defensible. The app
   * registers patterns and the platform records the pattern; **the variable segment is
   * discarded at the boundary and never transmitted.**
   */
  routes?: readonly string[];
}

// ── The caps (§5.1) ──────────────────────────────────────────────────────────

/** Total declared vocabulary cross-product: at most 2^12 distinct emit-shapes. */
export const APP_VOCAB_MAX_SHAPES = 4096;
/** At most 8 declared properties per event — the §5 discipline, unchanged. */
export const APP_MAX_PROPS_PER_EVENT = 8;
/** Enum values are strings; each is capped like every other string on the wire. */
export const APP_MAX_STR = 256;
/** Events per user per day, per app. Published in the consent line's detail. */
export const APP_MAX_EVENTS_PER_USER_PER_DAY = 500;
/** Declared event names per app. */
export const APP_MAX_EVENT_NAMES = 64;
/** Declared route patterns per app. */
export const APP_MAX_ROUTES = 64;

/** An app event name is `<appNamespace>.<event>` — lowercase, dotted, bounded. */
const EVENT_NAME_RE = /^[a-z][a-z0-9]{0,31}\.[a-z][a-zA-Z0-9]{0,31}$/;
/** A route pattern: `/`-rooted segments, each literal or `:name`. */
const ROUTE_RE = /^\/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_]*)?(?:\/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_]*))*$/;

/**
 * How many distinct emit-shapes a vocabulary can express: `Σ_events Π_props |values|`.
 *
 * This is the number §5.1's cap binds, and it is computed rather than eyeballed
 * because the cross-product grows multiplicatively — eight properties of sixteen values
 * is 4.3 billion shapes for ONE event name, which looks entirely reasonable written out
 * as a manifest.
 */
export const vocabularyShapeCount = (v: AppAnalyticsVocabulary): number => {
  let total = 0;
  for (const decl of Object.values(v.events)) {
    let shapes = 1;
    for (const p of Object.values(decl.props ?? {})) {
      if (p.type === "enum") shapes *= Math.max(1, p.values?.length ?? 0);
      else if (p.type === "boolean") shapes *= 2;
      else if (p.type === "number") {
        // A declared range is a declared alphabet. An integer range of N contributes N
        // shapes; a non-integer range is unbounded and is refused at validation, so the
        // conservative count here is the full span.
        const span = Math.floor((p.max ?? 0) - (p.min ?? 0)) + 1;
        shapes *= Math.max(1, span);
      }
      // Guard the multiplication itself: a manifest can otherwise overflow to Infinity
      // and compare as "not more than the cap" in a naive implementation.
      if (!Number.isFinite(shapes) || shapes > Number.MAX_SAFE_INTEGER) return Number.POSITIVE_INFINITY;
    }
    total += shapes;
    if (!Number.isFinite(total)) return Number.POSITIVE_INFINITY;
  }
  return total;
};

/** Bits per event the vocabulary can carry — §5.1's stated capacity, computed. */
export const vocabularyBits = (v: AppAnalyticsVocabulary): number => {
  const shapes = vocabularyShapeCount(v);
  return Number.isFinite(shapes) ? Math.log2(Math.max(1, shapes)) : Number.POSITIVE_INFINITY;
};

/**
 * Validate a manifest-declared vocabulary. Returns `null` when valid, else the reason.
 *
 * FAIL-CLOSED throughout: a vocabulary that does not validate yields NO capability, not
 * a narrowed one. A narrowed one would mean the consent line described something other
 * than what the app can emit.
 */
export const validateVocabulary = (raw: unknown): string | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "vocabulary must be an object";
  const v = raw as AppAnalyticsVocabulary;
  if (typeof v.events !== "object" || v.events === null || Array.isArray(v.events))
    return "vocabulary.events must be an object";

  const names = Object.keys(v.events);
  if (names.length === 0) return "vocabulary declares no events";
  if (names.length > APP_MAX_EVENT_NAMES) return `too many declared event names (max ${APP_MAX_EVENT_NAMES})`;

  for (const name of names) {
    if (!EVENT_NAME_RE.test(name)) return `invalid event name: ${name}`;
    // T-AN-10: an app event must not be able to impersonate a host event and poison
    // platform metrics. App events land in a separate table anyway, but a name that
    // READS like a host event would still mislead every human looking at a dashboard.
    if (/^(session|boot|app|llm|project|error|csp|dispatch|perf)\./.test(name))
      return `event name collides with the host vocabulary: ${name}`;

    const decl = v.events[name];
    if (typeof decl !== "object" || decl === null) return `invalid declaration for ${name}`;
    const props = decl.props ?? {};
    const keys = Object.keys(props);
    if (keys.length > APP_MAX_PROPS_PER_EVENT) return `${name}: too many props (max ${APP_MAX_PROPS_PER_EVENT})`;
    for (const key of keys) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) return `${name}: invalid prop key: ${key}`;
      const p = props[key];
      if (typeof p !== "object" || p === null) return `${name}.${key}: invalid declaration`;
      if (p.type === "enum") {
        if (!Array.isArray(p.values) || p.values.length === 0)
          return `${name}.${key}: a string property must declare a bounded enumeration`;
        if (p.values.length > 256) return `${name}.${key}: enumeration too large`;
        for (const val of p.values) {
          if (typeof val !== "string") return `${name}.${key}: enumeration values must be strings`;
          if (val.length > APP_MAX_STR) return `${name}.${key}: enumeration value exceeds string cap`;
        }
        if (new Set(p.values).size !== p.values.length) return `${name}.${key}: duplicate enumeration values`;
      } else if (p.type === "number") {
        if (typeof p.min !== "number" || typeof p.max !== "number" || !Number.isFinite(p.min) || !Number.isFinite(p.max))
          return `${name}.${key}: a numeric property must declare a finite range`;
        if (!Number.isInteger(p.min) || !Number.isInteger(p.max))
          return `${name}.${key}: a numeric range must be integral — a real range is an unbounded alphabet`;
        if (p.max < p.min) return `${name}.${key}: inverted range`;
      } else if (p.type !== "boolean") {
        return `${name}.${key}: unknown property type`;
      }
    }
  }

  if (v.routes !== undefined) {
    if (!Array.isArray(v.routes)) return "vocabulary.routes must be an array";
    if (v.routes.length > APP_MAX_ROUTES) return `too many route patterns (max ${APP_MAX_ROUTES})`;
    for (const r of v.routes) {
      if (typeof r !== "string" || !ROUTE_RE.test(r)) return `invalid route pattern: ${String(r)}`;
    }
  }

  // §5.1's binding cap. Checked LAST so the message names the real problem rather than
  // a symptom of it.
  const shapes = vocabularyShapeCount(v);
  if (shapes > APP_VOCAB_MAX_SHAPES)
    return `declared vocabulary expresses ${Number.isFinite(shapes) ? shapes : "unboundedly many"} distinct emit-shapes (max ${APP_VOCAB_MAX_SHAPES})`;

  return null;
};

// ── §2.1: the vocabulary hash bound into the grant ───────────────────────────

/**
 * A canonical, order-independent serialisation of the vocabulary.
 *
 * Order-independent deliberately: a publisher reordering their manifest keys has not
 * changed the bargain, and forcing re-consent on a formatting change trains users to
 * click through the prompt that matters.
 */
export const canonicalVocabulary = (v: AppAnalyticsVocabulary): string => {
  const events = Object.keys(v.events)
    .sort()
    .map((name) => {
      const props = v.events[name].props ?? {};
      const p = Object.keys(props)
        .sort()
        .map((k) => {
          const d = props[k];
          return d.type === "enum"
            ? [k, "enum", [...(d.values ?? [])].sort()]
            : d.type === "number"
              ? [k, "number", d.min, d.max]
              : [k, "boolean"];
        });
      return [name, p];
    });
  const routes = [...(v.routes ?? [])].sort();
  return JSON.stringify({ events, routes });
};

/**
 * The vocabulary hash bound into the grant record (§2.1).
 *
 * FNV-1a over the canonical form, widened by chaining — this is a CHANGE DETECTOR, not
 * a security primitive: both sides of the comparison are host-held, so there is no
 * adversary who benefits from a collision they cannot also just declare directly. It is
 * a plain function rather than `crypto.subtle` so the same value is computable
 * synchronously on both sides, including inside a consent render.
 */
export const vocabularyHash = (v: AppAnalyticsVocabulary): string => {
  const input = canonicalVocabulary(v);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
};

// ── §3.1: routes are patterns, never paths ───────────────────────────────────

/**
 * Match a concrete path against the declared patterns, returning the PATTERN.
 *
 * Returns `null` when nothing matches — and a non-matching path yields no row at all,
 * rather than a row carrying the path. **The variable segment is discarded here**, at
 * the boundary, so `/patients/12345` never exists downstream in any form.
 *
 * §3.1 is also the honest answer to the publisher's question: they asked which screens
 * are used, and the screen IS the pattern. An app needing per-item counts declares a
 * bounded enumeration of items; there is no unbounded per-item cardinality, because
 * adding one reopens §5.
 */
export const matchRoutePattern = (path: string, patterns: readonly string[]): string | null => {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  // Query and fragment are content and are never considered — a publisher cannot
  // smuggle a payload past pattern matching in `?q=`.
  const clean = path.split(/[?#]/)[0];
  const segs = clean.split("/").slice(1);
  for (const pattern of patterns) {
    const pSegs = pattern.split("/").slice(1);
    if (pSegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(":")) continue; // variable — matches, and is DISCARDED
      if (pSegs[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return pattern;
  }
  return null;
};

// ── Per-event validation (§3, host-side, before batching) ────────────────────

export interface AppAnalyticsEvent {
  name: string;
  at: string;
  props?: Record<string, string | number | boolean>;
  /** A DECLARED route pattern, already reduced from the concrete path. */
  route?: string;
}

/**
 * Validate one app event against the app's declared vocabulary.
 *
 * **Host-side and PER EVENT, before batching** (§3/§5). App events never share a batch
 * with host events, because whole-batch rejection on a shared batch would let one
 * malicious app drop up to 49 co-batched host events per flush — signal burial achieved
 * through the validator rather than through volume (G-AN-13).
 *
 * REJECTS, never strips. An undeclared key that were silently dropped would turn a leak
 * into a green test.
 */
export const validateAppEvent = (e: unknown, v: AppAnalyticsVocabulary): string | null => {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return "event must be an object";
  const ev = e as AppAnalyticsEvent;
  if (typeof ev.name !== "string") return "missing name";
  const decl = Object.prototype.hasOwnProperty.call(v.events, ev.name) ? v.events[ev.name] : undefined;
  if (!decl) return `undeclared event name: ${ev.name}`;
  if (typeof ev.at !== "string") return `${ev.name}: missing at`;

  if (ev.route !== undefined) {
    if (typeof ev.route !== "string") return `${ev.name}: route must be a string`;
    // Only a DECLARED PATTERN may appear. A concrete path reaching here means the
    // boundary reduction did not run, and passing it through would be T-AN-3 exactly.
    if (!(v.routes ?? []).includes(ev.route)) return `${ev.name}: route is not a declared pattern`;
  }

  const props = ev.props;
  if (props !== undefined) {
    if (typeof props !== "object" || props === null || Array.isArray(props)) return `${ev.name}: props must be an object`;
    const declared = decl.props ?? {};
    const entries = Object.entries(props);
    if (entries.length > APP_MAX_PROPS_PER_EVENT) return `${ev.name}: props exceeds key cap`;
    for (const [k, val] of entries) {
      const d = Object.prototype.hasOwnProperty.call(declared, k) ? declared[k] : undefined;
      if (!d) return `${ev.name}: undeclared prop key: ${k}`;
      if (d.type === "enum") {
        if (typeof val !== "string") return `${ev.name}.${k}: must be a string`;
        // G-AN-2: a NON-ENUMERATED string is rejected at the boundary. This is the
        // whole content bound — a free string would carry the file, the key, the row.
        if (!(d.values ?? []).includes(val)) return `${ev.name}.${k}: value is not in the declared enumeration`;
      } else if (d.type === "number") {
        if (typeof val !== "number" || !Number.isFinite(val)) return `${ev.name}.${k}: must be a finite number`;
        if (val < (d.min ?? 0) || val > (d.max ?? 0)) return `${ev.name}.${k}: out of declared range`;
        if (!Number.isInteger(val)) return `${ev.name}.${k}: must be an integer — a real is an unbounded alphabet`;
      } else if (d.type === "boolean") {
        if (typeof val !== "boolean") return `${ev.name}.${k}: must be a boolean`;
      }
    }
  }
  return null;
};
