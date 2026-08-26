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

### The shared telemetry event registry (R3-344)

`PLATFORM_TELEMETRY_SPEC` §5 requires **one** event vocabulary imported by both the
producer (`site-main`) and the fail-closed ingest validator (`immediately-run-backend`).
The operator security-events stream shipped with the vocabulary in one repo and the
registry hand-mirrored in the other; they drifted, and the stream rejected ~100% of its
batches for months while looking merely quiet (R3-343). A prefix list only the consumer
holds cannot be kept true by review — so it lives here, and a CI drift check runs in
**both directions** in **both** repos.

```ts
import {
  TELEMETRY_EVENTS,          // the closed vocabulary: props, maxTier, class, question
  telemetryEventNames,       // sorted names — the registry side of the drift check
  telemetryEventDef,         // (name) => def | null
  validateTelemetryEvent,    // one event vs. the registry + §5 discipline
  validateTelemetryBatch,    // a POSTed batch; see the granularity note below
  TELEMETRY_MAX_BATCH, TELEMETRY_MAX_PROP_KEYS, TELEMETRY_MAX_STR, TELEMETRY_MAX_FRAMES,
} from "@immediately-run/platform-constants";
```

**Batch granularity is deliberate and asymmetric:** an unregistered *name* rejects only
its own event, while a *props-discipline* violation rejects the whole batch. The two are
different failures — whole-batch rejection exists so a leak fails a test; applied to a
vocabulary drift it turns a rename into a total outage of the stream.

## Develop

```
npm ci
npm run build   # tsc → dist/
npm test        # jest
npm run lint
```

Published to npm on push to `main` via trusted publishing (OIDC) — see `.github/workflows/ci.yml`.
