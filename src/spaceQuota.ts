// The space-creation quota constants (TRUST_AND_SAFETY_SPEC §6 / TS-13), single-sourced
// here so the two enforcement points cannot drift (R3-463). Both sides read them:
//
//   - site-main's `etc/firestore.rules` — the primary enforcement (the browser client
//     path), via a GENERATED `maxUserSpaces()`/`maxAppSpaces()` function pair;
//   - the backend's `src/spaceQuota.ts` — the admin-SDK mint path that bypasses rules,
//     consumed directly from this package.
//
// These are fail-closed authority bounds. A silent divergence between the two
// enforcement points is the failure mode R3-355 filed as owed; owning them here means a
// change touches ONE package and the generated rules + the backend move together.

/** Max spaces one user may own (rules `maxUserSpaces()` / backend `MAX_USER_SPACES`). */
export const MAX_USER_SPACES = 100;

/** Max spaces one app may create for a user (rules `maxAppSpaces()` / backend `MAX_APP_SPACES`). */
export const MAX_APP_SPACES = 20;