/**
 * Entry point for the Omniscope Workflow MCP server.
 *  - Redirects console output into ./logs for later inspection.
 *  - Hosts the Streamable HTTP transport under /mcp with optional Basic auth.
 *  - Manages per-session McpServer instances so multiple MCP sessions can run concurrently.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import util from "util";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"; // no longer needed

import { registerWorkflowTools } from "./apis/workflow/workflow-tools.js";

// ---------- Global Logging Redirect ----------

// Create logs folder if missing
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create log streams (append mode)
const outStream = fs.createWriteStream(path.join(logsDir, "stdout.log"), {
  flags: "a",
});
const errStream = fs.createWriteStream(path.join(logsDir, "stderr.log"), {
  flags: "a",
});

// Keep original console methods
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;

function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return util.inspect(a, { depth: 4 });
  }
}

// Redirect console.log → file (+ terminal)
console.log = (...args: any[]) => {
  const line = args.map(formatArg).join(" ") + "\n";
  outStream.write(line);
  origLog(...args); // remove this if you want logs ONLY in files
};

// Redirect console.error → file (+ terminal)
console.error = (...args: any[]) => {
  const line = args.map(formatArg).join(" ") + "\n";
  errStream.write(line);
  origError(...args);
};

// Redirect console.warn → file (+ terminal)
console.warn = (...args: any[]) => {
  const line = args.map(formatArg).join(" ") + "\n";
  outStream.write("[WARN] " + line);
  origWarn(...args);
};

// Graceful shutdown: flush log streams
function shutdown() {
  outStream.end();
  errStream.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------- MCP Server ----------

function createOmniscopeServer(): McpServer {
  const server = new McpServer({
    name: "omniscope-mcp",
    version: "0.1.0",
  });

  // Register all API tool families here
  registerWorkflowTools(server);
  // registerSchedulerTools(server);
  // registerProjectTools(server);

  return server;
}

// ---------- Session handling ----------

type SessionContext = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

const sessions = new Map<string, SessionContext>();

async function disposeSession(id?: string) {
  if (!id) return;
  const ctx = sessions.get(id);
  if (!ctx) return;

  sessions.delete(id);
  await ctx.server.close();
}

// ---------- HTTP server ----------

const app = express();
app.use(express.json({ limit: "4mb" }));

const USER = process.env.MCP_BASIC_USER;
const PASS = process.env.MCP_BASIC_PASS;

/**
 * Basic auth for /mcp only.
 *
 * Behaviour:
 *  - If MCP_BASIC_USER and MCP_BASIC_PASS are set:
 *      -> Protect /mcp with HTTP Basic Auth.
 *  - If they are NOT set:
 *      -> Do NOT require auth (useful for ChatGPT MCP testing).
 */
app.use((req, res, next) => {
  // Only care about /mcp traffic
  if (!req.path.startsWith("/mcp")) return next();

  // If no credentials configured, leave /mcp open (for ChatGPT / dev)
  if (!USER || !PASS) {
    return next();
  }

  const h = req.header("authorization");
  if (!h || !h.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Omniscope MCP"');
    return res.status(401).json({ error: "Unauthorized" });
  }

  const decoded = Buffer.from(h.substring(6), "base64").toString();
  const [u, p] = decoded.split(":");

  if (u !== USER || p !== PASS) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  next();
});

// MCP endpoint
app.all("/mcp", async (req, res) => {
  console.log("=== Incoming MCP Request ===");
  console.log("Method:", req.method);
  console.log("Body.method:", (req.body as any)?.method);
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  console.log("============================");

  try {
    const id = req.header("mcp-session-id");
    let session = id ? sessions.get(id) : undefined;

    const isInit =
      req.method === "POST" &&
      req.body &&
      typeof (req.body as any).method === "string" &&
      (req.body as any).method === "initialize";

    // New session on initialize
    if (!session && isInit) {
      const server = createOmniscopeServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newId) => {
          sessions.set(newId, { server, transport });
        },
        onsessionclosed: (closedId) => {
          void disposeSession(closedId);
        },
      });

      transport.onclose = () => {
        void disposeSession(transport.sessionId);
      };

      await server.connect(transport);
      session = { server, transport };
    }

    // No valid session yet
    if (!session) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session" },
        id: null,
      });
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling /mcp request:", err);
    return res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    });
  }
});

// Start HTTP server
const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Omniscope MCP listening on ${port}`);
});
