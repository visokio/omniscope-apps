# Omniscope Workflow MCP Server

A Model Context Protocol (MCP) server that surfaces the Omniscope Workflow REST API as MCP tools. The server is designed to run alongside Omniscope or as a standalone, configurable service that can be registered with OpenAI MCP-compatible clients (e.g. ChatGPT connectors).

## Features

- Execute Omniscope workflows and lambda executions.
- Poll workflow job state.
- Read and update project parameters.
- Configurable base URLs and project allow-lists to keep execution scoped.
- Optional health check endpoint that validates connectivity to a specific project.

## Requirements

- Node.js 18 or later.
- Access to the Omniscope Workflow REST API.
- Network access to install npm dependencies, including `@modelcontextprotocol/sdk`.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and update the values:

   ```bash
   cp .env.example .env
   ```

3. Build the TypeScript sources:

   ```bash
   npm run build
   ```

4. Start the server:

   ```bash
   npm start
   ```

   The MCP endpoint is exposed at `http://localhost:3000/mcp` by default. Use the `PORT` environment variable to change the port.

## Environment variables

| Variable | Description | Required | Default |
| --- | --- | --- | --- |
| `OMNI_BASE_URL` | Base URL of the Omniscope instance (e.g. `https://public.omniscope.me`). | ✅ | — |
| `OMNI_ALLOW_BASE_URLS` | Optional comma-separated list of extra base URLs that tool callers are allowed to request. The default base URL is always allowed. | ❌ | — |
| `OMNI_ALLOWED_PROJECT_PREFIXES` | Optional comma-separated list of project path prefixes (e.g. `/_global_`). Requests must target a project within one of these prefixes when set. | ❌ | — |
| `OMNI_BASIC_USERNAME` / `OMNI_BASIC_PASSWORD` | Basic auth credentials for Omniscope. Provide these or `OMNI_BEARER_TOKEN` if the API is protected. | ❌ | — |
| `OMNI_BEARER_TOKEN` | Bearer token for Omniscope API authentication. | ❌ | — |
| `OMNI_TIMEOUT_MS` | Timeout for outbound HTTP requests to Omniscope in milliseconds. | ❌ | `30000` |
| `OMNI_HEALTHCHECK_PROJECT_PATH` | Optional project path used by the `/healthz` endpoint to verify connectivity. | ❌ | — |
| `PORT` | Port to listen on. | ❌ | `3000` |

## Available tools

| Tool | Description | Arguments |
| --- | --- | --- |
| `execute_workflow` | Runs a workflow in-place and returns a job ID. | `projectPath` (string), optional `blocks` (string[]), `refreshFromSource` (boolean), `cancelExisting` (boolean), `dryRun` (boolean), `baseUrl` (string; must be in the allow list). |
| `lambda_execute_workflow` | Executes a workflow as a temporary lambda copy. | Same as `execute_workflow`, plus optional `params` (object) and `deleteExecutionOnFinish` (boolean). |
| `get_job_state` | Retrieves the state of a workflow job. | `projectPath` (string), `jobId` (string), optional `baseUrl` (string). |
| `get_parameters` | Returns project parameters, optionally filtered by name. | `projectPath` (string), optional `parameterName` (string) and `baseUrl` (string). |
| `update_parameters` | Updates one or more project parameters. | `projectPath` (string), `updates` (array of `{ name, value }`), optional `dryRun` (boolean) and `baseUrl` (string). |

### Dry-run support

Mutating tools accept a `dryRun` flag. When set to `true` the server validates the request and reports what would happen without calling the Omniscope API.

## Health check

An optional `/healthz` HTTP endpoint is provided. When `OMNI_HEALTHCHECK_PROJECT_PATH` is set, the server attempts to fetch parameters from that project to verify Omniscope connectivity. Without the variable the endpoint simply returns a static success payload.

## Docker image

You can containerise the server with a simple multi-stage Dockerfile:

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV PORT=3000
CMD ["node", "dist/server.js"]
```

## Development tips

- Use `npm run dev` for a TypeScript-aware development server (requires `ts-node`).
- Enable verbose logging by wrapping the server start command with `DEBUG=mcp:* npm start` (the MCP SDK uses the `debug` package).
- Combine this server with ChatGPT Connectors by registering the MCP endpoint URL in your OpenAI settings.
