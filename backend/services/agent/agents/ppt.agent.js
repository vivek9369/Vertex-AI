import { getModel }                                               from "../config/llmModels.js"
import { generatePpt }                                            from "../utils/generatePpt.js"
import { getFromS3 }                                              from "../utils/getFromS3.js"
import { uploadToS3 }                                             from "../utils/uploadToS3.js"
import { deductCredits }                                          from "../utils/deductCredits.js"
import { checkAgentLimit }                                        from "../config/agentLimit.js"
import { getThreadState, buildThreadContext,
         buildConversationHistory }                               from "../config/memory.js"

export const pptAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "ppt")

    // ── Cross-Agent Thread Context ─────────────────────────────────────────
    const threadState   = await getThreadState(state.conversationId)
    const threadContext = buildThreadContext(threadState, "ppt")

    // ── Full Conversation History (cross-agent memory) ─────────────────────
    const history = await buildConversationHistory(state.conversationId)

    const llm = await getModel("ppt")

    const prompt = `You are a professional presentation designer for VERTEX AI AI.
${threadContext ? "\n" + threadContext + "\n" : ""}
${history ? "\n" + history + "\n" : ""}
IMPORTANT: Read the full conversation history above. If the user refers to previously discussed
content or says "make slides from what we talked about", use that context as the topic.

Return ONLY valid JSON.

Format:

{
"title":"",
"subtitle":"",
"slides":[
{
"title":"",
"points":["","","",""]
}
]
}

Rules:
- Generate exactly 6 content slides.
- Each slide should have 4-6 concise bullet points.
- No markdown.
- No explanation.
- No code block.
- Return ONLY JSON.

Topic:

${state.prompt}`

    const res  = await llm.invoke(prompt)
    const data = JSON.parse(res.content)
    await deductCredits(state.userId, "ppt")

    const ppt    = await generatePpt(data)
    const buffer = await ppt.write({ outputType: "nodebuffer" })

    const filename    = `ppt-${Date.now()}.pptx`
    await uploadToS3(filename, buffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation")

    // presigned URL: 24 hours (86400 seconds)
    const downloadUrl = await getFromS3(filename, 24 * 60 * 60)

    return {
      ...state,
      aiResponse: `# ✅ Presentation Generated

**${data.title}**

📥 [Download PPT](${downloadUrl})

_Secure link expires in 24 hours._`,
      activeAgent: "ppt",
    }

  } catch (error) {
    console.error("[pptAgent]", error)
    return {
      ...state,
      aiResponse:  error?.data?.message || "Failed to generate PPT.",
      activeAgent: "ppt",
    }
  }
}