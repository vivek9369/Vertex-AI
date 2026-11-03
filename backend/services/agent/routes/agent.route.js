import express                   from "express"
import { agent, agentStream }    from "../controllers/agent.controller.js"
import multer                    from "../config/multer.js"

const router = express.Router()

// Standard (non-streaming) agent handler – all agents
router.post("/chat",   multer.single("file"), agent)

// SSE token-streaming handler – Chat Agent only
router.post("/stream", express.json(), agentStream)

export default router