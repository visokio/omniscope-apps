# Omniscope Workflow MCP Server

MCP (Model Context Protocol) server that exposes the **Omniscope Workflow REST API** as a set of MCP tools.  
Run it locally, inside Docker, or via `docker compose` and connect it to ChatGPT MCP connectors, curl, or Insomnia.

---

## What You Get

- ✅ Execute Omniscope workflows (standard + lambda copies)
- ✅ Poll workflow job state
- ✅ Read and update project parameters
- ✅ Restrict access to specific project path prefixes
- ✅ Optional HTTP basic auth guard around the `/mcp` endpoint
- ✅ File-based logging (`logs/stdout.log`, `logs/stderr.log`) for auditing requests

All tools are registered under the MCP namespace `workflow_*` (see below).

---

## Requirements

- **Node.js** v18+ (for local runs)
- **npm** (ships with Node)
- Access to an Omniscope instance that exposes the Workflow REST API
- Ability to reach that Omniscope instance from wherever the MCP server runs
- Docker / Docker Compose (optional, for containerized runs)

---

## Environment Variables

Create a `.env` file in the project root. Only the variables below are used by the codebase.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OMNI_BASE_URL` | ✅ | — | Base URL of your Omniscope instance, e.g. `https://demo.omniscope.me`. |
| `OMNI_BASIC_USERNAME` | ⚠️ (one of username/password pair) | — | Username for Omniscope basic auth. Leave both username & password empty if authentication is not required. |
| `OMNI_BASIC_PASSWORD` | ⚠️ | — | Password for Omniscope basic auth. |
| `OMNI_ALLOWED_PROJECT_PREFIXES` | ❌ | (empty) | Comma-separated prefixes (`/_global_,/mcptest`). Requests must target one of these prefixes when set. |
| `OMNI_TIMEOUT_MS` | ❌ | `15000` | Timeout for outbound HTTP requests to Omniscope. |
| `PORT` | ❌ | `3000` | Port where the MCP HTTP server listens. |
| `MCP_BASIC_USER` / `MCP_BASIC_PASS` | ❌ | (unset) | Enable HTTP Basic Auth for `/mcp` if both are set. |
| `MCP_LOG_TOOLS` | ❌ | `true` | Set to `false` to mute per-tool console logging. |

> There is no `.env.example` in the repo, so create `.env` manually using the table above.

Minimal `.env` example:

```dotenv
OMNI_BASE_URL=https://demo.omniscope.me
OMNI_BASIC_USERNAME=workflow-user
OMNI_BASIC_PASSWORD=workflow-pass
PORT=3000
```

---

## Available MCP Tools

| Tool name | Description | Key arguments |
| --- | --- | --- |
| `workflow_execute` | Runs an Omniscope workflow and returns `jobId`. | `project_path` (string), optional `blocks`, `refresh_from_source`, `cancel_existing`, `dry_run`. |
| `workflow_execute_lambda` | Executes a lambda copy of a workflow. | Same as above plus optional `params`, `delete_execution_on_finish`. |
| `workflow_get_job_state` | Polls workflow run status. | `project_path`, `job_id`. |
| `workflow_get_parameters` | Reads project parameters. | `project_path`, optional `parameter_name`. |
| `workflow_update_parameters` | Updates one or more parameters. | `project_path`, `updates[{ name, value }]`, optional `dry_run`. |

These map to Omniscope REST endpoints via `src/apis/workflow/workflow-client.ts`.

---

## Running Locally (Node.js)

```bash
git clone <repo-url> omniscope-workflow-mcp
cd omniscope-workflow-mcp
npm install
```

1. **Configure environment**  
   Create `.env` (see table above).

2. **Build TypeScript → dist/**  
   ```bash
   npm run build
   ```

3. **Start the server**  
   ```bash
   npm start
   ```
   Expected log: `Omniscope MCP listening on 3000`. The MCP endpoint lives at `http://localhost:3000/mcp`.

4. **(Optional) Dev/watch mode**  
   ```bash
   npm run dev
   ```
   Uses `tsx` to watch `src/server.ts`.

Logs are always written to the local `logs/` folder (`stdout.log`, `stderr.log`). Keep the folder ignored in git (already configured).

---

## Running with Docker

### 1. Build an image (must be done before any Docker/Compose run)

```bash
docker build -t omniscope-mcp:latest .
```

### 2. Run the container directly

```bash
docker run --env-file .env -p 3000:3000 omniscope-mcp:latest
```

The server still writes to `/app/logs`. Mount a host volume if you want the log files persisted:

```bash
docker run --env-file .env -p 3000:3000 -v "$(pwd)/logs:/app/logs" omniscope-mcp:latest
```

---

## Running with Docker Compose

`docker-compose.yml` spins up the MCP server plus an nginx proxy that terminates TLS and forwards requests.

1. **Build the server image (Compose expects `omniscope-mcp:latest`):**

   ```bash
   docker build -t omniscope-mcp:latest .
   ```

2. **Bring up the stack:**

   ```bash
   docker compose up -d
   ```

   - `mcp-server`: runs the Node service, exposes port 3000 internally, mounts `./logs` → `/app/logs`.
   - `nginx`: listens on host port 3000, proxies to `mcp-server`, and mounts `nginx.conf` plus local `/etc/letsencrypt` certs.

3. **Check logs:**

   ```bash
   docker compose logs -f mcp-server
   docker compose logs -f nginx
   ```

4. **Shut everything down:**

   ```bash
   docker compose down
   ```

Update the compose file if you push tagged images to a registry; by default it expects the locally built `omniscope-mcp:latest`.

---

## Manual Testing with `curl`

### 1. Initialize a session

```bash
curl -i \
  -H "Content-Type: application/json" \
  -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
          "protocolVersion": "2025-03-26",
          "capabilities": {
            "tools": {},
            "resources": {},
            "prompts": {}
          },
          "clientInfo": {
            "name": "curl-client",
            "version": "1.0.0"
          }
        }
      }' \
  http://localhost:3000/mcp
```

Copy the `mcp-session-id` header from the response. If you configured `MCP_BASIC_USER/PASS`, add `-u "user:pass"` to each call.

### 2. Execute a workflow

```bash
curl -i \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
          "name": "workflow_execute",
          "arguments": {
            "project_path": "/mcptest/Project.iox"
          }
        }
      }' \
  http://localhost:3000/mcp
```

### 3. Poll job state

```bash
curl -i \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
          "name": "workflow_get_job_state",
          "arguments": {
            "project_path": "/mcptest/Project.iox",
            "job_id": "<JOB_ID>"
          }
        }
      }' \
  http://localhost:3000/mcp
```

Replace `project_path` and `job_id` with real values. Similar payloads apply to `workflow_get_parameters` and `workflow_update_parameters`.

---

## Logging & Troubleshooting

- Console output is mirrored to `logs/stdout.log` and `logs/stderr.log`. Inspect these when debugging requests from Insomnia or ChatGPT.
- Enable detailed tool logs with the default `MCP_LOG_TOOLS=true`. Set it to `false` to reduce noise.
- If Omniscope rejects requests, check credentials and project prefixes: `validateProjectPath` enforces `OMNI_ALLOWED_PROJECT_PREFIXES`.
- Timeout errors respect `OMNI_TIMEOUT_MS`.

---

## Development Notes

- Source lives under `src/` with TypeScript strict mode (see `tsconfig.json`).
- Build artifacts go to `dist/`; do not check them in.
- The server currently only registers workflow-related tools. Additional APIs can hook into `registerWorkflowTools` in `src/server.ts`.

You now have a complete MCP server that mirrors Omniscope workflows to AI agents and manual clients alike.
