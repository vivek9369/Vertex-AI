import Redis from "ioredis"

const redis = new Redis(process.env.REDIS_URL, {
    lazyConnect:          true,   // don't connect until first command
    enableOfflineQueue:   false,  // fail fast instead of queuing commands when disconnected
    maxRetriesPerRequest: 1,      // only retry once so errors surface quickly
    retryStrategy: (times) => {
        // Reconnect with a cap of 5s; don't hammer the server
        if (times > 5) return null  // stop retrying after 5 attempts per session
        return Math.min(times * 500, 5000)
    }
})

redis.on("connect", () => {
    console.log("redis connected")
})

redis.on("error", (err) => {
    // Log once but don't crash — services should degrade gracefully
    if (!redis._errLogged) {
        console.warn("[redis] Connection error:", err.message)
        redis._errLogged = true
    }
})

redis.on("reconnecting", () => {
    redis._errLogged = false  // reset so next error is logged
})

export default redis
