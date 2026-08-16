const $ = s => document.querySelector(s);
let projects = [], currentId = null, poll = null;
let draftFlow = null;

const statusFa = {
  DRAFT:'پیش‌نویس', READY:'آماده', RUNNING:'در حال اجرا', PAUSED:'مکث', NEEDS_HUMAN:'منتظر تصمیم شما',
  COMPLETED:'تکمیل‌شده', BLOCKED:'مسدود', STOPPED:'متوقف‌شده', ERROR:'خطا', AWAITING_MANUAL_RESULT:'منتظر نتیجه دستی',
  PASSED:'تأییدشده', FAILED:'ردشده', INTERRUPTED:'قطع‌شده'
};
const profileFa = { coding:'نرم‌افزار / کدنویسی', writing:'نوشتن / کتاب / محتوا', research:'پژوهش / تحلیل', planning:'برنامه‌ریزی / طراحی مسیر', general:'عمومی / ترکیبی' };
const complexityFa = { low:'کم', medium:'متوسط', high:'زیاد', very_high:'خیلی زیاد' };
const feasibilityFa = { ready:'آماده اجرا', conditional:'آماده با شرط', blocked:'فعلاً متوقف' };
const decisionFa = {
  CONTINUE:'ادامه', PROJECT_COMPLETE:'پروژه کامل شد', NEEDS_HUMAN:'نیازمند تصمیم شما', NO_PROGRESS:'پیشرفت کافی نیست',
  MAX_ITERATIONS:'رسیدن به سقف حلقه', PAUSED:'مکث', STOPPED:'متوقف‌شده', ERROR:'خطا', EXECUTE:'اجرا', ASK_USER:'پرسش از شما', COMPLETE:'تکمیل'
};
const reviewFa = { PASS:'تأیید', FAIL:'رد', PARTIAL:'ناقص' };
const fa = (map, value) => map[value] || value || '—';

async function api(path, options={}){
  const res = await fetch(path,{headers:{'content-type':'application/json',...(options.headers||{})},...options});
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||`درخواست با خطای ${res.status} مواجه شد`);
  return body;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setBusy(el,busy,text){if(!el)return;el.classList.toggle('loading',busy);if(text){if(!el.dataset.original)el.dataset.original=el.textContent;el.textContent=busy?text:el.dataset.original;}}
function show(sel,cls,text){const el=$(sel);if(!el)return;el.className=cls;el.textContent=text;}
function listHtml(items){return (items||[]).length?`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">موردی ثبت نشده است.</p>';}

function bindVoice(buttonSelector,targetSelector,statusSelector,limitSeconds=30){
  const btn=$(buttonSelector),target=$(targetSelector),status=statusSelector?$(statusSelector):null;
  if(!btn||!target)return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){
    btn.classList.add('voice-unavailable');
    btn.onclick=()=>{const msg='ورودی صوتی در این مرورگر در دسترس نیست؛ فعلاً متن را تایپ کن.';if(status)status.textContent=msg;else alert(msg);};
    return;
  }

  let active=false,recognition=null,timer=null,deadline=0,base='',committed='',interim='',original=btn.textContent;
  const renderSpeech=()=>{target.value=[base,committed,interim].map(x=>x.trim()).filter(Boolean).join(' ');target.dispatchEvent(new Event('input',{bubbles:true}));};
  const remaining=()=>Math.max(0,Math.ceil((deadline-Date.now())/1000));
  const cleanup=(message='')=>{
    clearInterval(timer);timer=null;active=false;btn.classList.remove('listening');btn.textContent=original;
    if(status&&message)status.textContent=message;
  };
  const stopSession=(message)=>{
    active=false;
    try{recognition?.stop();}catch{}
    recognition=null;interim='';renderSpeech();cleanup(message);
  };
  const startPiece=()=>{
    if(!active||remaining()<=0){stopSession('۳۰ ثانیه تمام شد؛ متن ثبت شد. برای ادامه دوباره ضبط را بزن.');return;}
    const r=new Recognition();recognition=r;r.lang='fa-IR';r.interimResults=true;
    try{r.continuous=true;}catch{}
    r.onresult=e=>{
      let live='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        const text=e.results[i][0].transcript.trim();
        if(!text)continue;
        if(e.results[i].isFinal)committed=[committed,text].filter(Boolean).join(' ');else live=[live,text].filter(Boolean).join(' ');
      }
      interim=live;renderSpeech();
    };
    r.onerror=e=>{
      if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error))stopSession(`ضبط متوقف شد (${e.error}). دسترسی میکروفن را بررسی کن.`);
      else if(status&&e.error!=='aborted'&&e.error!=='no-speech')status.textContent=`ضبط موقتاً قطع شد (${e.error})؛ تا پایان زمان دوباره وصل می‌شود.`;
    };
    r.onend=()=>{
      recognition=null;interim='';renderSpeech();
      if(active&&remaining()>0)setTimeout(startPiece,120);
      else if(active)stopSession('۳۰ ثانیه تمام شد؛ متن ثبت شد. برای ادامه دوباره ضبط را بزن.');
    };
    try{r.start();}catch(error){stopSession(`شروع ضبط ممکن نشد: ${error.message}`);}
  };

  btn.onclick=()=>{
    if(active){stopSession('ضبط متوقف شد؛ متن ثبت‌شده قابل ویرایش است.');return;}
    base=target.value.trim();committed='';interim='';deadline=Date.now()+limitSeconds*1000;active=true;
    btn.classList.add('listening');
    const tick=()=>{const sec=remaining();btn.textContent=`■ پایان · ${sec}ث`;if(status)status.textContent=`در حال شنیدن… ${sec} ثانیه باقی مانده`;if(sec<=0)stopSession('۳۰ ثانیه تمام شد؛ متن ثبت شد. برای ادامه دوباره ضبط را بزن.');};
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
    $('#idea').value='می‌خواهم یک متن کاربردی فارسی تولید کنم که بعداً به صوت تبدیل شود. هنوز درباره طول متن، نوع صدا و اینکه خروجی برای استفاده شخصی است یا انتشار عمومی تصمیم قطعی ندارم.';
    $('#profileHint').value='';$('#workspacePath').value='';$('#webSearch').checked=false;
    show('#discovery','success','نمونه آماده شد. حالا «تصویر ایده» را بزن.');
  };
  bindVoice('#ideaVoiceBtn','#idea','#ideaVoiceStatus',30);
}

async function analyze(){
  const btn=$('#analyzeBtn'),description=$('#idea').value.trim();
  if(description.length<10)return show('#discovery','error','ایده را کمی کامل‌تر بگو.');
  setBusy(btn,true,'در حال ساخت تصویر…');show('#discovery','','');
  try{
    const profileHint=$('#profileHint').value,useWebSearch=$('#webSearch').checked;
    const r=await api('/api/discover',{method:'POST',body:JSON.stringify({description,profileHint,useWebSearch})});
    if(!r.discovery)throw new Error('پاسخ معمار پروژه ناقص بود');
    draftFlow={description,profileHint,useWebSearch,discovery:r.discovery,answers:{}};
    renderDiscovery(r.discovery);
  }catch(e){show('#discovery','error',`تصویر ایده کامل نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

function choiceSet(item,scope,index){
  const type=item.selectionMode==='multiple'?'checkbox':'radio';
  const selected=new Set(item.selectedOptionIds||[]);
  const choices=(item.options||[]).map(o=>`<label class="choice-option"><input type="${type}" name="${scope}_${index}" data-option-id="${esc(o.id)}" data-option-label="${esc(o.label)}" ${selected.has(o.id)?'checked':''}><span><b>${esc(o.label)}</b>${o.note?`<small>${esc(o.note)}</small>`:''}</span></label>`).join('');
  return `<div class="choice-grid">${choices}</div>`;
}
function detailsBox(kind,id,index,prompt='اگر نکته‌ای مانده، کوتاه اضافه کن.'){return `<button type="button" class="details-toggle" data-details-target="${kind}_details_${index}">+ توضیح بیشتر</button><div id="${kind}_details_${index}" class="details-wrap" hidden><div class="field-head compact"><span class="field-hint">${esc(prompt)}</span><button id="${kind}_voice_${index}" class="voice-btn small" type="button">🎙 توضیح صوتی</button></div><textarea rows="3" data-details-kind="${kind}" data-details-id="${esc(id)}" placeholder="اختیاری"></textarea><div id="${kind}_voice_status_${index}" class="voice-status"></div></div>`;}
function bindDetailsAndVoice(items,kind){
  document.querySelectorAll('.details-toggle').forEach(btn=>{if(btn.dataset.bound)return;btn.dataset.bound='1';btn.onclick=()=>{const box=document.getElementById(btn.dataset.detailsTarget);if(!box)return;box.hidden=!box.hidden;btn.textContent=box.hidden?'+ توضیح بیشتر':'− بستن توضیح';};});
  (items||[]).forEach((item,i)=>{if(item.allowDetails)bindVoice(`#${kind}_voice_${i}`,`#${kind}_details_${i} textarea`,`#${kind}_voice_status_${i}`,30);});
}

function renderDiscovery(d){
  const el=$('#discovery');
  const approaches=(d.possibleApproaches||[]).map(a=>`<div class="mini approach-card"><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p><p class="muted"><b>نکته:</b> ${esc(a.tradeoffs)}</p></div>`).join('');
  const facts=(d.facts||[]).map((f,i)=>`<div class="fact-card" data-fact-id="${esc(f.id)}"><div class="fact-head"><div><span class="source-badge ${f.source==='user_explicit'?'explicit':'inferred'}">${f.source==='user_explicit'?'از حرف تو':'برداشت معمار'}</span><h3>${esc(f.label)}</h3></div><span class="review-mark">قابل اصلاح</span></div><p class="muted">${esc(f.whyItMatters)}</p>${choiceSet(f,'fact',i)}${f.allowDetails?detailsBox('fact',f.id,i):''}</div>`).join('');
  const questions=(d.questions||[]).map((q,i)=>`<div class="question-card" data-question-id="${esc(q.id)}" data-required="${q.required?'1':'0'}"><div class="question-number">${i+1}</div><div class="question-body"><h3>${esc(q.question)}</h3><p class="muted">${esc(q.why)}</p>${choiceSet(q,'question',i)}${q.allowDetails?detailsBox('question',q.id,i,q.detailsPrompt):''}</div></div>`).join('');

  el.innerHTML=`<div class="panel nested discovery-panel">
    <div class="architect-banner compact-banner"><div class="architect-mark">۱</div><div><strong>تصویر ایده</strong><small>این برداشت اولیه است؛ هرجا اشتباه است همان‌جا عوضش کن.</small></div><span class="step-badge">مرحله ۱ از ۳</span></div>
    <div class="idea-picture-grid">
      <div class="mini emphasis"><span class="card-label">ایده</span><p>${esc(d.ideaEssence||d.understanding)}</p></div>
      <div class="mini"><span class="card-label">مسئله / فرصت</span><p>${esc(d.problemOrOpportunity)}</p></div>
      <div class="mini"><span class="card-label">خروجی محتمل</span><p>${esc(d.intendedProduct)}</p></div>
      <div class="mini"><span class="card-label">ارزش</span><p>${esc(d.valueProposition)}</p></div>
    </div>

    <div class="section-head"><div><span class="eyebrow">برداشت من از حرف تو</span><h2>این‌ها درست فهمیده شده؟</h2></div><span class="stage-state">گزینه‌ها قابل تغییرند</span></div>
    <div class="facts-grid">${facts}</div>

    ${approaches?`<h3 class="section-title">راه‌های محتمل</h3><div class="card-grid">${approaches}</div>`:''}
    <div class="mini summary-row"><span><b>ماهیت:</b> ${esc(fa(profileFa,d.suggestedProfile))}</span><span><b>پیچیدگی:</b> ${esc(fa(complexityFa,d.estimatedComplexity))}</span><span><b>حجم:</b> ${esc(d.estimatedWorkload)}</span></div>

    <div class="clarification-zone"><div class="section-head"><div><span class="eyebrow">مرحله ۲ · روشن‌سازی</span><h2>${questions?'چند تصمیم مانده':'ابهام مهمی نمانده'}</h2></div><span class="stage-state">کوتاه و گزینه‌ای</span></div><p class="lead">فقط جاهایی را می‌پرسیم که جوابشان روی مسیر، خروجی، پیش‌نیاز یا ریسک پروژه اثر دارد.</p>${questions||'<div class="success">برداشت اولیه روشن است؛ می‌توانی مستقیم نقشه و قرارداد اجرا را بسازی.</div>'}<button id="refineBtn" class="primary large">ساخت نسخه پخته و قرارداد اجرا</button><div id="refineError"></div></div>
  </div>`;

  bindDetailsAndVoice(d.facts,'fact');bindDetailsAndVoice(d.questions,'question');
  $('#refineBtn').onclick=()=>refineIdea();
}

function collectReviewedAnswers(){
  const answers={};
  for(const card of document.querySelectorAll('.fact-card')){
    const id=card.dataset.factId,selected=[...card.querySelectorAll('input:checked')].map(x=>x.dataset.optionLabel),details=card.querySelector('textarea')?.value.trim()||'';
    if(!selected.length&&!details)throw new Error('برای هر برداشت، گزینه درست را مشخص کن یا توضیح اصلاحی بده.');
    answers[`fact:${id}`]=[selected.join('، '),details?`توضیح: ${details}`:''].filter(Boolean).join(' | ');
  }
  for(const card of document.querySelectorAll('.question-card')){
    const id=card.dataset.questionId,required=card.dataset.required==='1',selected=[...card.querySelectorAll('input:checked')].map(x=>x.dataset.optionLabel),details=card.querySelector('textarea')?.value.trim()||'';
    if(required&&!selected.length&&!details)throw new Error('به سؤال‌های ضروری پاسخ بده؛ انتخاب یک گزینه کافی است.');
    if(selected.length||details)answers[id]=[selected.join('، '),details?`توضیح: ${details}`:''].filter(Boolean).join(' | ');
  }
  return answers;
}

async function refineIdea(extraFeedback=''){
  const btn=$('#refineBtn')||$('#revisePlanBtn');if(!draftFlow)return;
  let answers;
  try{answers={...draftFlow.answers,...collectReviewedAnswers()};}catch(e){show('#refineError','error',e.message);return;}
  if(extraFeedback.trim())answers._final_feedback=extraFeedback.trim();
  setBusy(btn,true,'در حال پخته‌سازی…');show('#refineError','','');
  try{
    const r=await api('/api/refine',{method:'POST',body:JSON.stringify({description:draftFlow.description,discovery:draftFlow.discovery,answers,profileHint:draftFlow.profileHint,useWebSearch:draftFlow.useWebSearch})});
    if(!r.maturation)throw new Error('قرارداد اجرا دریافت نشد');
    draftFlow.answers=answers;draftFlow.maturation=r.maturation;draftFlow.maxLoopIterations=r.maxLoopIterations||13;
    renderMaturation(r.maturation);
  }catch(e){show('#refineError','error',`پخته‌سازی کامل نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

function riskFallbackHtml(items){return (items||[]).length?items.map(x=>`<div class="risk-row"><div><b>${esc(x.risk)}</b><span>${esc(x.impact)}</span></div><p><b>راه جایگزین:</b> ${esc(x.fallback)}</p></div>`).join(''):'<p class="muted">ریسک مهمی ثبت نشده است.</p>';}
function renderMaturation(m){
  const d=draftFlow.discovery,def=m.finalDefinition||{},c=m.executionContract||{};
  const stages=(m.executionStages||[]).map((s,i)=>`<div class="stage-card"><div class="stage-index">${i+1}</div><div><h3>${esc(s.title)}</h3><p>${esc(s.purpose)}</p><div class="stage-output"><b>خروجی:</b> ${(s.outputs||[]).map(esc).join('، ')||'—'}</div><div class="done-when"><b>پایان فاز:</b> ${esc(s.doneWhen)}</div></div></div>`).join('');
  const formats=(m.recommendedDeliveryFormats||def.deliveryFormats||[]).map(x=>`<span class="format-chip">${esc(x)}</span>`).join('');
  const unresolved=def.humanDecisionsRequired||[],blocked=c.feasibility==='blocked'||unresolved.length>0;
  const el=$('#discovery');
  el.innerHTML=`<div class="panel nested maturation-panel">
    <div class="architect-banner success-banner"><div class="architect-mark">✓</div><div><strong>نسخه پخته آماده است</strong><small>قبل از اجرا، هدف و قرارداد را یک‌بار ببین.</small></div><span class="step-badge">مرحله ۳ از ۳</span></div>

    <div class="mature-idea"><span class="eyebrow">پروژه نهایی · ${esc(fa(profileFa,m.finalProfile||d.suggestedProfile))}</span><h2>${esc(def.name||d.suggestedProjectType)}</h2><p class="lead strong-lead">${esc(m.clarifiedIdea)}</p></div>
    <div class="idea-picture-grid"><div class="mini emphasis"><span class="card-label">خروجی نهایی</span><p>${esc(m.productDefinition)}</p></div><div class="mini"><span class="card-label">ارزش</span><p>${esc(m.valueProposition)}</p></div><div class="mini"><span class="card-label">اثر مورد انتظار</span><p>${esc(m.desiredImpact)}</p></div><div class="mini"><span class="card-label">مسیر پیشنهادی</span><p><b>${esc(m.recommendedApproach?.name)}</b><br>${esc(m.recommendedApproach?.why)}</p></div></div>

    <div class="contract-head"><div><span class="eyebrow">قرارداد اجرا</span><h2>اگر تأیید کنی، مبنای کار این است</h2></div><span class="feasibility feasibility-${esc(c.feasibility||'conditional')}">${esc(fa(feasibilityFa,c.feasibility))}</span></div>
    <p class="lead">${esc(c.feasibilitySummary||'—')}</p>
    <div class="contract-metrics"><div><span>برآورد حلقه</span><b>${esc(c.estimatedIterations||'—')} از ۱۳</b></div><div><span>برآورد زمان</span><b>${esc(c.estimatedTime||'—')}</b></div><div><span>کیفیت هدف</span><b>۹۰ / ۱۰۰</b></div></div>
    <div class="split-grid"><div class="mini list-card"><span class="card-label">چیزهایی که برای اجرا لازم است</span>${listHtml(c.requiredInputs)}</div><div class="mini list-card"><span class="card-label">فرض‌های زمانی</span>${listHtml(c.timeAssumptions)}</div></div>
    <div class="split-grid"><div class="mini list-card"><span class="card-label">تعهد مغز پروژه</span>${listHtml(c.systemCommitments)}</div><div class="mini list-card"><span class="card-label">چیزهایی که از تو لازم است</span>${listHtml(c.userCommitments)}</div></div>
    ${(c.rightsAndPermissionChecks||[]).length?`<div class="mini list-card rights-card"><span class="card-label">حق استفاده / رضایت / حریم خصوصی</span>${listHtml(c.rightsAndPermissionChecks)}</div>`:''}
    ${(c.externalCosts||[]).length?`<div class="mini list-card"><span class="card-label">هزینه‌های بیرونی احتمالی</span>${listHtml(c.externalCosts)}</div>`:''}

    <div class="section-head"><div><span class="eyebrow">نقشه اجرا</span><h2>فازهای کار</h2></div><span class="stage-state">${(m.executionStages||[]).length} فاز · سقف ۱۳ حلقه</span></div><div class="stages">${stages}</div>
    <div class="delivery-box"><div><span class="card-label">فرمت تحویل</span><div class="format-list">${formats||'<span class="format-chip">براساس پروژه</span>'}</div></div><div><span class="card-label">راهبرد اجرا</span><p>${esc(def.executionStrategy||'—')}</p></div></div>

    <div class="split-grid"><div class="mini list-card"><span class="card-label">نقاط بازبینی</span>${listHtml(c.reviewCheckpoints)}</div><div class="mini list-card"><span class="card-label">کجا باید مکث کنیم؟</span>${listHtml(c.stopConditions)}</div></div>
    <div class="risk-box"><span class="card-label">ریسک‌ها و راه جایگزین</span>${riskFallbackHtml(c.risksAndFallbacks)}</div>
    ${unresolved.length?`<div class="warning"><b>هنوز تصمیم باز داریم:</b>${listHtml(unresolved)}</div>`:''}

    <div class="final-feedback"><div class="field-head"><div><label for="finalFeedback">اصلاح نهایی <span class="optional">اختیاری</span></label><span class="field-hint">اگر چیزی را اشتباه فهمیده‌ایم یا می‌خواهی شرطی عوض شود، همین‌جا بگو.</span></div><button id="finalVoiceBtn" class="voice-btn" type="button">🎙 گفتن اصلاح · ۳۰ث</button></div><textarea id="finalFeedback" rows="4" placeholder="مثال: خروجی فقط برای استفاده شخصی است و صدای خودم استفاده می‌شود…"></textarea><div id="finalVoiceStatus" class="voice-status"></div><button id="revisePlanBtn" class="secondary">بازسازی قرارداد</button><div id="refineError"></div></div>

    <details class="advanced"><summary>ویرایش فنی تعریف پروژه</summary><textarea id="definitionJson" class="json-editor" rows="24">${esc(JSON.stringify(def,null,2))}</textarea></details>
    <div class="grid2 final-settings"><div><label>اجراکننده</label><select id="executorMode"><option value="codex">Codex — اجرای خودکار</option><option value="manual">دستی — انتقال پرامپت</option></select></div><div><label>حداقل امتیاز کیفیت</label><input id="quality" type="number" min="1" max="100" value="90"></div></div>
    <div class="loop-note"><b>حداکثر ۱۳ حلقه</b><span>اگر پروژه زودتر کامل شود، همان‌جا متوقف می‌شود.</span></div>
    <button id="createProjectBtn" class="primary large final-create" ${blocked?'disabled':''}>${blocked?'اول تصمیم‌های باز را اصلاح کن':'تأیید قرارداد و ساخت پروژه'}</button><div id="createError"></div>
  </div>`;

  bindVoice('#finalVoiceBtn','#finalFeedback','#finalVoiceStatus',30);
  $('#revisePlanBtn').onclick=()=>{const feedback=$('#finalFeedback').value.trim();if(!feedback)return show('#refineError','error','اصلاح موردنظر را بنویس یا بگو.');refineIdea(feedback);};
  $('#createProjectBtn').onclick=createApprovedProject;
}

async function createApprovedProject(){
  const btn=$('#createProjectBtn');setBusy(btn,true,'در حال ساخت پروژه…');
  try{
    const definition=JSON.parse($('#definitionJson').value);definition.executionContract=draftFlow.maturation?.executionContract;
    const finalProfile=draftFlow.maturation?.finalProfile||draftFlow.discovery.suggestedProfile;
    const created=await api('/api/projects',{method:'POST',body:JSON.stringify({description:draftFlow.description,definition,profile:finalProfile,workspacePath:$('#workspacePath').value,executorMode:$('#executorMode').value,minQualityScore:Number($('#quality').value),maxIterations:13})});
    await refreshProjects();openProject(created.project.id);
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
    const terminal=['COMPLETED','STOPPED'].includes(p.status),disabled=terminal?'disabled':'',formats=(p.definition.deliveryFormats||[]).map(x=>`<span class="format-chip">${esc(x)}</span>`).join('');
    $('#main').innerHTML=`<section class="panel project-hero"><div class="section-head project-title-row"><div><span class="eyebrow">${esc(fa(profileFa,p.profile))}</span><h1>${esc(p.name)}</h1></div><span class="pill status-${p.status}">${esc(fa(statusFa,p.status))}</span></div><p class="lead">${esc(p.definition.primaryGoal)}</p><div class="actions project-actions"><button class="primary" id="runOnce" ${disabled}>اجرای یک مرحله</button><button class="primary" id="runLoop" ${disabled}>اجرای خودکار تا تکمیل</button><button class="secondary" id="pause">مکث</button><button class="danger" id="stop">توقف کامل</button></div><div class="card-grid project-facts"><div class="mini"><span class="card-label">پوشه کاری</span><p class="ltr path">${esc(p.workspacePath)}</p></div><div class="mini"><span class="card-label">اجراکننده</span><p>${p.executorMode==='codex'?'Codex خودکار':'اجرای دستی'}</p></div><div class="mini"><span class="card-label">کیفیت و حلقه</span><p>${p.minQualityScore}/100 · حداکثر ${p.maxIterations} تکرار</p></div></div><div class="delivery-box compact-delivery"><div><span class="card-label">فرمت تحویل</span><div class="format-list">${formats||'<span class="format-chip">براساس تعریف پروژه</span>'}</div></div><div><span class="card-label">راهبرد</span><p>${esc(p.definition.executionStrategy||'براساس تعریف پروژه')}</p></div></div><div class="field-head"><div><label for="directive">اصلاح مسیر / دستور جدید</label><span class="field-hint">هر نکته تازه وارد حافظه پروژه می‌شود.</span></div><button id="directiveVoiceBtn" class="voice-btn" type="button">🎙 گفتن دستور · ۳۰ث</button></div><div class="inline-form"><input id="directive" placeholder="مثال: خروجی نهایی DOCX هم داشته باشد"><button class="secondary" id="addDirective">افزودن</button></div><div id="directiveVoiceStatus" class="voice-status"></div>${awaiting?manualBox(awaiting):''}</section>
    <section class="panel"><h2>تعریف پروژه</h2><div class="idea-picture-grid"><div class="mini emphasis"><span class="card-label">ایده</span><p>${esc(p.definition.coreIdea||p.definition.vision)}</p></div><div class="mini"><span class="card-label">خروجی</span><p>${esc(p.definition.targetOutcome)}</p></div><div class="mini"><span class="card-label">ارزش</span><p>${esc(p.definition.valueProposition||'—')}</p></div><div class="mini"><span class="card-label">اثر</span><p>${esc(p.definition.desiredImpact||'—')}</p></div></div>${c.estimatedTime?`<div class="contract-metrics compact-metrics"><div><span>برآورد زمان</span><b>${esc(c.estimatedTime)}</b></div><div><span>برآورد حلقه</span><b>${esc(c.estimatedIterations)} از ۱۳</b></div><div><span>وضعیت</span><b>${esc(fa(feasibilityFa,c.feasibility))}</b></div></div>`:''}<div class="mini list-card"><span class="card-label">معیارهای موفقیت</span>${listHtml(p.definition.successCriteria)}</div></section>
    <section class="panel"><h2>روند اجرا و بازبینی</h2>${r.iterations.length?r.iterations.map(iterationHtml).join(''):'<p class="muted">هنوز اجرایی شروع نشده است. «اجرای خودکار تا تکمیل» را بزن تا Supervisor مرحله بعدی را تعیین کند.</p>'}</section>`;
    bindProjectActions(p,awaiting);bindVoice('#directiveVoiceBtn','#directive','#directiveVoiceStatus',30);if(awaiting)bindVoice('#manualVoiceBtn','#manualResult','#manualVoiceStatus',30);
  }catch(e){$('#main').innerHTML=`<div class="error">نمایش پروژه ممکن نشد: ${esc(e.message)}</div>`;}
}

function manualBox(i){return `<div class="mini manual-box"><h3>نتیجه اجرای دستی لازم است</h3><p>پرامپت را به اجراکننده بده و نتیجه واقعی را برگردان.</p><div class="prompt">${esc(i.executionPrompt)}</div><div class="field-head"><label for="manualResult">نتیجه اجراکننده</label><button id="manualVoiceBtn" class="voice-btn small" type="button">🎙 گفتن نتیجه · ۳۰ث</button></div><textarea id="manualResult" rows="9"></textarea><div id="manualVoiceStatus" class="voice-status"></div><button id="submitManual" class="primary">ارسال برای بازبینی</button></div>`;}
function iterationHtml(i){
  const score=i.reviewer?`<span class="score">${i.reviewer.score}</span>/100`:'',review=i.reviewer?` · ${esc(fa(reviewFa,i.reviewer.status))}`:'';
  return `<div class="iteration"><div class="iteration-head"><div><b>مرحله ${i.number}: ${esc(i.supervisor?.taskTitle||'اجرا')}</b><div class="muted">${esc(fa(statusFa,i.status))} · ${esc(fa(decisionFa,i.decision))}${review}</div></div><div>${score}</div></div>${i.supervisor?.reasoningSummary?`<p><b>چرا این مرحله؟</b> ${esc(i.supervisor.reasoningSummary)}</p>`:''}${i.reviewer?`<p><b>جمع‌بندی بازبین:</b> ${esc(i.reviewer.reasoningSummary)}</p><div class="muted"><b>اقدام بعدی:</b> ${esc(i.reviewer.recommendedNextAction)}</div>`:''}</div>`;
}
function bindProjectActions(p,awaiting){
  $('#runOnce').onclick=()=>action('run-once');$('#runLoop').onclick=()=>action('run-loop');$('#pause').onclick=()=>action('pause');$('#stop').onclick=()=>action('stop');
  $('#addDirective').onclick=async()=>{const text=$('#directive').value.trim();if(!text)return;await api(`/api/projects/${p.id}/directives`,{method:'POST',body:JSON.stringify({text})});$('#directive').value='';await renderProject();};
  if(awaiting)$('#submitManual').onclick=async()=>{const result=$('#manualResult').value.trim();if(!result)return;await api(`/api/projects/${p.id}/manual-result`,{method:'POST',body:JSON.stringify({result})});await renderProject();};
  async function action(name){try{await api(`/api/projects/${p.id}/${name}`,{method:'POST',body:'{}'});await renderProject();}catch(e){alert(`عملیات انجام نشد: ${e.message}`);}}
}

$('#newProjectBtn').onclick=newProject;
await Promise.all([refreshHealth(),refreshProjects()]);newProject();
