// The space-name length bound (FILE_SHARING_SPEC §9.7 rename, R3-723), single-sourced
// here so its enforcement points cannot drift:
//
//   - site-main's `etc/firestore.rules` — the server-side backstop, via a GENERATED
//     `maxSpaceNameLength()` function (the R3-463 quota pair's precedent);
//   - site-main's action gate (`requireSpaceName`) — the typed refusal before the
//     handler runs.
//
// 120 is a fresh bound, not a codified one: no shipped surface truncated space names
// when this landed (2026-09-28 — no `name.slice` in space-manager, the home app, or
// site-main's space paths), so the value is a decision, pinned by the test so a change
// is one too.

/** Max length of a space's display name, after trimming (rules `maxSpaceNameLength()`). */
export const MAX_SPACE_NAME_LENGTH = 120;
