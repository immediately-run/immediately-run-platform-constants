// The host-mount namespace (R3-352, R3-463): the roots under which the host may
// announce a mount to a sandbox frame.
//
// This list was written down TWICE — site-main's `filesystem/mountPath.ts` (host
// announce side) and sandbox's `protocol/mountAdmission.ts` (frame admission side),
// held together by a TODO. It is one vocabulary on a security boundary: the host
// asserts before announcing, the frame refuses anything outside it, and a drift
// between the two is either mounts that mysteriously fail or — worse, if the frame's
// copy is the wider one — a message that shadows paths the host never meant to
// expose (ways_of_working §6, "one home per cross-repo vocabulary").

/**
 * The roots under which the host may announce a mount to a sandbox frame:
 *
 * - `mnt`  — every `mountPathFromId()` address: spaces, working trees, content
 *   corpora, settings, git libraries (site-main `filesystem/mountUri.ts`).
 * - `task` — the §5.7 task file-delegation chroots
 *   (site-main `editor/task/taskDelegation.ts`).
 *
 * `app` and `node_modules` are the BUNDLER's, not the host's: a mount there shadows
 * the code the frame is about to evaluate. They are unreachable through this list by
 * construction rather than by a denylist (a denylist is only as good as its
 * enumeration — `/app/../app`, `/APP`, a future third bundler-owned path).
 *
 * Both sides require paths strictly BELOW a root (at least two segments): `/mnt` or
 * `/task` itself would shadow every mount inside it. That predicate stays in the
 * consumers; the vocabulary lives here.
 */
export const HOST_MOUNT_ROOTS = ["mnt", "task"] as const;
