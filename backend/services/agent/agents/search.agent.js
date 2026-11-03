import { checkAgentLimit }                 from "../config/agentLimit.js"
import { searchTool }                      from "../config/tavily.js"
import { deductCredits }                   from "../utils/deductCredits.js"
import { buildConversationHistory }        from "../config/memory.js"
import { getModel }                        from "../config/llmModels.js"

export const searchAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "search")

    // ── Full Conversation History – refine query with context ──────────────
    const history = await buildConversationHistory(state.conversationId, 10)

    // If history exists, use the LLM to produce a better search query
    let searchQuery = state.prompt
    if (history) {
      const llm = await getModel("router")
      const refinedRes = await llm.invoke(`You are a search query optimizer.

${history}

Based on the conversation history above and the user's current message, write the best
possible web search query. Return ONLY the search query string, nothing else.

User's current message: ${state.prompt}`)
      searchQuery = refinedRes.content.trim() || state.prompt
    }

    const results = await searchTool.invoke({ query: searchQuery })
    await deductCredits(state.userId, "search")

    return {
      ...state,
      searchResults: results,
      images:        results.images || [],
      activeAgent:   "search",
    }
  } catch (error) {
    console.error("[searchAgent]", error)
    return {
      ...state,
      searchResults: [],
      images:        [],
      aiResponse:    error?.data?.message || "Failed to search.",
      activeAgent:   "search",
    }
  }
}