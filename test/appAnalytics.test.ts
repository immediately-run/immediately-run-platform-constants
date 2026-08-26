// R3-350 gate tests at the vocabulary layer (APP_ANALYTICS_SPEC §3 / §5).
//
//   G-AN-1  an undeclared key is REJECTED, nothing stripped
//   G-AN-2  a non-enumerated string is rejected at the boundary
//   G-AN-3  emit on `/patients/12345` transmits only `/patients/:id`
//   G-AN-11 altering the manifest vocabulary changes the hash (→ re-consent)
//   T-AN-10 an app event name cannot impersonate a host event

import {
  APP_MAX_EVENTS_PER_USER_PER_DAY,
  APP_VOCAB_MAX_SHAPES,
  canonicalVocabulary,
  matchRoutePattern,
  validateAppEvent,
  validateVocabulary,
  vocabularyBits,
  vocabularyHash,
  vocabularyShapeCount,
  type AppAnalyticsVocabulary,
} from "../src/appAnalytics";

const VOCAB: AppAnalyticsVocabulary = {
  events: {
    "clinic.viewPatient": {
      props: {
        tab: { type: "enum", values: ["summary", "meds", "notes"] },
        starred: { type: "boolean" },
        ageBand: { type: "number", min: 0, max: 9 },
      },
    },
    "clinic.export": { props: { format: { type: "enum", values: ["pdf", "csv"] } } },
  },
  routes: ["/patients/:id", "/patients", "/settings/:section/detail"],
};

// ─────────────────────────────────────────────────────────────────────────────
describe("the declared vocabulary is validated fail-closed", () => {
  it("accepts a well-formed vocabulary", () => {
    expect(validateVocabulary(VOCAB)).toBeNull();
  });

  it("G-AN-2 — a string property MUST be a bounded enumeration", () => {
    // The difference between a bound that is computed and one that is hoped for. §12
    // predicts this is the first thing a publisher will ask to relax.
    expect(
      validateVocabulary({ events: { "a.b": { props: { note: { type: "enum" } } } } }),
    ).toMatch(/bounded enumeration/);
    expect(
      validateVocabulary({ events: { "a.b": { props: { note: { type: "enum", values: [] } } } } }),
    ).toMatch(/bounded enumeration/);
  });

  it("a numeric property must declare an INTEGRAL range — a real range is unbounded", () => {
    expect(validateVocabulary({ events: { "a.b": { props: { x: { type: "number" } } } } })).toMatch(/finite range/);
    expect(
      validateVocabulary({ events: { "a.b": { props: { x: { type: "number", min: 0, max: 1.5 } } } } }),
    ).toMatch(/integral/);
    expect(
      validateVocabulary({ events: { "a.b": { props: { x: { type: "number", min: 9, max: 1 } } } } }),
    ).toMatch(/inverted range/);
  });

  it("T-AN-10 — an app event name cannot impersonate a host event", () => {
    // App events land in a separate table anyway; a name that READS like a host event
    // would still mislead every human looking at a dashboard.
    for (const name of ["session.start", "boot.ok", "app.run", "llm.call", "error.host"]) {
      expect(validateVocabulary({ events: { [name]: {} } })).toMatch(/collides with the host vocabulary/);
    }
  });

  it("rejects an unnamespaced or malformed event name", () => {
    expect(validateVocabulary({ events: { viewPatient: {} } })).toMatch(/invalid event name/);
    expect(validateVocabulary({ events: { "Clinic.View": {} } })).toMatch(/invalid event name/);
    expect(validateVocabulary({ events: { "a.b.c": {} } })).toMatch(/invalid event name/);
  });

  it("rejects a malformed route pattern", () => {
    expect(validateVocabulary({ ...VOCAB, routes: ["patients/:id"] })).toMatch(/invalid route pattern/);
    expect(validateVocabulary({ ...VOCAB, routes: ["/patients/*"] })).toMatch(/invalid route pattern/);
  });

  it("a vocabulary declaring nothing is refused rather than treated as harmless", () => {
    expect(validateVocabulary({ events: {} })).toMatch(/declares no events/);
    expect(validateVocabulary(null)).toMatch(/must be an object/);
    expect(validateVocabulary([])).toMatch(/must be an object/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5.1 — the capacity is computed, not asserted away", () => {
  it("counts the cross-product of the declared alphabet", () => {
    // viewPatient: 3 tabs × 2 booleans × 10 age bands = 60; export: 2. Total 62.
    expect(vocabularyShapeCount(VOCAB)).toBe(62);
    expect(vocabularyBits(VOCAB)).toBeCloseTo(Math.log2(62), 5);
  });

  it("refuses the manifest that looks reasonable and is not", () => {
    // §5.1's own example: 8 properties of 16 enum values each. Written out as a
    // manifest this looks entirely modest; it is 4.3 BILLION shapes for one event name,
    // ~32 bits per event before the name alphabet is counted at all.
    const props: Record<string, { type: "enum"; values: string[] }> = {};
    for (let i = 0; i < 8; i++) {
      props[`p${i}`] = { type: "enum", values: Array.from({ length: 16 }, (_, j) => `v${j}`) };
    }
    const huge = { events: { "a.b": { props } } };
    expect(vocabularyShapeCount(huge)).toBe(16 ** 8);
    expect(validateVocabulary(huge)).toMatch(/distinct emit-shapes/);
  });

  it("caps the total at 2^12 emit-shapes", () => {
    expect(APP_VOCAB_MAX_SHAPES).toBe(4096);
    const atCap = {
      events: { "a.b": { props: { x: { type: "number" as const, min: 1, max: APP_VOCAB_MAX_SHAPES } } } },
    };
    expect(validateVocabulary(atCap)).toBeNull();
    const overCap = {
      events: { "a.b": { props: { x: { type: "number" as const, min: 1, max: APP_VOCAB_MAX_SHAPES + 1 } } } },
    };
    expect(validateVocabulary(overCap)).toMatch(/distinct emit-shapes/);
  });

  it("an overflowing cross-product is INFINITE, not a small number", () => {
    // A naive implementation overflows to `Infinity` and then compares as "not more
    // than the cap" — or worse, wraps. Guarded explicitly.
    const props: Record<string, { type: "number"; min: number; max: number }> = {};
    for (let i = 0; i < 8; i++) props[`p${i}`] = { type: "number", min: 0, max: 1_000_000_000 };
    expect(vocabularyShapeCount({ events: { "a.b": { props } } })).toBe(Number.POSITIVE_INFINITY);
    expect(validateVocabulary({ events: { "a.b": { props } } })).toMatch(/unboundedly many/);
  });

  it("the per-user daily cap is a published number, not an implementation detail", () => {
    // §5.1: the cap is published in the consent line's detail, so the bargain the user
    // is agreeing to is stated rather than discovered.
    expect(APP_MAX_EVENTS_PER_USER_PER_DAY).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("G-AN-11 — the vocabulary hash binds the grant", () => {
  it("is stable across key ORDER — a reformat is not a new bargain", () => {
    // Forcing re-consent on a formatting change trains users to click through the
    // prompt that matters.
    const reordered: AppAnalyticsVocabulary = {
      events: {
        "clinic.export": VOCAB.events["clinic.export"],
        "clinic.viewPatient": {
          props: {
            ageBand: { type: "number", min: 0, max: 9 },
            starred: { type: "boolean" },
            tab: { type: "enum", values: ["notes", "summary", "meds"] },
          },
        },
      },
      routes: ["/settings/:section/detail", "/patients", "/patients/:id"],
    };
    expect(vocabularyHash(reordered)).toBe(vocabularyHash(VOCAB));
    expect(canonicalVocabulary(reordered)).toBe(canonicalVocabulary(VOCAB));
  });

  it("CHANGES when the alphabet changes — which is what invalidates the grant", () => {
    // §2.1: `appKey` carries no ref, so a publisher can ship new code to the same
    // repository under an existing grant. Without this, they could observe their
    // aggregates and then retune the alphabet to encode what they now want to read.
    const widened: AppAnalyticsVocabulary = {
      ...VOCAB,
      events: {
        ...VOCAB.events,
        "clinic.viewPatient": {
          props: {
            ...VOCAB.events["clinic.viewPatient"].props,
            tab: { type: "enum", values: ["summary", "meds", "notes", "billing"] },
          },
        },
      },
    };
    expect(vocabularyHash(widened)).not.toBe(vocabularyHash(VOCAB));
  });

  it("changes on a new event name, a new prop, a widened range, or a new route", () => {
    const base = vocabularyHash(VOCAB);
    expect(vocabularyHash({ ...VOCAB, events: { ...VOCAB.events, "clinic.print": {} } })).not.toBe(base);
    expect(vocabularyHash({ ...VOCAB, routes: [...(VOCAB.routes ?? []), "/admin"] })).not.toBe(base);
    expect(
      vocabularyHash({
        ...VOCAB,
        events: {
          ...VOCAB.events,
          "clinic.export": { props: { format: { type: "enum", values: ["pdf", "csv", "xlsx"] } } },
        },
      }),
    ).not.toBe(base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("G-AN-3 — routes are patterns, and the variable segment is discarded", () => {
  it("emit on `/patients/12345` reduces to `/patients/:id`", () => {
    expect(matchRoutePattern("/patients/12345", VOCAB.routes!)).toBe("/patients/:id");
    // The id is nowhere in the result. That is the whole point: a raw path is content,
    // and `/patients/12345` is not a page name.
    expect(matchRoutePattern("/patients/12345", VOCAB.routes!)).not.toContain("12345");
  });

  it("a query string is never considered — no payload smuggled past the matcher", () => {
    expect(matchRoutePattern("/patients/12345?ssn=123-45-6789", VOCAB.routes!)).toBe("/patients/:id");
    expect(matchRoutePattern("/patients/1#secret", VOCAB.routes!)).toBe("/patients/:id");
  });

  it("an UNDECLARED path yields null — no row, rather than a row carrying the path", () => {
    expect(matchRoutePattern("/admin/secrets", VOCAB.routes!)).toBeNull();
    expect(matchRoutePattern("/patients/1/notes", VOCAB.routes!)).toBeNull();
    expect(matchRoutePattern("not-a-path", VOCAB.routes!)).toBeNull();
  });

  it("matches multi-segment patterns with the variable in the middle", () => {
    expect(matchRoutePattern("/settings/billing/detail", VOCAB.routes!)).toBe("/settings/:section/detail");
  });

  it("an event may carry only a DECLARED PATTERN, never a concrete path", () => {
    // A concrete path reaching the validator means the boundary reduction did not run,
    // and passing it through would be T-AN-3 exactly.
    expect(validateAppEvent({ name: "clinic.viewPatient", at: "x", route: "/patients/12345" }, VOCAB)).toMatch(
      /not a declared pattern/,
    );
    expect(validateAppEvent({ name: "clinic.viewPatient", at: "x", route: "/patients/:id" }, VOCAB)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("G-AN-1/2 — per-event validation rejects, never strips", () => {
  const ev = (over: Record<string, unknown> = {}) => ({
    name: "clinic.viewPatient",
    at: "2026-08-26T10:00:00.000Z",
    props: { tab: "meds", starred: true, ageBand: 4 },
    ...over,
  });

  it("accepts a declared event", () => {
    expect(validateAppEvent(ev(), VOCAB)).toBeNull();
  });

  it("G-AN-1 — an undeclared KEY rejects the event, nothing stripped", () => {
    expect(validateAppEvent(ev({ props: { tab: "meds", ssn: "123-45-6789" } }), VOCAB)).toMatch(
      /undeclared prop key: ssn/,
    );
  });

  it("G-AN-1 — an undeclared event NAME rejects", () => {
    expect(validateAppEvent(ev({ name: "clinic.exfiltrate" }), VOCAB)).toMatch(/undeclared event name/);
    // Prototype keys are not declarations.
    expect(validateAppEvent(ev({ name: "toString" }), VOCAB)).toMatch(/undeclared event name/);
  });

  it("G-AN-2 — a NON-ENUMERATED string is rejected at the boundary", () => {
    // The whole content bound. A free string here carries the file, the key, the row.
    expect(validateAppEvent(ev({ props: { tab: "-----BEGIN PRIVATE KEY-----" } }), VOCAB)).toMatch(
      /not in the declared enumeration/,
    );
    expect(validateAppEvent(ev({ props: { tab: 42 } }), VOCAB)).toMatch(/must be a string/);
  });

  it("a number outside the declared range rejects, and a real is refused", () => {
    expect(validateAppEvent(ev({ props: { ageBand: 99 } }), VOCAB)).toMatch(/out of declared range/);
    expect(validateAppEvent(ev({ props: { ageBand: 4.000001 } }), VOCAB)).toMatch(/out of declared range|integer/);
    expect(validateAppEvent(ev({ props: { ageBand: NaN } }), VOCAB)).toMatch(/finite number/);
  });

  it("a boolean property refuses a truthy string", () => {
    expect(validateAppEvent(ev({ props: { starred: "yes" } }), VOCAB)).toMatch(/must be a boolean/);
  });

  it("rejects a malformed envelope rather than coercing it", () => {
    expect(validateAppEvent(null, VOCAB)).toMatch(/must be an object/);
    expect(validateAppEvent([], VOCAB)).toMatch(/must be an object/);
    expect(validateAppEvent({ at: "x" }, VOCAB)).toMatch(/missing name/);
    expect(validateAppEvent({ name: "clinic.export" }, VOCAB)).toMatch(/missing at/);
    expect(validateAppEvent(ev({ props: "not an object" }), VOCAB)).toMatch(/props must be an object/);
  });
});
