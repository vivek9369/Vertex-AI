import dotenv from "dotenv"
dotenv.config()

import { ChatGroq }               from "@langchain/groq"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenRouter }         from "@langchain/openrouter"

// ─── Chat / Search (streaming-capable) ───────────────────────────────────────
const groqChat = new ChatGroq({
  model:       "qwen/qwen3.8-27b",
  temperature: 0.7,
  streaming:   true,
})

// ─── Router (deterministic, no streaming needed) ─────────────────────────────
const groqRouter = new ChatGroq({
  model:       "qwen/qwen3.8-27b",
  temperature: 0,
  streaming:   false,
})

// ─── Coding Agent ─────────────────────────────────────────────────────────────
// Qwen 2.5 Coder via OpenRouter: dedicated code model, reliable JSON output
const deepSeekCoding = new ChatOpenRouter({
  model:       "qwen/qwen-2.5-coder-32b-instruct",
  temperature: 0,
  maxTokens:   8000,
})

// ─── Intent / PDF / PPT / Util  (lightweight) ────────────────────────────────
const groqUtil = new ChatGroq({
  model:       "qwen/qwen3.8-27b",
  temperature: 0,
  streaming:   false,
})

// ─── Vision / Image Analysis ──────────────────────────────────────────────────
const gemini = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
})

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns the right LLM instance for the given agent slot.
 * @param {"chat"|"search"|"coding"|"intent"|"pdf"|"ppt"|"image"|"imageAnalyzer"|"pdf-rag"|"router"} agent
 */
export const getModel = async (agent) => {
  switch (agent) {
    case "chat":          return groqChat
    case "search":        return groqChat
    case "coding":        return deepSeekCoding
    case "intent":        return groqUtil
    case "pdf":           return groqUtil
    case "ppt":           return groqUtil
    case "pdf-rag":       return groqUtil
    case "image":         return groqUtil
    case "imageAnalyzer": return gemini
    case "router":        return groqRouter
    default:              return groqChat
  }
}

/**
 * Returns a streaming-enabled Groq instance for token-by-token SSE.
 * Used directly by the Chat Agent.
 */
export const getStreamingModel = () => groqChat
