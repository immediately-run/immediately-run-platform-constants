// The shared telemetry event registry — ONE vocabulary, imported by both the host
// (`site-main`, the producer) and the backend (the fail-closed ingest validator).
// (PLATFORM_TELEMETRY_SPEC §5, roadmap R3-344.)
//
// WHY THIS IS HERE AND NOT IN EITHER REPO
// ---------------------------------------
// The operator security-events stream shipped with the producer vocabulary in
// `site-main` and the registry hand-mirrored in `immediately-run-backend`. They
// drifted; validation is fail-closed on a whole batch; and the stream therefore
// rejected ~100% of its batches for months while looking merely quiet (R3-343: 298
// of 300 sampled POSTs `400`, one event delivered in 30 days). A prefix list that
// only the consumer holds cannot be kept true by review.
//
// So the vocabulary lives in the one package both repos depend on, and a CI drift
// check runs in BOTH DIRECTIONS in BOTH repos:
//   - no emitted name that is unregistered   (the R3-343 failure), and
//   - no registered name without a producer  (the mirror-image failure: R3-343 found
//     `net-fetch:ssrf-refused` registered with nothing emitting it, so T40 alerting
//     could never fire while reading as working coverage on inspection).
//
// THIS REGISTRY IS CLOSED. PLATFORM_TELEMETRY_SPEC §6 is a closed table of product
// questions — "Nothing outside this table is collected." Every entry below therefore
// names the question it answers; an entry that cannot name one does not belong here.

/**
 * The identity tier a row is written at (§4). Decided AT EMIT and recorded — never
 * inferred later, because auth restore is asynchronous and resolves after boot, so an
 * event emitted before it lands is honestly T1 even for a signed-in user.
 *
 * - `T0` — unkeyed. Not "anonymous": the controller terminates TLS on the beacon and
 *   writes T0 and T2 into the same sink, so a T0 row is singled-out-able within a
 *   session under Recital 26. §6's bucketing reduces identifiability; nothing here
 *   depends on it conferring anonymity.
 * - `T1` — an ephemeral in-memory session id, lost on reload.
 * - `T2` — `HMAC(uid, subkey)`, derived SERVER-SIDE (§4.1). Never client-side.
 */
export type TelemetryTier = "T0" | "T1" | "T2";

/** Tier ordering, for the "an event may never exceed its declared ceiling" check. */
const TIER_RANK: Record<TelemetryTier, number> = { T0: 0, T1: 1, T2: 2 };

/**
 * Which sink table a row lands in, and therefore its retention (§8).
 *
 * - `product` — the §6 table. 13-month raw retention (the §10 exemption ceiling).
 * - `error`   — §9 operator error/crash rows. Same ceiling.
 * - `boundary`— §6.2 dispatch observation. **30 days, no pseudonym, operator-only,
 *   and excluded from the §13 analysis surface.** Held to the security-events
 *   discipline deliberately: a per-pseudonym record of which repositories ran and
 *   which apps were invoked is the server-side equivalent of the `mounts:registry`
 *   cross-app activity oracle that `UI_AS_APPS_SPEC` §8.9 rules permanently
 *   ungrantable.
 * - `app`     — APP_ANALYTICS_SPEC events. Separate table, separate transport,
 *   validated host-side per event; never share a batch with host events.
 */
export type TelemetryEventClass = "product" | "error" | "boundary" | "app";

export interface TelemetryEventDef {
  /**
   * The per-name declared key set (§5). An UNKNOWN KEY REJECTS THE EVENT — it is
   * never stripped, so a leak fails a test rather than passing quietly.
   */
  readonly props: readonly string[];
  /**
   * The highest tier this event may ever carry. The emitter computes
   * `min(maxTier, tier available at emit)`; ingest rejects anything above the
   * ceiling. `boot.*` is T0 forever — boot health must never become keyed.
   */
  readonly maxTier: TelemetryTier;
  readonly class: TelemetryEventClass;
  /**
   * Whether a symbolicated HOST-ORIGIN frame list may ride this event (§9). Only
   * error rows set it. A frame is not a `prop` — the §5 scalar discipline does not
   * reach it — so carrying frames is an explicit, registry-gated exception rather
   * than an accident of the payload shape.
   */
  readonly frames?: true;
  /** The §6 product question this answers. An entry that cannot name one is not collected. */
  readonly question: string;
}

/**
 * The closed event vocabulary. Adding a name here is a spec amendment to §6's table.
 *
 * Dimension props are BUCKETED, normatively (§6): viewport to breakpoint buckets,
 * browser and OS to families, **region not city** (a resolved city is far more
 * identifying than the JS timezone the earlier draft dropped as "the high-entropy
 * bit"), and **no JS timezone at all**. The bucketing is applied host-side before
 * emit; the key names below are what the wire may carry.
 */
export const TELEMETRY_EVENTS = {
  // ── §6: reach, devices, sessions ──────────────────────────────────────────
  "session.start": {
    props: [
      "country",
      "region",
      "browser",
      "browserMajor",
      "os",
      "formFactor",
      "viewport",
      "referrerClass",
    ],
    maxTier: "T2",
    class: "product",
    question:
      "Daily users, visit frequency, retention; where users are and on what devices. `referrerClass` answers the sessions-with-no-auth-and-an-external-referrer row — which is NOT a first-time-visitor rate (§6).",
  },
  // ── §0: the load-bearing gap. A 200 on index.html is fully compatible with a
  // completely broken boot, so only a beacon from the running page can report it.
  "boot.ok": {
    props: ["ms", "cold"],
    maxTier: "T0",
    class: "product",
    question: "Does the site boot?",
  },
  "boot.fail": {
    props: ["failureClass", "ms"],
    maxTier: "T0",
    class: "product",
    question: "Does the site boot — and when it does not, in which class does it fail?",
  },
  // ── §6: repository popularity. Running a repository requires no account, so a T2
  // measurement counts the signed-in minority; `coordinateClass` records whether the
  // coordinate is a verbatim public one or a salted hash (private / local-dev).
  "app.run": {
    props: ["coordinate", "coordinateClass", "cold", "contract"],
    maxTier: "T2",
    class: "product",
    question: "Which repositories are run?",
  },
  "app.contribute": {
    props: ["coordinate", "coordinateClass"],
    maxTier: "T2",
    class: "product",
    question:
      "Which repositories are contributed to, and the share of users who contribute (over a stated denominator).",
  },
  "project.create": {
    props: ["template"],
    maxTier: "T1",
    class: "product",
    question: "New-project creation. Rides an authenticated request; identity is discarded at the sink.",
  },
  // ── §6.1: the load-profiling marker subset ────────────────────────────────
  // LOAD_PROFILING_SPEC §3's vocabulary **cannot be field-collected wholesale.**
  // `ir.open` carries `url`/`ns`/`repo`/`ref`; `ir.transpile` emits per-module
  // sub-marks whose **marker NAME is a file path** out of the user's own
  // repository, including private repos and local working trees; `ir.deps` emits
  // per-package sub-marks of unbounded cardinality.
  //
  // **A marker name is not a `prop`**, so the §5 scalar/8-key/256-char discipline
  // never reaches it. Field-collecting the vocabulary wholesale would put private
  // file paths into the analytics sink under a row labelled T0. Hence a strict
  // ALLOWLISTED SUBSET, enforced at the host before anything is emitted — the
  // props below are the whole of what may ever cross.
  "perf.load": {
    props: [
      "coordinate",
      "coordinateClass",
      "cold",
      "cacheHit",
      "loadSource",
      "interactiveMs",
      "transpileMs",
      "depsMs",
    ],
    maxTier: "T0",
    class: "product",
    question: "Per-app load time in the field — how long a real app takes to become interactive on a real network.",
  },
  // ── §9: error and crash reporting ─────────────────────────────────────────
  // Error reporting CANNOT use the §5 allowlist model: a stack trace is arbitrary
  // text nobody designed and nobody can sanitise at the source. `Cannot read
  // property 'ssn' of undefined` is an exception message and a data leak.
  //
  // **The cut is FRAME ORIGIN** — mechanical, not a judgement call. Host-origin
  // frames are collected (and symbolicated offline from build-time source maps)
  // with a SCRUBBED message; sandbox frames are replaced with a placeholder and a
  // count. `frames` is registry-gated precisely because a frame is not a `prop`
  // and the scalar discipline does not reach it.
  "error.host": {
    props: ["name", "fingerprint", "scope", "message", "sandboxFrames", "externalFrames", "repeated"],
    // T0 forever. An error row is not a measurement of a person, and keying it
    // would make the operator sink a per-user trail of failures.
    maxTier: "T0",
    class: "error",
    frames: true,
    question:
      "Is the host failing, where, and how often — the content-free half of `does the site boot` that would have caught the post-deploy chunk-404 incident.",
  },
  // The operator's view of an APP error: app identity, error constructor name,
  // boot vs steady-state, count. **Content-free by construction** — no frames key
  // at all, so G-TEL-5 cannot regress by someone adding one to a props bag. The
  // user still sees the full trace in the region error surface, at zero retention.
  "error.app": {
    props: ["app", "name", "scope", "sandboxFrames", "repeated"],
    maxTier: "T0",
    class: "error",
    question:
      "Are apps failing, and which — the content-free operator row. The full trace goes to the user's screen, never to us.",
  },
  // §9: CSP violations ride the same pipe, per HOST_ORIGIN_HARDENING_SPEC §2.1's
  // rule that the report endpoint MUST be same-origin or backend-owned. Only the
  // blocked ORIGIN is recorded — a `blockedURI` can be a `data:` URL whose body
  // is the injected content itself.
  "csp.violation": {
    props: ["directive", "disposition", "blockedOrigin", "sourceFile", "line", "severity"],
    maxTier: "T0",
    class: "error",
    question: "Is anything being injected into the host origin, and which directive caught it?",
  },
  // ── §6: LLM intensity. Extracted at the `llm.chat` service seam and NEVER touching
  // `messages`. Its own toggle: opt-out for platform-billed usage, OPT-IN for BYO-key,
  // because BYO-key spend is the user's own.
  "llm.call": {
    props: [
      "provider",
      "model",
      "promptTokens",
      "completionTokens",
      "latencyMs",
      "errorClass",
      "byoKey",
    ],
    maxTier: "T2",
    class: "product",
    question: "LLM intensity — which models, at what volume and latency, and with what error classes.",
  },
} as const satisfies Record<string, TelemetryEventDef>;

export type TelemetryEventName = keyof typeof TELEMETRY_EVENTS;

/** All registered names, sorted — the drift check's "registry side". */
export const telemetryEventNames = (): string[] => Object.keys(TELEMETRY_EVENTS).sort();

/** The definition for `name`, or `null` if unregistered (→ reject). */
export const telemetryEventDef = (name: string): TelemetryEventDef | null =>
  Object.prototype.hasOwnProperty.call(TELEMETRY_EVENTS, name)
    ? (TELEMETRY_EVENTS as Record<string, TelemetryEventDef>)[name]
    : null;

// ── The wire event (§5) ──────────────────────────────────────────────────────

export interface TelemetryEvent {
  /** Registry-resolved, `<domain>.<event>`. */
  name: string;
  /** ISO timestamp, stamped on emit. */
  at: string;
  /** Decided at emit (§4), never inferred later. */
  tier: TelemetryTier;
  props?: Record<string, string | number | boolean>;
  /**
   * Host-minted (§7). The app never chooses, reads or influences it — an app-visible
   * correlation id is a covert channel for linking one user across apps. Each side
   * records only its own leg; the join happens in the sink, never on the wire.
   */
  causationId?: string;
  /** Symbolicated HOST-ORIGIN frames (§9). Only for events whose def sets `frames`. */
  frames?: string[];
}

export interface TelemetryBatch {
  events: TelemetryEvent[];
  /** Count of events dropped since the last batch (drop-cap, never grow). */
  dropped?: number;
}

// ── §5 props discipline (SECURITY_EVENTS_STREAM_SPEC §5.5, applied unchanged) ──

/** At most 8 keys per event. */
export const TELEMETRY_MAX_PROP_KEYS = 8;
/** Strings capped at 256 characters. */
export const TELEMETRY_MAX_STR = 256;
/** Batch size cap — mirrors the security-events forwarder's `DEFAULT_MAX_BATCH`. */
export const TELEMETRY_MAX_BATCH = 50;
/** Frame-list cap for §9 error rows: at most this many, each ≤ {@link TELEMETRY_MAX_STR}. */
export const TELEMETRY_MAX_FRAMES = 32;

/**
 * Identity/secret keys that must NEVER be written, whatever a registry entry says.
 * A belt-and-braces backstop under the declared-key check, not a substitute for it:
 * §6.2's real rule is that any APP-INFLUENCED string is recorded as an index into a
 * declared set, never verbatim — a denylist over attacker-authored strings does not
 * hold, and G-TEL-4 deliberately plants its PII in an ALLOWLISTED key for exactly
 * that reason (a test that only plants it in an undeclared key passes trivially).
 */
const FORBIDDEN_PROP_KEYS = new Set([
  "uid",
  "token",
  "email",
  "password",
  "secret",
  "authorization",
  "pseudonym",
]);

const TIERS = new Set<TelemetryTier>(["T0", "T1", "T2"]);

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/**
 * Validate ONE event against the registry and the §5 discipline. Returns `null` when
 * valid, or a human-readable reason.
 *
 * FAIL-CLOSED, and it REJECTS rather than strips: silently stripping an offending key
 * turns a leak into a green test. Shared by the host hygiene pass and the backend
 * ingest gate so the two can never drift into disagreeing about the same payload —
 * which is the whole lesson of R3-343.
 */
export const validateTelemetryEvent = (e: unknown): string | null => {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return "event must be an object";
  const ev = e as Record<string, unknown>;

  if (typeof ev.name !== "string") return "missing name";
  const def = telemetryEventDef(ev.name);
  if (def === null) return `unregistered event name: ${ev.name}`;

  if (typeof ev.at !== "string") return `${ev.name}: missing at`;
  if (typeof ev.tier !== "string" || !TIERS.has(ev.tier as TelemetryTier))
    return `${ev.name}: invalid tier`;
  // The ceiling is normative: `boot.*` must never become keyed, however it is emitted.
  if (TIER_RANK[ev.tier as TelemetryTier] > TIER_RANK[def.maxTier])
    return `${ev.name}: tier ${ev.tier} exceeds declared ceiling ${def.maxTier}`;

  if (ev.causationId !== undefined && typeof ev.causationId !== "string")
    return `${ev.name}: causationId must be a string`;

  if (ev.frames !== undefined) {
    if (!def.frames) return `${ev.name}: frames not permitted for this event`;
    if (!Array.isArray(ev.frames)) return `${ev.name}: frames must be an array`;
    if (ev.frames.length > TELEMETRY_MAX_FRAMES) return `${ev.name}: frames exceeds cap`;
    for (const f of ev.frames) {
      if (typeof f !== "string") return `${ev.name}: frame must be a string`;
      if (f.length > TELEMETRY_MAX_STR) return `${ev.name}: frame exceeds string cap`;
    }
  }

  if (ev.props !== undefined) {
    if (typeof ev.props !== "object" || ev.props === null || Array.isArray(ev.props))
      return `${ev.name}: props must be an object`;
    const entries = Object.entries(ev.props as Record<string, unknown>);
    if (entries.length > TELEMETRY_MAX_PROP_KEYS) return `${ev.name}: props exceeds key cap`;
    for (const [k, v] of entries) {
      if (FORBIDDEN_PROP_KEYS.has(k)) return `${ev.name}: forbidden prop key: ${k}`;
      if (!def.props.includes(k)) return `${ev.name}: undeclared prop key: ${k}`;
      if (!isScalar(v)) return `${ev.name}: props.${k} must be scalar (no payloads)`;
      if (typeof v === "string" && v.length > TELEMETRY_MAX_STR)
        return `${ev.name}: props.${k} exceeds string cap`;
    }
  }

  return null;
};

export type TelemetryBatchResult =
  | { ok: true; events: TelemetryEvent[]; dropped?: number }
  | { ok: false; reason: string; name?: string };

/**
 * Validate a POSTed batch.
 *
 * GRANULARITY, decided deliberately (and recorded in the spec rather than left to the
 * reader — R3-343's fourth deliverable): **an unregistered NAME rejects only its own
 * event; a props-discipline violation rejects the whole batch.** The two failures are
 * not the same failure. Whole-batch rejection exists so a LEAK fails a test (SE-2/3);
 * applied to a vocabulary drift it converts a rename into a total outage of the
 * stream, which is precisely what R3-343 measured — a single routinely-emitted
 * unregistered kind destroying up to 49 valid co-batched events per flush.
 *
 * Both outcomes are OBSERVABLE: the caller logs `rejected` with the offending names.
 * A fail-closed validator whose rejections are logged nowhere is indistinguishable
 * from a healthy empty stream.
 */
export const validateTelemetryBatch = (
  body: unknown,
): TelemetryBatchResult & { rejected?: { name: string; reason: string }[] } => {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.events)) return { ok: false, reason: "events must be an array" };
  if (b.events.length === 0) return { ok: false, reason: "empty batch" };
  if (b.events.length > TELEMETRY_MAX_BATCH) return { ok: false, reason: "batch exceeds size cap" };
  if (b.dropped !== undefined && typeof b.dropped !== "number")
    return { ok: false, reason: "dropped must be a number" };

  const accepted: TelemetryEvent[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const e of b.events) {
    const reason = validateTelemetryEvent(e);
    if (reason === null) {
      accepted.push(e as TelemetryEvent);
      continue;
    }
    const name = typeof (e as { name?: unknown })?.name === "string" ? (e as { name: string }).name : "<unnamed>";
    // A props/tier/frames violation is the LEAK case → whole batch rejects.
    if (!reason.startsWith("unregistered event name") && reason !== "event must be an object" && reason !== "missing name") {
      return { ok: false, reason, name };
    }
    rejected.push({ name, reason });
  }
  if (accepted.length === 0) return { ok: false, reason: "no registered events in batch", rejected };
  return {
    ok: true,
    events: accepted,
    ...(typeof b.dropped === "number" ? { dropped: b.dropped } : {}),
    ...(rejected.length > 0 ? { rejected } : {}),
  };
};
