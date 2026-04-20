import type { IncomingMessage, ServerResponse } from "node:http";
import * as workflows from "./routes/workflows.js";
import * as agents from "./routes/agents.js";
import * as launch from "./routes/launch.js";
import * as staticFiles from "./routes/static.js";

export async function dispatch(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const pathname = url.pathname;

  // API routes
  if (pathname.startsWith("/api/workflows")) return workflows.handle(req, res, url);
  if (pathname.startsWith("/api/agents")) return agents.handle(req, res, url);
  if (pathname.startsWith("/api/launch")) return launch.handle(req, res, url);
  if (pathname.startsWith("/api/backends")) return await agents.handleBackends(req, res);
  if (pathname.startsWith("/api/config")) return launch.handleConfig(req, res);

  // Static assets
  staticFiles.serve(req, res, pathname);
}
