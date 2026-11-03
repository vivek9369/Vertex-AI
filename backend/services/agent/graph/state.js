import { Annotation } from "@langchain/langgraph";

/**
 * Cross-Agent Context Memory State
 * Maintains full session state across agent transitions so switching
 * from Chat → Code → PDF never drops conversation history or artifacts.
 */
export const agentState = Annotation.Root({
  // ── Core request fields ──────────────────────────────────────────────
  prompt:         Annotation(),   // current user prompt
  aiResponse:     Annotation(),   // final AI response text
  agent:          Annotation(),   // resolved agent name  (chat|coding|pdf|…)

  // ── Identity & session ───────────────────────────────────────────────
  conversationId: Annotation(),   // MongoDB conversation _id
  userId:         Annotation(),   // authenticated user _id
  threadId:       Annotation(),   // Redis thread key (= conversationId by default)

  // ── Cross-agent context propagation ─────────────────────────────────
  activeAgent:    Annotation(),   // the agent that was LAST active (for transitions)
  activeArtifacts:Annotation(),   // artifacts carried across agent switches
  variables:      Annotation(),   // free-form KV bag propagated across agents

  // ── Per-turn outputs ─────────────────────────────────────────────────
  artifacts:      Annotation(),   // artifacts produced THIS turn
  searchResults:  Annotation(),   // results from search agent
  images:         Annotation(),   // image URLs (vision / search)
  file:           Annotation(),   // uploaded file (multer)

  // ── Streaming support ────────────────────────────────────────────────
  streamCallback: Annotation(),   // SSE writer fn injected by controller

  // ── Metadata ─────────────────────────────────────────────────────────
  metadata:       Annotation(),   // arbitrary per-turn metadata object
})