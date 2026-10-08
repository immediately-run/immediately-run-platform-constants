// The `llm.chat@1` session budget default (LLM_AND_AGENTS_SPEC §4.2, R3-1065).
//
// The host-side spend bound on the shared chat slot: a per-(appKey, principal)
// budget, counted per chat session — the number of `llm.chat` provider calls one
// app may issue before the host refuses with `budget-exhausted` (terminal until the
// user raises the bound in Settings; never app-configurable, P1). It lives here for
// the reason the relay endpoints do: the spec homes the LLM egress constants in one
// package both host and backend can read, so a change to the default is a decision,
// not a drift.
//
// 200 is a fresh bound, not a codified one: no shipped surface capped chat calls
// when this landed, so the value is a decision — generous for a legitimate agent
// loop (a heavy tool-using conversation makes tens of calls), tight against a
// runaway one (a spin hits it in minutes). The user's Settings raise is preference
// data layered over this default.

/** Default per-(appKey, principal) chat-session budget: provider calls per chat
 *  session before the host refuses with `budget-exhausted`. */
export const LLM_CHAT_SESSION_BUDGET = 200;
