import express from "express";
import axios from "axios";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());

// Service endpoints
const INIT_SERVICE = process.env.INIT_SERVICE || "http://initialization-service:3001";
const ORCH_SERVICE = process.env.ORCH_SERVICE || "http://orchestration-service:3002";

// Create a new code editor session
app.post("/api/sessions", async (req, res) => {
    const { language = "nodejs", roomId, userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
    }
    
    // Generate cloudId - use roomId if provided, otherwise create a new one
    const cloudId = roomId || `room-${uuidv4()}`;
    
    try {
        // Initialize environment with templates and container
        const response = await axios.post(`${INIT_SERVICE}/initialize`, {
            cloudId,
            language,
            dependencies: req.body.dependencies || []
        });
        
        return res.status(201).json({
            sessionId: cloudId,
            language,
            containerEndpoint: response.data.containerEndpoint,
            wsEndpoint: `/ws?cloudId=${cloudId}`,
            message: "Session created successfully"
        });
    } catch (error) {
        console.error("Failed to create session:", error);
        return res.status(500).json({
            error: "Failed to create session",
            details: error.response?.data || error.message
        });
    }
});

// Get session status
app.get("/api/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        const response = await axios.get(`${INIT_SERVICE}/status/${sessionId}`);
        return res.status(200).json(response.data);
    } catch (error) {
        console.error("Failed to get session status:", error);
        return res.status(404).json({
            error: "Session not found or error checking status",
            details: error.response?.data || error.message
        });
    }
});

// Terminate session
app.delete("/api/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        await axios.delete(`${ORCH_SERVICE}/terminate/${sessionId}`);
        return res.status(200).json({
            message: "Session terminated successfully"
        });
    } catch (error) {
        console.error("Failed to terminate session:", error);
        return res.status(500).json({
            error: "Failed to terminate session",
            details: error.response?.data || error.message
        });
    }
});

// List supported languages
app.get("/api/languages", (req, res) => {
    return res.status(200).json({
        languages: [
            { id: "nodejs", name: "Node.js", version: "18" },
            { id: "python", name: "Python", version: "3.11" },
            { id: "java", name: "Java", version: "17" },
            { id: "cpp", name: "C++", version: "12" },
            { id: "go", name: "Go", version: "1.20" }
        ]
    });
});

// Proxy WebSocket connections to Runner service
io.on("connection", (socket) => {
    const cloudId = socket.handshake.query.cloudId as string;
    
    if (!cloudId) {
        socket.disconnect();
        return;
    }
    
    console.log(`Gateway WebSocket connected for cloudId: ${cloudId}`);
    
    // Forward events to Runner service
    // This is a simplified example - in a real implementation,
    // you might use a direct WebSocket connection to the Runner service
    
    socket.on("disconnect", () => {
        console.log(`Gateway WebSocket disconnected for cloudId: ${cloudId}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`API Gateway listening on port ${PORT}`);
});