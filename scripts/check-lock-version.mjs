#!/usr/bin/env node
// check-lock-version.mjs — R3-868: package.json's `version` must equal BOTH of
// package-lock.json's version fields (the root and `packages[""]`).
//
// THE FAILURE THIS EXISTS FOR. A version bump that rides a feature PR touches
// only package.json; npm does not rewrite the lock's own version fields unless
// an install runs, and `npm ci` TOLERATES the mismatch (probed on npm 11: exit
// 0). The lock then lies about what the tree claims to be, with no failure
// mode anywhere: this happened in platform-constants (manifest 0.13.0, lock
// 0.12.1), grove (0.1.8/0.1.7, the bump in #79) and dev-fs (0.5.0/0.4.0), each
// found by HAND by the R3-678 review gate rather than by any check — because
// `check:publish-version` (where it exists) compares the manifest against the
// npm registry, never against the lock.
//
// The fix command is always the same: `npm install --package-lock-only`, which
// rewrites the lock's version fields from the manifest without touching
// node_modules.
//
// Copied, not shared — the rule is ~30 lines, and a shared package for it
// would itself be a cross-repo dependency to coordinate (the
// check-dependency-pins.mjs precedent).
//
// Run: `node scripts/check-lock-version.mjs`           → exit 1 on a mismatch
//      `node scripts/check-lock-version.mjs --self-test` → prove it can fail
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function checkLockVersion({ pkg, lock, cwd = '.' }) {
  const problems = [];
  const manifestVersion = pkg?.version;
  if (typeof manifestVersion !== 'string' || manifestVersion.length === 0) {
    problems.push(`${cwd}/package.json has no version field — nothing to sync the lock against.`);
    return problems;
  }
  if (lock?.version !== manifestVersion) {
    problems.push(
      `${cwd}/package-lock.json's root version is ${JSON.stringify(lock?.version)} but package.json says ` +
        `${JSON.stringify(manifestVersion)} — run \`npm install --package-lock-only\` to resync the lock.`,
    );
  }
  const lockRootPkg = lock?.packages?.[''];
  if (lockRootPkg?.version !== manifestVersion) {
    problems.push(
      `${cwd}/package-lock.json's packages[""].version is ${JSON.stringify(lockRootPkg?.version)} but ` +
        `package.json says ${JSON.stringify(manifestVersion)} — the same \`npm install --package-lock-only\` fixes both fields.`,
    );
  }
  return problems;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

if (process.argv.includes('--self-test')) {
  const cases = [
    { name: 'in sync passes', pkg: { version: '1.0.0' }, lock: { version: '1.0.0', packages: { '': { version: '1.0.0' } } }, want: 0 },
    {
      name: 'a root-only mismatch fails with the fix command',
      pkg: { version: '1.0.1' },
      lock: { version: '1.0.0', packages: { '': { version: '1.0.0' } } },
      want: /package-lock\.json's root version/,
    },
    {
      name: 'a packages[""] mismatch fails too',
      pkg: { version: '1.0.1' },
      lock: { version: '1.0.1', packages: { '': { version: '1.0.0' } } },
      want: /packages\[""\]\.version/,
    },
    { name: 'a missing manifest version is its own failure', pkg: {}, lock: { version: '1.0.0' }, want: /no version field/ },
  ];
  let failed = 0;
  for (const c of cases) {
    const problems = checkLockVersion({ pkg: c.pkg, lock: c.lock });
    const ok =
      (c.want === 0 && problems.length === 0) ||
      (c.want instanceof RegExp && problems.some((p) => c.want.test(p)));
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${c.name}`);
    if (!ok) failed += 1;
  }
  console.log(`${failed === 0 ? 'OK' : 'FAILED'}: ${cases.length - failed}/${cases.length} self-test cases.`);
  process.exit(failed === 0 ? 0 : 1);
}

const problems = checkLockVersion({
  pkg: readJson('package.json'),
  lock: readJson('package-lock.json'),
});
for (const p of problems) console.error(`check-lock-version: ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
