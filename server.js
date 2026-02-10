import { WebSocketServer } from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import os from "os";
import { setupWSConnection, setPersistence, docs } from "./utils.js";
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

// --- Lightweight metrics & error logging ---

const serverStartTime = Date.now();
let peakConnections = 0;
let prevCpuUsage = process.cpuUsage();
let cpuPercent = 0;

// Health / metrics endpoint
app.get("/api/health", (req, res) => {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const totalConns = Array.from(docs.values()).reduce(
    (sum, doc) => sum + doc.conns.size,
    0,
  );

  res.json({
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
    cpu: {
      percent: +cpuPercent.toFixed(1),
      cores: os.cpus().length,
    },
    memory: {
      heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
      heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
      systemTotalGB: +(totalMem / 1024 / 1024 / 1024).toFixed(2),
      systemFreeGB: +(freeMem / 1024 / 1024 / 1024).toFixed(2),
      systemUsedPercent: +(((totalMem - freeMem) / totalMem) * 100).toFixed(1),
    },
    rooms: docs.size,
    connections: totalConns,
    peakConnections,
    platform: {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
    },
  });
});

// Metrics log every 30 seconds
setInterval(() => {
  // CPU % since last tick
  const cpuDelta = process.cpuUsage(prevCpuUsage);
  cpuPercent = ((cpuDelta.user + cpuDelta.system) / 1_000 / 30_000) * 100;
  prevCpuUsage = process.cpuUsage();

  const mem = process.memoryUsage();
  const heapMB = mem.heapUsed / 1024 / 1024;
  const rssMB = mem.rss / 1024 / 1024;
  
  const totalMemMB = os.totalmem() / 1024 / 1024;
  const freeMemMB = os.freemem() / 1024 / 1024;
  const usedMemPercent = ((totalMemMB - freeMemMB) / totalMemMB) * 100;

  const totalConns = Array.from(docs.values()).reduce(
    (sum, doc) => sum + doc.conns.size,
    0,
  );
  if (totalConns > peakConnections) peakConnections = totalConns;

  const uptimeH = ((Date.now() - serverStartTime) / 3_600_000).toFixed(1);

  console.log(
    `📊 CPU: ${cpuPercent.toFixed(1)}% | Heap: ${heapMB.toFixed(1)}MB | RSS: ${rssMB.toFixed(1)}MB | ` +
      `Sys: ${freeMemMB.toFixed(2)}MB free / ${totalMemMB.toFixed(2)}MB (${usedMemPercent.toFixed(0)}% used) | ` +
      `Rooms: ${docs.size} | Conns: ${totalConns} | Peak: ${peakConnections} | Up: ${uptimeH}h`,
  );

  // Threshold warnings
  if (rssMB > 450) {
    console.warn(
      `⚠️  Memory pressure! Process RSS ${rssMB.toFixed(1)}MB — consider restarting`,
    );
  }
  if (usedMemPercent > 95) {
    console.warn(
      `⚠️  System memory critical! ${usedMemPercent.toFixed(0)}% used (${freeMemMB.toFixed(2)}MB free)`,
    );
  }
  if (cpuPercent > 80) {
    console.warn(`⚠️  High CPU usage: ${cpuPercent.toFixed(1)}%`);
  }
}, 30_000);

// Global error handlers — keep the process alive
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// --- Start server ---

server.listen(port, host, () => {
  console.log(`Yjs WebSocket server running at '${host}' on port ${port}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await closeMongoDB();
  console.log("MongoDB connection closed... Shutdown complete.");
  process.exit(0);
});
