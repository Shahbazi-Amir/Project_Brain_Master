const STATUS_LABELS = {
  RUNNING: 'در حال اجرا',
  PAUSED: 'مکث',
  NEEDS_HUMAN: 'منتظر تصمیم شما',
  COMPLETED: 'تکمیل‌شده',
  STOPPED: 'متوقف‌شده',
  ERROR: 'خطا',
  BLOCKED: 'مسدود',
  READY: 'آماده'
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));

function formatElapsed(startValue, endValue = Date.now()) {
  const start = Date.parse(startValue || '');
  const end = typeof endValue === 'number' ? endValue : Date.parse(endValue || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقیقه`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} ساعت و ${restMinutes} دقیقه` : `${hours} ساعت`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} روز و ${restHours} ساعت` : `${days} روز`;
}

function tasksForStage(stage) {
  if (Array.isArray(stage.tasks) && stage.tasks.length) return stage.tasks.filter(Boolean);
  if (Array.isArray(stage.outputs) && stage.outputs.length) return stage.outputs.filter(Boolean);
  return stage.purpose ? [stage.purpose] : ['اجرای این فاز'];
}

function iterationHasPassed(iteration) {
  return iteration?.status === 'PASSED' || iteration?.reviewer?.status === 'PASS';
}

function taskState(globalIndex, passedCount, payload) {
  if (payload.project.status === 'COMPLETED') return 'done';
  if (globalIndex < passedCount) return 'done';
  if (globalIndex > passedCount) return 'pending';
  const waiting = payload.project.status === 'NEEDS_HUMAN' || payload.iterations.some(item => item.status === 'AWAITING_MANUAL_RESULT');
  if (waiting) return 'waiting';
  if (payload.project.status === 'ERROR' || payload.project.status === 'BLOCKED') return 'attention';
  if (payload.project.status === 'PAUSED' || payload.project.status === 'STOPPED') return 'paused';
  return payload.running || payload.project.status === 'RUNNING' ? 'running' : 'pending';
}

function taskIcon(state) {
  return ({done:'✓', running:'●', waiting:'!', attention:'!', paused:'Ⅱ', pending:'○'})[state] || '○';
}

function taskLabel(state) {
  return ({done:'انجام شد', running:'در حال اجرا', waiting:'منتظر شما', attention:'نیازمند بررسی', paused:'متوقف', pending:'در صف'})[state] || 'در صف';
}

function stageState(states) {
  if (states.length && states.every(state => state === 'done')) return 'done';
  if (states.includes('running')) return 'running';
  if (states.includes('waiting')) return 'waiting';
  if (states.includes('attention')) return 'attention';
  if (states.includes('paused')) return 'paused';
  return 'pending';
}

function stageLabel(state) {
  return ({done:'تکمیل', running:'در حال اجرا', waiting:'منتظر تصمیم', attention:'نیازمند بررسی', paused:'مکث', pending:'در صف'})[state] || 'در صف';
}

function executionDashboardHtml(payload) {
  const project = payload.project;
  const stages = Array.isArray(project.definition?.executionStages) ? project.definition.executionStages : [];
  const contract = project.definition?.executionContract || {};
  const iterations = Array.isArray(payload.iterations) ? payload.iterations : [];
  const passedCountRaw = iterations.filter(iterationHasPassed).length;

  if (!stages.length) {
    return `<section class="panel execution-dashboard legacy-plan">
      <div class="execution-dashboard-head"><div><span class="eyebrow">نقشه اجرا</span><h2>جزئیات مرحله‌ای برای این پروژه ثبت نشده</h2></div><span class="stage-chip neutral">پروژه قدیمی</span></div>
      <p class="muted">این پروژه قبل از داشبورد مرحله‌ای ساخته شده است. پروژه‌های جدید تعداد فازها، کارهای هر فاز، هدف و زمان هر فاز را از همان شروع اجرا نشان می‌دهند.</p>
    </section>`;
  }

  const stageTasks = stages.map(tasksForStage);
  const totalTasks = stageTasks.reduce((sum, tasks) => sum + tasks.length, 0);
  const passedCount = project.status === 'COMPLETED' ? totalTasks : Math.min(passedCountRaw, totalTasks);
  const progress = totalTasks ? Math.round((passedCount / totalTasks) * 100) : 0;
  const activeIteration = [...iterations].reverse().find(item => !iterationHasPassed(item));
  const currentPlannedTask = stageTasks.flat()[Math.min(passedCount, Math.max(0, totalTasks - 1))] || '—';
  const currentTask = activeIteration?.supervisor?.taskTitle || currentPlannedTask;
  const terminal = ['COMPLETED','STOPPED','ERROR'].includes(project.status);
  const elapsedEnd = terminal ? project.updatedAt : Date.now();

  let globalIndex = 0;
  const stageCards = stages.map((stage, stageIndex) => {
    const tasks = stageTasks[stageIndex];
    const states = tasks.map((_, localIndex) => taskState(globalIndex + localIndex, passedCount, payload));
    const state = stageState(states);
    const completed = states.filter(value => value === 'done').length;
    const stageProgress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
    const taskRows = tasks.map((task, localIndex) => {
      const taskIndex = globalIndex + localIndex;
      const itemState = taskState(taskIndex, passedCount, payload);
      return `<li class="execution-task task-${itemState}"><span class="task-icon">${taskIcon(itemState)}</span><div><b>${esc(task)}</b><small>${esc(taskLabel(itemState))}</small></div></li>`;
    }).join('');
    globalIndex += tasks.length;

    return `<article class="execution-stage stage-${state}">
      <div class="execution-stage-head">
        <div><span class="stage-number">فاز ${stageIndex + 1} از ${stages.length}</span><h3>${esc(stage.title || `فاز ${stageIndex + 1}`)}</h3></div>
        <span class="stage-chip ${state}">${esc(stageLabel(state))}</span>
      </div>
      <div class="stage-progress"><span style="width:${stageProgress}%"></span></div>
      <div class="stage-meta">
        <div><span>هدف دقیق</span><b>${esc(stage.purpose || '—')}</b></div>
        <div><span>زمان این فاز</span><b>${esc(stage.estimatedTime || 'برآورد ثبت نشده')}</b></div>
        <div><span>تعداد کار</span><b>${tasks.length} کار · ${completed} انجام‌شده</b></div>
        <div><span>شرط پایان</span><b>${esc(stage.doneWhen || '—')}</b></div>
      </div>
      <div class="stage-output"><span>خروجی این فاز</span><p>${stage.outputs?.length ? stage.outputs.map(esc).join('، ') : '—'}</p></div>
      <ol class="execution-task-list">${taskRows}</ol>
    </article>`;
  }).join('');

  return `<section class="panel execution-dashboard">
    <div class="execution-dashboard-head">
      <div><span class="eyebrow">روند واقعی اجرا</span><h2>نقشه مرحله‌به‌مرحله پروژه</h2></div>
      <span class="stage-chip ${project.status === 'RUNNING' ? 'running' : 'neutral'}">${esc(STATUS_LABELS[project.status] || project.status)}</span>
    </div>
    <div class="execution-kpis">
      <div><span>تعداد فازها</span><b>${stages.length}</b></div>
      <div><span>کل کارها</span><b>${totalTasks}</b></div>
      <div><span>انجام‌شده</span><b>${passedCount}</b></div>
      <div><span>زمان گذشته</span><b>${esc(formatElapsed(project.createdAt, elapsedEnd))}</b></div>
    </div>
    <div class="overall-progress"><div><span>پیشرفت کل</span><b>${progress}%</b></div><div class="overall-progress-track"><span style="width:${progress}%"></span></div></div>
    <div class="current-work"><span>کار فعلی</span><b>${esc(project.status === 'COMPLETED' ? 'پروژه تکمیل شده است' : currentTask)}</b><small>زمان کل برنامه: ${esc(contract.estimatedTime || '—')} · اجرای ثبت‌شده: ${iterations.length}</small></div>
    <div class="execution-stage-list">${stageCards}</div>
  </section>`;
}

let loading = false;

async function refreshExecutionDashboard() {
  if (loading) return;
  const active = document.querySelector('.project-link.active');
  const main = document.querySelector('#main');
  if (!main || !active?.dataset?.id) {
    main?.querySelector('.execution-dashboard')?.remove();
    return;
  }
  const historyPanel = [...main.querySelectorAll(':scope > section.panel')].find(panel => panel.querySelector('h2')?.textContent?.includes('روند اجرا'));
  if (!historyPanel) return;

  loading = true;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(active.dataset.id)}`, {cache:'no-store'});
    if (!response.ok) return;
    const payload = await response.json();
    if (document.querySelector('.project-link.active')?.dataset?.id !== active.dataset.id) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = executionDashboardHtml(payload).trim();
    const dashboard = wrapper.firstElementChild;
    const existing = main.querySelector(':scope > .execution-dashboard');
    if (existing) existing.replaceWith(dashboard);
    else historyPanel.before(dashboard);
  } catch {
    // The core Project Brain screen remains usable even if dashboard refresh fails.
  } finally {
    loading = false;
  }
}

const main = document.querySelector('#main');
if (main) {
  const observer = new MutationObserver(() => {
    if (main.querySelector('.project-hero') && !main.querySelector(':scope > .execution-dashboard')) {
      queueMicrotask(refreshExecutionDashboard);
    }
  });
  observer.observe(main, {childList:true});
}

setInterval(refreshExecutionDashboard, 3000);
refreshExecutionDashboard();