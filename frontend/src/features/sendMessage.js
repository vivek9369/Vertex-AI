
import api from '../../utils/axios'

/**
 * Standard (non-streaming) message send.
 * Used for Coding, PDF, PPT, Vision, and Search agents.
 */
async function sendMessage(payload) {
  try {
    const { data } = await api.post("/api/agent/chat", payload)
    return data
  } catch (error) {
    console.error("[sendMessage]", error)
    return null
  }
}

/**
 * SSE streaming message send – Chat Agent only.
 * Calls onToken(token) for each chunk and onDone(result) when complete.
 *
 * @param {{ prompt: string, conversationId: string }} payload
 * @param {{ onToken: (t:string)=>void, onDone: (r:object)=>void, onError: (e:Error)=>void }} handlers
 */
export async function sendMessageStream(payload, { onToken, onDone, onError }) {
  try {
    const response = await fetch("/api/agent/stream", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify(payload),
    })

    if (!response.ok) throw new Error(`Stream error: ${response.status}`)

    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer    = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE messages are separated by double newlines
      const lines = buffer.split("\n\n")
      buffer = lines.pop() // keep the incomplete last chunk

      for (const line of lines) {
        const dataLine = line.replace(/^data: /, "").trim()
        if (!dataLine) continue
        try {
          const event = JSON.parse(dataLine)
          if (event.type === "token") {
            onToken?.(event.token)
          } else if (event.type === "done") {
            onDone?.(event)
          } else if (event.type === "error") {
            onError?.(new Error(event.message))
          }
        } catch (_) { /* malformed chunk – skip */ }
      }
    }
  } catch (error) {
    console.error("[sendMessageStream]", error)
    onError?.(error)
  }
}

export default sendMessage
