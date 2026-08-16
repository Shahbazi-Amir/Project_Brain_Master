import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { config } from "./config.ts";
import { addDirective, getProject, insertProject, listDirectives, listIterations, listProjects, setProjectStatus } from "./db.ts";
import { loopController } from "./loop.ts";
import { codexProvider } from "./provider.ts";
import { runArchitect } from "./roles.ts";
import { appendDirectiveToMemory, initializeProjectStorage, resolveWorkspace } from "./storage.ts";
import type { DirectiveRecord, ExecutorMode, ProjectDefinition, ProjectProfile, ProjectRecord } from "./types.ts";

const publicDir = resolve("public");
function json(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
function text(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void { res.writeHead(status, { "content-type": contentType }); res.end(body); }
async function bodyJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = ""; for await (const chunk of req) { data += String(chunk); if (data.length > 2_000_000) throw new Error("Request body too large"); }
  return data ? JSON.parse(data) as Record<string, unknown> : {};
}
function projectPayload(id: string) { const project = getProject(id); return project ? { project, directives: listDirectives(id), iterations: listIterations(id), running: loopController.isRunning(id) } : null; }
function serveStatic(pathname: string, res: ServerResponse): boolean {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, ""); const path = resolve(publicDir, relative);
  if (!path.startsWith(publicDir) || !existsSync(path) || !statSync(path).isFile()) return false;
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
  text(res, 200, readFileSync(path, "utf8"), types[extname(path)] ?? "application/octet-stream"); return true;
}
function requireDefinition(value: unknown): ProjectDefinition {
  if (!value || typeof value !== "object") throw new Error("definition is required"); const d = value as ProjectDefinition;
  if (!d.name || !d.primaryGoal || !Array.isArray(d.successCriteria)) throw new Error("definition is incomplete"); return d;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET"; const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`); const path = url.pathname;
    if (method === "GET" && path === "/api/health") return json(res, 200, { ok: true, codex: await codexProvider.health(), node: process.version, dataDir: config.dataDir });
    if (method === "GET" && path === "/api/projects") return json(res, 200, { projects: listProjects() });
    if (method === "POST" && path === "/api/discover") {
      const body = await bodyJson(req); const description = String(body.description ?? "").trim(); if (description.length < 10) throw new Error("Describe the project in at least 10 characters");
      const run = await runArchitect(description, String(body.profileHint ?? ""), Boolean(body.useWebSearch)); return json(res, 200, { discovery: run.structured, usage: run.usage });
    }
    if (method === "POST" && path === "/api/projects") {
      const body = await bodyJson(req); const id = crypto.randomUUID(); const definition = requireDefinition(body.definition); const now = new Date().toISOString();
      const profile = String(body.profile ?? "general") as ProjectProfile; const executorMode = String(body.executorMode ?? "codex") as ExecutorMode;
      const project: ProjectRecord = {
        id, name: definition.name, profile, description: String(body.description ?? ""), status: "READY", definition,
        workspacePath: resolveWorkspace(id, String(body.workspacePath ?? "")), executorMode,
        minQualityScore: Math.min(100, Math.max(1, Number(body.minQualityScore ?? config.defaultMinQuality))),
        maxIterations: Math.min(100, Math.max(1, Number(body.maxIterations ?? config.defaultMaxIterations))), maxStagnantIterations: Math.min(10, Math.max(1, Number(body.maxStagnantIterations ?? 3))),
        createdAt: now, updatedAt: now
      };
      insertProject(project); initializeProjectStorage(project); return json(res, 201, projectPayload(id));
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (method === "GET" && projectMatch) { const payload = projectPayload(projectMatch[1]); return payload ? json(res, 200, payload) : json(res, 404, { error: "Project not found" }); }
    const actionMatch = path.match(/^\/api\/projects\/([^/]+)\/(directives|run-once|run-loop|pause|stop|manual-result)$/);
    if (method === "POST" && actionMatch) {
      const [, id, action] = actionMatch; const project = getProject(id); if (!project) return json(res, 404, { error: "Project not found" });
      if (action === "directives") {
        const body = await bodyJson(req); const value = String(body.text ?? "").trim(); if (!value) throw new Error("Directive cannot be empty");
        const directive: DirectiveRecord = { id: crypto.randomUUID(), projectId: id, text: value, active: true, createdAt: new Date().toISOString() };
        addDirective(directive); appendDirectiveToMemory(id, directive); return json(res, 201, directive);
      }
      if (action === "run-once" || action === "run-loop") {
        const count = action === "run-once" ? 1 : project.maxIterations; void loopController.run(id, count).catch(error => console.error("Project run failed", id, error));
        return json(res, 202, { started: true, iterations: count });
      }
      if (action === "pause") { const stopped = loopController.stop(id, "PAUSED"); if (!stopped) setProjectStatus(id, "PAUSED"); return json(res, 200, { paused: true }); }
      if (action === "stop") { const stopped = loopController.stop(id, "STOPPED"); if (!stopped) setProjectStatus(id, "STOPPED"); return json(res, 200, { stopped: true }); }
      if (action === "manual-result") { const body = await bodyJson(req); const result = String(body.result ?? "").trim(); if (!result) throw new Error("Manual result cannot be empty"); return json(res, 200, { review: await loopController.submitManualResult(id, result) }); }
    }

    if (method === "GET" && !path.startsWith("/api/") && serveStatic(path, res)) return;
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
});

server.listen(config.port, config.host, () => {
  console.log(`Project Brain running at http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});
