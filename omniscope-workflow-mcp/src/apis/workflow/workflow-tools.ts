/**
 * workflow-tools.ts
 *
 * This module registers all **Workflow API** MCP tools on the given McpServer.
 * Each tool:
 *   - validates input using Zod schemas,
 *   - logs the tool invocation and arguments,
 *   - delegates to the WorkflowClient (which calls Omniscope’s Workflow API),
 *   - wraps the JSON response into MCP-compatible tool output.
 *
 * Logging:
 *   - Uses console.log so logs appear in `docker compose logs -f mcp-server`.
 *   - Controlled by env var MCP_LOG_TOOLS:
 *       - unset or "true"  -> logging enabled (default)
 *       - "false"          -> logging disabled
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { loadConfig } from "../../config.js";
import {
  createWorkflowClient,
  ExecuteWorkflowArgs,
  LambdaExecuteWorkflowArgs,
  GetParametersArgs,
  UpdateParametersArgs,
} from "./workflow-client.js";

const config = loadConfig();

/**
 * Simple logging helper for workflow tools.
 * Logs only when MCP_LOG_TOOLS is not set to "false".
 */
const logTools = (message: string, data?: unknown) => {
  if (process.env.MCP_LOG_TOOLS === "false") {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = "[workflow-tools]";

  if (data === undefined) {
    console.log(`${prefix} [${timestamp}] ${message}`);
  } else {
    console.log(
      `${prefix} [${timestamp}] ${message}\n` +
        JSON.stringify(data, null, 2),
    );
  }
};

// ---------- Schemas (tool-facing input validation) ----------

/**
 * Input for executing a workflow on a given project.
 *
 * project_path        Path to the Omniscope project, e.g. "/mcptest/myproject.iox"
 * blocks              Optional list of block IDs to execute
 * refresh_from_source Optional: if true, refresh data from source before execution
 * cancel_existing     Optional: if true, cancel any existing run for this project
 * dry_run             Optional: if true, do not actually execute; just return a preview
 */
const executeSchema = z.object({
  project_path: z.string(),
  blocks: z.array(z.string()).optional(),
  refresh_from_source: z.boolean().optional(),
  cancel_existing: z.boolean().optional(),
  dry_run: z.boolean().optional(),
});

/**
 * Input for executing a lambda copy of a workflow.
 *
 * Inherits all of executeSchema plus:
 * params                     Optional map of parameter values to override
 * delete_execution_on_finish Optional: if true, delete the lambda copy after it finishes
 */
const lambdaSchema = executeSchema.extend({
  params: z.record(z.any()).optional(),
  delete_execution_on_finish: z.boolean().optional(),
});

/**
 * Input for retrieving job state.
 *
 * project_path Path to the project that owns the job
 * job_id       Identifier returned by execute/lambda execution
 */
const jobStateSchema = z.object({
  project_path: z.string(),
  job_id: z.string(),
});

/**
 * Input for retrieving project parameters.
 *
 * project_path   Path to the project
 * parameter_name Optional: if set, fetch only that parameter
 */
const getParamsSchema = z.object({
  project_path: z.string(),
  parameter_name: z.string().optional(),
});

/**
 * Input for updating project parameters.
 *
 * project_path   Path to the project
 * updates        List of { name, value } pairs
 * dry_run        Optional: if true, do not persist updates; just preview
 */
const updateParamsSchema = z.object({
  project_path: z.string(),
  updates: z
    .array(
      z.object({
        name: z.string(),
        value: z.any(), // required in the tool input
      }),
    )
    .min(1),
  dry_run: z.boolean().optional(),
});

// Types inferred from schemas (tool-facing)
type ExecuteToolInput = z.infer<typeof executeSchema>;
type LambdaToolInput = z.infer<typeof lambdaSchema>;
type JobStateToolInput = z.infer<typeof jobStateSchema>;
type GetParamsToolInput = z.infer<typeof getParamsSchema>;
type UpdateParamsToolInput = z.infer<typeof updateParamsSchema>;

// ---------- Helper to wrap results in MCP format ----------

/**
 * Wraps arbitrary JSON or string payload into an MCP tool response.
 * The OpenAI model will see this as a "text" content block.
 */
const toJsonResult = (payload: unknown): any => ({
  content: [
    {
      type: "text" as const,
      text:
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2),
    },
  ],
});

// ---------- Registration: attach tools to the MCP server ----------

/**
 * Registers all Workflow-related tools on the given MCP server instance.
 */
export function registerWorkflowTools(server: McpServer) {
  // ---------------------------------------------------------------------------
  // 1) Execute workflow
  // ---------------------------------------------------------------------------
  server.registerTool(
    "workflow_execute",
    {
      title: "Execute workflow",
      description:
        "Execute an Omniscope workflow project and return the job identifier.",
      inputSchema: executeSchema.shape,
    },
    async (args: ExecuteToolInput) => {
      logTools("TOOL CALL: workflow_execute (raw args)", args);

      const client = createWorkflowClient(config);

      // Map snake_case MCP input -> camelCase client args
      const execArgs: ExecuteWorkflowArgs = {
        projectPath: args.project_path,
        blocks: args.blocks,
        refreshFromSource: args.refresh_from_source,
        cancelExisting: args.cancel_existing,
        dryRun: args.dry_run,
      };

      logTools("CLIENT CALL: executeWorkflow (normalized args)", execArgs);

      const result = await client.executeWorkflow(execArgs);

      logTools("CLIENT RESULT: executeWorkflow", result);

      return toJsonResult(result);
    },
  );

  // ---------------------------------------------------------------------------
  // 2) Lambda execute workflow
  // ---------------------------------------------------------------------------
  server.registerTool(
    "workflow_execute_lambda",
    {
      title: "Lambda execute workflow",
      description:
        "Execute an Omniscope workflow as a lambda copy with optional parameters.",
      inputSchema: lambdaSchema.shape,
    },
    async (args: LambdaToolInput) => {
      logTools("TOOL CALL: workflow_execute_lambda (raw args)", args);

      const client = createWorkflowClient(config);

      // Map snake_case MCP input -> camelCase client args
      const lambdaArgs: LambdaExecuteWorkflowArgs = {
        projectPath: args.project_path,
        blocks: args.blocks,
        refreshFromSource: args.refresh_from_source,
        cancelExisting: args.cancel_existing,
        dryRun: args.dry_run,
        params: args.params,
        deleteExecutionOnFinish: args.delete_execution_on_finish,
      };

      logTools(
        "CLIENT CALL: lambdaExecuteWorkflow (normalized args)",
        lambdaArgs,
      );

      const result = await client.lambdaExecuteWorkflow(lambdaArgs);

      logTools("CLIENT RESULT: lambdaExecuteWorkflow", result);

      return toJsonResult(result);
    },
  );

  // ---------------------------------------------------------------------------
  // 3) Get job state
  // ---------------------------------------------------------------------------
  server.registerTool(
    "workflow_get_job_state",
    {
      title: "Get job state",
      description: "Retrieve the state of a workflow job using its identifier.",
      inputSchema: jobStateSchema.shape,
    },
    async (args: JobStateToolInput) => {
      logTools("TOOL CALL: workflow_get_job_state (raw args)", args);

      const client = createWorkflowClient(config);

      // Map snake_case MCP input -> camelCase client args
      const result = await client.getJobState(args.project_path, args.job_id);

      logTools("CLIENT RESULT: getJobState", result);

      return toJsonResult(result);
    },
  );

  // ---------------------------------------------------------------------------
  // 4) Get parameters
  // ---------------------------------------------------------------------------
  server.registerTool(
    "workflow_get_parameters",
    {
      title: "Get parameters",
      description: "Fetch project parameters from an Omniscope workflow project.",
      inputSchema: getParamsSchema.shape,
    },
    async (args: GetParamsToolInput) => {
      logTools("TOOL CALL: workflow_get_parameters (raw args)", args);

      const client = createWorkflowClient(config);

      // Map snake_case MCP input -> camelCase client args
      const getArgs: GetParametersArgs = {
        projectPath: args.project_path,
        parameterName: args.parameter_name,
      };

      logTools("CLIENT CALL: getParameters (normalized args)", getArgs);

      const result = await client.getParameters(getArgs);

      logTools("CLIENT RESULT: getParameters", result);

      return toJsonResult(result);
    },
  );

  // ---------------------------------------------------------------------------
  // 5) Update parameters
  // ---------------------------------------------------------------------------
  server.registerTool(
    "workflow_update_parameters",
    {
      title: "Update parameters",
      description: "Update project parameters in an Omniscope workflow project.",
      inputSchema: updateParamsSchema.shape,
    },
    async (args: UpdateParamsToolInput) => {
      logTools("TOOL CALL: workflow_update_parameters (raw args)", args);

      const client = createWorkflowClient(config);

      // Map snake_case MCP input -> camelCase client args
      const updateArgs: UpdateParametersArgs = {
        projectPath: args.project_path,
        dryRun: args.dry_run,
        updates: args.updates.map((u) => ({
          name: u.name,
          value: u.value as unknown,
        })),
      };

      logTools("CLIENT CALL: updateParameters (normalized args)", updateArgs);

      const result = await client.updateParameters(updateArgs);

      logTools("CLIENT RESULT: updateParameters", result);

      return toJsonResult(result);
    },
  );
}
