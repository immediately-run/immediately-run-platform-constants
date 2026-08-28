// The shared security-events registry + validator
// (SECURITY_EVENTS_STREAM_SPEC §5.5 / Appendix A, roadmap R3-343).
//
// These are the gate tests at the VOCABULARY layer. The two-way drift gates (does every
// emitted kind resolve; does every registered kind have a producer) live in the repos
// that own the producers and the ingest seam, because only those repos can see them.

import {
  SECURITY_DETAIL_MAX_KEYS,
  SECURITY_DETAIL_MAX_STR,
  SECURITY_EVENT_KINDS,
  SECURITY_MAX_BATCH,
  classifySecurityKind,
  classifySecuritySeverity,
  securityEventDef,
  securityEventKinds,
  validateSecurityBatch,
  validateSecurityEvent,
  type SecurityEvent,
} from "../src/securityEvents";

const ok = (over: Partial<SecurityEvent> = {}): SecurityEvent =>
  ({
    kind: "overlay:heal",
    severity: "low",
    at: "2026-08-26T10:00:00.000Z",
    detail: { phantomsSwept: 2 },
    ...over,
  }) as SecurityEvent;

describe("the registry is closed and self-describing", () => {
  it("every entry names the mitigation or threat it serves", () => {
    for (const [kind, def] of Object.entries(SECURITY_EVENT_KINDS)) {
      expect(typeof def.why).toBe("string");
      expect(def.why.length).toBeGreaterThan(10);
      // `<domain>:<event>` — the grammar the per-repo drift checks scan for. A kind
      // that does not match it is invisible to them, so the shape is asserted here.
      expect(kind).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
    }
  });

  it("holds EXACT kinds, never prefixes — no entry is a prefix of another", () => {
    // The predecessor was a prefix list, and that is what made "does anything still
    // produce this?" unanswerable. If an entry were a prefix of another, the same
    // ambiguity would be back.
    const kinds = securityEventKinds();
    for (const a of kinds) {
      for (const b of kinds) {
        if (a === b) continue;
        expect(b.startsWith(a)).toBe(false);
      }
    }
  });

  it("classifies every registered kind, and nothing else", () => {
    for (const kind of securityEventKinds()) expect(classifySecurityKind(kind)).not.toBeNull();
    expect(classifySecurityKind("gate:forbidden")).toBeNull(); // the retired name
    expect(classifySecurityKind("overlay-sweep:done")).toBeNull(); // the retired prefix
    expect(securityEventDef("constructor")).toBeNull(); // no prototype leakage
  });

  it("keeps the SE-6 severity split: abuse never reaches ERROR, integrity always does", () => {
    for (const [kind, def] of Object.entries(SECURITY_EVENT_KINDS)) {
      for (const sev of ["low", "medium", "high"] as const) {
        const out = classifySecuritySeverity(kind, sev);
        if (def.class === "abuse") expect(out).toBe("WARNING");
        if (def.class === "integrity") expect(out).toBe("ERROR");
      }
    }
    // `other` maps by the producer's own severity — this is what lets a `script-src`
    // CSP violation page while `connect-src` allowlist-tuning noise does not.
    expect(classifySecuritySeverity("csp:violation", "high")).toBe("ERROR");
    expect(classifySecuritySeverity("csp:violation", "medium")).toBe("WARNING");
    expect(classifySecuritySeverity("csp:violation", "low")).toBe("INFO");
  });

  it("carries the kinds whose absence blocked the stream (the R3-343 backfill)", () => {
    for (const kind of [
      "csp:violation",
      "capability:forbidden",
      "secrets:dev-prf-bypass-active",
      "registry:principal-claim-refused",
      "registry:layer2-chrome-moving-ref-refused",
      "overlay:heal",
      "artifact-integrity:distrust",
      "bundle-extent:outside-write",
      "focus:denied-no-activation",
      "focus:rate-limited",
      "focus:cross-activity-denied",
      "chrome:activity-dropped",
    ]) {
      expect(securityEventDef(kind)).not.toBeNull();
    }
  });

  it("does NOT carry the retired names, so the drift check has something to catch", () => {
    // Each of these was in the backend's `KIND_PREFIXES` and matched no live producer.
    // Keeping one as a spare slot is the second direction of the same bug.
    for (const kind of [
      "gate:forbidden",
      "config:refused",
      "consent:prompt-spam",
      "sdk-integrity:mismatch",
    ]) {
      expect(securityEventDef(kind)).toBeNull();
    }
  });
});

describe("validateSecurityEvent — §5.5, fail-closed", () => {
  it("accepts a registered event", () => {
    expect(validateSecurityEvent(ok())).toBeNull();
  });

  it("rejects an unregistered kind with the granularity-bearing prefix", () => {
    // `validateSecurityBatch` branches on this exact prefix. If it is reworded without
    // updating the batch validator, an unknown kind silently becomes a whole-batch
    // rejection again — the R3-343 outage. Asserted so the coupling is visible.
    expect(validateSecurityEvent(ok({ kind: "gate:forbidden" as never }))).toMatch(
      /^unknown kind: gate:forbidden$/,
    );
  });

  it("rejects non-objects, missing kind, bad severity and missing at", () => {
    expect(validateSecurityEvent(null)).toMatch(/must be an object/);
    expect(validateSecurityEvent([])).toMatch(/must be an object/);
    expect(validateSecurityEvent({ severity: "low", at: "x" })).toMatch(/missing kind/);
    expect(validateSecurityEvent(ok({ severity: "critical" as never }))).toMatch(
      /invalid severity/,
    );
    const noAt: Record<string, unknown> = { ...ok() };
    delete noAt.at;
    expect(validateSecurityEvent(noAt)).toMatch(/missing at/);
  });

  it("rejects — never strips — a forbidden detail key (SE-7)", () => {
    expect(validateSecurityEvent(ok({ detail: { uid: "u1" } }))).toMatch(
      /forbidden detail key: uid/,
    );
    expect(validateSecurityEvent(ok({ detail: { authorization: "Bearer x" } }))).toMatch(
      /forbidden detail key/,
    );
  });

  it("rejects a non-scalar detail value, an oversize string and too many keys", () => {
    expect(validateSecurityEvent(ok({ detail: { body: { a: 1 } } }))).toMatch(/must be scalar/);
    expect(
      validateSecurityEvent(ok({ detail: { path: "x".repeat(SECURITY_DETAIL_MAX_STR + 1) } })),
    ).toMatch(/exceeds string cap/);
    const wide: Record<string, number> = {};
    for (let i = 0; i <= SECURITY_DETAIL_MAX_KEYS; i++) wide[`k${i}`] = i;
    expect(validateSecurityEvent(ok({ detail: wide }))).toMatch(/detail exceeds key cap/);
  });

  it("accepts exactly the key cap (an off-by-one here would reject CSP reports)", () => {
    const atCap: Record<string, number> = {};
    for (let i = 0; i < SECURITY_DETAIL_MAX_KEYS; i++) atCap[`k${i}`] = i;
    expect(validateSecurityEvent(ok({ detail: atCap }))).toBeNull();
  });

  it("rejects an `undefined` detail value rather than treating it as absent", () => {
    // A producer that spreads an optional field writes the KEY with an `undefined`
    // value, and `Object.entries` sees it. It is not a scalar, so it rejects — which
    // is why the CSP producer must omit absent fields rather than spread them.
    expect(validateSecurityEvent(ok({ detail: { sourceFile: undefined } }))).toMatch(
      /must be scalar/,
    );
  });
});

describe("validateSecurityBatch — the granularity decision (R3-343)", () => {
  const registered = (i: number): SecurityEvent => ok({ detail: { i } });

  it("rejects only its own event for an unregistered kind, and lands the rest", () => {
    // THE regression test for the outage: one routinely-emitted unregistered kind used
    // to destroy up to 49 valid co-batched events per flush.
    const events = [
      ...Array.from({ length: 49 }, (_, i) => registered(i)),
      ok({ kind: "gate:forbidden" as never }),
    ];
    const res = validateSecurityBatch({ events });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events).toHaveLength(49);
    expect(res.rejected).toEqual([
      { kind: "gate:forbidden", reason: "unknown kind: gate:forbidden" },
    ]);
  });

  it("rejects the WHOLE batch for a detail-discipline violation (the leak case, SE-2/3)", () => {
    const events = [
      ...Array.from({ length: 3 }, (_, i) => registered(i)),
      ok({ detail: { uid: "u1" } }),
    ];
    const res = validateSecurityBatch({ events });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/forbidden detail key: uid/);
    expect(res.kind).toBe("overlay:heal");
  });

  it("rejects only the malformed event, not its 49 valid siblings", () => {
    // A kind-less or non-object event cannot leak — nothing about it is accepted — so
    // it is a vocabulary failure, not the SE-2/3 leak case. Grouping it with the leak
    // case would be the same availability trap in a different costume.
    const res = validateSecurityBatch({
      events: [registered(0), { severity: "low", at: "x" }, "not-an-object", registered(1)],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events).toHaveLength(2);
    expect(res.rejected?.map((r) => r.reason)).toEqual(["missing kind", "event must be an object"]);
  });

  it("names the offending kind on every rejection path, so a log line can carry it", () => {
    const all = validateSecurityBatch({
      events: [ok({ kind: "nope:at-all" as never })],
    });
    expect(all.ok).toBe(false);
    if (all.ok) return;
    expect(all.reason).toBe("no registered kinds in batch");
    expect(all.rejected).toEqual([{ kind: "nope:at-all", reason: "unknown kind: nope:at-all" }]);
  });

  it("enforces the envelope shape and the size cap", () => {
    expect(validateSecurityBatch(null)).toMatchObject({
      ok: false,
      reason: /must be an object/,
    });
    expect(validateSecurityBatch({})).toMatchObject({
      ok: false,
      reason: /events must be an array/,
    });
    expect(validateSecurityBatch({ events: [] })).toMatchObject({
      ok: false,
      reason: /empty batch/,
    });
    expect(
      validateSecurityBatch({
        events: Array.from({ length: SECURITY_MAX_BATCH + 1 }, (_, i) => registered(i)),
      }),
    ).toMatchObject({ ok: false, reason: /exceeds size cap/ });
    expect(validateSecurityBatch({ events: [ok()], session: 7 })).toMatchObject({
      ok: false,
      reason: /session/,
    });
    expect(validateSecurityBatch({ events: [ok()], dropped: "3" })).toMatchObject({
      ok: false,
      reason: /dropped/,
    });
  });

  it("carries `dropped` through instead of discarding it", () => {
    // The forwarder has always sent it and the backend has always thrown it away, so
    // `security-stream:forward-dropped` telemetry was lost. The result now surfaces it.
    const res = validateSecurityBatch({
      events: [ok()],
      dropped: 12,
      session: "s1",
    });
    expect(res).toMatchObject({ ok: true, dropped: 12, session: "s1" });
  });
});
