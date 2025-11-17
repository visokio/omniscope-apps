import dotenv from "dotenv";
dotenv.config();

export interface ServerConfig {
  baseUrl: string;
  auth: {
    type: "basic" | "none";
    username?: string;
    password?: string;
  };
  allowedPrefixes: string[];
  requestTimeoutMs: number;
}

/**
 * Reads configuration from environment variables so other modules can treat the
 * resulting object as immutable runtime config.
 */
export const loadConfig = (): ServerConfig => {
  const baseUrl = process.env.OMNI_BASE_URL ?? "";

  const username = process.env.OMNI_BASIC_USERNAME;
  const password = process.env.OMNI_BASIC_PASSWORD;

  let auth: ServerConfig["auth"];

  if (username && password) {
    // Use Basic auth to Omniscope
    auth = {
      type: "basic",
      username,
      password,
    };
  } else {
    // No Omniscope credentials configured – workflow client should treat this
    // as "no Authorization header"
    auth = {
      type: "none",
    };
  }

  const allowedPrefixes = (process.env.OMNI_ALLOWED_PROJECT_PREFIXES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const requestTimeoutMs = Number(process.env.OMNI_TIMEOUT_MS ?? 15000);

  const config: ServerConfig = {
    baseUrl,
    auth,
    allowedPrefixes,
    requestTimeoutMs,
  };

  // Optional debug log – remove if too noisy
  console.log("[CONFIG] Loaded server config:", {
    baseUrl: config.baseUrl,
    authType: config.auth.type,
    hasUsername: !!config.auth.username,
    hasPassword: !!config.auth.password,
    allowedPrefixes: config.allowedPrefixes,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  return config;
};

/**
 * Normalizes the base URL so downstream clients don't have to worry about trailing slashes.
 */
export function resolveBaseUrl(config: ServerConfig): string {
  // Normalize by stripping trailing slashes
  return config.baseUrl.replace(/\/+$/, "");
}

/**
 * Ensures a project path respects the optional prefix allow-list before hitting Omniscope.
 */
export function validateProjectPath(
  config: ServerConfig,
  projectPath: string,
): string {
  if (!config.allowedPrefixes.length) {
    // If no prefixes configured, allow everything
    return projectPath;
  }

  const valid = config.allowedPrefixes.some((prefix) =>
    projectPath.startsWith(prefix),
  );

  if (!valid) {
    throw new Error(
      `Project path "${projectPath}" is not allowed. Must start with one of: ${config.allowedPrefixes.join(
        ", ",
      )}`,
    );
  }

  return projectPath;
}
