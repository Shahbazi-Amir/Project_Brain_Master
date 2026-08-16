import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { config } from "./config.ts";
import { addDirective, getProject, insertProject, listDirectives, listIterations, listProjects, setProjectStatus } from "./db.ts";
import { loopController } from "./loop.ts";
import { codexProvider } from "./provider.ts";
import { runArchitect, runMaturation } from "./roles.ts";
import { appendDirectiveToMemory, initializeProjectStorage, resolveWorkspace } from "./storage.ts";
import type { DirectiveRecord, DiscoveryResult, ExecutorMode, ProjectDefinition, ProjectProfile, ProjectRecord } from "./types.ts";

const publicDir = resolve("public");
const maxUploadBytes = 200 * 1024 * 1024;
let activeDiscoveryController: AbortController | null = null;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function text(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store, no-cache, must-revalidate" });
  res.end(body);
}
async function bodyJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const chunk of req) {
    data += String(chunk);
    if (data.length > 2_000_000) throw new Error("حجم درخواست متنی بیش از حد مجاز است");
  }
  return data ? JSON.parse(data) as Record<string, unknown> : {};
}
async function bodyBuffer(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > maxUploadBytes) throw new Error("حجم فایل بیشتر از ۲۰۰ مگابایت است");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
function projectPayload(id: string) {
  const project = getProject(id);
  return project ? { project, directives: listDirectives(id), iterations: listIterations(id), running: loopController.isRunning(id) } : null;
}
function serveStatic(pathname: string, res: ServerResponse): boolean {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const path = resolve(publicDir, relative);
  if (!path.startsWith(publicDir) || !existsSync(path) || !statSync(path).isFile()) return false;
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
  text(res, 200, readFileSync(path, "utf8"), types[extname(path)] ?? "application/octet-stream");
  return true;
}
function requireDefinition(value: unknown): ProjectDefinition {
  if (!value || typeof value !== "object") throw new Error("تعریف پروژه لازم است");
  const d = value as ProjectDefinition;
  if (!d.name || !d.primaryGoal || !Array.isArray(d.successCriteria)) throw new Error("تعریف پروژه کامل نیست");
  d.humanDecisionsRequired = [];
  d.resourceReferences = Array.isArray(d.resourceReferences) ? d.resourceReferences.map(String).filter(Boolean) : [];
  return d;
}
function requireDiscovery(value: unknown): DiscoveryResult {
  if (!value || typeof value !== "object") throw new Error("تصویر اولیه ایده لازم است");
  const d = value as DiscoveryResult;
  if (!d.understanding || !Array.isArray(d.questions) || !Array.isArray(d.facts) || !d.draftDefinition) throw new Error("تصویر اولیه ایده کامل نیست");
  return d;
}
function requireProfile(value: unknown): ProjectProfile {
  const profile = String(value ?? "general") as ProjectProfile;
  if (!["coding", "writing", "research", "planning", "general"].includes(profile)) throw new Error("ماهیت پروژه معتبر نیست");
  return profile;
}
function safeUploadName(value: string): string {
  const clean = basename(value || "resource.bin")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || "resource.bin";
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (method === "GET" && path === "/api/health") {
      return json(res, 200, { ok: true, codex: await codexProvider.health(), node: process.version, dataDir: config.dataDir, maxLoopIterations: config.defaultMaxIterations });
    }
    if (method === "GET" && path === "/api/projects") return json(res, 200, { projects: listProjects() });

    if (method === "POST" && path === "/api/resources/upload") {
      const name = safeUploadName(String(url.searchParams.get("name") ?? "resource.bin"));
      const id = crypto.randomUUID();
      const dir = resolve(config.dataDir, "uploads", id);
      mkdirSync(dir, { recursive: true });
      const filePath = resolve(dir, name);
      const data = await bodyBuffer(req);
      if (!data.length) throw new Error("فایل خالی است");
      writeFileSync(filePath, data);
      return json(res, 201, { id, name, size: data.length, path: filePath });
    }

    if (method === "POST" && path === "/api/discovery/cancel") {
      const wasRunning = Boolean(activeDiscoveryController && !activeDiscoveryController.signal.aborted);
      activeDiscoveryController?.abort();
      activeDiscoveryController = null;
      return json(res, 200, { cancelled: wasRunning });
    }

    if (method === "POST" && path === "/api/discover") {
      const body = await bodyJson(req);
      const description = String(body.description ?? "").trim();
      if (description.length < 10) throw new Error("ایده را کمی کامل‌تر توضیح بده");

      activeDiscoveryController?.abort();
      const controller = new AbortController();
      activeDiscoveryController = controller;
      const abortOnDisconnect = () => controller.abort();
      req.once("aborted", abortOnDisconnect);
      res.once("close", () => { if (!res.writableEnded) controller.abort(); });

      try {
        const run = await runArchitect(description, String(body.profileHint ?? ""), Boolean(body.useWebSearch), controller.signal);
        return json(res, 200, { discovery: run.structured, usage: run.usage });
      } finally {
        if (activeDiscoveryController === controller) activeDiscoveryController = null;
      }
    }

    if (method === "POST" && path === "/api/refine") {
      const body = await bodyJson(req);
      const description = String(body.description ?? "").trim();
      if (description.length < 10) throw new Error("شرح ایده لازم است");
      const discovery = requireDiscovery(body.discovery);
      const rawAnswers = body.answers;
      if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) throw new Error("بازبینی برداشت‌ها و پاسخ‌ها لازم است");
      const answers = Object.fromEntries(Object.entries(rawAnswers as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "").trim()]));
      const unreviewedFacts = discovery.facts.filter(f => !answers[`fact:${f.id}`]);
      if (unreviewedFacts.length) throw new Error(`برداشت‌های اولیه را مرور کن (${unreviewedFacts.length} مورد باقی مانده)`);
      const unanswered = discovery.questions.filter(q => q.required && !answers[q.id]);
      if (unanswered.length) throw new Error(`به سؤال‌های ضروری پاسخ بده (${unanswered.length} مورد باقی مانده)`);

      const run = await runMaturation(description, discovery, answers, String(body.profileHint ?? discovery.suggestedProfile ?? ""), Boolean(body.useWebSearch));
      if (run.structured) {
        run.structured.finalDefinition.humanDecisionsRequired = [];
        run.structured.finalDefinition.resourceReferences = [];
        run.structured.finalDefinition.executionContract = run.structured.executionContract;
      }
      return json(res, 200, { maturation: run.structured, usage: run.usage, maxLoopIterations: config.defaultMaxIterations });
    }

    if (method === "POST" && path === "/api/projects") {
      const body = await bodyJson(req);
      const id = crypto.randomUUID();
      const definition = requireDefinition(body.definition);
      const now = new Date().toISOString();
      const profile = requireProfile(body.profile);
      const executorModeRaw = String(body.executorMode ?? "codex");
      const executorMode: ExecutorMode = executorModeRaw === "manual" ? "manual" : "codex";
      const project: ProjectRecord = {
        id,
        name: definition.name,
        profile,
        description: String(body.description ?? ""),
        status: "READY",
        definition,
        workspacePath: resolveWorkspace(id, String(body.workspacePath ?? "")),
        executorMode,
        minQualityScore: Math.min(100, Math.max(1, Number(body.minQualityScore ?? config.defaultMinQuality))),
        maxIterations: Math.min(13, Math.max(1, Number(body.maxIterations ?? config.defaultMaxIterations))),
        maxStagnantIterations: Math.min(10, Math.max(1, Number(body.maxStagnantIterations ?? 3))),
        createdAt: now,
        updatedAt: now
      };
      insertProject(project);
      initializeProjectStorage(project);
      return json(res, 201, projectPayload(id));
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (method === "GET" && projectMatch) {
      const payload = projectPayload(projectMatch[1]);
      return payload ? json(res, 200, payload) : json(res, 404, { error: "پروژه پیدا نشد" });
    }

    const actionMatch = path.match(/^\/api\/projects\/([^/]+)\/(directives|run-once|run-loop|pause|stop|manual-result)$/);
    if (method === "POST" && actionMatch) {
      const [, id, action] = actionMatch;
      const project = getProject(id);
      if (!project) return json(res, 404, { error: "پروژه پیدا نشد" });

      if (action === "directives") {
        const body = await bodyJson(req);
        const value = String(body.text ?? "").trim();
        if (!value) throw new Error("دستور نمی‌تواند خالی باشد");
        const directive: DirectiveRecord = { id: crypto.randomUUID(), projectId: id, text: value, active: true, createdAt: new Date().toISOString() };
        addDirective(directive);
        appendDirectiveToMemory(id, directive);
        return json(res, 201, directive);
      }

      if (action === "run-once" || action === "run-loop") {
        const count = action === "run-once" ? 1 : Math.min(13, project.maxIterations);
        void loopController.run(id, count).catch(error => console.error("Project run failed", id, error));
        return json(res, 202, { started: true, iterations: count });
      }

      if (action === "pause") {
        const stopped = loopController.stop(id, "PAUSED");
        if (!stopped) setProjectStatus(id, "PAUSED");
        return json(res, 200, { paused: true });
      }
      if (action === "stop") {
        const stopped = loopController.stop(id, "STOPPED");
        if (!stopped) setProjectStatus(id, "STOPPED");
        return json(res, 200, { stopped: true });
      }
      if (action === "manual-result") {
        const body = await bodyJson(req);
        const result = String(body.result ?? "").trim();
        if (!result) throw new Error("نتیجه اجرای دستی خالی است");
        return json(res, 200, { review: await loopController.submitManualResult(id, result) });
      }
    }

    if (method === "GET" && !path.startsWith("/api/") && serveStatic(path, res)) return;
    return json(res, 404, { error: "مسیر پیدا نشد" });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Project Brain running at http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});
