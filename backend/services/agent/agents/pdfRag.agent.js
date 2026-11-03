import fs                                      from "fs"
import { createRequire }                        from "module"
const require   = createRequire(import.meta.url)
const pdfParse  = require("pdf-parse")
import { RecursiveCharacterTextSplitter }      from "@langchain/textsplitters"
import { vectorStore }                         from "../config/vectorDb.js"
import { getModel }                            from "../config/llmModels.js"
import { HumanMessage, SystemMessage }         from "@langchain/core/messages"
import { deductCredits }                       from "../utils/deductCredits.js"
import { checkAgentLimit }                     from "../config/agentLimit.js"
import { getThreadState, buildThreadContext,
         buildConversationHistory }            from "../config/memory.js"

export const pdfRag = async (state) => {
  try {
    await checkAgentLimit(state.userId, "pdf")

    // ── Cross-Agent Thread Context ─────────────────────────────────────
    const threadState   = await getThreadState(state.conversationId)
    const threadContext = buildThreadContext(threadState, "pdfRag")

    // ── Full Conversation History ──────────────────────────────────────
    const history = await buildConversationHistory(state.conversationId, 10)

    // ── Parse uploaded PDF ────────────────────────────────────────────
    const buffer = fs.readFileSync(state.file.path)
    const result = await pdfParse(buffer)
    const text   = result.text

    // ── Chunk and embed into Qdrant vector store ──────────────────────
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize:    1000,
      chunkOverlap: 200,
    })

    const docs           = await splitter.createDocuments([text])
    const collectionName = `pdf-${Date.now()}`
    const store          = await vectorStore(docs, collectionName)

    // ── Similarity search for relevant context ────────────────────────
    const relevantDocs = await store.similaritySearch(state.prompt, 5)
    const context      = relevantDocs.map((d) => d.pageContent).join("\n\n")

    const llm = await getModel("pdf-rag")

    const messages = [
      new SystemMessage(`You are VERTEX AI PDF Assistant.
${threadContext ? "\n" + threadContext + "\n" : ""}
${history ? "\n" + history + "\n" : ""}
Rules:
- Answer ONLY from the uploaded PDF.
- Never make up information.
- If the answer is not present in the PDF, reply: "I couldn't find this information in the uploaded PDF."
- Use Markdown formatting.`),

      new HumanMessage(`Context:\n${context}\n\nQuestion:\n${state.prompt}`),
    ]

    const response = await llm.invoke(messages)
    await deductCredits(state.userId, "pdf")

    return {
      ...state,
      aiResponse:  response.content,
      activeAgent: "pdfRag",
    }
  } catch (error) {
    console.error("[pdfRag]", error)
    return {
      ...state,
      aiResponse:  error?.data?.message || "Failed to analyze PDF.",
      activeAgent: "pdfRag",
    }
  } finally {
    if (state.file?.path) {
      try { fs.unlinkSync(state.file.path) } catch (_) {}
    }
  }
}