import { getModel }                         from "../config/llmModels.js"
import axios                                from "axios"
import { uploadToS3 }                       from "../utils/uploadToS3.js"
import { getFromS3 }                        from "../utils/getFromS3.js"
import { deductCredits }                    from "../utils/deductCredits.js"
import { checkAgentLimit }                  from "../config/agentLimit.js"
import { buildConversationHistory }         from "../config/memory.js"

export const visionAgent = async (state) => {
  try {
    // ── Rate limit check ───────────────────────────────────────────────────
    await checkAgentLimit(state.userId, "image")

    // ── Full Conversation History ──────────────────────────────────────────
    const history = await buildConversationHistory(state.conversationId, 10)

    const llm = await getModel("image")

    // ── Generate enhanced image prompt ────────────────────────────────────
    const res = await llm.invoke(`You are an elite AI image prompt engineer for VERTEX AI.
${history ? "\n" + history + "\n" : ""}
IMPORTANT: Read the conversation history above. If the user refers to a previous topic
or says "generate an image of what we discussed", use that context.

Convert the user request into a highly detailed image generation prompt.

Requirements:
- Cinematic lighting
- Professional composition
- Ultra realistic
- High detail
- Beautiful color palette
- Sharp focus
- 8K quality
- Photorealistic
- Depth of field
- Professional photography
- Stunning visuals

Return only the image prompt.

User Request:
${state.prompt}`)

    const prompt   = res.content.trim()
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`

    // ── Fetch generated image ─────────────────────────────────────────────
    const imageRes = await axios.get(imageUrl, { responseType: "arraybuffer" })
    await deductCredits(state.userId, "vision")

    const buffer   = Buffer.from(imageRes.data)
    const filename = `image-${Date.now()}.png`

    // ── Upload to S3 and get presigned URL (24 hours = 86400 seconds) ─────
    await uploadToS3(filename, buffer, "image/png")
    const downloadUrl = await getFromS3(filename, 24 * 60 * 60)

    return {
      ...state,
      aiResponse: `![Generated Image](${downloadUrl})

📥 [Download Image](${downloadUrl})

⏳ Link expires in 24 hours.`,
      activeAgent: "vision",
    }

  } catch (error) {
    console.error("[visionAgent]", error)
    return {
      ...state,
      aiResponse:  error?.data?.message || "Failed to generate image.",
      activeAgent: "vision",
    }
  }
}