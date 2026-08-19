const runtimeFetch = window.fetch.bind(window);
const runtimeEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const EVENT_LABELS = {
  'project.created':'پروژه ساخته شد',
  'execution.target_prepare_started':'آماده‌سازی مخزن اجرا',
  'execution.target_resolved':'محل اجرا مشخص شد',
  'execution.target_change_blocked':'تغییر مخزن اجرا متوقف شد',
  'resources.repo_fetch_started':'دریافت مخزن منابع',
  'resources.repo_ready':'منابع آماده شد',
  'resources.repo_error':'خطای دریافت منابع',
  'preflight.checked':'بررسی قبل از اجرا',
  'run.started':'چرخه اجرا شروع شد',
  'supervisor.started':'Supervisor شروع شد',
  'supervisor.decided':'Supervisor تصمیم گرفت',
  'supervisor.needs_human':'نیاز به اطلاعات/تصمیم شما',
  'iteration.started':'کار جدید شروع شد',
  'executor.started':'Executor شروع به کار کرد',
  'executor.completed':'Executor کار را تحویل داد',
  'reviewer.started':'Reviewer شروع شد',
  'reviewer.completed':'Reviewer نتیجه را بررسی کرد',
  'iteration.completed':'کار ثبت و ارزیابی شد',
  'github.checkpoint_started':'آماده‌سازی Commit/Push',
  'github.checkpoint_reviewed':'Checkpoint روی GitHub Push شد',
  'github.draft_pr_ready':'Draft PR آماده شد',
  'github.delivery_blocked':'تحویل GitHub متوقف شد',
  'run.error':'خطای اجرا',
  'run.stop_requested':'درخواست توقف',
  'run.finished':'چرخه اجرا پایان یافت',
  'directive.added':'دستور جدید ثبت شد'
};

function eventText(event) {
  const p = event.payload || {};
  const detail = p.question || p.message || p.task || p.summary || p.repository || p.workspacePath || '';
  return `${EVENT_LABELS[event.eventType] || event.eventType}${detail ? ` — ${detail}` : ''}`;
}
function timeText(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

function inspectorHtml(payload) {
  const preflight = payload.preflight || {};
  const target = preflight.executionTarget || {};
  const repos = preflight.resourceRepositories || [];
  const issues = preflight.issues || [];
  const required = preflight.requiredInputs || [];
  const events = payload.events || [];
  const latest = events[0];
  const canStart = !payload.running && !['COMPLETED','STOPPED'].includes(payload.project.status);
  const sourceRows = repos.length ? repos.map(repo => `<li><b>${runtimeEsc(repo.repository)}</b><span>${repo.fileCount} فایل · ${runtimeEsc((repo.categories || []).join('، ') || 'دسته‌بندی نشده')}</span></li>`).join('') : '<li><span>مخزن منبع GitHub ثبت نشده.</span></li>';
  const issueRows = issues.length ? issues.map(issue => `<li>${runtimeEsc(issue)}</li>`).join('') : '<li class="ok-item">مشکل اجرایی ثبت‌شده‌ای وجود ندارد.</li>';
  const requiredRows = required.length ? required.map(item => `<li>${runtimeEsc(item)}</li>`).join('') : '<li>ورودی اجباری دیگری در قرارداد ثبت نشده.</li>';
  const logRows = events.slice(0, 30).map(event => `<li class="runtime-log-row"><time>${runtimeEsc(timeText(event.createdAt))}</time><span>${runtimeEsc(eventText(event))}</span></li>`).join('') || '<li>هنوز لاگی ثبت نشده.</li>';

  return `<section class="panel runtime-inspector">
    <div class="runtime-head"><div><span class="eyebrow">قبل و حین اجرا</span><h2>${payload.running ? 'اجرا در جریان است' : 'وضعیت واقعی پروژه'}</h2></div><span class="runtime-state ${payload.running ? 'live' : ''}">${payload.running ? '● LIVE' : runtimeEsc(payload.project.status)}</span></div>
    <div class="runtime-grid">
      <div><span>محل اجرای واقعی</span><b>${target.mode === 'github' ? runtimeEsc(target.repository) : 'Workspace محلی Brain'}</b><small>${runtimeEsc(target.branch || target.workspacePath || '—')}</small></div>
      <div><span>منابع دریافت‌شده</span><b>${repos.length} مخزن</b><small>${repos.reduce((sum, repo) => sum + Number(repo.fileCount || 0), 0)} فایل</small></div>
      <div><span>آخرین رویداد</span><b>${runtimeEsc(latest ? EVENT_LABELS[latest.eventType] || latest.eventType : 'هنوز چیزی اجرا نشده')}</b><small>${runtimeEsc(latest ? eventText(latest) : '—')}</small></div>
    </div>
    <div class="runtime-problems"><h3>مشکل / توقف فعلی</h3><ul>${issueRows}</ul></div>
    <div class="runtime-source-block"><h3>مخزن‌های منابع</h3><ul>${sourceRows}</ul></div>
    <div class="runtime-actions"><button id="realStartBtn" class="primary" ${canStart ? '' : 'disabled'}>${payload.running ? 'در حال اجرا…' : payload.iterations?.length ? 'ادامه اجرای واقعی' : 'شروع اجرای واقعی'}</button><span>${payload.running ? 'Supervisor / Executor / Reviewer در حال کارند؛ لاگ پایین تازه می‌شود.' : 'با این دکمه Loop واقعی شروع می‌شود.'}</span></div>
    <details class="runtime-details"><summary>ورودی‌های موردنیاز قرارداد</summary><ul>${requiredRows}</ul></details>
    <details class="runtime-details runtime-logs" ${payload.running ? 'open' : ''}><summary>لاگ زنده اجرا</summary><ul>${logRows}</ul></details>
  </section>`;
}

let runtimeLoading = false;
let rememberedScroll = window.scrollY;
window.addEventListener('scroll', () => { rememberedScroll = window.scrollY; }, {passive:true});

async function refreshRuntimeInspector() {
  if (runtimeLoading) return;
  const active = document.querySelector('.project-link.active');
  const main = document.querySelector('#main');
  const hero = main?.querySelector('.project-hero');
  if (!active?.dataset?.id || !hero) return;
  runtimeLoading = true;
  try {
    const response = await runtimeFetch(`/api/projects/${encodeURIComponent(active.dataset.id)}`, {cache:'no-store'});
    if (!response.ok) return;
    const payload = await response.json();
    if (document.querySelector('.project-link.active')?.dataset?.id !== active.dataset.id) return;
    const holder = document.createElement('div'); holder.innerHTML = inspectorHtml(payload).trim();
    const next = holder.firstElementChild;
    const current = main.querySelector(':scope > .runtime-inspector');
    if (current) current.replaceWith(next); else hero.after(next);
    const runLoop = main.querySelector('#runLoop');
    if (runLoop && !payload.running && !payload.iterations?.length) runLoop.textContent = 'شروع اجرای واقعی';
    next.querySelector('#realStartBtn')?.addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'در حال شروع…';
      try {
        const started = await runtimeFetch(`/api/projects/${encodeURIComponent(active.dataset.id)}/run-loop`, {method:'POST', body:'{}', headers:{'content-type':'application/json'}});
        const body = await started.json().catch(() => ({}));
        if (!started.ok) throw new Error(body.error || 'شروع اجرا ناموفق بود');
        await refreshRuntimeInspector();
      } catch (error) {
        button.disabled = false; button.textContent = 'شروع اجرای واقعی';
        alert(`شروع اجرا انجام نشد: ${error.message}`);
      }
    });
  } catch {} finally { runtimeLoading = false; }
}

const runtimeMain = document.querySelector('#main');
if (runtimeMain) {
  const observer = new MutationObserver(() => {
    if (runtimeMain.querySelector('.project-hero') && !runtimeMain.querySelector(':scope > .runtime-inspector')) {
      const restore = rememberedScroll;
      queueMicrotask(async () => {
        await refreshRuntimeInspector();
        requestAnimationFrame(() => { if (Math.abs(window.scrollY - restore) > 40) window.scrollTo({top:restore, behavior:'instant'}); });
      });
    }
  });
  observer.observe(runtimeMain, {childList:true});
}
setInterval(refreshRuntimeInspector, 2000);
refreshRuntimeInspector();
