import { WebSocketServer } from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import { setupWSConnection, setPersistence } from "./utils.js";
import { initMongoDB, persistence, closeMongoDB } from "./persistence.js";
import { createRouteHandler } from "uploadthing/express";
import { uploadRouter } from "./uploadthing.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const host = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "1234");

// Create Express app
const app = express();

// Enable CORS for frontend
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

// UploadThing route
const handlers = createRouteHandler({
  router: uploadRouter,
  config: {
    token: process.env.UPLOADTHING_TOKEN,
  },
});

app.use("/api/uploadthing", handlers);

// Health check
app.get("/", (req, res) => {
  res.send("Yjs WebSocket Server is running");
});

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer(app);

// Initialize MongoDB and set persistence
initMongoDB().then((success) => {
  if (success) {
    setPersistence(persistence);
    console.log("🗄️  MongoDB persistence enabled");
  } else {
    console.log("⚠️  Running without persistence (in-memory only)");
  }
});

wss.on("connection", setupWSConnection);

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

server.listen(port, host, () => {
  console.log(`Yjs WebSocket server running at '${host}' on port ${port}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await closeMongoDB();
  process.exit(0);
});
