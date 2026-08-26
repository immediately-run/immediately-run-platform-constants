// The shared telemetry registry + validator (PLATFORM_TELEMETRY_SPEC §5, R3-344).
//
// These are the gate tests that live at the vocabulary layer. The transport-level and
// wire-level gates (G-TEL-1 storage, G-TEL-9 access-log correlation) live in the repos
// that own those seams.

import {
  TELEMETRY_EVENTS,
  TELEMETRY_MAX_BATCH,
  TELEMETRY_MAX_FRAMES,
  TELEMETRY_MAX_STR,
  telemetryEventDef,
  telemetryEventNames,
  validateTelemetryBatch,
  validateTelemetryEvent,
  type TelemetryEvent,
} from "../src/telemetry";

const ok = (over: Partial<TelemetryEvent> = {}): TelemetryEvent => ({
  name: "boot.ok",
  at: "2026-08-26T10:00:00.000Z",
  tier: "T0",
  props: { ms: 812, cold: true },
  ...over,
});

describe("the registry is closed and self-describing", () => {
  it("every entry names the §6 product question it answers", () => {
    for (const [name, def] of Object.entries(TELEMETRY_EVENTS)) {
      expect(typeof def.question).toBe("string");
      expect(def.question.length).toBeGreaterThan(10);
      expect(name).toMatch(/^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/); // <domain>.<event>
    }
  });

  it("no entry declares more props than the §5 key cap allows", () => {
    for (const def of Object.values(TELEMETRY_EVENTS)) {
      expect(def.props.length).toBeLessThanOrEqual(8);
    }
  });

  it("boot health is pinned at T0 — it must never become keyed", () => {
    expect(telemetryEventDef("boot.ok")?.maxTier).toBe("T0");
    expect(telemetryEventDef("boot.fail")?.maxTier).toBe("T0");
  });

  it("telemetryEventNames() is the sorted registry side of the drift check", () => {
    expect(telemetryEventNames()).toEqual([...telemetryEventNames()].sort());
    expect(telemetryEventNames()).toContain("session.start");
  });

  it("an unregistered name resolves to null rather than a default", () => {
    expect(telemetryEventDef("boot.definitely-not-a-thing")).toBeNull();
    // Prototype keys are not registry entries.
    expect(telemetryEventDef("toString")).toBeNull();
    expect(telemetryEventDef("constructor")).toBeNull();
  });
});

describe("§5 props discipline — fail-closed, rejects rather than strips", () => {
  it("accepts a well-formed event", () => {
    expect(validateTelemetryEvent(ok())).toBeNull();
  });

  it("rejects an unregistered event name", () => {
    expect(validateTelemetryEvent(ok({ name: "exfil.channel" }))).toMatch(/unregistered event name/);
  });

  it("rejects an UNDECLARED prop key rather than stripping it", () => {
    const reason = validateTelemetryEvent(ok({ props: { ms: 1, stowaway: "x" } }));
    expect(reason).toMatch(/undeclared prop key: stowaway/);
  });

  it("rejects a non-scalar prop — payloads never ride the wire", () => {
    const reason = validateTelemetryEvent(
      ok({ props: { ms: { nested: "payload" } } as unknown as Record<string, string> }),
    );
    expect(reason).toMatch(/must be scalar/);
  });

  it("rejects an over-long string prop", () => {
    const reason = validateTelemetryEvent(
      ok({ name: "app.run", tier: "T0", props: { coordinate: "a".repeat(TELEMETRY_MAX_STR + 1) } }),
    );
    expect(reason).toMatch(/exceeds string cap/);
  });

  it("rejects more than 8 prop keys", () => {
    const props: Record<string, number> = {};
    for (let i = 0; i < 9; i++) props[`k${i}`] = i;
    expect(validateTelemetryEvent(ok({ props }))).toMatch(/exceeds key cap/);
  });

  it("rejects identity keys even if something ever declared one", () => {
    // The declared-key check would already reject these; this is the backstop that
    // holds if a registry entry is ever edited carelessly.
    expect(validateTelemetryEvent(ok({ props: { uid: "u_123" } }))).toMatch(/forbidden prop key: uid/);
    expect(validateTelemetryEvent(ok({ props: { pseudonym: "abc" } }))).toMatch(/forbidden prop key/);
  });

  it("rejects a tier above the event's declared ceiling (G-TEL: boot stays unkeyed)", () => {
    expect(validateTelemetryEvent(ok({ tier: "T2" }))).toMatch(/exceeds declared ceiling T0/);
    expect(validateTelemetryEvent(ok({ tier: "T1" }))).toMatch(/exceeds declared ceiling T0/);
  });

  it("accepts a tier at or below the ceiling", () => {
    expect(validateTelemetryEvent({ name: "session.start", at: "x", tier: "T0" })).toBeNull();
    expect(validateTelemetryEvent({ name: "session.start", at: "x", tier: "T2" })).toBeNull();
  });
});

describe("frames are a registry-gated exception, not a payload accident", () => {
  it("rejects frames on an event whose def does not permit them", () => {
    expect(validateTelemetryEvent(ok({ frames: ["at foo (/src/a.ts:1:2)"] }))).toMatch(
      /frames not permitted/,
    );
  });

  it("accepts frames on an event whose def permits them", () => {
    expect(
      validateTelemetryEvent({
        name: "error.host",
        at: "x",
        tier: "T0",
        props: { name: "TypeError", fingerprint: "a1b2c3d4" },
        frames: ["at render (/static/js/main.abc.js:1:2345)"],
      }),
    ).toBeNull();
  });

  it("caps the frame list and each frame length", () => {
    const ev = (frames: unknown[]) => ({ name: "error.host", at: "x", tier: "T0" as const, frames });
    expect(validateTelemetryEvent(ev(Array.from({ length: TELEMETRY_MAX_FRAMES + 1 }, () => "f")))).toMatch(
      /frames exceeds cap/,
    );
    expect(validateTelemetryEvent(ev(["a".repeat(TELEMETRY_MAX_STR + 1)]))).toMatch(/frame exceeds string cap/);
    expect(validateTelemetryEvent(ev([42]))).toMatch(/frame must be a string/);
  });

  it("G-TEL-5 — the app error row has NO frames key at all, so it cannot grow one by accident", () => {
    // The operator row for an app error is content-free BY CONSTRUCTION: the def does
    // not set `frames`, so the validator refuses them outright rather than relying on a
    // producer remembering to strip them.
    expect(telemetryEventDef("error.app")?.frames).toBeUndefined();
    expect(
      validateTelemetryEvent({
        name: "error.app",
        at: "x",
        tier: "T0",
        frames: ["at handler (/app/src/patients.tsx:42:7)"],
      }),
    ).toMatch(/frames not permitted/);
  });

  it("every error-class event stays pinned at T0 — an error row is not a measurement of a person", () => {
    for (const name of ["error.host", "error.app", "csp.violation"]) {
      expect(telemetryEventDef(name)?.maxTier).toBe("T0");
      expect(telemetryEventDef(name)?.class).toBe("error");
    }
  });
});

describe("batch granularity — the R3-343 decision, asserted", () => {
  it("an unregistered NAME rejects only its own event; the co-batched valid ones land", () => {
    const events = [
      ...Array.from({ length: 49 }, () => ok()),
      { name: "csp.violation-not-yet-registered", at: "x", tier: "T0" as const },
    ];
    const result = validateTelemetryBatch({ events });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(49);
    // ...and the rejection is REPORTABLE — silence is what made R3-343 invisible.
    expect(result.rejected).toEqual([
      { name: "csp.violation-not-yet-registered", reason: expect.stringMatching(/unregistered/) },
    ]);
  });

  it("a props-discipline violation — the LEAK case — still rejects the WHOLE batch", () => {
    const events = [
      ...Array.from({ length: 10 }, () => ok()),
      ok({ props: { ms: 1, leaked: "/home/peter/private/repo/secrets.env" } }),
    ];
    const result = validateTelemetryBatch({ events });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/undeclared prop key: leaked/);
    expect(result.name).toBe("boot.ok");
  });

  it("a batch of only-unregistered events is a rejection, not an empty success", () => {
    const result = validateTelemetryBatch({ events: [{ name: "nope.nope", at: "x", tier: "T0" }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no registered events/);
  });

  it("rejects a malformed or oversize batch envelope", () => {
    expect(validateTelemetryBatch(null).ok).toBe(false);
    expect(validateTelemetryBatch({}).ok).toBe(false);
    expect(validateTelemetryBatch({ events: [] }).ok).toBe(false);
    expect(
      validateTelemetryBatch({ events: Array.from({ length: TELEMETRY_MAX_BATCH + 1 }, () => ok()) }).ok,
    ).toBe(false);
    expect(validateTelemetryBatch({ events: [ok()], dropped: "many" }).ok).toBe(false);
  });

  it("carries the forwarder's `dropped` count through instead of discarding it", () => {
    // R3-343's "minor, same area": the security-events backend validated only
    // `events`/`session` and silently discarded `dropped`, losing the forward-drop
    // telemetry the client was already paying to send.
    const result = validateTelemetryBatch({ events: [ok()], dropped: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toBe(7);
  });
});

describe("G-TEL-4 — PII planted in an ALLOWLISTED key", () => {
  // The gate deliberately plants in a DECLARED key: a test that only plants in an
  // undeclared key passes trivially and proves nothing. The vocabulary layer cannot
  // reject this by shape — `coordinate` is a declared string — so the control is
  // §6's rule that private/local coordinates arrive already salted-hashed, enforced
  // at the producer. This test pins the boundary of what THIS layer promises, so the
  // producer-side gate is not mistaken for redundant.
  it("a declared string key is accepted by the vocabulary layer — the control is upstream", () => {
    const leaky = {
      name: "app.run",
      at: "x",
      tier: "T0" as const,
      props: { coordinate: "/home/peter/private/notes.txt", coordinateClass: "public" },
    };
    expect(validateTelemetryEvent(leaky)).toBeNull();
    // Documented here so the producer-side hashing gate is never dropped as
    // "already covered by validation". It is not.
  });
});
