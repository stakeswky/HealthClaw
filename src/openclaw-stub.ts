// Placeholder types for OpenClaw Plugin SDK
// These will be replaced with actual types when integrated into OpenClaw workspace

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface OpenClawPluginApi {
  pluginConfig: unknown;
  logger: PluginLogger;
  resolvePath(relativePath: string): string;
  registerHttpRoute(config: {
    path: string;
    auth: string;
    match: string;
    handler: (req: unknown, res: unknown) => Promise<boolean>;
  }): void;
  registerTool(tool: unknown, options?: { name: string }): void;
  registerCommand(config: {
    name: string;
    description: string;
    acceptsArgs: boolean;
    handler: (ctx: { args?: string }) => Promise<{ text: string }>;
  }): void;
  registerService(config: {
    id: string;
    start: (ctx: { stateDir: string }) => Promise<void>;
    stop: () => Promise<void>;
  }): void;
  on(event: string, handler: (event: unknown) => Promise<unknown>): void;
  runtime: unknown;
}

export interface OpenClawPluginConfigSchema {
  safeParse(value: unknown): { success: boolean; data?: unknown; error?: { issues: { path: string[]; message: string }[] } };
  parse(value: unknown): unknown;
  jsonSchema: Record<string, unknown>;
}