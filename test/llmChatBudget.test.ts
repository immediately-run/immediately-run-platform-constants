// The `llm.chat@1` session budget default (LLM_AND_AGENTS_SPEC §4.2, R3-1065). The
// test pins the number so a change is a decision, not a drift.

import { LLM_CHAT_SESSION_BUDGET } from '../src/llmChatBudget';

describe('llm chat session budget default', () => {
  it('is the documented value', () => {
    expect(LLM_CHAT_SESSION_BUDGET).toBe(200);
  });

  it('is a usable bound — positive, generous for one conversation, tight against a runaway loop', () => {
    expect(LLM_CHAT_SESSION_BUDGET).toBeGreaterThan(0);
    expect(LLM_CHAT_SESSION_BUDGET).toBeLessThanOrEqual(10_000);
  });
});
