import axios  from "axios"
import { graph } from "../graph/graph.js"
import { addMessage, saveThreadState } from "../config/memory.js"

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Persist conversation messages + thread state after every agent turn. */
const persistTurn = async ({ conversationId, userId, prompt, result }) => {
  const agentName     = result.activeAgent || result.agent || "chat"
  const activeArtifacts = result.activeArtifacts || result.artifacts || []

  // 1. Redis conversation cache
  await addMessage(conversationId, "user",      prompt)
  await addMessage(conversationId, "assistant", result.aiResponse)

  // 2. Cross-Agent Thread State  (activeAgent + artifacts + variables)
  await saveThreadState(conversationId, {
    activeAgent:     agentName,
    activeArtifacts: activeArtifacts,
    variables:       result.variables || {},
  })

  // 3. MongoDB persistence via chat service
  await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
    conversationId,
    role:      "assistant",
    content:   result?.aiResponse,
    images:    result?.images,
    artifacts: result?.artifacts,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Standard (non-streaming) handler
// ─────────────────────────────────────────────────────────────────────────────
export const agent = async (req, res, next) => {
  try {
    const { prompt, conversationId, agent: agentName } = req.body
    const file   = req.file
    const userId = req.headers["x-user-id"]

    console.log(`[agent] prompt=${prompt} convId=${conversationId} agent=${agentName} userId=${userId}`)

    // Save user message to MongoDB (with timeout so a dead chat service doesn't hang)
    await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
      conversationId,
      role:    "user",
      content: prompt,
    }, { timeout: 8000 })

    const result = await graph.invoke({
      prompt,
      conversationId,
      agent: agentName,
      userId,
      file,
    })

    await persistTurn({ conversationId, userId, prompt, result })

    return res.status(200).json({
      answer:    result?.aiResponse,
      images:    result?.images,
      artifacts: result?.artifacts,
    })
  } catch (error) {
    console.error("[agent controller error]", error?.message || error)
    next(error)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SSE Streaming handler  (Chat Agent only)
// ─────────────────────────────────────────────────────────────────────────────
export const agentStream = async (req, res, next) => {
  const { prompt, conversationId } = req.body
  const userId = req.headers["x-user-id"]

  console.log(`[agentStream] prompt=${prompt} convId=${conversationId} userId=${userId}`)

  // SSE headers — must be set BEFORE any await so client sees streaming response
  res.setHeader("Content-Type",  "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection",    "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
    if (typeof res.flush === "function") res.flush()
  }

  try {
    // Save user message to MongoDB (with timeout)
    await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
      conversationId,
      role:    "user",
      content: prompt,
    }, { timeout: 8000 }).catch(err => console.warn("[agentStream] save-message failed (non-fatal):", err.message))

    // ── Inject SSE callback into state so chatAgent can stream tokens ──
    const streamCallback = (event) => {
      if (event.type === "token") sendEvent({ type: "token", token: event.token })
    }

    const result = await graph.invoke({
      prompt,
      conversationId,
      agent:          "chat",
      userId,
      streamCallback,
    })

    await persistTurn({ conversationId, userId, prompt, result }).catch(err =>
      console.warn("[agentStream] persistTurn failed (non-fatal):", err.message)
    )

    // Signal completion
    sendEvent({
      type:      "done",
      answer:    result?.aiResponse,
      images:    result?.images   || [],
      artifacts: result?.artifacts || [],
    })

    res.end()
  } catch (error) {
    console.error("[agentStream error]", error?.message || error)
    try {
      sendEvent({ type: "error", message: error?.message || "Agent error" })
      res.end()
    } catch (_) { /* already closed */ }
  }
}