const originalFetch = window.fetch.bind(window);
let skipNextAutomaticRun = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function safeGitHubUrl(value) {
  const clean = String(value || '').trim();
  return /^https:\/\/github\.com\//i.test(clean) ? clean : '';
}

function injectGitHubRepositoryFields() {
  const workspace = document.querySelector('#finalWorkspace');
  if (!workspace) return;
  if (!document.querySelector('#finalGitHubRepo')) {
    const label = document.createElement('label');
    label.className = 'github-repo-field';
    label.innerHTML = `مخزن اجرای کار <span class="optional">اختیاری</span>
      <input id="finalGitHubRepo" class="ltr" placeholder="owner/repo یا https://github.com/owner/repo">
      <small>Brain فقط روی Clone جدا و Branch امن brain/* کار می‌کند؛ main/master دست‌نخورده می‌ماند.</small>`;
    workspace.closest('label')?.after(label);
  }
  if (!document.querySelector('#finalSourceRepos')) {
    const executionLabel = document.querySelector('#finalGitHubRepo')?.closest('label');
    const label = document.createElement('label');
    label.className = 'github-repo-field source-repo-field';
    label.innerHTML = `مخزن منابع <span class="optional">اختیاری</span>
      <input id="finalSourceRepos" class="ltr" placeholder="owner/resources-repo — چند مخزن را با کاما جدا کن">
      <small>این مخزن‌ها به‌عنوان منبع Clone و فایل‌هایشان شمارش و دسته‌بندی می‌شوند؛ محل اجرای کار نیستند.</small>`;
    executionLabel?.after(label);
  }
  const create = document.querySelector('#createProjectBtn');
  if (create && !create.dataset.preflightLabel) {
    create.dataset.preflightLabel = '1';
    create.textContent = 'ساخت پروژه و بررسی قبل از اجرا';
  }
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'POST' && url === '/api/projects' && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      const executionRepo = document.querySelector('#finalGitHubRepo')?.value?.trim() || '';
      const sourceRepos = document.querySelector('#finalSourceRepos')?.value?.trim() || '';
      if (executionRepo) body.githubRepository = executionRepo;
      if (sourceRepos) body.sourceRepositories = sourceRepos.split(/[,\n]+/).map(v => v.trim()).filter(Boolean);
      init = {...init, body:JSON.stringify(body)};
    } catch {}
    const response = await originalFetch(input, init);
    if (response.ok) skipNextAutomaticRun = true;
    return response;
  }
  if (method === 'POST' && /\/api\/projects\/[^/]+\/run-loop$/.test(url) && skipNextAutomaticRun) {
    skipNextAutomaticRun = false;
    return new Response(JSON.stringify({started:false, preflight:true, message:'Project created. Waiting for explicit start after preflight.'}), {
      status:202,
      headers:{'content-type':'application/json; charset=utf-8'}
    });
  }
  return originalFetch(input, init);
};

let statusLoading = false;
async function renderGitHubDeliveryStatus() {
  if (statusLoading) return;
  const active = document.querySelector('.project-link.active');
  const hero = document.querySelector('.project-hero');
  if (!active?.dataset?.id || !hero || hero.querySelector('.github-delivery-status')) return;
  statusLoading = true;
  try {
    const response = await originalFetch(`/api/projects/${encodeURIComponent(active.dataset.id)}`, {cache:'no-store'});
    if (!response.ok) return;
    const payload = await response.json();
    const integration = payload.project?.definition?.githubIntegration;
    const sourceRepos = payload.project?.definition?.resourceRepositories || [];
    if (!integration && !sourceRepos.length) return;
    const prUrl = safeGitHubUrl(integration?.draftPrUrl);
    const repoUrl = integration ? `https://github.com/${encodeURI(integration.repository)}` : '';
    const sourceText = sourceRepos.length ? sourceRepos.map(repo => `${repo.repository} · ${repo.fileCount} فایل`).join(' | ') : '—';
    const box = document.createElement('div');
    box.className = 'github-delivery-status';
    box.innerHTML = `<div><span>مخزن اجرا</span><b>${esc(integration?.repository || 'Workspace محلی')}</b></div>
      <div><span>Branch امن</span><b class="ltr-inline">${esc(integration?.workBranch || '—')}</b></div>
      <div><span>منابع GitHub</span><b>${esc(sourceText)}</b></div>
      <div class="github-links">${repoUrl ? `<a href="${repoUrl}" target="_blank" rel="noreferrer">مخزن اجرا</a>` : ''}${prUrl ? `<a href="${prUrl}" target="_blank" rel="noreferrer">Draft PR</a>` : ''}</div>`;
    hero.querySelector('.project-summary')?.after(box);
  } catch {
    // Never break core UI because a supplemental GitHub status failed.
  } finally { statusLoading = false; }
}

const main = document.querySelector('#main');
if (main) {
  const observer = new MutationObserver(() => {
    injectGitHubRepositoryFields();
    if (main.querySelector('.project-hero')) queueMicrotask(renderGitHubDeliveryStatus);
  });
  observer.observe(main, {childList:true, subtree:true});
}

injectGitHubRepositoryFields();
setInterval(renderGitHubDeliveryStatus, 3000);
