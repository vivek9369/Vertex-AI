import redis from "../../../shared/redis/redis.js"
import { getMessages } from "../utils/getMessages.js"

// ─────────────────────────────────────────────────────────────────
//  TTL constants
// ─────────────────────────────────────────────────────────────────
const MESSAGE_TTL = 24 * 60 * 60        // 24 hours  – conversation messages
const THREAD_TTL  = 7  * 24 * 60 * 60  //  7 days   – full thread context

// ─────────────────────────────────────────────────────────────────
//  Key helpers
// ─────────────────────────────────────────────────────────────────
const msgKey    = (id) => `messages:${id}`
const threadKey = (id) => `thread:${id}`

// ─────────────────────────────────────────────────────────────────
//  Redis helpers (safe – never throw on connection errors)
// ─────────────────────────────────────────────────────────────────
const safeGet = async (key) => {
  try { return await redis.get(key) } catch { return null }
}
const safeSet = async (key, value, ...args) => {
  try { await redis.set(key, value, ...args) } catch { /* no-op */ }
}

// ─────────────────────────────────────────────────────────────────
//  Message memory  (conversational history)
// ─────────────────────────────────────────────────────────────────

/**
 * Retrieve conversation messages from Redis cache.
 * Falls back to MongoDB via the chat service if cache is cold.
 */
export const getMemory = async (conversationId) => {
  const key    = msgKey(conversationId)
  const cached = await safeGet(key)
  if (cached) return JSON.parse(cached)

  const messages = await getMessages(conversationId)
  if (messages && messages.length > 0) {
    await safeSet(key, JSON.stringify(messages), "EX", MESSAGE_TTL)
  }
  return messages || []
}

/**
 * Append a message to the conversation's Redis cache.
 * Sliding window of 40 messages to keep context rich without bloating the prompt.
 */
export const addMessage = async (conversationId, role, content) => {
  const key         = msgKey(conversationId)
  const rawMessages = await safeGet(key)
  const messages    = rawMessages ? JSON.parse(rawMessages) : []

  messages.push({ role, content, timestamp: Date.now() })

  // keep last 40 messages (sliding window)
  if (messages.length > 40) messages.shift()

  await safeSet(key, JSON.stringify(messages), "EX", MESSAGE_TTL)
}

// ─────────────────────────────────────────────────────────────────
//  Cross-Agent Thread State  (artifacts + variables + active agent)
// ─────────────────────────────────────────────────────────────────

/**
 * Load the full thread state for a conversation.
 * Thread state carries:
 *   - activeAgent     : name of the last agent that handled a turn
 *   - activeArtifacts : code/file artifacts from the coding agent
 *   - variables       : free-form KV bag for cross-agent data sharing
 */
export const getThreadState = async (conversationId) => {
  const key    = threadKey(conversationId)
  const cached = await safeGet(key)
  if (cached) return JSON.parse(cached)

  // cold start – return empty defaults
  return { activeAgent: null, activeArtifacts: [], variables: {} }
}

/**
 * Persist updated thread state after each agent turn.
 * Merges partial updates so callers only need to pass what changed.
 */
export const saveThreadState = async (conversationId, updates = {}) => {
  const key     = threadKey(conversationId)
  const current = await getThreadState(conversationId)

  const next = {
    ...current,
    ...updates,
    // deep-merge variables instead of overwriting
    variables: {
      ...(current.variables || {}),
      ...(updates.variables || {}),
    },
    // keep activeArtifacts unless explicitly updated
    activeArtifacts: updates.activeArtifacts !== undefined
      ? updates.activeArtifacts
      : current.activeArtifacts,
    updatedAt: Date.now(),
  }

  await safeSet(key, JSON.stringify(next), "EX", THREAD_TTL)
  return next
}

/**
 * Build a human-readable "thread context" summary injected into agent prompts
 * so each agent knows what happened before it was activated.
 */
export const buildThreadContext = (threadState, currentAgent) => {
  if (!threadState) return ""
  const { activeAgent, activeArtifacts, variables } = threadState
  const parts = []

  if (activeAgent && activeAgent !== currentAgent) {
    parts.push(
      `[Context] The user was previously working with the **${activeAgent}** agent.`
    )
  }
  if (activeArtifacts && activeArtifacts.length > 0) {
    const titles = activeArtifacts.map((a) => a.title || a.type).join(", ")
    parts.push(`[Active Artifacts] Currently open artifacts: ${titles}.`)
  }
  if (variables && Object.keys(variables).length > 0) {
    const varStr = Object.entries(variables)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join("; ")
    parts.push(`[Session Variables] ${varStr}`)
  }

  return parts.join("\n")
}

/**
 * Build a formatted conversation history string from the full message log.
 * Injected into EVERY agent so they all share the same cross-agent memory.
 *
 * @param {string} conversationId
 * @param {number} [limit=20]  – max recent messages to include
 * @returns {Promise<string>}  – formatted history block or empty string
 */
export const buildConversationHistory = async (conversationId, limit = 20) => {
  if (!conversationId) return ""

  const messages = await getMemory(conversationId)
  if (!messages || messages.length === 0) return ""

  // take the most recent `limit` messages
  const recent = messages.slice(-limit)

  const formatted = recent
    .map((m) => {
      const role = m.role === "user" ? "User" : "Assistant"
      // truncate very long assistant replies to avoid huge prompts
      const content =
        m.role === "assistant" && m.content?.length > 800
          ? m.content.slice(0, 800) + "…"
          : (m.content || "")
      return `${role}: ${content}`
    })
    .join("\n")

  return `[Conversation History]\n${formatted}`
}
