import express from "express"
import dotenv from "dotenv"
import proxy from "express-http-proxy"
import http from "http"
dotenv.config()
import cors from "cors"
import cookieParser from "cookie-parser"
import { getCurrentUser } from "./controllers/user.controller.js"
import protect from "./middleware/auth.middleware.js"
import { proxyWithHeader } from "./utils/proxyWithHeader.js"
import morgan from "morgan"

const port = process.env.PORT

const app = express()
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}))
app.use(morgan("dev"))
app.use(cookieParser())
app.use(express.json())

// ── SSE Streaming route — must bypass express-http-proxy (it buffers SSE) ─────
// Manually pipe the agent stream so SSE tokens reach the browser in real-time.
app.post("/api/agent/stream", protect, (req, res) => {
    const agentUrl = new URL(process.env.AGENT_SERVICE)
    const body = JSON.stringify(req.body)

    const options = {
        hostname: agentUrl.hostname,
        port:     agentUrl.port || 80,
        path:     "/stream",
        method:   "POST",
        headers: {
            "Content-Type":   "application/json",
            "Content-Length": Buffer.byteLength(body),
            "x-user-id":      req.user?.userId || "",
        },
    }

    const agentReq = http.request(options, (agentRes) => {
        // Forward SSE headers
        res.setHeader("Content-Type",      agentRes.headers["content-type"] || "text/event-stream")
        res.setHeader("Cache-Control",     "no-cache")
        res.setHeader("Connection",        "keep-alive")
        res.setHeader("X-Accel-Buffering", "no")
        res.flushHeaders()

        // Pipe the SSE stream straight through without buffering
        agentRes.pipe(res)
        agentRes.on("end", () => res.end())
    })

    agentReq.on("error", (err) => {
        console.error("[gateway/stream]", err.message)
        if (!res.headersSent) res.status(502).json({ message: "Agent stream unavailable" })
        else res.end()
    })

    agentReq.write(body)
    agentReq.end()
})

app.use("/api/auth", proxy(process.env.AUTH_SERVICE))
app.use("/api/chat", protect, proxyWithHeader(process.env.CHAT_SERVICE))
app.use("/api/agent", protect, proxyWithHeader(process.env.AGENT_SERVICE))
app.use("/api/billing", protect, proxyWithHeader(process.env.BILLING_SERVICE))
app.get("/api/me", protect, getCurrentUser)
app.get("/", (req, res) => {
    res.json({ message: "hello from gateway v5" })
})

app.listen(port, () => {
    console.log(`gateway started at ${port}`)
})
