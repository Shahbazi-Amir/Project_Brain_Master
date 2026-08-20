const STATUS_LABELS = {
  RUNNING:'در حال اجرا', PAUSED:'مکث', NEEDS_HUMAN:'منتظر شما', COMPLETED:'تکمیل‌شده', STOPPED:'متوقف', ERROR:'خطا', BLOCKED:'مسدود', READY:'آماده'
};
const TASK_LABELS = {PENDING:'در صف', RUNNING:'در حال اجرا', DONE:'انجام شد', ATTENTION:'نیازمند بررسی', WAITING:'منتظر شما', PAUSED:'مکث'};
const TASK_CLASS = {PENDING:'pending', RUNNING:'running', DONE:'done', ATTENTION:'attention', WAITING:'waiting', PAUSED:'paused'};
const TASK_ICON = {PENDING:'○', RUNNING:'●', DONE:'✓', ATTENTION:'!', WAITING:'!', PAUSED:'Ⅱ'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function formatElapsed(startValue, endValue = Date.now()) {
  const start = Date.parse(startValue || '');
  const end = typeof endValue === 'number' ? endValue : Date.parse(endValue || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعت${minutes % 60 ? ` و ${minutes % 60} دقیقه` : ''}`;
  return `${Math.floor(hours / 24)} روز`;
}

function stageStatus(tasks) {
  if (tasks.length && tasks.every(task => task.status === 'DONE')) return 'done';
  if (tasks.some(task => task.status === 'RUNNING')) return 'running';
  if (tasks.some(task => task.status === 'WAITING')) return 'waiting';
  if (tasks.some(task => task.status === 'ATTENTION')) return 'attention';
  if (tasks.some(task => task.status === 'PAUSED')) return 'paused';
  return 'pending';
}
function stageLabel(state) {
  return ({done:'تکمیل',running:'در حال اجرا',waiting:'منتظر شما',attention:'نیازمند بررسی',paused:'مکث',pending:'در صف'})[state] || 'در صف';
}

function executionDashboardHtml(payload) {
  const project = payload.project;
  const stages = Array.isArray(project.definition?.executionStages) ? project.definition.executionStages : [];
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (!stages.length) return `<section class="panel execution-dashboard legacy-plan"><h2>نقشه مرحله‌ای ثبت نشده</h2><p class="muted">این پروژه نقشه فاز/کار قابل پیگیری ندارد.</p></section>`;

  const total = tasks.length || stages.reduce((sum, stage) => sum + (stage.tasks?.length || 0), 0);
  const done = tasks.filter(task => task.status === 'DONE').length;
  const progress = total ? Math.round(done / total * 100) : 0;
  const activeTask = tasks.find(task => task.status === 'RUNNING') || tasks.find(task => task.status === 'WAITING' || task.status === 'ATTENTION') || tasks.find(task => task.status === 'PENDING');
  const currentStageIndex = activeTask?.stageIndex ?? Math.min(stages.length - 1, tasks.filter(task => task.status === 'DONE').reduce((max, task) => Math.max(max, task.stageIndex), 0));
  const terminal = ['COMPLETED','STOPPED','ERROR'].includes(project.status);

  const stageRows = stages.map((stage, stageIndex) => {
    const stageTasks = tasks.filter(task => task.stageIndex === stageIndex);
    const fallbackTasks = stageTasks.length ? stageTasks : (stage.tasks || []).map((title, taskIndex) => ({title, taskIndex, status:'PENDING'}));
    const state = stageStatus(fallbackTasks);
    const completed = fallbackTasks.filter(task => task.status === 'DONE').length;
    const isCurrent = stageIndex === currentStageIndex && project.status !== 'COMPLETED';
    const checklist = fallbackTasks.map(task => {
      const status = task.status || 'PENDING';
      const cls = TASK_CLASS[status] || 'pending';
      return `<li class="execution-task task-${cls}"><span class="task-icon">${TASK_ICON[status] || '○'}</span><div><b>${esc(task.title)}</b><small>${esc(TASK_LABELS[status] || status)}</small></div></li>`;
    }).join('');
    return `<article class="execution-stage stage-${state} ${isCurrent ? 'stage-current' : ''}">
      <div class="execution-stage-head"><div><span class="stage-number">مرحله ${stageIndex + 1} از ${stages.length}</span><h3>${esc(stage.title || `مرحله ${stageIndex + 1}`)}</h3></div><span class="stage-chip ${state}">${esc(stageLabel(state))}</span></div>
      <div class="stage-summary"><b>${esc(stage.purpose || '—')}</b><span>${fallbackTasks.length} کار · ${completed} انجام‌شده · ${esc(stage.estimatedTime || 'زمان نامشخص')}</span></div>
      <ol class="execution-task-list">${checklist}</ol>
      <details class="stage-details"><summary>جزئیات این مرحله</summary><div class="stage-detail-body"><p><b>شرط پایان:</b> ${esc(stage.doneWhen || '—')}</p><p><b>خروجی‌ها:</b> ${esc((stage.outputs || []).join('، ') || '—')}</p></div></details>
    </article>`;
  }).join('');

  return `<section class="panel execution-dashboard">
    <div class="execution-dashboard-head"><div><span class="eyebrow">اجرای واقعی پروژه</span><h2>مرحله ${Math.min(stages.length, (currentStageIndex ?? 0) + 1)} از ${stages.length}</h2></div><span class="stage-chip ${project.status === 'RUNNING' ? 'running' : 'neutral'}">${esc(STATUS_LABELS[project.status] || project.status)}</span></div>
    <div class="execution-kpis"><div><span>کل مراحل</span><b>${stages.length}</b></div><div><span>کل کارها</span><b>${total}</b></div><div><span>تیک خورده</span><b>${done}</b></div><div><span>زمان گذشته</span><b>${esc(formatElapsed(project.createdAt, terminal ? project.updatedAt : Date.now()))}</b></div></div>
    <div class="overall-progress"><div><span>پیشرفت واقعی</span><b>${progress}%</b></div><div class="overall-progress-track"><span style="width:${progress}%"></span></div></div>
    <div class="current-work"><span>کار فعلی</span><b>${esc(project.status === 'COMPLETED' ? 'پروژه تکمیل شده' : activeTask?.title || 'هنوز کاری شروع نشده')}</b></div>
    <div class="execution-stage-list">${stageRows}</div>
  </section>`;
}

let loading = false;
async function refreshExecutionDashboard() {
  if (loading) return;
  const active = document.querySelector('.project-link.active');
  const main = document.querySelector('#main');
  if (!main || !active?.dataset?.id) return;
  const historyPanel = [...main.querySelectorAll(':scope > section.panel')].find(panel => panel.querySelector('h2')?.textContent?.includes('روند اجرا'));
  if (!historyPanel) return;
  loading = true;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(active.dataset.id)}`, {cache:'no-store'});
    if (!response.ok) return;
    const payload = await response.json();
    if (document.querySelector('.project-link.active')?.dataset?.id !== active.dataset.id) return;
    const wrapper = document.createElement('div'); wrapper.innerHTML = executionDashboardHtml(payload).trim();
    const dashboard = wrapper.firstElementChild;
    const existing = main.querySelector(':scope > .execution-dashboard');
    if (existing) existing.replaceWith(dashboard); else historyPanel.before(dashboard);
  } catch {} finally { loading = false; }
}

const main = document.querySelector('#main');
if (main) {
  const observer = new MutationObserver(() => { if (main.querySelector('.project-hero') && !main.querySelector(':scope > .execution-dashboard')) queueMicrotask(refreshExecutionDashboard); });
  observer.observe(main, {childList:true});
}
setInterval(refreshExecutionDashboard, 2000);
refreshExecutionDashboard();
