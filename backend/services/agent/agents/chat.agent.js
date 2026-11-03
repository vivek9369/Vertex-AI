import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import { getModel } from "../config/llmModels.js"
import { getMemory, getThreadState, buildThreadContext } from "../config/memory.js"
import { deductCredits } from "../utils/deductCredits.js"
import { checkAgentLimit } from "../config/agentLimit.js"

export const chatAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "chat")

    const llm     = await getModel("chat")
    const history = await getMemory(state.conversationId)

    // ── Cross-Agent Context ──────────────────────────────────────────────
    const threadState   = await getThreadState(state.conversationId)
    const threadContext = buildThreadContext(threadState, "chat")

    // ── Search context (from search agent, if chained) ───────────────────
    const searchContext = state.searchResults
      ? `\nWeb Search Results:\n${JSON.stringify(state.searchResults)}\n\nAnswer the user using only the above search results.`
      : ""

    // ── System Prompt ────────────────────────────────────────────────────
    const systemPrompt = `You are VERTEX AI, an intelligent AI assistant by Vertex AI.

${threadContext ? threadContext + "\n" : ""}
${searchContext}

Rules:
- For simple questions, greetings, and short queries, respond naturally in plain text.
- For technical, educational, coding, or detailed topics, use clean Markdown.
- When the user references prior work (artifacts, code, documents), acknowledge and build on them.

Formatting:
- Use # for titles and ## for sections.
- Leave a blank line after headings.
- Use bullet points for lists.
- Use numbered lists for steps.
- Use fenced code blocks with language tags for code.
- Keep paragraphs short and readable.
- Never write headings and content on the same line.
- Never generate large walls of text.`

    // ── Build message array ──────────────────────────────────────────────
    const messages = [new SystemMessage(systemPrompt)]

    history.forEach((msg) => {
      if (msg.role === "user")      messages.push(new HumanMessage(msg.content))
      if (msg.role === "assistant") messages.push(new AIMessage(msg.content))
    })

    messages.push(new HumanMessage(state.prompt))

    // ── Token Streaming via SSE callback ─────────────────────────────────
    let fullResponse = ""

    if (typeof state.streamCallback === "function") {
      // stream tokens one-by-one to the SSE controller
      const stream = await llm.stream(messages)
      for await (const chunk of stream) {
        const token = chunk.content ?? ""
        if (token) {
          fullResponse += token
          state.streamCallback({ type: "token", token })
        }
      }
    } else {
      // non-streaming fallback (e.g., background invocations)
      const response = await llm.invoke(messages)
      fullResponse = response.content
    }

    await deductCredits(state.userId, "chat")

    return {
      ...state,
      aiResponse:  fullResponse,
      activeAgent: "chat",
    }
  } catch (error) {
    console.error("[chatAgent]", error)
    return {
      ...state,
      aiResponse:  error?.data?.message || "Failed to generate chat response.",
      activeAgent: "chat",
    }
  }
}