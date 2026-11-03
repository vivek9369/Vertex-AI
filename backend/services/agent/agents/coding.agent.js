import { checkAgentLimit }                                        from "../config/agentLimit.js"
import { getModel }                                               from "../config/llmModels.js"
import { getThreadState, buildThreadContext,
         buildConversationHistory }                               from "../config/memory.js"
import { deductCredits }                                          from "../utils/deductCredits.js"

/**
 * Safely extract and parse JSON from an LLM response.
 * Handles:
 *   - Raw JSON  { ... }
 *   - Markdown-fenced ```json ... ```
 *   - Trailing text after the closing brace
 */
function extractJson(raw) {
  // 1. Strip markdown fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()

  // 2. Try direct parse first
  try { return JSON.parse(stripped) } catch (_) {}

  // 3. Extract the outermost { ... } block
  const start = stripped.indexOf("{")
  const end   = stripped.lastIndexOf("}")
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(stripped.slice(start, end + 1)) } catch (_) {}
  }

  throw new SyntaxError("No valid JSON found in LLM response:\n" + raw.slice(0, 300))
}

export const codingAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "coding")

    const intentLlm = await getModel("intent")
    const codingLlm = await getModel("coding")

    // ── Cross-Agent Thread Context ─────────────────────────────────────────
    const threadState   = await getThreadState(state.conversationId)
    const threadContext = buildThreadContext(threadState, "coding")

    // ── Full Conversation History (cross-agent memory) ─────────────────────
    const history = await buildConversationHistory(state.conversationId)

    // ── Intent Classification ──────────────────────────────────────────────
    const intentRes = await intentLlm.invoke(`You are an intent classifier.
${history ? history + "\n" : ""}
Return ONLY one of these values:

CODE_GENERATION
CODE_REVIEW
CODE_EXPLANATION
DEBUGGING
OPTIMIZATION
CONVERSION
DOCUMENTATION

User Request:
${state.prompt}`)

    const intent = intentRes.content.trim()

    // ════════════════════════════════════════════════════════════════════
    //  CODE GENERATION  →  multi-file artifact output
    // ════════════════════════════════════════════════════════════════════
    if (intent === "CODE_GENERATION") {
      const priorArtifacts = (threadState.activeArtifacts || []).length > 0
        ? `\nPreviously generated artifacts:\n${JSON.stringify(
            threadState.activeArtifacts.map((a) => ({ title: a.title, files: a.files?.map((f) => f.name) })),
            null, 2
          )}\nBuild upon or relate to these if the user's request suggests it.\n`
        : ""

      const generationPrompt = `You are VERTEX AI Coding Agent, an expert multi-file code generator.
${threadContext ? "\n" + threadContext : ""}
${history ? "\n" + history : ""}
${priorArtifacts}
IMPORTANT: Read the full conversation history above. If the user says "use the prompt from chat" or
"build what we discussed" or similar, refer to the conversation history to understand what to build.

Generate the requested project.

Default stack:
- HTML
- CSS
- JavaScript

Use React / Next.js / Vue ONLY if explicitly requested.

Rules:
- Responsive
- Modern UI with CSS Variables
- Flexbox / Grid
- Smooth Scroll, Hover Effects
- Beautiful spacing
- Single page unless user asks otherwise.

IMAGES:
- Always use real Unsplash images.
- Never use placeholders.

Return ONLY valid JSON with this exact schema:

{
  "files": [
    { "name": "index.html", "content": "..." },
    { "name": "style.css",  "content": "..." },
    { "name": "script.js",  "content": "..." }
  ]
}

Rules:
- Output must start with {
- Output must end with }
- No markdown, no explanations, no \`\`\`
- Never mention intent

User Request:
${state.prompt}`

      const res  = await codingLlm.invoke(generationPrompt)
      const data = extractJson(res.content)
      await deductCredits(state.userId, "coding")

      const artifact = {
        id:    Date.now(),
        type:  "Project",
        files: data.files || [],
        title: state.prompt.slice(0, 80),
      }

      return {
        ...state,
        aiResponse:      "Code Generated Successfully.",
        artifacts:       [artifact],
        activeArtifacts: [...(threadState.activeArtifacts || []), artifact],
        activeAgent:     "coding",
      }
    }

    // ════════════════════════════════════════════════════════════════════
    //  Non-generation intents  →  Markdown explanation / review
    // ════════════════════════════════════════════════════════════════════
    const res = await codingLlm.invoke(`You are VERTEX AI Coding Agent.
${threadContext ? "\n" + threadContext + "\n" : ""}
${history ? "\n" + history + "\n" : ""}
IMPORTANT: Read the full conversation history above. If the user references anything discussed
earlier (in chat or another agent), use that context to give a complete answer.

The user's request type is: ${intent}

Return Markdown only. Never generate project files.

Use headings like:
# Overview
## Explanation
## Problems
## Improvements
## Best Practices
## Optimized Code (if needed)

User Request:
${state.prompt}`)

    await deductCredits(state.userId, "coding")

    return {
      ...state,
      aiResponse:  res.content,
      artifacts:   [],
      activeAgent: "coding",
    }
  } catch (error) {
    console.error("[codingAgent]", error)
    return {
      ...state,
      aiResponse:  error?.data?.message || error?.message || "Failed to generate code.",
      artifacts:   [],
      activeAgent: "coding",
    }
  }
}
