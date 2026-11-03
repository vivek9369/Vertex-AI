import { getModel }                                               from "../config/llmModels.js"
import { generatePdf }                                            from "../utils/generatePdf.js"
import { deductCredits }                                          from "../utils/deductCredits.js"
import { checkAgentLimit }                                        from "../config/agentLimit.js"
import { getThreadState, buildThreadContext,
         buildConversationHistory }                               from "../config/memory.js"

export const pdfAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "pdf")

    // ── Cross-Agent Thread Context ─────────────────────────────────────────
    const threadState   = await getThreadState(state.conversationId)
    const threadContext = buildThreadContext(threadState, "pdf")

    // ── Full Conversation History (cross-agent memory) ─────────────────────
    const history = await buildConversationHistory(state.conversationId)

    const llm = await getModel("pdf")

    const prompt = `You are an expert document writer for VERTEX AI AI platform.
${threadContext ? "\n" + threadContext + "\n" : ""}
${history ? "\n" + history + "\n" : ""}
IMPORTANT: Read the full conversation history above. If the user says "use what we discussed"
or refers to prior chat content, use that context as the document topic.

Return ONLY valid JSON. Do NOT return markdown or explanations.

Structure:

{
  "title":    "",
  "subtitle": "",
  "sections": [
    {
      "heading": "",
      "points":  []
    }
  ]
}

Rules:
- Generate 4-8 sections.
- Each section should have 3-6 concise bullet points.
- No markdown, no code blocks, output must start with { and end with }

Topic:
${state.prompt}`

    const res  = await llm.invoke(prompt)

    // ── Strip any markdown code fences the LLM might wrap around the JSON ─
    const raw  = res.content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
    const data = JSON.parse(raw)

    await deductCredits(state.userId, "pdf")

    // ── Generate PDF as binary buffer via PDFKit ───────────────────────────
    const pdfBuffer = await generatePdf(data)

    // ── Encode to base64 data URI (no S3 needed) ──────────────────────────
    const base64    = pdfBuffer.toString("base64")
    const dataUri   = `data:application/pdf;base64,${base64}`

    return {
      ...state,
      aiResponse: `# PDF Generated ✅

**${data.title}**

${data.subtitle ? `*${data.subtitle}*\n` : ""}
📥 [Download PDF](${dataUri})

> _Right-click → "Save link as…" if the browser doesn't download automatically._`,
      activeAgent: "pdf",
    }
  } catch (error) {
    console.error("[pdfAgent]", error)
    return {
      ...state,
      aiResponse:  error?.data?.message || `Failed to generate PDF: ${error?.message || "Unknown error"}`,
      activeAgent: "pdf",
    }
  }
}