const $ = selector => document.querySelector(selector);

const VOICE_LIMIT_SECONDS = 15;
let projects = [];
let currentId = null;
let poll = null;
let draftFlow = null;
let discoveryController = null;
const voiceStops = new Set();

const statusFa = {
  DRAFT:'پیش‌نویس', READY:'آماده', RUNNING:'در حال اجرا', PAUSED:'مکث', NEEDS_HUMAN:'منتظر تصمیم شما',
  COMPLETED:'تکمیل‌شده', BLOCKED:'مسدود', STOPPED:'متوقف‌شده', ERROR:'خطا', AWAITING_MANUAL_RESULT:'منتظر نتیجه دستی',
  PASSED:'تأییدشده', FAILED:'ردشده', INTERRUPTED:'قطع‌شده'
};
const profileFa = { coding:'نرم‌افزار / کدنویسی', writing:'نوشتن / محتوا', research:'پژوهش / تحلیل', planning:'برنامه‌ریزی', general:'عمومی / ترکیبی' };
const decisionFa = {
  CONTINUE:'ادامه', PROJECT_COMPLETE:'پروژه کامل شد', NEEDS_HUMAN:'نیازمند تصمیم شما', NO_PROGRESS:'پیشرفت کافی نیست',
  MAX_ITERATIONS:'رسیدن به سقف حلقه', PAUSED:'مکث', STOPPED:'متوقف‌شده', ERROR:'خطا', EXECUTE:'اجرا', ASK_USER:'پرسش از شما', COMPLETE:'تکمیل'
};
const reviewFa = { PASS:'تأیید', FAIL:'رد', PARTIAL:'ناقص' };
const fa = (map, value) => map[value] || value || '—';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function splitList(value) {
  return String(value || '').split(/[،,\n]/).map(x => x.trim()).filter(Boolean);
}
function inlineList(items, limit = 8) {
  const list = (items || []).filter(Boolean).slice(0, limit);
  return list.length ? list.map(esc).join('، ') : '—';
}
function listHtml(items) {
  return (items || []).length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<span class="muted">—</span>';
}
function show(selector, className, text) {
  const el = $(selector);
  if (!el) return;
  el.className = className;
  el.textContent = text;
}
function setBusy(button, busy, busyText) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.classList.toggle('loading', busy);
  button.textContent = busy ? busyText : button.dataset.originalText;
}
async function api(path, options = {}) {
  const headers = {'content-type':'application/json', ...(options.headers || {})};
  const response = await fetch(path, {cache:'no-store', ...options, headers});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `درخواست با خطای ${response.status} مواجه شد`);
  return body;
}

function stopAllVoice(message = 'ضبط متوقف شد.') {
  for (const stop of [...voiceStops]) stop(message);
}

function bindVoice(buttonSelector, targetSelector, statusSelector) {
  const button = $(buttonSelector);
  const target = $(targetSelector);
  const status = statusSelector ? $(statusSelector) : null;
  if (!button || !target) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const originalLabel = button.textContent;
  if (!Recognition) {
    button.classList.add('voice-unavailable');
    button.onclick = () => {
      const message = 'ورودی صوتی در این مرورگر در دسترس نیست؛ متن را تایپ کن.';
      if (status) status.textContent = message;
      else alert(message);
    };
    return;
  }

  let active = false;
  let recognition = null;
  let timer = null;
  let deadline = 0;
  let base = '';
  let stableParts = [];
  let pending = '';

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const remaining = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const renderStable = () => {
    target.value = [base, ...stableParts].map(normalize).filter(Boolean).join(' ');
    target.dispatchEvent(new Event('input', {bubbles:true}));
  };
  const appendStable = value => {
    const clean = normalize(value);
    if (!clean) return;
    const joined = normalize(stableParts.join(' '));
    if (joined === clean || joined.endsWith(` ${clean}`) || joined.endsWith(clean)) return;
    stableParts.push(clean);
    renderStable();
  };
  const updateStatus = () => {
    const seconds = remaining();
    button.textContent = `■ پایان · ${seconds}ث`;
    if (status) status.textContent = `در حال شنیدن… ${seconds} ثانیه${pending ? ` · «${pending.slice(-42)}»` : ''}`;
    if (seconds <= 0) stop(`${VOICE_LIMIT_SECONDS} ثانیه تمام شد؛ برای ادامه دوباره ضبط را بزن.`);
  };
  const stop = (message = 'ضبط متوقف شد؛ متن ثبت شد.') => {
    if (!active && !recognition) return;
    active = false;
    if (pending) appendStable(pending);
    pending = '';
    clearInterval(timer);
    timer = null;
    try { recognition?.stop(); } catch {}
    recognition = null;
    button.classList.remove('listening');
    button.textContent = originalLabel;
    if (status) status.textContent = message;
    voiceStops.delete(stop);
  };
  const startPiece = () => {
    if (!active || remaining() <= 0) return;
    const instance = new Recognition();
    recognition = instance;
    instance.lang = 'fa-IR';
    instance.interimResults = true;
    try { instance.continuous = false; } catch {}

    instance.onresult = event => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = normalize(event.results[i][0].transcript);
        if (!text) continue;
        if (event.results[i].isFinal) appendStable(text);
        else live = [live, text].filter(Boolean).join(' ');
      }
      pending = normalize(live);
      updateStatus();
    };
    instance.onerror = event => {
      if (['not-allowed','service-not-allowed','audio-capture'].includes(event.error)) {
        stop(`ضبط متوقف شد (${event.error}). دسترسی میکروفن را بررسی کن.`);
      }
    };
    instance.onend = () => {
      if (recognition === instance) recognition = null;
      if (pending) appendStable(pending);
      pending = '';
      if (active && remaining() > 0) setTimeout(startPiece, 100);
      else if (active) stop(`${VOICE_LIMIT_SECONDS} ثانیه تمام شد؛ برای ادامه دوباره ضبط را بزن.`);
    };
    try { instance.start(); }
    catch (error) { stop(`شروع ضبط ممکن نشد: ${error.message}`); }
  };

  button.onclick = () => {
    if (button.disabled) return;
    if (active) return stop();
    base = target.value.trim();
    stableParts = [];
    pending = '';
    deadline = Date.now() + VOICE_LIMIT_SECONDS * 1000;
    active = true;
    voiceStops.add(stop);
    button.classList.add('listening');
    updateStatus();
    timer = setInterval(updateStatus, 250);
    startPiece();
  };
}

function setIdeaLocked(locked) {
  ['idea','ideaVoiceBtn','profileHint','workspacePath','webSearch','quickTestBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  const analyze = $('#analyzeBtn');
  const cancel = $('#cancelDiscoveryBtn');
  if (analyze) analyze.hidden = locked;
  if (cancel) cancel.hidden = !locked;
}

async function cancelDiscovery() {
  stopAllVoice('ضبط متوقف شد؛ می‌توانی توضیحات را اصلاح کنی.');
  discoveryController?.abort();
  discoveryController = null;
  try { await api('/api/discovery/cancel', {method:'POST', body:'{}'}); } catch {}
  setIdeaLocked(false);
  show('#discovery','success','ساخت تصویر لغو شد. توضیحات را کامل کن و دوباره «تصویر ایده» را بزن.');
}

async function refreshHealth() {
  try {
    const health = await api('/api/health');
    const el = $('#health');
    const codex = health.codex;
    if (codex.available && codex.authenticated && codex.compatible !== false) {
      el.className = 'health ok';
      el.textContent = `Codex آماده · سقف حلقه ${health.maxLoopIterations || 13}`;
    } else if (!codex.available) {
      el.className = 'health bad'; el.textContent = 'Codex روی سیستم پیدا نشد';
    } else if (!codex.authenticated) {
      el.className = 'health bad'; el.textContent = 'Codex نیاز به ورود دارد';
    } else {
      el.className = 'health bad'; el.textContent = 'نسخه Codex با اجرای خودکار سازگار نیست';
    }
  } catch {
    $('#health').className = 'health bad';
    $('#health').textContent = 'بررسی وضعیت ناموفق بود';
  }
}
async function refreshProjects() {
  const response = await api('/api/projects');
  projects = response.projects;
  renderList();
}
function renderList() {
  const el = $('#projectList');
  el.innerHTML = projects.length
    ? projects.map(project => `<div class="project-link ${project.id === currentId ? 'active' : ''}" data-id="${project.id}"><strong>${esc(project.name)}</strong><small>${esc(fa(statusFa, project.status))} · ${esc(fa(profileFa, project.profile))}</small></div>`).join('')
    : '<div class="empty-side">هنوز پروژه‌ای نیست.</div>';
  el.querySelectorAll('.project-link').forEach(item => item.onclick = () => openProject(item.dataset.id));
}

function newProject() {
  stopAllVoice();
  currentId = null;
  draftFlow = null;
  clearInterval(poll);
  renderList();
  const template = $('#newProjectTemplate').content.cloneNode(true);
  $('#main').replaceChildren(template);
  $('#analyzeBtn').onclick = analyze;
  $('#cancelDiscoveryBtn').onclick = cancelDiscovery;
  $('#quickTestBtn').onclick = () => {
    $('#idea').value = 'می‌خواهم یک متن فارسی کاربردی تولید کنم و بعد آن را به صوت طبیعی تبدیل کنم.';
    $('#profileHint').value = '';
    $('#workspacePath').value = '';
    $('#webSearch').checked = false;
    show('#discovery','success','نمونه داخل کادر قرار گرفت. اگر مناسب است «تصویر ایده» را بزن.');
  };
  bindVoice('#ideaVoiceBtn','#idea','#ideaVoiceStatus');
}

async function analyze() {
  const description = $('#idea').value.trim();
  if (description.length < 10) return show('#discovery','error','ایده را کمی کامل‌تر بگو.');

  stopAllVoice('ضبط پایان یافت و متن ثبت شد.');
  setIdeaLocked(true);
  show('#discovery','progress','در حال ساخت برداشت اولیه…');
  discoveryController = new AbortController();

  try {
    const response = await api('/api/discover', {
      method:'POST',
      signal:discoveryController.signal,
      body:JSON.stringify({
        description,
        profileHint:$('#profileHint').value,
        useWebSearch:$('#webSearch').checked
      })
    });
    if (!response.discovery) throw new Error('پاسخ معمار پروژه ناقص بود');
    draftFlow = {
      description,
      profileHint:$('#profileHint').value,
      useWebSearch:$('#webSearch').checked,
      discovery:response.discovery,
      answers:{},
      resources:[],
      maturation:null
    };
    renderDiscovery(response.discovery);
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('aborted')) {
      show('#discovery','success','ساخت تصویر لغو شد.');
    } else {
      show('#discovery','error',`تصویر ایده کامل نشد: ${error.message}`);
    }
  } finally {
    discoveryController = null;
    setIdeaLocked(false);
  }
}

function choiceSet(item, scope, index) {
  const selected = new Set(item.selectedOptionIds || []);
  const options = (item.options || []).map(option => `<label class="choice-check"><input type="checkbox" data-option-label="${esc(option.label)}" ${selected.has(option.id) ? 'checked' : ''}><span>${esc(option.label)}</span></label>`).join('');
  return `<div class="choice-line" data-selection-mode="${esc(item.selectionMode || 'multiple')}" data-choice-scope="${scope}_${index}">${options}</div>`;
}
function detailsBox(kind, id, index) {
  return `<button type="button" class="details-toggle" data-details-target="${kind}_details_${index}">+ توضیح بیشتر</button>
    <div id="${kind}_details_${index}" class="details-wrap" hidden>
      <div class="details-actions"><textarea rows="2" data-details-kind="${kind}" data-details-id="${esc(id)}" placeholder="توضیح اختیاری"></textarea><button id="${kind}_voice_${index}" class="voice-btn small" type="button">🎙 ۱۵ث</button></div>
      <div id="${kind}_voice_status_${index}" class="voice-status"></div>
    </div>`;
}
function bindChoiceRules() {
  document.querySelectorAll('.choice-line').forEach(line => {
    line.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.checked) return;
      if (line.dataset.selectionMode === 'single') {
        line.querySelectorAll('input').forEach(other => { if (other !== input) other.checked = false; });
      }
    });
  });
}
function bindDetailControls(items, kind) {
  document.querySelectorAll('.details-toggle').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.onclick = () => {
      const box = document.getElementById(button.dataset.detailsTarget);
      box.hidden = !box.hidden;
      button.textContent = box.hidden ? '+ توضیح بیشتر' : '− بستن';
    };
  });
  (items || []).forEach((item, index) => {
    if (item.allowDetails) bindVoice(`#${kind}_voice_${index}`, `#${kind}_details_${index} textarea`, `#${kind}_voice_status_${index}`);
  });
}

function renderDiscovery(discovery) {
  const facts = (discovery.facts || []).map((fact, index) => `<div class="decision-row fact-row" data-fact-id="${esc(fact.id)}">
    <div class="decision-label"><span class="source-badge">${fact.source === 'user_explicit' ? 'تو گفتی' : 'برداشت من'}</span><strong>${esc(fact.label)}</strong></div>
    <div class="decision-controls">${choiceSet(fact,'fact',index)}${fact.allowDetails ? detailsBox('fact',fact.id,index) : ''}</div>
  </div>`).join('');

  const questions = (discovery.questions || []).map((question, index) => `<div class="decision-row question-row" data-question-id="${esc(question.id)}" data-required="${question.required ? '1' : '0'}">
    <div class="decision-label"><strong>${esc(question.question)}</strong>${question.required ? '<span class="required-dot">لازم</span>' : ''}</div>
    <div class="decision-controls">${choiceSet(question,'question',index)}${question.allowDetails ? detailsBox('question',question.id,index) : ''}</div>
  </div>`).join('');

  $('#discovery').innerHTML = `<div class="panel nested discovery-panel compact-flow">
    <div class="step-title"><span>۱</span><div><b>برداشت من</b><small>اگر اشتباه فهمیده‌ام، همین‌جا تیک‌ها را عوض کن.</small></div></div>
    <div class="idea-summary-line"><span>ایده</span><strong>${esc(discovery.ideaEssence || discovery.understanding)}</strong></div>

    <div class="compact-block"><h2>چیزی که از حرفت فهمیدم</h2><div class="linear-list">${facts}</div></div>
    <div class="compact-block"><h2>${questions ? 'چند انتخاب برای دقیق شدن' : 'ابهام مهمی نمانده'}</h2>${questions || '<div class="success">تصویر اولیه روشن است.</div>'}</div>

    <div class="flow-actions"><button id="refineBtn" class="primary large">پخته‌سازی و ساخت نقشه اجرا</button></div>
    <div id="refineError"></div>
  </div>`;

  bindChoiceRules();
  bindDetailControls(discovery.facts,'fact');
  bindDetailControls(discovery.questions,'question');
  $('#refineBtn').onclick = () => refineIdea();
}

function collectReviewedAnswers() {
  const answers = {};
  for (const row of document.querySelectorAll('.fact-row')) {
    const selected = [...row.querySelectorAll('input:checked')].map(input => input.dataset.optionLabel);
    const details = row.querySelector('textarea')?.value.trim() || '';
    if (!selected.length && !details) throw new Error('برای هر برداشت، گزینه درست را مشخص کن یا توضیح بده.');
    answers[`fact:${row.dataset.factId}`] = [selected.join('، '), details ? `توضیح: ${details}` : ''].filter(Boolean).join(' | ');
  }
  for (const row of document.querySelectorAll('.question-row')) {
    const selected = [...row.querySelectorAll('input:checked')].map(input => input.dataset.optionLabel);
    const details = row.querySelector('textarea')?.value.trim() || '';
    if (row.dataset.required === '1' && !selected.length && !details) throw new Error('به سؤال‌های ضروری پاسخ بده.');
    if (selected.length || details) answers[row.dataset.questionId] = [selected.join('، '), details ? `توضیح: ${details}` : ''].filter(Boolean).join(' | ');
  }
  return answers;
}

function captureFinalEdits() {
  if (!$('#finalName')) return null;
  return {
    name:$('#finalName').value.trim(),
    primaryGoal:$('#finalGoal').value.trim(),
    targetOutcome:$('#finalOutcome').value.trim(),
    audience:$('#finalAudience').value.trim(),
    scope:splitList($('#finalFeatures').value),
    executionStrategy:$('#finalStrategy').value.trim(),
    deliveryFormats:splitList($('#finalFormats').value),
    workspacePath:$('#finalWorkspace').value.trim()
  };
}
function applyEditsToMaturation(maturation, edits) {
  if (!edits) return maturation;
  const definition = maturation.finalDefinition || {};
  definition.name = edits.name || definition.name;
  definition.primaryGoal = edits.primaryGoal || definition.primaryGoal;
  definition.targetOutcome = edits.targetOutcome || definition.targetOutcome;
  definition.audience = edits.audience || definition.audience;
  if (edits.scope.length) definition.scope = edits.scope;
  if (edits.executionStrategy) definition.executionStrategy = edits.executionStrategy;
  if (edits.deliveryFormats.length) definition.deliveryFormats = edits.deliveryFormats;
  maturation.finalDefinition = definition;
  maturation.productDefinition = definition.targetOutcome || maturation.productDefinition;
  maturation.recommendedDeliveryFormats = definition.deliveryFormats || maturation.recommendedDeliveryFormats;
  return maturation;
}

async function refineIdea(extraFeedback = '') {
  const button = $('#refineBtn') || $('#revisePlanBtn');
  if (!draftFlow) return;
  const finalEdits = captureFinalEdits();
  let answers = {...draftFlow.answers};
  if (document.querySelector('.fact-row')) {
    try { answers = {...answers, ...collectReviewedAnswers()}; }
    catch (error) { return show('#refineError','error',error.message); }
  }
  if (finalEdits) answers._final_edits = JSON.stringify(finalEdits);
  if (extraFeedback.trim()) {
    answers._final_feedback = extraFeedback.trim();
    draftFlow.finalFeedbackDirective = extraFeedback.trim();
  }

  setBusy(button,true,'در حال اصلاح…');
  show('#refineError','','');
  try {
    const response = await api('/api/refine', {
      method:'POST',
      body:JSON.stringify({
        description:draftFlow.description,
        discovery:draftFlow.discovery,
        answers,
        profileHint:draftFlow.profileHint,
        useWebSearch:draftFlow.useWebSearch
      })
    });
    if (!response.maturation) throw new Error('نقشه اجرا دریافت نشد');
    draftFlow.answers = answers;
    draftFlow.maturation = applyEditsToMaturation(response.maturation, finalEdits);
    renderMaturation(draftFlow.maturation, finalEdits?.workspacePath);
  } catch (error) {
    show('#refineError','error',`اصلاح انجام نشد: ${error.message}`);
  } finally {
    setBusy(button,false);
  }
}

function resourceListHtml() {
  const resources = draftFlow?.resources || [];
  return resources.length
    ? resources.map((item,index) => `<div class="resource-item"><span>${esc(item)}</span><button type="button" class="remove-resource" data-index="${index}">حذف</button></div>`).join('')
    : '<span class="muted">منبع اضافه‌ای ثبت نشده.</span>';
}
function renderResourceList() {
  const el = $('#resourceList');
  if (!el) return;
  el.innerHTML = resourceListHtml();
  el.querySelectorAll('.remove-resource').forEach(button => button.onclick = () => {
    draftFlow.resources.splice(Number(button.dataset.index),1);
    renderResourceList();
  });
}
function addResourceReference(value) {
  const clean = String(value || '').trim();
  if (!clean) return;
  if (!draftFlow.resources.includes(clean)) draftFlow.resources.push(clean);
  renderResourceList();
}
async function uploadSelectedResources() {
  const input = $('#resourceFiles');
  const files = [...(input?.files || [])];
  if (!files.length) return show('#resourceStatus','error','اول فایل را انتخاب کن.');
  const button = $('#uploadResourcesBtn');
  setBusy(button,true,'در حال آپلود…');
  try {
    for (const file of files) {
      const response = await fetch(`/api/resources/upload?name=${encodeURIComponent(file.name)}`, {method:'POST', body:file, cache:'no-store'});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `آپلود ${file.name} ناموفق بود`);
      addResourceReference(`فایل ${file.name}: ${body.path}`);
    }
    input.value = '';
    show('#resourceStatus','success','فایل ثبت شد.');
  } catch (error) {
    show('#resourceStatus','error',`آپلود انجام نشد: ${error.message}`);
  } finally {
    setBusy(button,false);
  }
}
function bindResourceControls() {
  $('#uploadResourcesBtn').onclick = uploadSelectedResources;
  $('#addResourceRefBtn').onclick = () => {
    const input = $('#resourceRef');
    const value = input.value.trim();
    if (!value) return;
    addResourceReference(value);
    input.value = '';
  };
  renderResourceList();
}

function renderMaturation(maturation, workspaceOverride = '') {
  const definition = maturation.finalDefinition || {};
  const contract = maturation.executionContract || {};
  const workspace = workspaceOverride || $('#workspacePath')?.value.trim() || '';
  const stages = maturation.executionStages || [];
  const formats = maturation.recommendedDeliveryFormats || definition.deliveryFormats || [];

  $('#discovery').innerHTML = `<div class="panel nested maturation-panel compact-flow">
    <div class="step-title done"><span>✓</span><div><b>نسخه پخته آماده است</b><small>همه بخش‌های اصلی زیر قابل ویرایش‌اند.</small></div></div>

    <div class="editable-contract">
      <label>نام پروژه<input id="finalName" value="${esc(definition.name || '')}"></label>
      <label>هدف<textarea id="finalGoal" rows="2">${esc(definition.primaryGoal || maturation.clarifiedIdea || '')}</textarea></label>
      <label>خروجی نهایی<textarea id="finalOutcome" rows="2">${esc(definition.targetOutcome || maturation.productDefinition || '')}</textarea></label>
      <label>مخاطب / استفاده<input id="finalAudience" value="${esc(definition.audience || '')}"></label>
      <label>ویژگی‌ها<input id="finalFeatures" value="${esc((definition.scope || definition.deliverables || []).join('، '))}"></label>
      <label>روش اجرا<textarea id="finalStrategy" rows="2">${esc(definition.executionStrategy || maturation.recommendedApproach?.name || '')}</textarea></label>
      <label>فرمت تحویل<input id="finalFormats" value="${esc(formats.join('، '))}"></label>
      <label>پوشه کاری<input id="finalWorkspace" class="ltr" value="${esc(workspace)}" placeholder="خالی = پوشه مدیریت‌شده Project Brain"></label>
    </div>

    <div class="compact-metrics">
      <span><b>زمان تقریبی:</b> ${esc(contract.estimatedTime || '—')}</span>
      <span><b>حلقه:</b> حدود ${esc(contract.estimatedIterations || '—')} از سقف ۱۳</span>
      <span><b>فاز:</b> ${stages.length || '—'}</span>
    </div>

    <div class="edit-status-line"><button id="saveEditsBtn" class="secondary" type="button">ثبت اصلاحات همین صفحه</button><span id="saveEditsStatus" class="muted"></span></div>

    <details class="compact-details"><summary>جزئیات اجرا</summary>
      <div class="detail-lines"><p><b>مراحل:</b> ${inlineList(stages.map(stage => stage.title),8)}</p><p><b>منابع لازم:</b> ${inlineList(contract.requiredInputs,8)}</p><p><b>بازبینی:</b> ${inlineList(contract.reviewCheckpoints,8)}</p><p><b>مانیتورینگ:</b> ${esc(contract.monitoringPlan || 'همین داشبورد Project Brain')}</p><p><b>خلاصه اجرا:</b> ${esc(contract.executionBrief || '—')}</p></div>
    </details>

    <div class="resource-box compact-resource">
      <h3>منابع اجرا <span class="optional">اختیاری</span></h3>
      <div class="resource-upload-row"><input id="resourceFiles" type="file" multiple><button id="uploadResourcesBtn" class="secondary" type="button">آپلود</button></div>
      <div class="inline-form"><input id="resourceRef" placeholder="لینک، مسیر محلی یا فایل Release"><button id="addResourceRefBtn" class="secondary" type="button">افزودن</button></div>
      <div id="resourceStatus"></div><div id="resourceList" class="resource-list"></div>
    </div>

    <div class="final-feedback compact-feedback">
      <div class="field-head"><label for="finalFeedback">اصلاح کلی با توضیح <span class="optional">اختیاری</span></label><button id="finalVoiceBtn" class="voice-btn small" type="button">🎙 ۱۵ث</button></div>
      <textarea id="finalFeedback" rows="2" placeholder="اگر لازم است با یک توضیح، نقشه دوباره تنظیم شود."></textarea>
      <div id="finalVoiceStatus" class="voice-status"></div>
      <button id="revisePlanBtn" class="secondary" type="button">اعمال این اصلاح روی نقشه</button><div id="refineError"></div>
    </div>

    <div class="final-settings compact-settings">
      <label>اجراکننده<select id="executorMode"><option value="codex">Codex — خودکار</option><option value="manual">دستی</option></select></label>
      <label>حداقل کیفیت<input id="quality" type="number" min="1" max="100" value="90"></label>
    </div>

    <button id="createProjectBtn" class="primary large final-create" type="button">ساخت پروژه و شروع اجرا</button>
    <div id="createError"></div>
  </div>`;

  bindResourceControls();
  bindVoice('#finalVoiceBtn','#finalFeedback','#finalVoiceStatus');
  $('#saveEditsBtn').onclick = () => {
    const edits = captureFinalEdits();
    draftFlow.maturation = applyEditsToMaturation(draftFlow.maturation, edits);
    $('#saveEditsStatus').textContent = 'ثبت شد؛ همین مقادیر مبنای ساخت پروژه هستند.';
  };
  $('#revisePlanBtn').onclick = () => {
    const feedback = $('#finalFeedback').value.trim();
    if (!feedback) return show('#refineError','error','اصلاح موردنظر را بنویس یا بگو.');
    refineIdea(feedback);
  };
  $('#createProjectBtn').onclick = createApprovedProject;
}

function buildDefinitionFromFinalForm() {
  const edits = captureFinalEdits();
  const definition = structuredClone(draftFlow.maturation.finalDefinition || {});
  definition.name = edits.name;
  definition.primaryGoal = edits.primaryGoal;
  definition.targetOutcome = edits.targetOutcome;
  definition.audience = edits.audience;
  definition.scope = edits.scope;
  definition.deliverables = edits.scope.length ? edits.scope : (definition.deliverables || []);
  definition.executionStrategy = edits.executionStrategy;
  definition.deliveryFormats = edits.deliveryFormats;
  definition.humanDecisionsRequired = [];
  definition.resourceReferences = [...(draftFlow.resources || [])];
  definition.executionContract = draftFlow.maturation.executionContract;
  if (draftFlow.finalFeedbackDirective) {
    definition.constraints = [...(definition.constraints || []), `اصلاح نهایی کاربر: ${draftFlow.finalFeedbackDirective}`];
  }
  if (!definition.name || !definition.primaryGoal || !definition.targetOutcome) throw new Error('نام، هدف و خروجی نهایی را کامل کن.');
  return {definition, workspacePath:edits.workspacePath};
}

async function createApprovedProject() {
  const button = $('#createProjectBtn');
  setBusy(button,true,'در حال ساخت و شروع…');
  show('#createError','','');
  try {
    const {definition, workspacePath} = buildDefinitionFromFinalForm();
    const finalProfile = draftFlow.maturation?.finalProfile || draftFlow.discovery.suggestedProfile;
    const created = await api('/api/projects', {
      method:'POST',
      body:JSON.stringify({
        description:draftFlow.description,
        definition,
        profile:finalProfile,
        workspacePath,
        executorMode:$('#executorMode').value,
        minQualityScore:Number($('#quality').value || 90),
        maxIterations:13
      })
    });
    const id = created.project.id;
    await refreshProjects();
    await api(`/api/projects/${id}/run-loop`, {method:'POST', body:'{}'});
    await openProject(id);
  } catch (error) {
    show('#createError','error',`ساخت/شروع پروژه انجام نشد: ${error.message}`);
  } finally {
    setBusy(button,false);
  }
}

async function openProject(id) {
  stopAllVoice();
  currentId = id;
  draftFlow = null;
  renderList();
  clearInterval(poll);
  await renderProject();
  poll = setInterval(() => {
    const active = document.activeElement;
    if (active && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName)) return;
    renderProject();
  }, 3000);
}

async function renderProject() {
  if (!currentId) return;
  try {
    const response = await api(`/api/projects/${currentId}`);
    const project = response.project;
    const contract = project.definition.executionContract || {};
    const awaiting = response.iterations.find(item => item.status === 'AWAITING_MANUAL_RESULT');
    const terminal = ['COMPLETED','STOPPED'].includes(project.status);
    const runDisabled = terminal || response.running ? 'disabled' : '';

    $('#main').innerHTML = `<section class="panel project-hero">
      <div class="section-head project-title-row"><div><span class="eyebrow">${esc(fa(profileFa,project.profile))}</span><h1>${esc(project.name)}</h1></div><span class="pill status-${project.status}">${esc(fa(statusFa,project.status))}</span></div>
      <p class="lead">${esc(project.definition.primaryGoal)}</p>
      <div class="project-summary"><div><span>خروجی</span><b>${esc(project.definition.targetOutcome || '—')}</b></div><div><span>زمان / حلقه</span><b>${esc(contract.estimatedTime || '—')} · ${esc(contract.estimatedIterations || '—')} از ۱۳</b></div><div><span>پوشه</span><b class="ltr-inline">${esc(project.workspacePath)}</b></div></div>
      <div class="actions project-actions"><button class="primary" id="runLoop" ${runDisabled}>ادامه خودکار</button><button class="secondary" id="runOnce" ${runDisabled}>یک مرحله</button><button class="secondary" id="pause">مکث</button><button class="danger" id="stop">توقف</button></div>
      <div class="field-head"><label for="directive">اصلاح مسیر / دستور جدید</label><button id="directiveVoiceBtn" class="voice-btn small" type="button">🎙 ۱۵ث</button></div>
      <div class="inline-form"><input id="directive" placeholder="دستور جدید"><button class="secondary" id="addDirective">افزودن</button></div><div id="directiveVoiceStatus" class="voice-status"></div>
      ${awaiting ? manualBox(awaiting) : ''}
    </section>
    <section class="panel"><h2>روند اجرا</h2>${response.iterations.length ? response.iterations.map(iterationHtml).join('') : `<p class="muted">${response.running ? 'در حال آماده‌سازی اولین مرحله…' : 'هنوز اجرایی ثبت نشده.'}</p>`}</section>`;

    bindProjectActions(project, awaiting);
    bindVoice('#directiveVoiceBtn','#directive','#directiveVoiceStatus');
    if (awaiting) bindVoice('#manualVoiceBtn','#manualResult','#manualVoiceStatus');
  } catch (error) {
    $('#main').innerHTML = `<div class="error">نمایش پروژه ممکن نشد: ${esc(error.message)}</div>`;
  }
}

function manualBox(iteration) {
  return `<div class="manual-box"><h3>نتیجه اجرای دستی لازم است</h3><div class="prompt">${esc(iteration.executionPrompt)}</div><div class="field-head"><label for="manualResult">نتیجه</label><button id="manualVoiceBtn" class="voice-btn small" type="button">🎙 ۱۵ث</button></div><textarea id="manualResult" rows="6"></textarea><div id="manualVoiceStatus" class="voice-status"></div><button id="submitManual" class="primary">ارسال برای بازبینی</button></div>`;
}
function iterationHtml(iteration) {
  const score = iteration.reviewer ? `${iteration.reviewer.score}/100` : '';
  return `<div class="iteration"><div class="iteration-head"><div><b>مرحله ${iteration.number}: ${esc(iteration.supervisor?.taskTitle || 'اجرا')}</b><div class="muted">${esc(fa(statusFa,iteration.status))} · ${esc(fa(decisionFa,iteration.decision))}</div></div><div>${score}</div></div>${iteration.reviewer ? `<p><b>بازبینی:</b> ${esc(iteration.reviewer.reasoningSummary)}</p><div class="muted"><b>بعدی:</b> ${esc(iteration.reviewer.recommendedNextAction)}</div>` : ''}</div>`;
}
function bindProjectActions(project, awaiting) {
  $('#runOnce').onclick = () => action('run-once');
  $('#runLoop').onclick = () => action('run-loop');
  $('#pause').onclick = () => action('pause');
  $('#stop').onclick = () => action('stop');
  $('#addDirective').onclick = async () => {
    const text = $('#directive').value.trim();
    if (!text) return;
    await api(`/api/projects/${project.id}/directives`, {method:'POST', body:JSON.stringify({text})});
    $('#directive').value = '';
    await renderProject();
  };
  if (awaiting) $('#submitManual').onclick = async () => {
    const result = $('#manualResult').value.trim();
    if (!result) return;
    await api(`/api/projects/${project.id}/manual-result`, {method:'POST', body:JSON.stringify({result})});
    await renderProject();
  };
  async function action(name) {
    try {
      await api(`/api/projects/${project.id}/${name}`, {method:'POST', body:'{}'});
      await renderProject();
    } catch (error) {
      alert(`عملیات انجام نشد: ${error.message}`);
    }
  }
}

$('#newProjectBtn').onclick = newProject;
await Promise.all([refreshHealth(), refreshProjects()]);
newProject();
