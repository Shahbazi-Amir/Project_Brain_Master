const $ = s => document.querySelector(s);
let projects = [], currentId = null, poll = null;
let draftFlow = null;

const statusFa = {
  DRAFT:'پیش‌نویس', READY:'آماده', RUNNING:'در حال اجرا', PAUSED:'مکث', NEEDS_HUMAN:'منتظر تصمیم شما',
  COMPLETED:'تکمیل‌شده', BLOCKED:'مسدود', STOPPED:'متوقف‌شده', ERROR:'خطا', AWAITING_MANUAL_RESULT:'منتظر نتیجه دستی',
  PASSED:'تأییدشده', FAILED:'ردشده', INTERRUPTED:'قطع‌شده'
};
const profileFa = { coding:'نرم‌افزار / کدنویسی', writing:'نوشتن / کتاب / محتوا', research:'پژوهش / تحلیل', planning:'برنامه‌ریزی / طراحی مسیر', general:'عمومی / ترکیبی' };
const feasibilityFa = { ready:'آماده اجرا', conditional:'نیازمند چند ورودی', blocked:'نیازمند منبع قبل از ادامه' };
const decisionFa = {
  CONTINUE:'ادامه', PROJECT_COMPLETE:'پروژه کامل شد', NEEDS_HUMAN:'نیازمند تصمیم شما', NO_PROGRESS:'پیشرفت کافی نیست',
  MAX_ITERATIONS:'رسیدن به سقف حلقه', PAUSED:'مکث', STOPPED:'متوقف‌شده', ERROR:'خطا', EXECUTE:'اجرا', ASK_USER:'پرسش از شما', COMPLETE:'تکمیل'
};
const reviewFa = { PASS:'تأیید', FAIL:'رد', PARTIAL:'ناقص' };
const fa = (map, value) => map[value] || value || '—';

async function api(path, options={}) {
  const res = await fetch(path,{headers:{'content-type':'application/json',...(options.headers||{})},...options});
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||`درخواست با خطای ${res.status} مواجه شد`);
  return body;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setBusy(el,busy,text){if(!el)return;el.classList.toggle('loading',busy);if(text){if(!el.dataset.original)el.dataset.original=el.textContent;el.textContent=busy?text:el.dataset.original;}}
function show(sel,cls,text){const el=$(sel);if(!el)return;el.className=cls;el.textContent=text;}
function listHtml(items){return (items||[]).length?`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<span class="muted">—</span>';}
function inlineList(items,limit=6){
  const arr=(items||[]).filter(Boolean).slice(0,limit);
  return arr.length?arr.map(esc).join('، '):'—';
}

function bindVoice(buttonSelector,targetSelector,statusSelector,limitSeconds=20){
  const btn=$(buttonSelector),target=$(targetSelector),status=statusSelector?$(statusSelector):null;
  if(!btn||!target)return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){
    btn.classList.add('voice-unavailable');
    btn.onclick=()=>{const msg='ورودی صوتی در این مرورگر در دسترس نیست؛ متن را تایپ کن.';if(status)status.textContent=msg;else alert(msg);};
    return;
  }

  let active=false,recognition=null,timer=null,deadline=0,base='',committed=[],preview='',original=btn.textContent;
  const remaining=()=>Math.max(0,Math.ceil((deadline-Date.now())/1000));
  const normalized=txt=>String(txt||'').replace(/\s+/g,' ').trim();
  const render=()=>{target.value=[base,...committed].map(normalized).filter(Boolean).join(' ');target.dispatchEvent(new Event('input',{bubbles:true}));};
  const appendStable=text=>{
    const clean=normalized(text);
    if(!clean)return;
    const current=normalized(committed.join(' '));
    if(current===clean||current.endsWith(` ${clean}`)||current.endsWith(clean))return;
    committed.push(clean);
    render();
  };
  const escPreview=value=>{
    const clean=normalized(value);
    return clean.length>42?`${clean.slice(-42)}…`:clean;
  };
  const statusText=()=>{
    const sec=remaining();
    const heard=preview?` · «${escPreview(preview)}»`:'';
    return `در حال شنیدن… ${sec} ثانیه${heard}`;
  };
  const cleanup=message=>{
    clearInterval(timer);timer=null;active=false;btn.classList.remove('listening');btn.textContent=original;
    if(status)status.textContent=message||'';
  };
  const flushPreview=()=>{if(preview){appendStable(preview);preview='';}};
  const stopSession=message=>{
    if(!active&&!recognition)return;
    active=false;flushPreview();
    const r=recognition;recognition=null;
    try{r?.stop();}catch{}
    cleanup(message);
  };
  const startPiece=()=>{
    if(!active)return;
    if(remaining()<=0){stopSession(`${limitSeconds} ثانیه تمام شد؛ متن ثبت شد. برای ادامه دوباره ضبط را بزن.`);return;}
    const r=new Recognition();recognition=r;
    r.lang='fa-IR';r.interimResults=true;
    try{r.continuous=false;}catch{}
    r.onresult=e=>{
      let live=[];
      for(let i=e.resultIndex;i<e.results.length;i++){
        const text=normalized(e.results[i][0].transcript);
        if(!text)continue;
        if(e.results[i].isFinal)appendStable(text);else live.push(text);
      }
      preview=normalized(live.join(' '));
      if(status)status.textContent=statusText();
    };
    r.onerror=e=>{
      if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){
        stopSession(`ضبط متوقف شد (${e.error}). دسترسی میکروفن را بررسی کن.`);
        return;
      }
      if(e.error!=='aborted'&&e.error!=='no-speech'&&status)status.textContent=`صدا موقتاً قطع شد؛ تا پایان ${limitSeconds} ثانیه دوباره وصل می‌شود.`;
    };
    r.onend=()=>{
      if(recognition===r)recognition=null;
      flushPreview();
      if(active&&remaining()>0)setTimeout(startPiece,160);
      else if(active)stopSession(`${limitSeconds} ثانیه تمام شد؛ متن ثبت شد. برای ادامه دوباره ضبط را بزن.`);
    };
    try{r.start();}catch(error){stopSession(`شروع ضبط ممکن نشد: ${error.message}`);}
  };

  btn.onclick=()=>{
    if(active){stopSession('ضبط متوقف شد؛ متن ثبت‌شده قابل ویرایش است.');return;}
    base=target.value.trim();committed=[];preview='';deadline=Date.now()+limitSeconds*1000;active=true;
    btn.classList.add('listening');
    const tick=()=>{
      const sec=remaining();
      btn.textContent=`■ پایان · ${sec}ث`;
      if(status)status.textContent=statusText();
      if(sec<=0)stopSession(`${limitSeconds} ثانیه تمام شد؛ متن ثبت شد. برای ادامه دوباره ضبط را بزن.`);
    };
    tick();timer=setInterval(tick,250);startPiece();
  };
}

async function refreshHealth(){
  try{
    const h=await api('/api/health'),e=$('#health'),c=h.codex;
    if(c.available&&c.authenticated&&c.compatible!==false){e.className='health ok';e.textContent=`Codex آماده · سقف حلقه ${h.maxLoopIterations||13}`;}
    else if(!c.available){e.className='health bad';e.textContent='Codex روی سیستم پیدا نشد';}
    else if(!c.authenticated){e.className='health bad';e.textContent='Codex نیاز به ورود دارد';}
    else{e.className='health bad';e.textContent='نسخه Codex با اجرای خودکار سازگار نیست';}
  }catch{$('#health').className='health bad';$('#health').textContent='بررسی وضعیت ناموفق بود';}
}
async function refreshProjects(){const r=await api('/api/projects');projects=r.projects;renderList();}
function renderList(){
  const el=$('#projectList');
  el.innerHTML=projects.length?projects.map(p=>`<div class="project-link ${p.id===currentId?'active':''}" data-id="${p.id}"><strong>${esc(p.name)}</strong><small>${esc(fa(statusFa,p.status))} · ${esc(fa(profileFa,p.profile))}</small></div>`).join(''):'<div class="empty-side">هنوز پروژه‌ای اینجا نیست.<br>ایده‌ی اول را از بالا شروع کن.</div>';
  el.querySelectorAll('.project-link').forEach(x=>x.onclick=()=>openProject(x.dataset.id));
}

function newProject(){
  currentId=null;draftFlow=null;clearInterval(poll);renderList();
  const t=$('#newProjectTemplate').content.cloneNode(true);$('#main').replaceChildren(t);
  $('#analyzeBtn').onclick=analyze;
  $('#quickTestBtn').onclick=()=>{
    $('#idea').value='می‌خواهم یک متن فارسی کاربردی تولید کنم، بعد آن را به صوت طبیعی تبدیل کنم و خروجی نهایی قابل استفاده تحویل بگیرم.';
    $('#profileHint').value='';$('#workspacePath').value='';$('#webSearch').checked=false;
    show('#discovery','success','نمونه فقط داخل کادر قرار گرفت. اگر مناسب است «تصویر ایده» را بزن.');
  };
  bindVoice('#ideaVoiceBtn','#idea','#ideaVoiceStatus',20);
}

async function analyze(){
  const btn=$('#analyzeBtn'),description=$('#idea').value.trim();
  if(description.length<10)return show('#discovery','error','ایده را کمی کامل‌تر بگو.');
  setBusy(btn,true,'در حال ساخت تصویر…');show('#discovery','','');
  try{
    const profileHint=$('#profileHint').value,useWebSearch=$('#webSearch').checked;
    const r=await api('/api/discover',{method:'POST',body:JSON.stringify({description,profileHint,useWebSearch})});
    if(!r.discovery)throw new Error('پاسخ معمار پروژه ناقص بود');
    draftFlow={description,profileHint,useWebSearch,discovery:r.discovery,answers:{},resources:[]};
    renderDiscovery(r.discovery);
  }catch(e){show('#discovery','error',`تصویر ایده کامل نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

function choiceSet(item,scope,index){
  const selected=new Set(item.selectedOptionIds||[]);
  const choices=(item.options||[]).map(o=>`<label class="choice-check"><input type="checkbox" data-option-id="${esc(o.id)}" data-option-label="${esc(o.label)}" ${selected.has(o.id)?'checked':''}><span>${esc(o.label)}</span></label>`).join('');
  return `<div class="choice-line" data-selection-mode="${esc(item.selectionMode||'multiple')}" data-choice-scope="${scope}_${index}">${choices}</div>`;
}
function detailsBox(kind,id,index,prompt='اگر لازم است، کوتاه توضیح بده.'){
  return `<button type="button" class="details-toggle" data-details-target="${kind}_details_${index}">+ توضیح بیشتر</button><div id="${kind}_details_${index}" class="details-wrap" hidden><div class="field-head compact"><span class="field-hint">${esc(prompt)}</span><button id="${kind}_voice_${index}" class="voice-btn small" type="button">🎙 گفتن · ۲۰ث</button></div><textarea rows="3" data-details-kind="${kind}" data-details-id="${esc(id)}" placeholder="اختیاری"></textarea><div id="${kind}_voice_status_${index}" class="voice-status"></div></div>`;
}
function bindChoiceRules(){
  document.querySelectorAll('.choice-line').forEach(line=>{
    line.addEventListener('change',e=>{
      const target=e.target;
      if(!(target instanceof HTMLInputElement)||!target.checked)return;
      if(line.dataset.selectionMode==='single'){
        line.querySelectorAll('input').forEach(input=>{if(input!==target)input.checked=false;});
      }
    });
  });
}
function bindDetailsAndVoice(items,kind){
  document.querySelectorAll('.details-toggle').forEach(btn=>{
    if(btn.dataset.bound)return;
    btn.dataset.bound='1';
    btn.onclick=()=>{
      const box=document.getElementById(btn.dataset.detailsTarget);
      if(!box)return;
      box.hidden=!box.hidden;
      btn.textContent=box.hidden?'+ توضیح بیشتر':'− بستن توضیح';
    };
  });
  (items||[]).forEach((item,i)=>{if(item.allowDetails)bindVoice(`#${kind}_voice_${i}`,`#${kind}_details_${i} textarea`,`#${kind}_voice_status_${i}`,20);});
}

function renderDiscovery(d){
  const el=$('#discovery');
  const facts=(d.facts||[]).map((f,i)=>`<div class="fact-row" data-fact-id="${esc(f.id)}"><div class="fact-label"><span class="source-badge ${f.source==='user_explicit'?'explicit':'inferred'}">${f.source==='user_explicit'?'تو گفتی':'برداشت من'}</span><strong>${esc(f.label)}</strong></div><div class="fact-controls">${choiceSet(f,'fact',i)}${f.allowDetails?detailsBox('fact',f.id,i):''}</div></div>`).join('');
  const questions=(d.questions||[]).map((q,i)=>`<div class="question-row" data-question-id="${esc(q.id)}" data-required="${q.required?'1':'0'}"><div class="question-label"><strong>${esc(q.question)}</strong>${q.required?'<span class="required-dot">لازم</span>':''}</div><div class="question-controls">${choiceSet(q,'question',i)}${q.allowDetails?detailsBox('question',q.id,i,q.detailsPrompt):''}</div></div>`).join('');

  el.innerHTML=`<div class="panel nested discovery-panel">
    <div class="architect-banner compact-banner"><div class="architect-mark">۱</div><div><strong>برداشت اولیه</strong><small>هنوز نتیجه‌گیری نکرده‌ایم؛ فقط چیزی را که فهمیده‌ام چک کن.</small></div><span class="step-badge">مرحله ۱ از ۳</span></div>

    <div class="idea-summary-line"><span>برداشت فعلی</span><strong>${esc(d.ideaEssence||d.understanding)}</strong></div>

    <div class="section-head compact-section"><div><span class="eyebrow">چیزهایی که از حرفت فهمیدم</span><h2>اگر لازم است تیک‌ها را عوض کن</h2></div></div>
    <div class="linear-list">${facts}</div>

    <div class="clarification-zone">
      <div class="section-head compact-section"><div><span class="eyebrow">روشن‌سازی</span><h2>${(d.questions||[]).length?'چند انتخاب کوتاه':'ابهام مهمی نمانده'}</h2></div><span class="stage-state">${(d.questions||[]).length?'گزینه‌ای':'آماده مرحله بعد'}</span></div>
      ${questions||'<div class="success">برداشت فعلی روشن است؛ می‌توانی قرارداد اجرا را بسازی.</div>'}
      <button id="refineBtn" class="primary large">ساخت قرارداد اجرا</button>
      <div id="refineError"></div>
    </div>
  </div>`;

  bindChoiceRules();
  bindDetailsAndVoice(d.facts,'fact');bindDetailsAndVoice(d.questions,'question');
  $('#refineBtn').onclick=()=>refineIdea();
}

function collectReviewedAnswers(){
  const answers={};
  for(const row of document.querySelectorAll('.fact-row')){
    const id=row.dataset.factId,selected=[...row.querySelectorAll('input:checked')].map(x=>x.dataset.optionLabel),details=row.querySelector('textarea')?.value.trim()||'';
    if(!selected.length&&!details)throw new Error('برای هر برداشت، گزینه درست را تیک بزن یا توضیح اصلاحی بده.');
    answers[`fact:${id}`]=[selected.join('، '),details?`توضیح: ${details}`:''].filter(Boolean).join(' | ');
  }
  for(const row of document.querySelectorAll('.question-row')){
    const id=row.dataset.questionId,required=row.dataset.required==='1',selected=[...row.querySelectorAll('input:checked')].map(x=>x.dataset.optionLabel),details=row.querySelector('textarea')?.value.trim()||'';
    if(required&&!selected.length&&!details)throw new Error('به سؤال‌های ضروری پاسخ بده؛ یک یا چند تیک کافی است.');
    if(selected.length||details)answers[id]=[selected.join('، '),details?`توضیح: ${details}`:''].filter(Boolean).join(' | ');
  }
  return answers;
}

async function refineIdea(extraFeedback=''){
  const btn=$('#refineBtn')||$('#revisePlanBtn');if(!draftFlow)return;
  let answers={...draftFlow.answers};
  if(document.querySelector('.fact-row')){
    try{answers={...answers,...collectReviewedAnswers()};}catch(e){show('#refineError','error',e.message);return;}
  }
  if(extraFeedback.trim())answers._final_feedback=extraFeedback.trim();
  setBusy(btn,true,'در حال ساخت قرارداد…');show('#refineError','','');
  try{
    const r=await api('/api/refine',{method:'POST',body:JSON.stringify({description:draftFlow.description,discovery:draftFlow.discovery,answers,profileHint:draftFlow.profileHint,useWebSearch:draftFlow.useWebSearch})});
    if(!r.maturation)throw new Error('قرارداد اجرا دریافت نشد');
    draftFlow.answers=answers;draftFlow.maturation=r.maturation;draftFlow.maxLoopIterations=r.maxLoopIterations||13;
    renderMaturation(r.maturation);
  }catch(e){show('#refineError','error',`قرارداد کامل نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

function stageDetailsHtml(stages){
  return (stages||[]).map((s,i)=>`<div class="stage-row"><b>${i+1}. ${esc(s.title)}</b><span>${esc(s.purpose)}</span><small>خروجی: ${inlineList(s.outputs)}</small></div>`).join('');
}
function riskFallbackHtml(items){
  return (items||[]).length?items.map(x=>`<div class="risk-row"><b>${esc(x.risk)}</b><span>${esc(x.fallback)}</span></div>`).join(''):'<span class="muted">—</span>';
}
function resourceListHtml(){
  const resources=draftFlow?.resources||[];
  if(!resources.length)return '<span class="muted">هنوز منبعی اضافه نشده است.</span>';
  return resources.map((x,i)=>`<div class="resource-item"><span>${esc(x)}</span><button type="button" class="remove-resource" data-index="${i}">حذف</button></div>`).join('');
}
function renderResourceList(){
  const el=$('#resourceList');if(!el)return;
  el.innerHTML=resourceListHtml();
  el.querySelectorAll('.remove-resource').forEach(btn=>btn.onclick=()=>{draftFlow.resources.splice(Number(btn.dataset.index),1);renderResourceList();});
}
function addResourceReference(value){
  const clean=String(value||'').trim();if(!clean)return;
  if(!draftFlow.resources.includes(clean))draftFlow.resources.push(clean);
  renderResourceList();
}
async function uploadSelectedResources(){
  const input=$('#resourceFiles'),status=$('#resourceStatus'),btn=$('#uploadResourcesBtn');
  const files=[...(input?.files||[])];if(!files.length){if(status)status.textContent='اول فایل را انتخاب کن.';return;}
  setBusy(btn,true,'در حال آپلود…');if(status)status.textContent='';
  try{
    for(const file of files){
      const res=await fetch(`/api/resources/upload?name=${encodeURIComponent(file.name)}`,{method:'POST',body:file});
      const body=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(body.error||`آپلود ${file.name} ناموفق بود`);
      addResourceReference(`فایل ${file.name}: ${body.path}`);
    }
    input.value='';if(status)status.textContent='فایل ثبت شد و مسیرش وارد قرارداد شد.';
  }catch(e){if(status)status.textContent=`آپلود انجام نشد: ${e.message}`;}finally{setBusy(btn,false);}
}
function bindResourceControls(){
  $('#uploadResourcesBtn').onclick=uploadSelectedResources;
  $('#addResourceRefBtn').onclick=()=>{const input=$('#resourceRef'),value=input.value.trim();if(!value)return;addResourceReference(`لینک/مسیر: ${value}`);input.value='';};
  renderResourceList();
}

function renderMaturation(m){
  const d=draftFlow.discovery,def=m.finalDefinition||{},c=m.executionContract||{};
  const workspace=$('#workspacePath')?.value.trim()||'پوشه داخلی خودکار Project Brain';
  const formats=m.recommendedDeliveryFormats||def.deliveryFormats||[];
  const featureText=inlineList((def.scope||[]).length?def.scope:def.deliverables,8);
  const requiredText=inlineList(c.requiredInputs,8);
  const timeLoop=`${c.estimatedTime||'—'} · حدود ${c.estimatedIterations||'—'} حلقه از سقف ۱۳`;
  const el=$('#discovery');

  el.innerHTML=`<div class="panel nested maturation-panel">
    <div class="architect-banner success-banner"><div class="architect-mark">✓</div><div><strong>قرارداد اجرا آماده است</strong><small>خلاصه را ببین؛ اگر درست است پروژه را بساز و همان لحظه اجرا را شروع کن.</small></div><span class="step-badge">مرحله ۳ از ۳</span></div>

    <div class="mature-head"><span class="eyebrow">${esc(fa(profileFa,m.finalProfile||d.suggestedProfile))}</span><h2>${esc(def.name||d.suggestedProjectType)}</h2><p>${esc(m.clarifiedIdea)}</p></div>

    <div class="execution-summary">
      <div class="summary-line"><span>هدف</span><strong>${esc(def.primaryGoal||m.clarifiedIdea)}</strong></div>
      <div class="summary-line"><span>خروجی</span><strong>${esc(m.productDefinition||def.targetOutcome)}</strong></div>
      <div class="summary-line"><span>ویژگی‌ها</span><strong>${featureText}</strong></div>
      <div class="summary-line"><span>روش اجرا</span><strong>${esc(def.executionStrategy||m.recommendedApproach?.name||'—')}</strong></div>
      <div class="summary-line"><span>زمان و حلقه</span><strong>${esc(timeLoop)}</strong></div>
      <div class="summary-line"><span>پوشه کار</span><strong class="ltr-inline">${esc(workspace)}</strong></div>
      <div class="summary-line"><span>مانیتورینگ</span><strong>${esc(c.monitoringPlan||'همین داشبورد Project Brain')}</strong></div>
      <div class="summary-line"><span>منابع لازم</span><strong>${requiredText}</strong></div>
      <div class="summary-line"><span>فرمت تحویل</span><strong>${inlineList(formats,8)}</strong></div>
    </div>

    <div class="resource-box">
      <div class="resource-head"><div><span class="eyebrow">منابع اجرا</span><h3>فایل، لینک یا مسیر لازم داری؟ همین‌جا اضافه کن</h3></div><span class="feasibility feasibility-${esc(c.feasibility||'conditional')}">${esc(fa(feasibilityFa,c.feasibility))}</span></div>
      <div class="resource-upload-row"><input id="resourceFiles" type="file" multiple><button id="uploadResourcesBtn" class="secondary" type="button">آپلود فایل</button></div>
      <div class="inline-form"><input id="resourceRef" placeholder="لینک، مسیر محلی یا آدرس فایل Release"><button id="addResourceRefBtn" class="secondary" type="button">افزودن</button></div>
      <div id="resourceStatus" class="voice-status"></div><div id="resourceList" class="resource-list"></div>
    </div>

    <div class="final-feedback">
      <div class="field-head"><div><label for="finalFeedback">اصلاح آخر <span class="optional">اختیاری</span></label><span class="field-hint">اگر یک نکته هنوز اشتباه است، یک‌جا بگو.</span></div><button id="finalVoiceBtn" class="voice-btn" type="button">🎙 گفتن · ۲۰ث</button></div>
      <textarea id="finalFeedback" rows="3" placeholder="مثال: خروجی نهایی DOCX باشد و فایل صوتی هم کنار آن قرار بگیرد."></textarea>
      <div id="finalVoiceStatus" class="voice-status"></div>
      <button id="revisePlanBtn" class="secondary" type="button">اعمال اصلاح</button><div id="refineError"></div>
    </div>

    <details class="advanced">
      <summary>دیدن فازها و جزئیات فنی</summary>
      <div class="advanced-body">
        <div class="advanced-block"><b>فازهای اجرا</b>${stageDetailsHtml(m.executionStages)}</div>
        <div class="advanced-block"><b>نقاط بازبینی</b>${listHtml(c.reviewCheckpoints)}</div>
        <div class="advanced-block"><b>ریسک و راه جایگزین</b>${riskFallbackHtml(c.risksAndFallbacks)}</div>
        <div class="advanced-block"><b>پرامپت/خلاصه مهندسی اجرا</b><pre class="brief">${esc(c.executionBrief||'—')}</pre></div>
        ${(c.externalCosts||[]).length?`<div class="advanced-block"><b>هزینه بیرونی احتمالی</b>${listHtml(c.externalCosts)}</div>`:''}
      </div>
    </details>

    <details class="advanced"><summary>ویرایش فنی تعریف پروژه</summary><textarea id="definitionJson" class="json-editor" rows="22">${esc(JSON.stringify(def,null,2))}</textarea></details>

    <div class="final-settings">
      <label>اجراکننده<select id="executorMode"><option value="codex">Codex — اجرای خودکار</option><option value="manual">دستی — انتقال پرامپت</option></select></label>
      <label>حداقل کیفیت<input id="quality" type="number" min="1" max="100" value="90"></label>
    </div>

    <button id="createProjectBtn" class="primary large final-create">ساخت پروژه و شروع اجرا</button>
    <div id="createError"></div>
  </div>`;

  bindResourceControls();
  bindVoice('#finalVoiceBtn','#finalFeedback','#finalVoiceStatus',20);
  $('#revisePlanBtn').onclick=()=>{const feedback=$('#finalFeedback').value.trim();if(!feedback)return show('#refineError','error','اصلاح موردنظر را بنویس یا بگو.');refineIdea(feedback);};
  $('#createProjectBtn').onclick=createApprovedProject;
}

async function createApprovedProject(){
  const btn=$('#createProjectBtn');setBusy(btn,true,'در حال ساخت و شروع…');
  try{
    const definition=JSON.parse($('#definitionJson').value);
    definition.executionContract=draftFlow.maturation?.executionContract;
    definition.resourceReferences=[...(draftFlow.resources||[])];
    definition.humanDecisionsRequired=[];
    const finalProfile=draftFlow.maturation?.finalProfile||draftFlow.discovery.suggestedProfile;
    const created=await api('/api/projects',{method:'POST',body:JSON.stringify({
      description:draftFlow.description,
      definition,
      profile:finalProfile,
      workspacePath:$('#workspacePath').value,
      executorMode:$('#executorMode').value,
      minQualityScore:Number($('#quality').value),
      maxIterations:13
    })});
    const id=created.project.id;
    await refreshProjects();
    try{await api(`/api/projects/${id}/run-loop`,{method:'POST',body:'{}'});}
    catch(startError){alert(`پروژه ساخته شد، اما شروع خودکار انجام نشد: ${startError.message}`);}
    await openProject(id);
  }catch(e){show('#createError','error',`ساخت پروژه انجام نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

async function openProject(id){
  currentId=id;draftFlow=null;renderList();clearInterval(poll);await renderProject();
  poll=setInterval(()=>{const active=document.activeElement;if(active&&['INPUT','TEXTAREA','SELECT'].includes(active.tagName))return;renderProject();},3000);
}
async function renderProject(){
  if(!currentId)return;
  try{
    const r=await api(`/api/projects/${currentId}`),p=r.project,awaiting=r.iterations.find(i=>i.status==='AWAITING_MANUAL_RESULT'),c=p.definition.executionContract||{};
    const terminal=['COMPLETED','STOPPED'].includes(p.status),runDisabled=(terminal||r.running)?'disabled':'',resources=p.definition.resourceReferences||[];
    const iterationEmpty=r.running?'در حال آماده‌سازی اولین مرحله…':'هنوز اجرایی شروع نشده است.';
    $('#main').innerHTML=`<section class="panel project-hero">
      <div class="section-head project-title-row"><div><span class="eyebrow">${esc(fa(profileFa,p.profile))}</span><h1>${esc(p.name)}</h1></div><span class="pill status-${p.status}">${esc(fa(statusFa,p.status))}</span></div>
      <p class="lead">${esc(p.definition.primaryGoal)}</p>

      <div class="project-summary">
        <div><span>خروجی</span><b>${esc(p.definition.targetOutcome||'—')}</b></div>
        <div><span>زمان / حلقه</span><b>${esc(c.estimatedTime||'—')} · ${esc(c.estimatedIterations||'—')} از ۱۳</b></div>
        <div><span>پوشه</span><b class="ltr-inline">${esc(p.workspacePath)}</b></div>
        <div><span>مانیتورینگ</span><b>${esc(c.monitoringPlan||'همین داشبورد؛ تازه‌سازی خودکار هر ۳ ثانیه')}</b></div>
        <div><span>منابع</span><b>${resources.length?resources.map(esc).join(' | '):'منبع اضافه‌ای ثبت نشده'}</b></div>
      </div>

      <div class="actions project-actions">
        <button class="primary" id="runLoop" ${runDisabled}>اجرای خودکار تا تکمیل</button>
        <button class="secondary" id="runOnce" ${runDisabled}>فقط یک مرحله</button>
        <button class="secondary" id="pause">مکث</button>
        <button class="danger" id="stop">توقف کامل</button>
      </div>

      <div class="field-head"><div><label for="directive">اصلاح مسیر / دستور جدید</label><span class="field-hint">هر نکته تازه وارد حافظه پروژه می‌شود.</span></div><button id="directiveVoiceBtn" class="voice-btn" type="button">🎙 گفتن · ۲۰ث</button></div>
      <div class="inline-form"><input id="directive" placeholder="مثال: از این مرحله به بعد خروجی DOCX هم داشته باشد"><button class="secondary" id="addDirective">افزودن</button></div>
      <div id="directiveVoiceStatus" class="voice-status"></div>
      ${awaiting?manualBox(awaiting):''}
    </section>

    <section class="panel">
      <h2>روند اجرا و بازبینی</h2>
      ${r.iterations.length?r.iterations.map(iterationHtml).join(''):`<p class="muted">${iterationEmpty}</p>`}
    </section>

    <details class="panel advanced project-advanced"><summary>تعریف کامل پروژه</summary><div class="advanced-body"><div class="advanced-block"><b>معیارهای موفقیت</b>${listHtml(p.definition.successCriteria)}</div><div class="advanced-block"><b>مراحل</b>${listHtml(p.definition.milestones)}</div><div class="advanced-block"><b>فرمت تحویل</b>${listHtml(p.definition.deliveryFormats)}</div></div></details>`;

    bindProjectActions(p,awaiting);
    bindVoice('#directiveVoiceBtn','#directive','#directiveVoiceStatus',20);
    if(awaiting)bindVoice('#manualVoiceBtn','#manualResult','#manualVoiceStatus',20);
  }catch(e){$('#main').innerHTML=`<div class="error">نمایش پروژه ممکن نشد: ${esc(e.message)}</div>`;}
}

function manualBox(i){
  return `<div class="manual-box"><h3>نتیجه اجرای دستی لازم است</h3><p class="muted">پرامپت را به اجراکننده بده و نتیجه واقعی را برگردان.</p><div class="prompt">${esc(i.executionPrompt)}</div><div class="field-head"><label for="manualResult">نتیجه اجراکننده</label><button id="manualVoiceBtn" class="voice-btn small" type="button">🎙 گفتن · ۲۰ث</button></div><textarea id="manualResult" rows="8"></textarea><div id="manualVoiceStatus" class="voice-status"></div><button id="submitManual" class="primary">ارسال برای بازبینی</button></div>`;
}
function iterationHtml(i){
  const score=i.reviewer?`<span class="score">${i.reviewer.score}</span>/100`:'',review=i.reviewer?` · ${esc(fa(reviewFa,i.reviewer.status))}`:'';
  return `<div class="iteration"><div class="iteration-head"><div><b>مرحله ${i.number}: ${esc(i.supervisor?.taskTitle||'اجرا')}</b><div class="muted">${esc(fa(statusFa,i.status))} · ${esc(fa(decisionFa,i.decision))}${review}</div></div><div>${score}</div></div>${i.supervisor?.reasoningSummary?`<p><b>هدف این مرحله:</b> ${esc(i.supervisor.reasoningSummary)}</p>`:''}${i.reviewer?`<p><b>بازبینی:</b> ${esc(i.reviewer.reasoningSummary)}</p><div class="muted"><b>بعدی:</b> ${esc(i.reviewer.recommendedNextAction)}</div>`:''}</div>`;
}
function bindProjectActions(p,awaiting){
  $('#runOnce').onclick=()=>action('run-once');$('#runLoop').onclick=()=>action('run-loop');$('#pause').onclick=()=>action('pause');$('#stop').onclick=()=>action('stop');
  $('#addDirective').onclick=async()=>{const text=$('#directive').value.trim();if(!text)return;await api(`/api/projects/${p.id}/directives`,{method:'POST',body:JSON.stringify({text})});$('#directive').value='';await renderProject();};
  if(awaiting)$('#submitManual').onclick=async()=>{const result=$('#manualResult').value.trim();if(!result)return;await api(`/api/projects/${p.id}/manual-result`,{method:'POST',body:JSON.stringify({result})});await renderProject();};
  async function action(name){try{await api(`/api/projects/${p.id}/${name}`,{method:'POST',body:'{}'});await renderProject();}catch(e){alert(`عملیات انجام نشد: ${e.message}`);}}
}

$('#newProjectBtn').onclick=newProject;
await Promise.all([refreshHealth(),refreshProjects()]);
newProject();
