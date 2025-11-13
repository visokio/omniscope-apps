import { URL } from 'node:url';

export type AuthConfig =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string };

export interface ServerConfig {
  defaultBaseUrl: string;
  allowedBaseUrls: string[];
  allowedProjectPrefixes: string[];
  auth: AuthConfig;
  requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const normalizeBaseUrl = (raw: string): string => {
  const url = new URL(raw);
  url.hash = '';
  if (url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
};

const normalizePrefix = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty project prefix provided in OMNI_ALLOWED_PROJECT_PREFIXES');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const parseAuth = (): AuthConfig => {
  const token = process.env.OMNI_BEARER_TOKEN?.trim();
  const username = process.env.OMNI_BASIC_USERNAME?.trim();
  const password = process.env.OMNI_BASIC_PASSWORD ?? '';

  if (token) {
    return { type: 'bearer', token };
  }

  if (username) {
    return { type: 'basic', username, password };
  }

  return { type: 'none' };
};

export const loadConfig = (): ServerConfig => {
  const baseUrlEnv = process.env.OMNI_BASE_URL;
  if (!baseUrlEnv) {
    throw new Error('OMNI_BASE_URL environment variable is required');
  }
  const defaultBaseUrl = normalizeBaseUrl(baseUrlEnv);

  const allowedBaseUrls = new Set<string>([defaultBaseUrl]);
  const additional = process.env.OMNI_ALLOW_BASE_URLS
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  additional?.forEach((value) => {
    allowedBaseUrls.add(normalizeBaseUrl(value));
  });

  const prefixes = process.env.OMNI_ALLOWED_PROJECT_PREFIXES
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(normalizePrefix) ?? [];

  const timeoutRaw = process.env.OMNI_TIMEOUT_MS;
  const timeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : DEFAULT_TIMEOUT_MS;

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`Invalid OMNI_TIMEOUT_MS value: ${timeoutRaw}`);
  }

  return {
    defaultBaseUrl,
    allowedBaseUrls: Array.from(allowedBaseUrls.values()),
    allowedProjectPrefixes: prefixes,
    auth: parseAuth(),
    requestTimeoutMs: timeout,
  };
};

export const resolveBaseUrl = (config: ServerConfig, requested?: string): string => {
  if (!requested) {
    return config.defaultBaseUrl;
  }

  let normalized: string;
  try {
    normalized = normalizeBaseUrl(requested);
  } catch (error) {
    throw new Error(`Invalid baseUrl provided: ${(error as Error).message}`);
  }

  if (!config.allowedBaseUrls.includes(normalized)) {
    throw new Error('Requested baseUrl is not in the allowed list');
  }

  return normalized;
};

export const validateProjectPath = (config: ServerConfig, raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('projectPath is required');
  }

  if (!trimmed.startsWith('/')) {
    throw new Error('projectPath must start with a "/"');
  }

  if (trimmed.includes('..')) {
    throw new Error('projectPath cannot contain ".."');
  }

  if (config.allowedProjectPrefixes.length > 0) {
    const matchesPrefix = config.allowedProjectPrefixes.some((prefix) => trimmed.startsWith(prefix));
    if (!matchesPrefix) {
      throw new Error('projectPath is not in the allowed prefixes');
    }
  }

  return trimmed;
};
