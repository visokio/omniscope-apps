/**
 * Thin HTTP client for Omniscope Workflow REST API.
 * Keeps all networking and authentication logic out of the MCP tool definitions.
 */
import { Buffer } from "node:buffer";
import { ServerConfig, resolveBaseUrl, validateProjectPath } from "../../config.js";

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
  | "QUEUED"
  | "RUNNING"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface JobStateResponse {
  jobState: JobState;
}

/**
 * Wraps all workflow REST calls and enforces the server-side config constraints.
 */
export class WorkflowClient {
  constructor(
    private readonly config: ServerConfig,
    private readonly baseUrl: string
  ) {}

  private buildUrl(projectPath: string, suffix: string) {
    const base = this.baseUrl.replace(/\/+$/, "");
    const withLeading = projectPath.startsWith("/")
      ? projectPath
      : `/${projectPath}`;
    const clean = withLeading.replace(/\/+$/, "");

    return `${base}${clean}${suffix}`;
  }

  private createHeaders(): HeadersInit {
    const { type, username, password } = this.config.auth;

    if (type === "basic") {
      return {
        Authorization:
          "Basic " +
          Buffer.from(`${username}:${password}`, "utf8").toString("base64"),
      };
    }

    return {};
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");

    const authHeaders = this.createHeaders();
    Object.entries(authHeaders).forEach(([k, v]) => headers.set(k, v));

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs
    );

    try {
      const response = await fetch(url, { ...init, headers, signal: controller.signal });

      if (!response.ok) {
        let msg = response.statusText;
        try {
          const json = await response.json();
          msg = JSON.stringify(json);
        } catch {}
        throw new Error(`Workflow API error (${response.status}): ${msg}`);
      }

      if (response.status === 204) return {} as T;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------- Endpoints ----------

  /**
   * Triggers an in-place workflow run or returns a dry-run payload.
   */
  executeWorkflow(args: ExecuteWorkflowArgs) {
    const p = validateProjectPath(this.config, args.projectPath);
    if (args.dryRun) return { dryRun: true, projectPath: p, baseUrl: this.baseUrl };

    const body: any = {};
    if (args.blocks) body.blocks = args.blocks;
    if (args.refreshFromSource !== undefined) body.refreshFromSource = args.refreshFromSource;
    if (args.cancelExisting !== undefined) body.cancelExisting = args.cancelExisting;

    return this.request<{ jobId: string }>(
      this.buildUrl(p, "/w/execute"),
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  /**
   * Triggers a lambda workflow run or returns a dry-run payload.
   */
  lambdaExecuteWorkflow(args: LambdaExecuteWorkflowArgs) {
    const p = validateProjectPath(this.config, args.projectPath);
    if (args.dryRun) return { dryRun: true, projectPath: p, baseUrl: this.baseUrl };

    const body: any = {};
    if (args.blocks) body.blocks = args.blocks;
    if (args.refreshFromSource !== undefined) body.refreshFromSource = args.refreshFromSource;
    if (args.cancelExisting !== undefined) body.cancelExisting = args.cancelExisting;
    if (args.deleteExecutionOnFinish !== undefined)
      body.deleteExecutionOnFinish = args.deleteExecutionOnFinish;
    if (args.params) body.params = args.params;

    return this.request<{ jobId: string; lambdaProjectPath: string }>(
      this.buildUrl(p, "/w/lambda/execute"),
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  /**
   * Polls job state for a workflow execution.
   */
  getJobState(projectPath: string, jobId: string) {
    const p = validateProjectPath(this.config, projectPath);
    return this.request<JobStateResponse>(
      this.buildUrl(p, `/w/job/${encodeURIComponent(jobId)}/state`)
    );
  }

  /**
   * Reads workflow parameters or a single parameter when `parameterName` is set.
   */
  getParameters(args: GetParametersArgs) {
    const p = validateProjectPath(this.config, args.projectPath);
    const suffix = args.parameterName
      ? `/w/param/${encodeURIComponent(args.parameterName)}`
      : "/w/param";

    return this.request<Record<string, unknown>>(this.buildUrl(p, suffix));
  }

  /**
   * Updates workflow parameters or previews the update when `dryRun` is true.
   */
  updateParameters(args: UpdateParametersArgs) {
    const p = validateProjectPath(this.config, args.projectPath);
    if (args.dryRun)
      return { dryRun: true, projectPath: p, updates: args.updates };

    return this.request<Record<string, unknown>>(
      this.buildUrl(p, "/w/updateparams"),
      { method: "POST", body: JSON.stringify({ updates: args.updates }) }
    );
  }
}

/**
 * Factory that instantiates WorkflowClient with the normalized base URL.
 */
export const createWorkflowClient = (config: ServerConfig) =>
  new WorkflowClient(config, resolveBaseUrl(config));
