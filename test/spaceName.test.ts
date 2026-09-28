// The shared space-name length bound (FILE_SHARING_SPEC §9.7 rename, R3-723). Single
// source for site-main's GENERATED firestore.rules `maxSpaceNameLength()` and the
// action gate's `requireSpaceName`; the test pins the number so a change is a decision.

import { MAX_SPACE_NAME_LENGTH } from '../src/spaceName';

describe('space name bound', () => {
  it('is the documented value', () => {
    expect(MAX_SPACE_NAME_LENGTH).toBe(120);
  });

  it('is a usable bound — positive, and comfortably above any real name', () => {
    expect(MAX_SPACE_NAME_LENGTH).toBeGreaterThan(0);
    expect(MAX_SPACE_NAME_LENGTH).toBeLessThanOrEqual(1024);
  });
});
