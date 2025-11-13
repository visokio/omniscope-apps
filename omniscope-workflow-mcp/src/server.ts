import "dotenv/config";
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
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

type ExecuteWorkflowInput = z.infer<typeof executeWorkflowSchema>;
type LambdaExecuteWorkflowInput = z.infer<typeof lambdaExecuteWorkflowSchema>;
type GetJobStateInput = z.infer<typeof getJobStateSchema>;
type GetParametersInput = z.infer<typeof getParametersSchema>;
type UpdateParametersInput = z.infer<typeof updateParametersSchema>;

const toJsonResult = (payload: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    },
  ],
});

const registerWorkflowTools = (server: McpServer) => {
  server.registerTool(
    'execute_workflow',
    {
      title: 'Execute workflow',
      description: 'Execute an Omniscope workflow project and return the job identifier.',
      inputSchema: executeWorkflowSchema.shape,
    },
    async (args: ExecuteWorkflowInput) => {
      const client = createClient(config, args.baseUrl);
      const { baseUrl, ...rest } = args;
      const workflowArgs: ExecuteWorkflowArgs = { ...rest };
      const response = await client.executeWorkflow(workflowArgs);
      return toJsonResult(response);
    },
  );

  server.registerTool(
    'lambda_execute_workflow',
    {
      title: 'Lambda execute workflow',
      description: 'Execute an Omniscope workflow as a lambda copy with optional parameters.',
      inputSchema: lambdaExecuteWorkflowSchema.shape,
    },
    async (args: LambdaExecuteWorkflowInput) => {
      const client = createClient(config, args.baseUrl);
      const { baseUrl, ...rest } = args;
      const lambdaArgs: LambdaExecuteWorkflowArgs = { ...rest };
      const response = await client.lambdaExecuteWorkflow(lambdaArgs);
      return toJsonResult(response);
    },
  );

  server.registerTool(
    'get_job_state',
    {
      title: 'Get job state',
      description: 'Retrieve the state of a workflow job using its identifier.',
      inputSchema: getJobStateSchema.shape,
    },
    async (args: GetJobStateInput) => {
      const client = createClient(config, args.baseUrl);
      const response = await client.getJobState(args.projectPath, args.jobId);
      return toJsonResult(response);
    },
  );

  server.registerTool(
    'get_parameters',
    {
      title: 'Get parameters',
      description: 'Fetch project parameters from an Omniscope workflow project.',
      inputSchema: getParametersSchema.shape,
    },
    async (args: GetParametersInput) => {
      const client = createClient(config, args.baseUrl);
      const { baseUrl, ...rest } = args;
      const parameterArgs: GetParametersArgs = { ...rest };
      const response = await client.getParameters(parameterArgs);
      return toJsonResult(response);
    },
  );

  server.registerTool(
    'update_parameters',
    {
      title: 'Update parameters',
      description: 'Update project parameters in an Omniscope workflow project.',
      inputSchema: updateParametersSchema.shape,
    },
    async (args: UpdateParametersInput) => {
      const client = createClient(config, args.baseUrl);
      const { baseUrl, ...rest } = args;
      const updateArgs: UpdateParametersArgs = {
        ...rest,
        updates: rest.updates.map((entry) => ({
          name: entry.name,
          value: entry.value,
        })),
      };
      const response = await client.updateParameters(updateArgs);
      return toJsonResult(response);
    },
  );
};

const createWorkflowServer = (): McpServer => {
  const server = new McpServer({
    name: 'omniscope-workflow-mcp',
    version: '0.1.0',
  });
  registerWorkflowTools(server);
  return server;
};

type SessionContext = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

const sessions = new Map<string, SessionContext>();

const trackSession = (sessionId: string, context: SessionContext) => {
  sessions.set(sessionId, context);
};

const disposeSession = async (sessionId?: string) => {
  if (!sessionId) {
    return;
  }
  const context = sessions.get(sessionId);
  if (!context) {
    return;
  }
  sessions.delete(sessionId);
  try {
    await context.server.close();
  } catch (error) {
    console.error(`Failed to close session ${sessionId}:`, error);
  }
};

const app = express();
app.use(
  express.json({
    limit: '4mb',
  }),
);

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

const unknownSessionResponse = {
  jsonrpc: '2.0',
  error: {
    code: -32004,
    message: 'Unknown MCP session. Start a new session with an initialization request.',
  },
  id: null,
};

const invalidRequestResponse = {
  jsonrpc: '2.0',
  error: {
    code: -32000,
    message: 'Bad Request: No valid session ID provided',
  },
  id: null,
};

app.all('/mcp', async (req, res) => {
  try {
    const sessionId = req.header('mcp-session-id') ?? undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session && req.method === 'POST' && isInitializeRequest(req.body)) {
      const server = createWorkflowServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          trackSession(newSessionId, { server, transport });
        },
        onsessionclosed: (closedSessionId) => {
          void disposeSession(closedSessionId);
        },
      });

      transport.onclose = () => {
        void disposeSession(transport.sessionId);
      };

      await server.connect(transport);
      session = { server, transport };
    } else if (!session && sessionId) {
      res.status(404).json(unknownSessionResponse);
      return;
    } else if (!session) {
      res.status(400).json(invalidRequestResponse);
      return;
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Failed to handle MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

async function main() {
  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      console.log(`Omniscope Workflow MCP server listening on http://${host}:${port}`);
      resolve();
    });
  });
}

void main().catch((error) => {
  console.error('Failed to start Omniscope Workflow MCP server:', error);
  process.exitCode = 1;
});
