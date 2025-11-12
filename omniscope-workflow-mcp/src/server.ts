import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/transport/streamable-http.js';
import { z } from 'zod';

import { loadConfig } from './config.js';
import {
  createClient,
  ExecuteWorkflowArgs,
  LambdaExecuteWorkflowArgs,
  UpdateParametersArgs,
  GetParametersArgs,
} from './omniscope-client.js';

const config = loadConfig();

const server = new McpServer({
  name: 'omniscope-workflow-mcp',
  version: '0.1.0',
});

const executeWorkflowSchema = z.object({
  projectPath: z.string(),
  blocks: z.array(z.string()).optional(),
  refreshFromSource: z.boolean().optional(),
  cancelExisting: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  dryRun: z.boolean().optional(),
});

const lambdaExecuteWorkflowSchema = executeWorkflowSchema.extend({
  params: z.record(z.any()).optional(),
  deleteExecutionOnFinish: z.boolean().optional(),
});

const getJobStateSchema = z.object({
  projectPath: z.string(),
  jobId: z.string(),
  baseUrl: z.string().url().optional(),
});

const getParametersSchema = z.object({
  projectPath: z.string(),
  parameterName: z.string().optional(),
  baseUrl: z.string().url().optional(),
});

const updateParametersSchema = z.object({
  projectPath: z.string(),
  updates: z
    .array(
      z.object({
        name: z.string(),
        value: z.any(),
      }),
    )
    .min(1),
  baseUrl: z.string().url().optional(),
  dryRun: z.boolean().optional(),
});

server.tool(
  'execute_workflow',
  {
    description: 'Execute an Omniscope workflow project and return the job identifier.',
    inputSchema: executeWorkflowSchema,
  },
  async (_context, args: z.infer<typeof executeWorkflowSchema>) => {
    const client = createClient(config, args.baseUrl);
    const { baseUrl, ...rest } = args;
    const response = await client.executeWorkflow(rest as ExecuteWorkflowArgs);
    return {
      type: 'result',
      content: [
        {
          type: 'json',
          json: response,
        },
      ],
    };
  },
);

server.tool(
  'lambda_execute_workflow',
  {
    description: 'Execute an Omniscope workflow as a lambda copy with optional parameters.',
    inputSchema: lambdaExecuteWorkflowSchema,
  },
  async (_context, args: z.infer<typeof lambdaExecuteWorkflowSchema>) => {
    const client = createClient(config, args.baseUrl);
    const { baseUrl, ...rest } = args;
    const response = await client.lambdaExecuteWorkflow(rest as LambdaExecuteWorkflowArgs);
    return {
      type: 'result',
      content: [
        {
          type: 'json',
          json: response,
        },
      ],
    };
  },
);

server.tool(
  'get_job_state',
  {
    description: 'Retrieve the state of a workflow job using its identifier.',
    inputSchema: getJobStateSchema,
  },
  async (_context, args: z.infer<typeof getJobStateSchema>) => {
    const client = createClient(config, args.baseUrl);
    const response = await client.getJobState(args.projectPath, args.jobId);
    return {
      type: 'result',
      content: [
        {
          type: 'json',
          json: response,
        },
      ],
    };
  },
);

server.tool(
  'get_parameters',
  {
    description: 'Fetch project parameters from an Omniscope workflow project.',
    inputSchema: getParametersSchema,
  },
  async (_context, args: z.infer<typeof getParametersSchema>) => {
    const client = createClient(config, args.baseUrl);
    const { baseUrl, ...rest } = args;
    const response = await client.getParameters(rest as GetParametersArgs);
    return {
      type: 'result',
      content: [
        {
          type: 'json',
          json: response,
        },
      ],
    };
  },
);

server.tool(
  'update_parameters',
  {
    description: 'Update project parameters in an Omniscope workflow project.',
    inputSchema: updateParametersSchema,
  },
  async (_context, args: z.infer<typeof updateParametersSchema>) => {
    const client = createClient(config, args.baseUrl);
    const { baseUrl, ...rest } = args;
    const response = await client.updateParameters(rest as UpdateParametersArgs);
    return {
      type: 'result',
      content: [
        {
          type: 'json',
          json: response,
        },
      ],
    };
  },
);

const app = express();
app.use(express.json());

const transport = new StreamableHTTPServerTransport({
  app,
  path: '/mcp',
});

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
if (!Number.isFinite(port)) {
  throw new Error('Invalid PORT value');
}

const host = process.env.HOST ?? '0.0.0.0';
const healthProjectPath = process.env.OMNI_HEALTHCHECK_PROJECT_PATH;

app.get('/healthz', async (_req, res) => {
  if (!healthProjectPath) {
    res.json({ status: 'ok', message: 'No health check project configured' });
    return;
  }

  try {
    const client = createClient(config);
    await client.getParameters({ projectPath: healthProjectPath });
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

async function main() {
  await transport.listen({
    port,
    host,
    server,
  });
  console.log(`Omniscope Workflow MCP server listening on http://${host}:${port}`);
}

void main().catch((error) => {
  console.error('Failed to start Omniscope Workflow MCP server:', error);
  process.exitCode = 1;
});
