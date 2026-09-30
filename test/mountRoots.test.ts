// The host-mount namespace (R3-352, R3-463). One vocabulary read by both the host
// announce side (site-main) and the frame admission side (sandbox); the test pins
// the values so a change is a decision, and so a widened list is a deliberate act.

import { HOST_MOUNT_ROOTS } from '../src/mountRoots';

describe('HOST_MOUNT_ROOTS', () => {
  it('is exactly the mnt and task roots', () => {
    expect([...HOST_MOUNT_ROOTS]).toEqual(['mnt', 'task']);
  });

  it('never contains the bundler-owned roots', () => {
    // /app and /node_modules are the bundler's: a mount there shadows the code the
    // frame is about to evaluate. This is the assertion that turns a mistaken
    // widening into a red build.
    expect(HOST_MOUNT_ROOTS).not.toContain('app');
    expect(HOST_MOUNT_ROOTS).not.toContain('node_modules');
  });

  it('has no duplicates and only plain segments', () => {
    expect(new Set(HOST_MOUNT_ROOTS).size).toBe(HOST_MOUNT_ROOTS.length);
    for (const root of HOST_MOUNT_ROOTS) {
      expect(root).toMatch(/^[a-z0-9_-]+$/);
    }
  });
});
