import type pm2 from 'pm2';
import type { AppConfig, Storage } from '../db/model.js';

// ─── Shared input/output types ────────────────────────────────────────────────

export interface BuildPm2ConfigInput {
  dir: string;
  name: string;
  port: number;
  status: string;
  config: AppConfig;
}

export interface PrepareReleaseOptions {
  /** Install/restore dependencies (e.g. npm install, pip install, dotnet restore) */
  withDependencies?: boolean;
  withBuild?: boolean;
  /** Run linter/formatter and auto-fix */
  withLint?: boolean;
  logDir: string;
  appName?: string;
}

export interface CreateBuildDirInput {
  appDir: string;
  projectDir?: string;
  storages?: Storage[];
}

export interface DetectionResult {
  projectType: string | null;
  score: number;
  ambiguous: boolean;
  /** Top two candidates when result is ambiguous, ordered by score descending. */
  candidates?: Array<{ projectType: string; score: number }>;
}

// ─── AppTypeHandler interface ─────────────────────────────────────────────────

export interface AppTypeHandler {
  /**
   * The unique key for this app type (e.g. 'nextjs', 'nestjs', 'dotnet').
   * This is the value stored in the database and used as the registry key.
   * Each handler defines its own key — adding a new handler just means
   * calling registerHandler(handler) with a handler that declares its typeKey.
   */
  readonly typeKey: string;

  /**
   * Returns a PM2 StartOptions object for launching this app type.
   * May throw if required artefacts (e.g. DLL, dist/main.js) are missing.
   */
  buildPm2Config(input: BuildPm2ConfigInput): pm2.StartOptions;

  /**
   * Creates a versioned build directory snapshot from the release directory.
   */
  createBuildDir(input: CreateBuildDirInput): string;

  /**
   * Returns extra Nginx location-block directives specific to this type.
   * Each string is a complete directive line without leading/trailing whitespace.
   */
  getNginxLocationDirectives(): string[];

  /**
   * Runs the build/compile step (npm install + build, dotnet publish, etc.).
   * For dotnet: also validates SDK version and ensures correct assembly name.
   */
  prepareRelease(dir: string, opts: PrepareReleaseOptions): Promise<void>;

  /**
   * Sync all config/env files for this type from envDir into the release dir.
   * Returns true if anything changed (triggers redeploy even when code hasn't).
   */
  syncConfig(buildRelDir: string, envDir: string): Promise<boolean>;

  /**
   * Returns the base directory where apps of this type are stored.
   * Typically sourced from an env var constant (e.g. NEXT_DIR, NEST_DIR).
   */
  getAppsDir(): string;

  /**
   * Human-readable display name for this type, with optional emoji.
   * e.g. '⚡ Next.js', '.NET'
   */
  getDisplayName(unicode: boolean): string;

  /**
   * Examines a directory and returns a confidence score 0–100.
   */
  detect(dir: string): Promise<number>;

  /**
   * Optional pre-flight check run at `dm init` time (e.g. verify dotnet SDK).
   */
  checkPrerequisites?(): void;

  /**
   * Returns the PM2 exec mode for this app type ('cluster' or 'fork').
   * Fork-mode types do not support multiple instances.
   */
  getExecMode(): 'cluster' | 'fork';

  /**
   * Whether this type supports PM2 node_args.
   * Returns false for fork-mode types (e.g. dotnet) where node_args has no effect.
   * Default: true.
   */
  supportsNodeArgs?(): boolean;

  /**
   * Optional hook called after the app has been started/restarted by PM2.
   * Use for post-deploy tasks like DB migrations, cache warming, health checks.
   */
  afterDeploy?(context: { appDir: string; port: number; appName: string }): Promise<void>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * A registered project type key — any string defined by a handler's typeKey.
 * Kept as `string` so new handlers can be added without touching this file.
 */
export type ProjectType = string;

const REGISTRY = new Map<string, AppTypeHandler>();

/**
 * Register a handler using its own typeKey.
 * The handler declares its own key — callers just pass the handler object.
 */
export function registerHandler(handler: AppTypeHandler): void {
  REGISTRY.set(handler.typeKey, handler);
}

/**
 * Returns the handler for the given projectType key.
 * Throws a descriptive error if the type is not registered.
 */
export function getHandler(projectType: string): AppTypeHandler {
  const handler = REGISTRY.get(projectType);
  if (!handler) {
    const registered = Array.from(REGISTRY.keys()).join(', ');
    throw new Error(
      `Unknown project type: "${projectType}". Registered types: ${registered}`
    );
  }
  return handler;
}

/**
 * Returns all registered project type keys.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(REGISTRY.keys());
}

/**
 * Runs every registered handler's detect() against the given directory
 * and returns the best match as a DetectionResult.
 */
export async function detectAppType(dir: string): Promise<DetectionResult> {
  const scores: Array<{ projectType: string; score: number }> = [];

  for (const [projectType, handler] of REGISTRY) {
    const score = await handler.detect(dir);
    scores.push({ projectType, score });
  }

  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];

  if (!top || top.score <= 50) {
    return { projectType: null, score: top?.score ?? 0, ambiguous: false };
  }

  const ambiguous =
    second !== undefined &&
    second.score > 50 &&
    top.score - second.score <= 10;

  return {
    projectType: top.projectType,
    score: top.score,
    ambiguous,
    ...(ambiguous ? { candidates: [top, second] } : {}),
  };
}
