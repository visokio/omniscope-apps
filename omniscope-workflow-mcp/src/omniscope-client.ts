import { Buffer } from 'node:buffer';

import { ServerConfig, resolveBaseUrl, validateProjectPath } from './config.js';

export interface ExecuteWorkflowArgs {
  projectPath: string;
  blocks?: string[];
  refreshFromSource?: boolean;
  cancelExisting?: boolean;
  dryRun?: boolean;
}

export interface LambdaExecuteWorkflowArgs extends ExecuteWorkflowArgs {
  params?: Record<string, unknown>;
  deleteExecutionOnFinish?: boolean;
}

export interface UpdateParametersArgs {
  projectPath: string;
  updates: Array<{ name: string; value: unknown }>;
  dryRun?: boolean;
}

export interface GetParametersArgs {
  projectPath: string;
  parameterName?: string;
}

export type JobState =
  | 'QUEUED'
  | 'RUNNING'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface JobStateResponse {
  jobState: JobState;
}

export class OmniscopeClient {
  constructor(private readonly config: ServerConfig, private readonly baseUrl: string) {}

  private buildUrl(projectPath: string, suffix: string): string {
    const sanitized = projectPath.endsWith('/') ? projectPath.replace(/\/+$/, '') : projectPath;
    return `${this.baseUrl}${sanitized}${suffix}`;
  }

  private createHeaders(): HeadersInit {
    switch (this.config.auth.type) {
      case 'bearer':
        return { Authorization: `Bearer ${this.config.auth.token}` };
      case 'basic':
        return {
          Authorization: `Basic ${Buffer.from(`${this.config.auth.username}:${this.config.auth.password}`, 'utf8').toString('base64')}`,
        };
      default:
        return {};
    }
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.createHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    };

    if (init.body !== undefined && init.body !== null && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage: string | undefined;
        try {
          const data = await response.json();
          errorMessage = typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data);
        } catch (error) {
          errorMessage = response.statusText || (error as Error).message;
        }

        throw new Error(`Omniscope API request failed (${response.status}): ${errorMessage}`);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async executeWorkflow(args: ExecuteWorkflowArgs) {
    const projectPath = validateProjectPath(this.config, args.projectPath);
    if (args.dryRun) {
      return { dryRun: true, projectPath, baseUrl: this.baseUrl };
    }

    const body: Record<string, unknown> = {};
    if (args.blocks) body.blocks = args.blocks;
    if (typeof args.refreshFromSource === 'boolean') body.refreshFromSource = args.refreshFromSource;
    if (typeof args.cancelExisting === 'boolean') body.cancelExisting = args.cancelExisting;

    return this.request<{ jobId: string }>(this.buildUrl(projectPath, '/w/execute'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async lambdaExecuteWorkflow(args: LambdaExecuteWorkflowArgs) {
    const projectPath = validateProjectPath(this.config, args.projectPath);
    if (args.dryRun) {
      return { dryRun: true, projectPath, baseUrl: this.baseUrl };
    }

    const body: Record<string, unknown> = {};
    if (args.blocks) body.blocks = args.blocks;
    if (typeof args.refreshFromSource === 'boolean') body.refreshFromSource = args.refreshFromSource;
    if (typeof args.cancelExisting === 'boolean') body.cancelExisting = args.cancelExisting;
    if (typeof args.deleteExecutionOnFinish === 'boolean') body.deleteExecutionOnFinish = args.deleteExecutionOnFinish;
    if (args.params) body.params = args.params;

    return this.request<{ jobId: string; lambdaProjectPath: string }>(
      this.buildUrl(projectPath, '/w/lambda/execute'),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
  }

  async getJobState(projectPath: string, jobId: string) {
    const validPath = validateProjectPath(this.config, projectPath);
    return this.request<JobStateResponse>(this.buildUrl(validPath, `/w/job/${encodeURIComponent(jobId)}/state`));
  }

  async getParameters(args: GetParametersArgs) {
    const projectPath = validateProjectPath(this.config, args.projectPath);
    const suffix = args.parameterName ? `/w/param/${encodeURIComponent(args.parameterName)}` : '/w/param';
    return this.request<Record<string, unknown>>(this.buildUrl(projectPath, suffix));
  }

  async updateParameters(args: UpdateParametersArgs) {
    const projectPath = validateProjectPath(this.config, args.projectPath);
    if (args.dryRun) {
      return { dryRun: true, projectPath, baseUrl: this.baseUrl, updates: args.updates };
    }

    if (args.updates.length === 0) {
      throw new Error('updates array must contain at least one entry');
    }

    return this.request<Record<string, unknown>>(this.buildUrl(projectPath, '/w/updateparams'), {
      method: 'POST',
      body: JSON.stringify({ updates: args.updates }),
    });
  }
}

export const createClient = (config: ServerConfig, baseUrl?: string): OmniscopeClient => {
  const resolvedBaseUrl = resolveBaseUrl(config, baseUrl);
  return new OmniscopeClient(config, resolvedBaseUrl);
};
