// The shared space-creation quota (TRUST_AND_SAFETY_SPEC §6 / TS-13, R3-463). These
// values are the single source for site-main's GENERATED firestore.rules functions and
// the backend's spaceQuota.ts; the test pins the numbers so a change is a decision.

import { MAX_APP_SPACES, MAX_USER_SPACES } from '../src/spaceQuota';

describe('space quota constants', () => {
  it('are the documented fail-closed bounds', () => {
    expect(MAX_USER_SPACES).toBe(100);
    expect(MAX_APP_SPACES).toBe(20);
  });

  it('are positive and the user bound is above the app bound', () => {
    expect(MAX_USER_SPACES).toBeGreaterThan(0);
    expect(MAX_APP_SPACES).toBeGreaterThan(0);
    expect(MAX_USER_SPACES).toBeGreaterThan(MAX_APP_SPACES);
  });
});