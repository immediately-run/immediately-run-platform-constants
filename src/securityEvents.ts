// The shared §8.14 OPERATOR SECURITY-EVENTS registry — ONE vocabulary, imported by
// both the host (`site-main`, the producer) and the backend (the fail-closed ingest
// validator). (SECURITY_EVENTS_STREAM_SPEC §5.5 / Appendix A, roadmap R3-343.)
//
// WHY THIS IS HERE AND NOT IN THE BACKEND
// ---------------------------------------
// It used to be in the backend: a hand-written `KIND_PREFIXES` list in
// `immediately-run-backend/src/securityEvents.ts`, mirrored from nothing, kept true by
// review. It was not true. Measured on production over 30 days (R3-343): **298 of 300
// sampled `POST /api/v1/security-events` returned `400`** and exactly ONE event reached
// the durable sink. Producers had been renamed on the `site-main` side —
// `gate:forbidden` → `capability:forbidden`, `overlay-sweep:` → `overlay:heal`,
// `config:refused` retired outright — and nothing re-checked the other side of the repo
// boundary. A prefix list only the consumer holds cannot be kept true by review, so the
// vocabulary lives in the one package both repos already depend on.
//
// The sibling telemetry registry in `./telemetry.ts` was built (R3-344) with R3-343's
// lesson already in hand; this module is that lesson applied back to the stream that
// taught it.
//
// EXACT KINDS, NOT PREFIXES. The prefix list was not merely stale, it was
// UNAUDITABLE in both directions:
//   - a near-miss silently failed (`overlay:heal` vs the `overlay-sweep:` prefix), and
//   - "is anything still producing this entry?" was unanswerable, because a prefix
//     matches names nobody has ever emitted. `net-fetch:ssrf-refused` sat in the list
//     with NO producer anywhere, so §6's T40 SSRF alerting could never fire while
//     reading as working coverage on inspection.
// A closed table of exact kinds makes both questions decidable, which is what lets
// `check-security-events-registry.mjs` run in BOTH directions in BOTH repos.
//
// THIS REGISTRY IS CLOSED, AND EVERY ENTRY HAS A LIVE PRODUCER. An entry whose
// producer is retired is REMOVED, not left as a spare slot — a registered kind with
// nothing emitting it is a silent coverage gap. The removals, and the follow-up work
// each implies, are recorded in `SECURITY_EVENTS_STREAM_SPEC` Appendix A.

/** Producer-declared severity of one event (unchanged from the §5.2 wire shape). */
export type SecuritySeverity = "low" | "medium" | "high";

/**
 * The §5.4 routing class. It decides the Cloud Logging severity, and therefore which
 * bucket the event lands in and whether it can page.
 *
 * - `integrity` — an integrity breach. ERROR unconditionally; ~never fires in healthy
 *   production, so it is safe to page on.
 * - `abuse`     — abuse telemetry. WARNING unconditionally, because these are EXPECTED
 *   under attack and a paging alert on them is a denial-of-service against the operator
 *   (SE-6). Counters and rate alerts read them; nothing pages.
 * - `other`     — host-internal signal, mapped by the producer's own severity
 *   (low→INFO, medium→WARNING, high→ERROR).
 */
export type SecurityEventClass = "integrity" | "abuse" | "other";

export interface SecurityEventDef {
  readonly class: SecurityEventClass;
  /**
   * The §6 mitigation or threat this kind serves, and the producer that emits it.
   * An entry that cannot name one does not belong here — that is the property that
   * keeps the registry from re-growing spare slots.
   */
  readonly why: string;
}

/**
 * The closed kind vocabulary. Adding a kind here is an amendment to
 * `SECURITY_EVENTS_STREAM_SPEC` Appendix A, and the two-way drift check in each repo
 * requires it to have a producer before it can land.
 */
export const SECURITY_EVENT_KINDS = {
  // ── integrity breach → ERROR, pages ───────────────────────────────────────
  // A cache zip whose contents disagree with its own signed sidecar. Producer:
  // site-main `src/filesystem/zipIntegrity.ts` (`reportZipIntegrityFailure`).
  "zip-integrity:coordinate-mismatch": {
    class: "integrity",
    why: "A zip's sidecar names a different repo than the load request — the PR-redirection / baseline-poisoning shape (RL-1 / CT-1).",
  },
  "zip-integrity:blob-mismatch": {
    class: "integrity",
    why: "A file's content does not hash to the blob SHA its manifest entry claims.",
  },
  "zip-integrity:tree-mismatch": {
    class: "integrity",
    why: "The manifest's tree does not reconstruct the commit's tree SHA.",
  },
  "zip-integrity:extra-entries": {
    class: "integrity",
    why: "The zip carries entries the (untruncated) manifest does not list — content smuggled past the manifest.",
  },
  "zip-integrity:commit-tree-mismatch": {
    class: "integrity",
    why: "The commit object does not point at the tree the manifest reconstructs.",
  },
  // Producer: site-main `src/editor/artifactTrust.ts`.
  "artifact-integrity:distrust": {
    class: "integrity",
    why: "A pre-transpiled artifact for this commit failed spot-verification, so every artifact for the commit is distrusted (PRETRANSPILED_ARTIFACTS_SPEC §5.7).",
  },
  // Producers: site-main `src/registry/resolveRegistry.ts`.
  "registry:layer2-chrome-moving-ref-refused": {
    class: "integrity",
    why: "A deployment-layer override of a CHROME region named a moving ref instead of a SHA pin and was dropped for the build default (UI_AS_APPS_SPEC §3.3 / T3).",
  },
  "registry:principal-claim-refused": {
    class: "integrity",
    why: "A non-build-default binding tried to claim a broad-elevated / first-party principal — attempted privilege escalation via the principal sugar (R3-98 S2).",
  },
  // Producers: site-main `src/registry/fetchRelease.ts` + `src/registry/releaseLock.ts`.
  "release:unpinned-refused": {
    class: "integrity",
    why: "A production config named a UI release with no `sha256` pin. The pin is the only integrity anchor not living on the registry origin being defended against (UI_RELEASES_SPEC §4.1).",
  },
  "release:digest-mismatch": {
    class: "integrity",
    why: "A fetched release lock did not match its index digest or its deployment pin.",
  },
  "release:entry-invalid": {
    class: "integrity",
    why: "A release lock entry failed structural validation — a malformed or hostile lock on the shared registry origin.",
  },
  "release:first-party-caps-stripped": {
    class: "integrity",
    why: "A release repointed a region and its first-party-only capabilities were stripped (UI_RELEASES_SPEC §6.1b) — a release carries code, never authority.",
  },
  // Producer: site-main `src/secrets/crypto/devPrfAuthenticator.ts`.
  "secrets:dev-prf-bypass-active": {
    class: "integrity",
    why: "The dev PRF unseal bypass is armed. It cannot arm in a production bundle (the §5.3 sentinel gate); if this is ever seen from production, the guardrail failed.",
  },

  // ── abuse telemetry → WARNING, never pages (SE-6) ─────────────────────────
  // Producer: site-main `src/editor/requestDispatcher.ts` (`emitForbidden`).
  "capability:forbidden": {
    class: "abuse",
    why: "The §8.4 gate refused an app→host call. The T24 probing-detection signal — high traffic by design, so it must never page. Renamed from `gate:forbidden`, which is the rename R3-343 caught.",
  },
  // Producer: site-main `src/editor/netFetchHandler.ts`.
  "net-fetch:ssrf-refused": {
    class: "abuse",
    why: "A `net:fetch` named an SSRF-blocked host and was refused before any request left the browser (§5.11 / T40).",
  },
  // Producer: site-main `src/filesystem/securityEvents.ts` (the T46 limiter itself).
  "security-stream:app-flooding": {
    class: "abuse",
    why: "An app exceeded its per-window event budget and is itself a flagged anomaly (T46) — an app must not be able to bury a real signal.",
  },
  // Producer: backend `src/app.ts` (the ingest endpoint), from the forwarder envelope.
  "security-stream:forward-dropped": {
    class: "abuse",
    why: "The host forwarder dropped events at its buffer cap before this batch. Recorded so a drop-capped stream is visible rather than merely shorter — the count was previously sent and discarded.",
  },
  // Producers: site-main `src/editor/chrome/columnFocus.ts`.
  "focus:denied-no-activation": {
    class: "abuse",
    why: "A column-focus transfer was requested without a real user gesture and was refused (FT-1 / FT-6).",
  },
  "focus:rate-limited": {
    class: "abuse",
    why: "Column-focus transfers exceeded the flicker budget (FT-3, capacity-class and fail-open).",
  },

  // ── host-internal signal → severity-mapped ────────────────────────────────
  // Producer: site-main `src/filesystem/overlaySweep.ts`.
  "overlay:heal": {
    class: "other",
    why: "The overlay sweep healed phantom entries or evicted a legacy migration (R3-28). Renamed from `overlay-sweep:`, the second rename R3-343 caught.",
  },
  // Producer: site-main `src/filesystem/extentObservations.ts`.
  "bundle-extent:outside-write": {
    class: "other",
    why: "A write landed outside its bundle's declared extent. C0 OBSERVES — nothing was refused, and the row is about the declaration mismatch, not an incident.",
  },
  // Producers: site-main `src/registry/fetchRelease.ts` + `src/registry/releaseLock.ts`.
  "release:fetch-failed": {
    class: "other",
    why: "The release index or lock could not be fetched or timed out; the build-in fallback was used.",
  },
  "release:unknown-region": {
    class: "other",
    why: "A release lock named a region this build does not know — a forward-compatible lock, or a typo.",
  },
  "release:region-missing": {
    class: "other",
    why: "A release lock omitted a region this build expects, which resolves from the build default.",
  },
  // Producer: site-main `src/registry/activities.ts`, emitted from `ContentViewer`.
  "chrome:activity-dropped": {
    class: "other",
    why: "An activity referenced a region no layer binds, so it was dropped from the rail rather than rendering a dead affordance.",
  },
  // Producer: site-main `src/security/cspReport.ts`.
  //
  // CLASS IS `other`, DELIBERATELY. `integrity` would map every CSP report to ERROR,
  // and while the header is `Report-Only` the ordinary `connect-src`/`img-src` reports
  // are allowlist-tuning noise. The producer's own severity carries the distinction —
  // a `script-src` violation (the XSS-relevant one) is `high` → ERROR and pages; the
  // structural TCB directives are `medium` → WARNING; the rest are `low` → INFO.
  "csp:violation": {
    class: "other",
    why: "Something was blocked by the host-origin CSP. HOST_ORIGIN_HARDENING_SPEC §2.1 requires these reports reach a backend-owned endpoint; R3-343 measured them reaching it and being discarded.",
  },
} as const satisfies Record<string, SecurityEventDef>;

export type SecurityEventKind = keyof typeof SECURITY_EVENT_KINDS;

/** All registered kinds, sorted — the drift check's "registry side". */
export const securityEventKinds = (): string[] => Object.keys(SECURITY_EVENT_KINDS).sort();

/** The definition for `kind`, or `null` if unregistered (→ reject that event). */
export const securityEventDef = (kind: string): SecurityEventDef | null =>
  Object.prototype.hasOwnProperty.call(SECURITY_EVENT_KINDS, kind)
    ? (SECURITY_EVENT_KINDS as Record<string, SecurityEventDef>)[kind]
    : null;

/** The §5.4 class of a kind, or `null` if the kind is not registered. */
export const classifySecurityKind = (kind: string): SecurityEventClass | null =>
  securityEventDef(kind)?.class ?? null;

/**
 * Cloud Logging severity (the SE-6 split): `integrity`→ERROR, `abuse`→WARNING,
 * `other`→by the producer's own severity. An UNREGISTERED kind maps as `other` so a
 * caller that logs one anyway (the rejection record) still gets a sane severity — it
 * is never a path to acceptance, which `validateSecurityEvent` owns.
 */
export const classifySecuritySeverity = (
  kind: string,
  severity: SecuritySeverity,
): "ERROR" | "WARNING" | "INFO" => {
  const cls = classifySecurityKind(kind);
  if (cls === "integrity") return "ERROR";
  if (cls === "abuse") return "WARNING";
  return severity === "high" ? "ERROR" : severity === "medium" ? "WARNING" : "INFO";
};

// ── The wire event (§5.2) ────────────────────────────────────────────────────

export interface SecurityEvent {
  /** Registry-resolved, `<domain>:<event>`. Typed as the union at the producer seam,
   *  so an unregistered kind is a COMPILE error in `site-main` and the runtime check
   *  below is the backstop for anything that reaches the wire another way. */
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  detail?: Record<string, unknown>;
  /**
   * Attributing app when the event was caused by a specific app's call. Recorded ONLY
   * as an UNVERIFIED label unless the batch was App-Check-attested (SE-5) — never
   * trusted for alerting or auto-mitigation on its own.
   */
  app?: string;
  /** Dedup count: identical repeats coalesced into this entry (T46). */
  repeated?: number;
  /** ISO timestamp, stamped on emit. */
  at: string;
}

export interface SecurityEventBatch {
  events: SecurityEvent[];
  /** Opaque session id — no identity, no cross-session linkage (SE-7). */
  session?: string;
  /** Count of events the host forwarder dropped at its buffer cap since the last
   *  batch (drop-cap, never grow). */
  dropped?: number;
}

// ── §5.5 detail discipline ───────────────────────────────────────────────────

/** Batch size cap — mirrors the host forwarder's `DEFAULT_MAX_BATCH`. */
export const SECURITY_MAX_BATCH = 50;
/** At most 8 keys per `detail`. */
export const SECURITY_DETAIL_MAX_KEYS = 8;
/** Detail strings capped at 256 characters. */
export const SECURITY_DETAIL_MAX_STR = 256;

/** Identity/secret keys that must NEVER be written to the retained log (SE-7). */
const FORBIDDEN_DETAIL_KEYS = new Set([
  "uid",
  "token",
  "email",
  "password",
  "secret",
  "authorization",
]);

const SEVERITIES = new Set<SecuritySeverity>(["low", "medium", "high"]);

/**
 * The reasons that reject ONE event rather than the batch: the event names no entry in
 * the vocabulary, or it is too malformed to name one. Kept next to the strings
 * {@link validateSecurityEvent} produces, because the two are a coupling — reword one
 * without the other and an unknown kind silently becomes a whole-batch rejection
 * again, which is the R3-343 outage.
 */
const VOCABULARY_FAILURE = /^(unknown kind:|missing kind$|event must be an object$)/;

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/**
 * Validate ONE event against the registry and the §5.5 discipline. Returns `null`
 * when valid, or a human-readable reason.
 *
 * FAIL-CLOSED, and it REJECTS rather than strips: silently stripping an offending
 * detail key turns a leak into a green test (SE-2/3). Shared by the host hygiene pass
 * and the backend ingest gate so the two can never drift into disagreeing about the
 * same payload — which is the whole lesson of R3-343.
 *
 * The reason string for an unregistered kind is load-bearing: `validateSecurityBatch`
 * matches on the `unknown kind:` prefix to decide granularity, so keep it stable.
 */
export const validateSecurityEvent = (e: unknown): string | null => {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return "event must be an object";
  const ev = e as Record<string, unknown>;

  if (typeof ev.kind !== "string") return "missing kind";
  if (securityEventDef(ev.kind) === null) return `unknown kind: ${ev.kind}`;

  if (typeof ev.severity !== "string" || !SEVERITIES.has(ev.severity as SecuritySeverity))
    return `${ev.kind}: invalid severity`;
  if (typeof ev.at !== "string") return `${ev.kind}: missing at`;
  if (ev.app !== undefined && typeof ev.app !== "string") return `${ev.kind}: app must be a string`;
  if (ev.repeated !== undefined && typeof ev.repeated !== "number")
    return `${ev.kind}: repeated must be a number`;

  if (ev.detail !== undefined) {
    if (typeof ev.detail !== "object" || ev.detail === null || Array.isArray(ev.detail))
      return `${ev.kind}: detail must be an object`;
    const entries = Object.entries(ev.detail as Record<string, unknown>);
    if (entries.length > SECURITY_DETAIL_MAX_KEYS) return `${ev.kind}: detail exceeds key cap`;
    for (const [k, v] of entries) {
      if (FORBIDDEN_DETAIL_KEYS.has(k)) return `${ev.kind}: forbidden detail key: ${k}`;
      if (!isScalar(v)) return `${ev.kind}: detail.${k} must be scalar (no payloads)`;
      if (typeof v === "string" && v.length > SECURITY_DETAIL_MAX_STR)
        return `${ev.kind}: detail.${k} exceeds string cap`;
    }
  }

  return null;
};

/** One rejected event, named so an operator query can group by it. */
export interface SecurityRejection {
  kind: string;
  reason: string;
}

export type SecurityBatchResult =
  | {
      ok: true;
      events: SecurityEvent[];
      session?: string;
      dropped?: number;
      rejected?: SecurityRejection[];
    }
  | {
      ok: false;
      reason: string;
      kind?: string;
      rejected?: SecurityRejection[];
    };

/**
 * Validate a POSTed batch (§5.5).
 *
 * GRANULARITY, decided deliberately and recorded here rather than left to the reader
 * (R3-343's fourth deliverable): **an unregistered KIND rejects only its own event; a
 * DETAIL-discipline violation rejects the whole batch.**
 *
 * The two failures are not the same failure, and the original rule treated them as
 * one. Whole-batch rejection exists so a LEAK fails a test (SE-2/3) — an unknown
 * `detail` key might be the leak, and stripping it quietly is exactly what SE-2/3
 * forbids, so the whole batch still goes. Applied to a VOCABULARY DRIFT the same rule
 * converts a rename into a total outage of the stream: the host forwarder buffers up
 * to 50 events per POST, so one routinely-emitted unregistered kind
 * (`capability:forbidden`, on every refused app→host call) destroyed up to 49 valid
 * co-batched events per flush. That is not a leak defence, it is an availability bug
 * wearing one.
 *
 * Both outcomes are OBSERVABLE — the caller logs `rejected` with the offending kinds.
 * A fail-closed validator whose rejections are logged nowhere is indistinguishable
 * from a healthy empty stream, which is precisely how R3-343 presented for a month.
 */
export const validateSecurityBatch = (body: unknown): SecurityBatchResult => {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return { ok: false, reason: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.events)) return { ok: false, reason: "events must be an array" };
  if (b.events.length === 0) return { ok: false, reason: "empty batch" };
  if (b.events.length > SECURITY_MAX_BATCH) return { ok: false, reason: "batch exceeds size cap" };
  if (b.session !== undefined && typeof b.session !== "string")
    return { ok: false, reason: "session must be a string" };
  if (b.dropped !== undefined && typeof b.dropped !== "number")
    return { ok: false, reason: "dropped must be a number" };

  const accepted: SecurityEvent[] = [];
  const rejected: SecurityRejection[] = [];
  for (const e of b.events) {
    const reason = validateSecurityEvent(e);
    if (reason === null) {
      accepted.push(e as SecurityEvent);
      continue;
    }
    const kind =
      typeof (e as { kind?: unknown })?.kind === "string"
        ? (e as { kind: string }).kind
        : "<unnamed>";
    // Anything that is NOT "this event names no vocabulary entry" is the leak case,
    // and the leak case still rejects the whole batch. A malformed or kind-less event
    // is grouped with the vocabulary failures deliberately: it cannot leak (nothing
    // about it is accepted), so rejecting 49 valid siblings over it would be the same
    // availability trap in a different costume.
    if (!VOCABULARY_FAILURE.test(reason)) {
      return {
        ok: false,
        reason,
        kind,
        rejected: [...rejected, { kind, reason }],
      };
    }
    rejected.push({ kind, reason });
  }
  if (accepted.length === 0) return { ok: false, reason: "no registered kinds in batch", rejected };
  return {
    ok: true,
    events: accepted,
    ...(typeof b.session === "string" ? { session: b.session } : {}),
    ...(typeof b.dropped === "number" ? { dropped: b.dropped } : {}),
    ...(rejected.length > 0 ? { rejected } : {}),
  };
};
