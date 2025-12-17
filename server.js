import { WebSocketServer } from "ws";
import http from "http";
import { setupWSConnection, setPersistence } from "./utils.js";
import { initMongoDB, persistence, closeMongoDB } from "./persistence.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const host = process.env.HOST || "localhost";
const port = parseInt(process.env.PORT || "1234");

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("Yjs WebSocket Server is running");
});

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
