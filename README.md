# @immediately-run/platform-constants

The **single source of truth** for cross-repo platform vocabulary — currently the
`.immediately.run` cache-zip **sidecar layout**: the contribute-manifest path, the
pre-transpiled-artifacts directory, the bundled-packages directory, and the
"is this path platform infrastructure?" predicate.

## Why this exists (R3-104)

These values used to be **copied as raw string literals** into three repos:

| Repo | Previously hard-coded |
|---|---|
| `cli` (cache-zip emitter) | `MANIFEST_SIDECAR_ENTRY`, `.immediately.run/artifacts/…`, `.immediately.run/packages/…` |
| `sandbox` (bundler readers) | `MANIFEST_SIDECAR_PATH`, `BUNDLED_PACKAGES_DIR` |
| `site-main` (contribute diff / integrity allowlist) | `PLATFORM_SIDECAR_INFRA_PREFIX` |

Because the literal was duplicated, the `.tinkerable/` → `.immediately.run/` rename had to
land in all three repos **in lockstep** (cli #12 / sandbox #30 / site-main #117). Owning the
vocabulary here means a future rename or extension is **one edit + a version bump**, and a
consumer that hard-codes the literal again is caught by each repo's
`check-no-sidecar-literal` drift gate (ways_of_working §7).

## Exports

```ts
import {
  SIDECAR_DIR,            // ".immediately.run"            (root-relative, no leading slash)
  SIDECAR_PREFIX,         // ".immediately.run/"           (prefix form)
  CONTRIBUTE_MANIFEST_PATH,// ".immediately.run/contribute-manifest.json"
  ARTIFACTS_DIR,          // ".immediately.run/artifacts"
  PACKAGES_DIR,           // ".immediately.run/packages"
  isUnderSidecar,         // (path) => boolean  (accepts a leading "/" or "./")
} from "@immediately-run/platform-constants";
```

## Develop

```
npm ci
npm run build   # tsc → dist/
npm test        # jest
npm run lint
```

Published to npm on push to `main` via trusted publishing (OIDC) — see `.github/workflows/ci.yml`.
