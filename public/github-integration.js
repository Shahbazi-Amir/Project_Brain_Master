const originalFetch = window.fetch.bind(window);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function safeGitHubUrl(value) {
  const clean = String(value || '').trim();
  return /^https:\/\/github\.com\//i.test(clean) ? clean : '';
}

function injectGitHubRepositoryField() {
  const workspace = document.querySelector('#finalWorkspace');
  if (!workspace || document.querySelector('#finalGitHubRepo')) return;
  const label = document.createElement('label');
  label.className = 'github-repo-field';
  label.innerHTML = `مخزن GitHub <span class="optional">اختیاری</span>
    <input id="finalGitHubRepo" class="ltr" placeholder="owner/repo یا https://github.com/owner/repo">
    <small>اگر پر شود، Brain یک Clone جدا و Branch امن brain/* می‌سازد؛ پوشه کاری بالا برای اجرا استفاده نمی‌شود.</small>`;
  workspace.closest('label')?.after(label);
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const method = String(init.method || 'GET').toUpperCase();
  if (method === 'POST' && url === '/api/projects' && typeof init.body === 'string') {
    const repo = document.querySelector('#finalGitHubRepo')?.value?.trim() || '';
    if (repo) {
      try {
        const body = JSON.parse(init.body);
        body.githubRepository = repo;
        init = {...init, body:JSON.stringify(body)};
      } catch {}
    }
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
    if (!integration) return;
    const prUrl = safeGitHubUrl(integration.draftPrUrl);
    const repoUrl = `https://github.com/${encodeURI(integration.repository)}`;
    const box = document.createElement('div');
    box.className = 'github-delivery-status';
    box.innerHTML = `<div><span>GitHub</span><b>${esc(integration.repository)}</b></div>
      <div><span>Branch امن</span><b class="ltr-inline">${esc(integration.workBranch)}</b></div>
      <div><span>تحویل</span><b>${integration.status === 'PR_OPEN' ? 'Draft PR آماده' : integration.status === 'PUSHED' ? 'Checkpoint Push شده' : 'آماده اجرا'}</b></div>
      <div class="github-links"><a href="${repoUrl}" target="_blank" rel="noreferrer">باز کردن مخزن</a>${prUrl ? `<a href="${prUrl}" target="_blank" rel="noreferrer">باز کردن Draft PR</a>` : ''}</div>`;
    hero.querySelector('.project-summary')?.after(box);
  } catch {
    // GitHub delivery UI must never break the core Project Brain screen.
  } finally {
    statusLoading = false;
  }
}

const main = document.querySelector('#main');
if (main) {
  const observer = new MutationObserver(() => {
    injectGitHubRepositoryField();
    if (main.querySelector('.project-hero')) queueMicrotask(renderGitHubDeliveryStatus);
  });
  observer.observe(main, {childList:true, subtree:true});
}

injectGitHubRepositoryField();
setInterval(renderGitHubDeliveryStatus, 3000);
