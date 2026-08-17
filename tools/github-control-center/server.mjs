import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const HOST = process.env.GITHUB_OPS_HOST || "127.0.0.1";
const PORT = Number(process.env.GITHUB_OPS_PORT || 3010);
const API_VERSION = "2026-03-10";
const CACHE_TTL_MS = 60_000;
const CLEANUP_PREVIEW_TTL_MS = 10 * 60_000;
const MAX_REPOS = 300;
const MAX_PARALLEL = 6;
const CACHE_LIMIT_BYTES = 10 * 1024 ** 3;
const PLAN_ALLOWANCES = {
  free: { artifactBytes: 500 * 1024 ** 2, minutes: 2000, label: "GitHub Free" },
  pro: { artifactBytes: 1024 ** 3, minutes: 3000, label: "GitHub Pro" }
};
const PROTECTED_NAME = /(?:^|[-_.])(release|deploy|deployment|production|prod|final|evidence|audit|governance|sbom|signature|signed|attestation|proof)(?:$|[-_.])/i;

let cachedOverview = null;
let cachedInternal = null;
let cachedAt = 0;
const cleanupPreviews = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:3000"
  });
  res.end(JSON.stringify(body));
}

function html(res, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function bodyJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("درخواست بیش از حد بزرگ است");
  }
  return raw ? JSON.parse(raw) : {};
}

async function ghRaw(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024
    });
    return stdout.trim();
  } catch (error) {
    if (allowFailure) return null;
    const stderr = String(error?.stderr || error?.message || error).trim();
    throw new Error(stderr || "GitHub CLI request failed");
  }
}

async function ghApi(path, { method = "GET", allowFailure = false } = {}) {
  const args = [
    "api",
    "--method", method,
    "-H", "Accept: application/vnd.github+json",
    "-H", `X-GitHub-Api-Version: ${API_VERSION}`,
    path
  ];
  const raw = await ghRaw(args, { allowFailure });
  if (raw === null) return null;
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return raw; }
}

async function paginate(path, key, { allowFailure = false, maxPages = 20 } = {}) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const joiner = path.includes("?") ? "&" : "?";
    const payload = await ghApi(`${path}${joiner}per_page=100&page=${page}`, { allowFailure });
    if (payload === null) return null;
    const batch = key ? (payload?.[key] || []) : payload;
    if (!Array.isArray(batch)) return rows;
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function bytes(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function ageDays(value) {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, (Date.now() - then) / 86_400_000);
}

function normalizePlanName(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("pro")) return "pro";
  if (text.includes("free")) return "free";
  return null;
}

function pct(used, total) {
  if (!total) return null;
  return Math.max(0, Math.round((used / total) * 1000) / 10);
}

function repoView(repo) {
  return {
    name: repo.name,
    fullName: repo.fullName,
    private: repo.private,
    repoBytes: repo.repoBytes,
    artifactCount: repo.artifactCount,
    artifactBytes: repo.artifactBytes,
    cacheCount: repo.cacheCount,
    cacheBytes: repo.cacheBytes,
    cacheLimitBytes: CACHE_LIMIT_BYTES,
    cachePercent: pct(repo.cacheBytes, CACHE_LIMIT_BYTES),
    running: repo.running,
    queued: repo.queued,
    activeRuns: repo.activeRuns,
    recentFailures: repo.recentFailures,
    totalRuns: repo.totalRuns,
    updatedAt: repo.updatedAt,
    warnings: repo.warnings,
    apiErrors: repo.apiErrors
  };
}

async function scanRepository(meta) {
  const fullName = meta.full_name;
  const apiErrors = [];
  const [artifacts, cachesPayload, runsPayload] = await Promise.all([
    paginate(`/repos/${fullName}/actions/artifacts`, "artifacts", { allowFailure: true }),
    ghApi(`/repos/${fullName}/actions/caches?per_page=100`, { allowFailure: true }),
    ghApi(`/repos/${fullName}/actions/runs?per_page=100`, { allowFailure: true })
  ]);

  if (artifacts === null) apiErrors.push("artifacts");
  if (cachesPayload === null) apiErrors.push("caches");
  if (runsPayload === null) apiErrors.push("runs");

  const artifactRows = Array.isArray(artifacts) ? artifacts : [];
  const cacheRows = Array.isArray(cachesPayload?.actions_caches) ? cachesPayload.actions_caches : [];
  const runRows = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
  const liveArtifacts = artifactRows.filter(a => !a.expired);
  const activeRuns = runRows.filter(r => ["queued", "in_progress", "requested", "waiting", "pending"].includes(r.status));
  const running = activeRuns.filter(r => r.status === "in_progress").length;
  const queued = activeRuns.filter(r => r.status !== "in_progress").length;
  const recentFailures = runRows.filter(r => r.status === "completed" && ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(r.conclusion)).length;
  const artifactBytes = liveArtifacts.reduce((sum, a) => sum + bytes(a.size_in_bytes), 0);
  const cacheBytes = cacheRows.reduce((sum, c) => sum + bytes(c.size_in_bytes), 0);
  const warnings = [];
  const cachePercent = pct(cacheBytes, CACHE_LIMIT_BYTES) || 0;
  if (cachePercent >= 90) warnings.push("کش این مخزن به محدوده بحرانی رسیده");
  else if (cachePercent >= 75) warnings.push("کش این مخزن سنگین شده");
  if (queued > 0) warnings.push(`${queued} اجرای GitHub Actions در صف است`);
  if (recentFailures >= 5) warnings.push(`${recentFailures} اجرای اخیر ناموفق/لغوشده است`);
  if (apiErrors.length) warnings.push(`خواندن ${apiErrors.join(" / ")} کامل نبود`);

  return {
    name: meta.name,
    fullName,
    private: Boolean(meta.private),
    repoBytes: bytes(meta.size) * 1024,
    artifactCount: liveArtifacts.length,
    artifactBytes,
    cacheCount: cacheRows.length,
    cacheBytes,
    running,
    queued,
    activeRuns: activeRuns.map(r => ({ id: r.id, name: r.name, status: r.status, branch: r.head_branch, url: r.html_url, createdAt: r.created_at })),
    recentFailures,
    totalRuns: Number(runsPayload?.total_count || runRows.length || 0),
    updatedAt: meta.updated_at,
    warnings,
    apiErrors,
    artifacts: artifactRows,
    caches: cacheRows,
    runs: runRows
  };
}

async function readBilling(login) {
  const now = new Date();
  const path = `/users/${encodeURIComponent(login)}/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}&product=Actions`;
  const payload = await ghApi(path, { allowFailure: true });
  if (!payload || !Array.isArray(payload.usageItems)) {
    return { available: false, items: [], reason: "توکن فعلی gh به Billing/Plan دسترسی کافی ندارد یا Enhanced Billing برای حساب فعال نیست." };
  }
  return { available: true, items: payload.usageItems, reason: null };
}

async function getOverview(force = false) {
  if (!force && cachedOverview && Date.now() - cachedAt < CACHE_TTL_MS) return cachedOverview;

  const auth = await ghRaw(["auth", "status"], { allowFailure: true });
  if (auth === null) throw new Error("GitHub CLI نصب یا لاگین نشده است. اول gh auth login را انجام بده.");

  const user = await ghApi("/user");
  const repoMeta = await paginate("/user/repos?affiliation=owner&sort=updated", null, { maxPages: 3 });
  const selected = (repoMeta || []).slice(0, MAX_REPOS);
  const repos = await mapLimit(selected, MAX_PARALLEL, scanRepository);
  const billing = await readBilling(user.login);

  const totals = repos.reduce((acc, repo) => {
    acc.repoBytes += repo.repoBytes;
    acc.artifactBytes += repo.artifactBytes;
    acc.artifactCount += repo.artifactCount;
    acc.cacheBytes += repo.cacheBytes;
    acc.cacheCount += repo.cacheCount;
    acc.running += repo.running;
    acc.queued += repo.queued;
    acc.totalRuns += repo.totalRuns;
    return acc;
  }, { repoBytes: 0, artifactBytes: 0, artifactCount: 0, cacheBytes: 0, cacheCount: 0, running: 0, queued: 0, totalRuns: 0 });

  const planKey = normalizePlanName(user?.plan?.name);
  const allowance = planKey ? PLAN_ALLOWANCES[planKey] : null;
  const artifactTotalBytes = allowance?.artifactBytes ?? null;
  const artifactFreeVisibleBytes = artifactTotalBytes === null ? null : Math.max(0, artifactTotalBytes - totals.artifactBytes);
  const artifactPercentVisible = artifactTotalBytes === null ? null : pct(totals.artifactBytes, artifactTotalBytes);
  const aggregateCacheCapacity = repos.length * CACHE_LIMIT_BYTES;

  const alerts = [];
  if (artifactPercentVisible !== null && artifactPercentVisible >= 90) alerts.push({ level: "danger", text: `Artifactهای قابل مشاهده حدود ${artifactPercentVisible}% سقف پلن را اشغال کرده‌اند. Packages می‌تواند مصرف واقعی pool مشترک را بالاتر ببرد.` });
  else if (artifactPercentVisible !== null && artifactPercentVisible >= 75) alerts.push({ level: "warning", text: `Artifactهای قابل مشاهده حدود ${artifactPercentVisible}% سقف پلن را اشغال کرده‌اند.` });
  if (totals.queued > 0) alerts.push({ level: "warning", text: `${totals.queued} اجرای Actions در صف است.` });
  const hotCaches = repos.filter(r => (pct(r.cacheBytes, CACHE_LIMIT_BYTES) || 0) >= 75);
  if (hotCaches.length) alerts.push({ level: "warning", text: `${hotCaches.length} مخزن بیش از ۷۵٪ ظرفیت Cache خود را مصرف کرده‌اند.` });
  if (!billing.available) alerts.push({ level: "info", text: "Billing API با احراز هویت فعلی قابل خواندن نیست؛ عدد هزینه/مصرف ماهانه حدس زده نمی‌شود." });
  if (!allowance) alerts.push({ level: "info", text: "نوع پلن از gh قابل تشخیص نبود؛ Total/Free حساب به‌صورت نامشخص نمایش داده می‌شود." });
  if (!alerts.length) alerts.push({ level: "ok", text: "هشدار فوری از Artifact، Cache یا صف اجراها دیده نشد." });

  cachedInternal = { user, repos, totals, billing, allowance };
  cachedOverview = {
    generatedAt: new Date().toISOString(),
    refreshSeconds: 300,
    user: { login: user.login, plan: allowance?.label || user?.plan?.name || null },
    account: {
      repoCount: repos.length,
      repoBytes: totals.repoBytes,
      artifactCount: totals.artifactCount,
      artifactBytes: totals.artifactBytes,
      artifactTotalBytes,
      artifactFreeVisibleBytes,
      artifactPercentVisible,
      artifactPoolNote: "Artifact storage با GitHub Packages مشترک است؛ Free قابل‌نمایش بر اساس Artifactهای قابل مشاهده است و ممکن است Packages آن را کمتر کند.",
      cacheCount: totals.cacheCount,
      cacheBytes: totals.cacheBytes,
      cacheCapacityBytes: aggregateCacheCapacity,
      cachePerRepoBytes: CACHE_LIMIT_BYTES,
      running: totals.running,
      queued: totals.queued,
      totalRuns: totals.totalRuns,
      billing
    },
    alerts,
    repos: repos.map(repoView).sort((a, b) => (b.artifactBytes + b.cacheBytes) - (a.artifactBytes + a.cacheBytes))
  };
  cachedAt = Date.now();
  return cachedOverview;
}

function cleanupCandidateArtifact(repo, artifact, reason) {
  return {
    type: "artifact",
    repo: repo.fullName,
    id: Number(artifact.id),
    name: artifact.name || `artifact-${artifact.id}`,
    bytes: bytes(artifact.size_in_bytes),
    reason,
    createdAt: artifact.created_at || null
  };
}

function cleanupCandidateCache(repo, cache, reason) {
  return {
    type: "cache",
    repo: repo.fullName,
    id: Number(cache.id),
    name: cache.key || `cache-${cache.id}`,
    bytes: bytes(cache.size_in_bytes),
    reason,
    createdAt: cache.created_at || cache.last_accessed_at || null
  };
}

async function buildCleanupPreview() {
  await getOverview(true);
  const candidates = [];
  const skippedActiveRepos = [];

  for (const repo of cachedInternal.repos) {
    if (repo.running || repo.queued) {
      skippedActiveRepos.push(repo.fullName);
      continue;
    }

    const byName = new Map();
    for (const artifact of repo.artifacts) {
      const name = String(artifact.name || "unnamed");
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(artifact);
    }
    for (const [name, group] of byName) {
      group.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      for (let i = 0; i < group.length; i++) {
        const artifact = group[i];
        if (PROTECTED_NAME.test(name)) continue;
        if (artifact.expired) {
          candidates.push(cleanupCandidateArtifact(repo, artifact, "Artifact منقضی شده"));
          continue;
        }
        if (i > 0 && ageDays(artifact.created_at) >= 30) {
          candidates.push(cleanupCandidateArtifact(repo, artifact, "نسخه قدیمی‌تر از ۳۰ روز با Artifact جدیدتر هم‌نام"));
        }
      }
    }

    for (const cache of repo.caches) {
      if (ageDays(cache.last_accessed_at || cache.created_at) >= 14) {
        candidates.push(cleanupCandidateCache(repo, cache, "Cache بیش از ۱۴ روز استفاده نشده"));
      }
    }
  }

  candidates.sort((a, b) => b.bytes - a.bytes);
  const token = randomUUID();
  const preview = {
    token,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CLEANUP_PREVIEW_TTL_MS).toISOString(),
    candidates,
    skippedActiveRepos,
    estimatedBytesFreed: candidates.reduce((sum, item) => sum + item.bytes, 0),
    note: "هیچ Workflow Run یا log حذف نمی‌شود. Repoهای دارای running/queued کامل کنار گذاشته می‌شوند. حذف واقعی فقط بعد از تأیید انجام می‌شود."
  };
  cleanupPreviews.set(token, { ...preview, expiresMs: Date.now() + CLEANUP_PREVIEW_TTL_MS });
  return preview;
}

async function repoHasActiveRuns(repo) {
  const payload = await ghApi(`/repos/${repo}/actions/runs?per_page=50`, { allowFailure: true });
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  return runs.some(r => ["queued", "in_progress", "requested", "waiting", "pending"].includes(r.status));
}

async function applyCleanup(body) {
  const token = String(body?.token || "");
  const confirmation = String(body?.confirmation || "");
  if (confirmation !== "پاکسازی موارد امن") throw new Error("عبارت تأیید پاکسازی درست نیست");
  const preview = cleanupPreviews.get(token);
  if (!preview || preview.expiresMs < Date.now()) throw new Error("Preview منقضی شده؛ دوباره بررسی پاکسازی را بزن");

  const deleted = [];
  const skipped = [];
  const errors = [];
  const repoActivity = new Map();
  for (const item of preview.candidates) {
    if (!repoActivity.has(item.repo)) repoActivity.set(item.repo, await repoHasActiveRuns(item.repo));
    if (repoActivity.get(item.repo)) {
      skipped.push({ ...item, reason: "Repo اکنون اجرای فعال/صف‌شده دارد" });
      continue;
    }
    const endpoint = item.type === "artifact"
      ? `/repos/${item.repo}/actions/artifacts/${item.id}`
      : `/repos/${item.repo}/actions/caches/${item.id}`;
    const result = await ghApi(endpoint, { method: "DELETE", allowFailure: true });
    if (result === null) errors.push({ ...item, error: "GitHub API حذف را نپذیرفت" });
    else deleted.push(item);
  }

  cleanupPreviews.delete(token);
  cachedAt = 0;
  cachedOverview = null;
  cachedInternal = null;
  return {
    deleted,
    skipped,
    errors,
    estimatedBytesFreed: deleted.reduce((sum, item) => sum + item.bytes, 0),
    completedAt: new Date().toISOString()
  };
}

const page = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GitHub Control Center</title>
<style>
:root{font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#17202b;background:#f3f5f7}*{box-sizing:border-box}body{margin:0;background:#f3f5f7}main{max-width:1500px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:16px}.top h1{font-size:26px;margin:0}.top p{margin:4px 0 0;color:#687684;font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:10px 14px;font:700 12px inherit;cursor:pointer}.primary{background:#1d67e8;color:#fff}.secondary{background:#e7edf3;color:#2e3c4a}.danger{background:#b83232;color:#fff}button:disabled{opacity:.45;cursor:not-allowed}.status{font-size:11px;color:#6d7a86;margin:8px 0 14px}.cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.card{background:#fff;border:1px solid #e0e6ea;border-radius:14px;padding:14px;box-shadow:0 8px 24px #17202b0a}.card span{display:block;font-size:9px;color:#72808b;font-weight:800}.card strong{display:block;font-size:21px;margin:4px 0}.card small{font-size:9px;color:#7d8993;line-height:1.6}.panel{background:#fff;border:1px solid #e0e6ea;border-radius:14px;padding:16px;margin-top:12px}.panel h2{font-size:15px;margin:0 0 10px}.alert{padding:9px 11px;border-radius:9px;margin:6px 0;font-size:11px}.alert-ok{background:#e7f8ed;color:#17643a}.alert-info{background:#edf3fa;color:#315979}.alert-warning{background:#fff4db;color:#805d13}.alert-danger{background:#ffe8e4;color:#9d2e20}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:10px;white-space:nowrap}th,td{padding:9px;border-bottom:1px solid #edf0f2;text-align:right}th{position:sticky;top:0;background:#fafbfc;color:#60707c}.repo{font-weight:800}.bar{width:90px;height:6px;background:#e7edf1;border-radius:999px;overflow:hidden;display:inline-block;vertical-align:middle;margin-left:5px}.bar i{display:block;height:100%;background:#1d67e8}.hot i{background:#d9473f}.warn i{background:#d29a2d}.muted{color:#7a8792}.cleanup-grid{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.confirm{display:flex;gap:8px;align-items:center;margin-top:10px}.confirm input{padding:9px 10px;border:1px solid #ccd5dc;border-radius:9px;min-width:220px}.candidate{display:grid;grid-template-columns:110px 1fr 100px 1.5fr;gap:8px;padding:8px 0;border-top:1px solid #edf0f2;font-size:10px}.candidate:first-child{border-top:0}@media(max-width:1100px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){main{padding:12px}.top{align-items:flex-start;flex-direction:column}.cards{grid-template-columns:1fr 1fr}.candidate{grid-template-columns:1fr}.cleanup-grid{grid-template-columns:1fr}}
</style>
</head><body><main>
<div class="top"><div><h1>GitHub Control Center</h1><p>مانیتور مرکزی مخزن‌ها، Actions، Artifact و Cache — بدون مصرف GitHub Actions برای مانیتورینگ</p></div><div class="actions"><button id="refresh" class="primary">↻ تازه‌سازی</button><button id="preview" class="secondary">بررسی پاکسازی</button></div></div>
<div id="status" class="status">در حال خواندن GitHub…</div><div id="alerts"></div><div id="cards" class="cards"></div>
<section class="panel"><h2>مخزن‌ها</h2><div class="table-wrap"><table><thead><tr><th>مخزن</th><th>حجم Repo</th><th>Artifact</th><th>Cache</th><th>Running</th><th>Queued</th><th>Runها</th><th>هشدار</th></tr></thead><tbody id="repos"></tbody></table></div></section>
<section class="panel"><h2>پاکسازی امن</h2><p class="muted">ابتدا Preview ساخته می‌شود. Repoهای در حال اجرا/صف حذف نمی‌شوند و Workflow Run/Log هم پاک نمی‌شود.</p><div id="cleanup">هنوز Preview نگرفته‌ای.</div></section>
</main><script>
const $=s=>document.querySelector(s);let previewToken=null;const nf=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:1});
function size(n){n=Number(n||0);if(n<1024)return nf.format(n)+' B';if(n<1024**2)return nf.format(n/1024)+' KB';if(n<1024**3)return nf.format(n/1024**2)+' MB';return nf.format(n/1024**3)+' GB'}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function card(label,value,small=''){return '<div class="card"><span>'+label+'</span><strong>'+value+'</strong><small>'+small+'</small></div>'}
function setStatus(t){$('#status').textContent=t}
function bar(p){p=Math.max(0,Math.min(100,Number(p||0)));const c=p>=90?'hot':p>=75?'warn':'';return '<span class="bar '+c+'"><i style="width:'+p+'%"></i></span>'+nf.format(p)+'٪'}
async function load(force=false){setStatus('در حال تازه‌سازی…');$('#refresh').disabled=true;try{const r=await fetch('/api/overview'+(force?'?force=1':''),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);render(d);setStatus('آخرین بروزرسانی: '+new Date(d.generatedAt).toLocaleString('fa-IR')+' · بروزرسانی خودکار هر ۵ دقیقه')}catch(e){setStatus('خطا: '+e.message)}finally{$('#refresh').disabled=false}}
function render(d){const a=d.account;const artTotal=a.artifactTotalBytes?size(a.artifactTotalBytes):'نامشخص';const artFree=a.artifactFreeVisibleBytes!==null?size(a.artifactFreeVisibleBytes):'نامشخص';$('#cards').innerHTML=card('مخزن‌ها',nf.format(a.repoCount),'مالک این حساب')+card('حجم مخزن‌ها',size(a.repoBytes),'Git repository metadata')+card('Artifact فعلی',size(a.artifactBytes),a.artifactCount+' فایل · سقف '+artTotal)+card('فضای قابل‌مشاهده Artifact',artFree,a.artifactPercentVisible!==null?bar(a.artifactPercentVisible):'نیازمند تشخیص پلن')+card('Cache فعلی',size(a.cacheBytes),'۱۰ GB مستقل برای هر مخزن')+card('Actions فعال',nf.format(a.running)+' / '+nf.format(a.queued),'در حال اجرا / صف');$('#alerts').innerHTML=d.alerts.map(x=>'<div class="alert alert-'+x.level+'">'+esc(x.text)+'</div>').join('');$('#repos').innerHTML=d.repos.map(r=>'<tr><td><span class="repo">'+esc(r.fullName)+'</span><br><span class="muted">'+(r.private?'Private':'Public')+'</span></td><td>'+size(r.repoBytes)+'</td><td>'+size(r.artifactBytes)+' · '+nf.format(r.artifactCount)+'</td><td>'+size(r.cacheBytes)+'<br>'+bar(r.cachePercent)+'</td><td>'+nf.format(r.running)+'</td><td>'+nf.format(r.queued)+'</td><td>'+nf.format(r.totalRuns)+'</td><td>'+esc((r.warnings||[]).join(' · ')||'—')+'</td></tr>').join('')}
async function preview(){setStatus('در حال محاسبه پاکسازی امن…');$('#preview').disabled=true;try{const r=await fetch('/api/cleanup/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);previewToken=d.token;const rows=d.candidates.map(x=>'<div class="candidate"><b>'+esc(x.type)+'</b><span>'+esc(x.repo)+' · '+esc(x.name)+'</span><span>'+size(x.bytes)+'</span><span>'+esc(x.reason)+'</span></div>').join('');$('#cleanup').innerHTML='<div><b>'+nf.format(d.candidates.length)+' مورد</b> · آزادسازی تخمینی '+size(d.estimatedBytesFreed)+'</div>'+(d.skippedActiveRepos.length?'<div class="alert alert-info">به دلیل اجرای فعال کنار گذاشته شد: '+esc(d.skippedActiveRepos.join('، '))+'</div>':'')+'<div>'+ (rows||'<div class="muted">مورد امنی برای حذف پیدا نشد.</div>') +'</div>'+(d.candidates.length?'<div class="confirm"><input id="confirmText" placeholder="پاکسازی موارد امن"><button id="apply" class="danger">حذف موارد Preview</button></div>':'');if($('#apply'))$('#apply').onclick=apply;setStatus('Preview آماده است؛ چیزی حذف نشده.')}catch(e){setStatus('خطا: '+e.message)}finally{$('#preview').disabled=false}}
async function apply(){if(!previewToken)return;const confirmation=$('#confirmText')?.value||'';if(confirmation!=='پاکسازی موارد امن'){alert('عبارت «پاکسازی موارد امن» را دقیق وارد کن.');return}if(!confirm('فقط موارد Preview شده حذف شوند؟ Repoهای فعال دوباره بررسی خواهند شد.'))return;$('#apply').disabled=true;setStatus('در حال پاکسازی موارد تأییدشده…');try{const r=await fetch('/api/cleanup/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:previewToken,confirmation})});const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);$('#cleanup').innerHTML='<div class="alert alert-ok">حذف‌شده: '+nf.format(d.deleted.length)+' · ردشده به دلیل تغییر وضعیت: '+nf.format(d.skipped.length)+' · خطا: '+nf.format(d.errors.length)+' · آزادسازی تخمینی: '+size(d.estimatedBytesFreed)+'</div>';previewToken=null;await load(true)}catch(e){setStatus('خطا: '+e.message);$('#apply').disabled=false}}
$('#refresh').onclick=()=>load(true);$('#preview').onclick=preview;load(true);setInterval(()=>load(true),300000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (method === "GET" && url.pathname === "/") return html(res, page);
    if (method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, host: HOST, port: PORT });
    if (method === "GET" && url.pathname === "/api/overview") return json(res, 200, await getOverview(url.searchParams.get("force") === "1"));
    if (method === "POST" && url.pathname === "/api/cleanup/preview") return json(res, 200, await buildCleanupPreview());
    if (method === "POST" && url.pathname === "/api/cleanup/apply") return json(res, 200, await applyCleanup(await bodyJson(req)));
    return json(res, 404, { error: "مسیر پیدا نشد" });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`GitHub Control Center running at http://${HOST}:${PORT}`);
  console.log("Monitoring uses local gh authentication; no GitHub Actions minutes are consumed by this dashboard.");
});
