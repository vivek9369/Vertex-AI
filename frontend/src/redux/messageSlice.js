import { createSlice } from "@reduxjs/toolkit";

const messageSlice = createSlice({
  name: "message",
  initialState: {
    messages:  [],
    artifacts: [],
    isLoading: false,
  },
  reducers: {
    setMessages: (state, action) => {
      state.messages = action.payload
    },
    addMessage: (state, action) => {
      state.messages.push(action.payload)
    },
    setArtifacts: (state, action) => {
      state.artifacts = action.payload
    },
    setIsLoading: (state, action) => {
      state.isLoading = action.payload
    },

    // ── SSE Streaming reducers ────────────────────────────────────────────
    /** Append a token to the last (streaming) assistant message. */
    appendStreamToken: (state, action) => {
      const last = state.messages[state.messages.length - 1]
      if (last && last.role === "assistant") {
        last.content   = (last.content || "") + action.payload
        last.streaming = true
      }
    },
    /** Mark the last assistant message as fully received. */
    finalizeStream: (state) => {
      const last = state.messages[state.messages.length - 1]
      if (last && last.role === "assistant") {
        last.streaming = false
      }
    },
  },
})

export const {
  setMessages,
  addMessage,
  setArtifacts,
  setIsLoading,
  appendStreamToken,
  finalizeStream,
} = messageSlice.actions

export default messageSlice.reducer
