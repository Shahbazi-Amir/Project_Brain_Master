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
const decisionFa = {
  CONTINUE:'ادامه', PROJECT_COMPLETE:'پروژه کامل شد', NEEDS_HUMAN:'نیازمند تصمیم شما', NO_PROGRESS:'پیشرفت کافی نیست',
  MAX_ITERATIONS:'رسیدن به سقف حلقه', PAUSED:'مکث', STOPPED:'متوقف‌شده', ERROR:'خطا', EXECUTE:'اجرا', ASK_USER:'پرسش از شما', COMPLETE:'تکمیل'
};
const reviewFa = { PASS:'تأیید', FAIL:'رد', PARTIAL:'ناقص' };
const fa = (map, value) => map[value] || value || '—';

async function api(path, options={}){
  const res = await fetch(path,{headers:{"content-type":"application/json",...(options.headers||{})},...options});
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||`درخواست با خطای ${res.status} مواجه شد`);
  return body;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setBusy(el,busy,text){if(!el)return;el.classList.toggle('loading',busy);if(text){if(!el.dataset.original)el.dataset.original=el.textContent;el.textContent=busy?text:el.dataset.original;}}
function show(sel,cls,text){const el=$(sel);if(!el)return;el.className=cls;el.textContent=text;}
function listHtml(items){return (items||[]).length?`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">موردی ثبت نشده است.</p>';}

function bindVoice(buttonSelector,targetSelector,statusSelector){
  const btn=$(buttonSelector),target=$(targetSelector),status=statusSelector?$(statusSelector):null;
  if(!btn||!target)return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){
    btn.classList.add('voice-unavailable');
    btn.onclick=()=>{const msg='ورودی صوتی در این مرورگر در دسترس نیست؛ فعلاً متن را تایپ کن.';if(status)status.textContent=msg;else alert(msg);};
    return;
  }
  let recognition=null;
  btn.onclick=()=>{
    if(recognition){recognition.stop();return;}
    recognition=new Recognition();recognition.lang='fa-IR';recognition.interimResults=true;recognition.continuous=false;
    const base=target.value.trim(),original=btn.textContent;let hadError=false;
    recognition.onstart=()=>{btn.classList.add('listening');btn.textContent='■ پایان';if(status)status.textContent='در حال شنیدن…';};
    recognition.onresult=e=>{let transcript='';for(let i=0;i<e.results.length;i++)transcript+=e.results[i][0].transcript;const spoken=transcript.trim();target.value=[base,spoken].filter(Boolean).join(base&&spoken?' ':'');target.dispatchEvent(new Event('input',{bubbles:true}));};
    recognition.onerror=e=>{hadError=true;if(status)status.textContent=`ضبط کامل نشد (${e.error}). دوباره امتحان کن یا تایپ کن.`;};
    recognition.onend=()=>{btn.classList.remove('listening');btn.textContent=original;recognition=null;if(status&&!hadError&&target.value.trim())status.textContent='متن صوتی ثبت شد و قابل ویرایش است.';};
    try{recognition.start();}catch(error){recognition=null;btn.classList.remove('listening');btn.textContent=original;if(status)status.textContent=`شروع ضبط ممکن نشد: ${error.message}`;}
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
    $('#idea').value='می‌خواهم یک نمونه بسیار ساده داشته باشم که عبارت Hello Project Brain را به شکل یک خروجی واقعی ذخیره کند، اما هنوز درباره نوع دقیق خروجی تصمیم نگرفته‌ام.';
    $('#profileHint').value='';$('#workspacePath').value='';$('#webSearch').checked=false;
    show('#discovery','success','نمونه آماده شد. حالا «تصویر کردن ایده» را بزن.');
  };
  bindVoice('#ideaVoiceBtn','#idea','#ideaVoiceStatus');
}

async function analyze(){
  const btn=$('#analyzeBtn'),description=$('#idea').value.trim();
  if(description.length<10)return show('#discovery','error','ایده هنوز خیلی کوتاه است؛ یک یا دو جمله درباره چیزی که می‌خواهی به آن برسی اضافه کن.');
  setBusy(btn,true,'در حال تصویر کردن ایده…');show('#discovery','','');
  try{
    const profileHint=$('#profileHint').value,useWebSearch=$('#webSearch').checked;
    const r=await api('/api/discover',{method:'POST',body:JSON.stringify({description,profileHint,useWebSearch})});
    if(!r.discovery)throw new Error('پاسخ معمار پروژه ناقص بود');
    draftFlow={description,profileHint,useWebSearch,discovery:r.discovery,answers:{}};
    renderDiscovery(r.discovery);
  }catch(e){show('#discovery','error',`تصویر ایده کامل نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

function renderDiscovery(d){
  const el=$('#discovery');
  const approaches=(d.possibleApproaches||[]).map(a=>`<div class="mini approach-card"><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p><p class="muted"><b>نکته:</b> ${esc(a.tradeoffs)}</p></div>`).join('');
  const questions=(d.questions||[]).map((q,i)=>`<div class="question-card">
    <div class="question-number">${i+1}</div>
    <div class="question-body"><h3>${esc(q.question)}</h3><p class="muted">چرا مهم است؟ ${esc(q.why)}</p><p class="answer-hint">${esc(q.answerHint||'پاسخ کوتاه کافی است؛ اگر مطمئن نیستی بنویس: پیشنهاد بده')}</p>
      <div class="field-head compact"><label for="answer_${i}">پاسخ شما</label><button class="voice-btn small" id="voice_${i}" type="button">🎙 گفتن پاسخ</button></div>
      <textarea id="answer_${i}" rows="3" data-question-id="${esc(q.id)}" placeholder="پاسخ بده یا بنویس: پیشنهاد بده"></textarea>
      <div class="question-actions"><button type="button" class="text-btn suggest-btn" data-target="answer_${i}">پیشنهاد بده</button></div>
      <div id="voiceStatus_${i}" class="voice-status"></div>
    </div>
  </div>`).join('');

  el.innerHTML=`<div class="panel nested discovery-panel">
    <div class="architect-banner compact-banner"><div class="architect-mark">۱</div><div><strong>تصویر ایده آماده شد</strong><small>هنوز چیزی اجرا نشده؛ فقط برداشت اولیه را با تو چک می‌کنیم.</small></div><span class="step-badge">مرحله ۱ از ۳</span></div>
    <div class="idea-picture-grid">
      <div class="mini emphasis"><span class="card-label">ماحصل ایده</span><p>${esc(d.ideaEssence||d.understanding)}</p></div>
      <div class="mini"><span class="card-label">مسئله یا فرصت اصلی</span><p>${esc(d.problemOrOpportunity)}</p></div>
      <div class="mini"><span class="card-label">محصول / خروجی محتمل</span><p>${esc(d.intendedProduct)}</p></div>
      <div class="mini"><span class="card-label">ارزشی که ایجاد می‌کند</span><p>${esc(d.valueProposition)}</p></div>
      <div class="mini"><span class="card-label">اثر مطلوب</span><p>${esc(d.desiredImpact)}</p></div>
      <div class="mini"><span class="card-label">ماهیت پروژه</span><p>${esc(fa(profileFa,d.suggestedProfile))} · ${esc(d.suggestedProjectType)}</p></div>
    </div>

    ${approaches?`<h3 class="section-title">راه‌هایی که می‌شود به نتیجه رسید</h3><div class="card-grid">${approaches}</div>`:''}
    <div class="mini list-card"><span class="card-label">فرض‌هایی که فعلاً کرده‌ایم</span>${listHtml(d.keyAssumptions)}</div>
    <div class="mini summary-row"><span><b>پیچیدگی:</b> ${esc(fa(complexityFa,d.estimatedComplexity))}</span><span><b>حجم کار:</b> ${esc(d.estimatedWorkload)}</span><span><b>نیاز به پژوهش:</b> ${d.researchNeeded?'بله':'فعلاً نه'}</span></div>

    <div class="clarification-zone">
      <div class="section-head"><div><span class="eyebrow">مرحله ۲ · پخته‌سازی</span><h2>قبل از اجرا، این چند تصمیم را روشن کنیم</h2></div><span class="stage-state">پاسخ شما لازم است</span></div>
      <p class="lead">این سؤال‌ها برای فرم‌پرکنی نیستند؛ فقط چیزهایی هستند که جوابشان می‌تواند مسیر پروژه را عوض کند.</p>
      ${questions||'<div class="success">ابهام مهمی پیدا نشد. برای تأیید برداشت اولیه، در کادر زیر بنویس «همین درست است».</div><textarea id="fallbackAnswer" rows="3" data-question-id="confirmation" placeholder="همین درست است / یا اصلاح موردنظر را بنویس"></textarea>'}
      <button id="refineBtn" class="primary large">پخته‌سازی ایده و ساخت نقشه اجرا</button>
      <div id="refineError"></div>
    </div>
  </div>`;

  (d.questions||[]).forEach((q,i)=>bindVoice(`#voice_${i}`,`#answer_${i}`,`#voiceStatus_${i}`));
  document.querySelectorAll('.suggest-btn').forEach(btn=>btn.onclick=()=>{const target=document.getElementById(btn.dataset.target);if(target){target.value='پیشنهاد بده';}});
  $('#refineBtn').onclick=refineIdea;
}

async function refineIdea(extraFeedback=''){
  const btn=$('#refineBtn')||$('#revisePlanBtn');if(!draftFlow)return;
  const answers={...draftFlow.answers};
  const fields=[...document.querySelectorAll('[data-question-id]')];
  for(const field of fields){const value=field.value.trim();if(!value){show('#refineError','error','برای همه سؤال‌های مرحله روشن‌سازی پاسخ بده؛ اگر جواب قطعی نداری بنویس «پیشنهاد بده».');return;}answers[field.dataset.questionId]=value;}
  if(extraFeedback.trim())answers._final_feedback=extraFeedback.trim();
  setBusy(btn,true,'در حال پخته‌سازی…');show('#refineError','','');
  try{
    const r=await api('/api/refine',{method:'POST',body:JSON.stringify({description:draftFlow.description,discovery:draftFlow.discovery,answers,profileHint:draftFlow.profileHint,useWebSearch:draftFlow.useWebSearch})});
    if(!r.maturation)throw new Error('نقشه نهایی دریافت نشد');
    draftFlow.answers=answers;draftFlow.maturation=r.maturation;draftFlow.maxLoopIterations=r.maxLoopIterations||13;
    renderMaturation(r.maturation);
  }catch(e){show('#refineError','error',`پخته‌سازی کامل نشد: ${e.message}`);}finally{setBusy(btn,false);}
}

function renderMaturation(m){
  const d=draftFlow.discovery,def=m.finalDefinition||{};
  const stages=(m.executionStages||[]).map((s,i)=>`<div class="stage-card"><div class="stage-index">${i+1}</div><div><h3>${esc(s.title)}</h3><p>${esc(s.purpose)}</p><div class="stage-output"><b>خروجی:</b> ${(s.outputs||[]).map(esc).join('، ')||'—'}</div><div class="done-when"><b>تمام‌شده وقتی:</b> ${esc(s.doneWhen)}</div></div></div>`).join('');
  const formats=(m.recommendedDeliveryFormats||def.deliveryFormats||[]).map(x=>`<span class="format-chip">${esc(x)}</span>`).join('');
  const unresolved=(def.humanDecisionsRequired||[]);
  const el=$('#discovery');
  el.innerHTML=`<div class="panel nested maturation-panel">
    <div class="architect-banner success-banner"><div class="architect-mark">✓</div><div><strong>ایده پخته شد</strong><small>حالا می‌توانی قبل از ساخت پروژه، تعریف نهایی و مسیر اجرا را ببینی و اصلاح کنی.</small></div><span class="step-badge">مرحله ۳ از ۳</span></div>

    <div class="mature-idea"><span class="eyebrow">نسخه پخته‌شده ایده · ${esc(fa(profileFa,m.finalProfile||d.suggestedProfile))}</span><h2>${esc(def.name||d.suggestedProjectType)}</h2><p class="lead strong-lead">${esc(m.clarifiedIdea)}</p></div>

    <div class="idea-picture-grid">
      <div class="mini emphasis"><span class="card-label">محصول / خروجی نهایی</span><p>${esc(m.productDefinition)}</p></div>
      <div class="mini"><span class="card-label">ارزش اصلی</span><p>${esc(m.valueProposition)}</p></div>
      <div class="mini"><span class="card-label">اثر مورد انتظار</span><p>${esc(m.desiredImpact)}</p></div>
      <div class="mini"><span class="card-label">پیشنهاد معمار</span><p><b>${esc(m.recommendedApproach?.name)}</b><br>${esc(m.recommendedApproach?.why)}</p></div>
    </div>

    <div class="split-grid">
      <div class="mini list-card"><span class="card-label">چه چیزهایی نسبت به برداشت اول روشن‌تر شد؟</span>${listHtml(m.whatChanged)}</div>
      <div class="mini list-card"><span class="card-label">تصمیم‌های تثبیت‌شده</span>${listHtml(m.resolvedDecisions)}</div>
    </div>

    <div class="section-head"><div><span class="eyebrow">نقشه اجرا</span><h2>پیشنهاد من برای اجرای پروژه</h2></div><span class="stage-state">${(m.executionStages||[]).length} فاز پروژه · تا ${draftFlow.maxLoopIterations||13} تکرار خودکار</span></div>
    <p class="lead">فازهای زیر ساختار پروژه‌اند؛ حلقه‌ی Supervisor/Executor/Reviewer در صورت نیاز تا سقف ۱۳ بار جلو می‌رود، اما اگر کار زودتر کامل شود همان‌جا متوقف می‌شود.</p>
    <div class="stages">${stages}</div>

    <div class="delivery-box"><div><span class="card-label">فرمت‌های پیشنهادی تحویل</span><div class="format-list">${formats||'<span class="format-chip">براساس پروژه</span>'}</div></div><div><span class="card-label">راهبرد اجرا</span><p>${esc(def.executionStrategy||'—')}</p></div></div>
    <div class="mini list-card"><span class="card-label">ریسک‌ها / جاهایی که باید حواسمان باشد</span>${listHtml(m.executionRisks)}</div>
    ${unresolved.length?`<div class="warning"><b>یک نکته هنوز تصمیم می‌خواهد:</b>${listHtml(unresolved)}<span>می‌توانی پایین اصلاح نهایی را بگویی تا نقشه دوباره ساخته شود.</span></div>`:''}

    <div class="final-feedback">
      <div class="field-head"><div><label for="finalFeedback">اصلاح نهایی قبل از اجرا <span class="optional">اختیاری</span></label><span class="field-hint">اگر چیزی را اشتباه فهمیده‌ایم، همین‌جا بگو.</span></div><button id="finalVoiceBtn" class="voice-btn" type="button">🎙 گفتن اصلاح</button></div>
      <textarea id="finalFeedback" rows="4" placeholder="مثال: خروجی نهایی باید DOCX باشد و لحن رسمی نباشد…"></textarea><div id="finalVoiceStatus" class="voice-status"></div>
      <button id="revisePlanBtn" class="secondary">اعمال اصلاح و بازسازی نقشه</button><div id="refineError"></div>
    </div>

    <details class="advanced"><summary>مشاهده / ویرایش فنی تعریف نهایی پروژه</summary><textarea id="definitionJson" class="json-editor" rows="24">${esc(JSON.stringify(def,null,2))}</textarea></details>

    <div class="grid2 final-settings">
      <div><label>اجراکننده</label><select id="executorMode"><option value="codex">Codex — اجرای خودکار</option><option value="manual">دستی — انتقال پرامپت به ChatGPT/Work</option></select></div>
      <div><label>حداقل امتیاز کیفیت</label><input id="quality" type="number" min="1" max="100" value="90"></div>
    </div>
    <div class="loop-note"><b>سقف حلقه خودکار: ۱۳</b><span>این سقف است، نه اجبار به ۱۳ اجرا. پروژه کوچک به‌محض تکمیل متوقف می‌شود.</span></div>
    <button id="createProjectBtn" class="primary large final-create">تأیید ایده پخته و ساخت پروژه</button><div id="createError"></div>
  </div>`;

  bindVoice('#finalVoiceBtn','#finalFeedback','#finalVoiceStatus');
  $('#revisePlanBtn').onclick=()=>{const feedback=$('#finalFeedback').value.trim();if(!feedback)return show('#refineError','error','اصلاحی که می‌خواهی اعمال شود را بنویس یا با صدا بگو.');refineIdea(feedback);};
  $('#createProjectBtn').onclick=createApprovedProject;
}

async function createApprovedProject(){
  const btn=$('#createProjectBtn');setBusy(btn,true,'در حال ساخت پروژه…');
  try{
    const definition=JSON.parse($('#definitionJson').value);
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
    const r=await api(`/api/projects/${currentId}`),p=r.project,awaiting=r.iterations.find(i=>i.status==='AWAITING_MANUAL_RESULT');
    const terminal=['COMPLETED','STOPPED'].includes(p.status),disabled=terminal?'disabled':'';
    const formats=(p.definition.deliveryFormats||[]).map(x=>`<span class="format-chip">${esc(x)}</span>`).join('');
    $('#main').innerHTML=`<section class="panel project-hero">
      <div class="section-head project-title-row"><div><span class="eyebrow">${esc(fa(profileFa,p.profile))}</span><h1>${esc(p.name)}</h1></div><span class="pill status-${p.status}">${esc(fa(statusFa,p.status))}</span></div>
      <p class="lead">${esc(p.definition.primaryGoal)}</p>
      <div class="actions project-actions"><button class="primary" id="runOnce" ${disabled}>اجرای یک مرحله</button><button class="primary" id="runLoop" ${disabled}>اجرای خودکار تا تکمیل</button><button class="secondary" id="pause">مکث</button><button class="danger" id="stop">توقف کامل</button></div>
      <div class="card-grid project-facts"><div class="mini"><span class="card-label">پوشه کاری</span><p class="ltr path">${esc(p.workspacePath)}</p></div><div class="mini"><span class="card-label">اجراکننده</span><p>${p.executorMode==='codex'?'Codex خودکار':'اجرای دستی'}</p></div><div class="mini"><span class="card-label">کیفیت و حلقه</span><p>${p.minQualityScore}/100 · حداکثر ${p.maxIterations} تکرار</p></div></div>
      <div class="delivery-box compact-delivery"><div><span class="card-label">فرمت تحویل</span><div class="format-list">${formats||'<span class="format-chip">براساس تعریف پروژه</span>'}</div></div><div><span class="card-label">راهبرد</span><p>${esc(p.definition.executionStrategy||'براساس تعریف و معیارهای پروژه')}</p></div></div>
      <div class="field-head"><div><label for="directive">اصلاح مسیر / دستور جدید</label><span class="field-hint">هر زمان نظرت عوض شد یا نکته تازه‌ای داشتی، اینجا بگو؛ وارد حافظه پروژه می‌شود.</span></div><button id="directiveVoiceBtn" class="voice-btn" type="button">🎙 گفتن دستور</button></div>
      <div class="inline-form"><input id="directive" placeholder="مثال: از این مرحله به بعد خروجی نهایی DOCX هم داشته باشد"><button class="secondary" id="addDirective">افزودن</button></div><div id="directiveVoiceStatus" class="voice-status"></div>
      ${awaiting?manualBox(awaiting):''}
    </section>
    <section class="panel"><h2>تعریف پخته‌شده پروژه</h2><div class="idea-picture-grid"><div class="mini emphasis"><span class="card-label">هسته ایده</span><p>${esc(p.definition.coreIdea||p.definition.vision)}</p></div><div class="mini"><span class="card-label">محصول نهایی</span><p>${esc(p.definition.targetOutcome)}</p></div><div class="mini"><span class="card-label">ارزش</span><p>${esc(p.definition.valueProposition||'—')}</p></div><div class="mini"><span class="card-label">اثر مطلوب</span><p>${esc(p.definition.desiredImpact||'—')}</p></div></div><div class="mini list-card"><span class="card-label">فازهای اصلی</span>${listHtml(p.definition.milestones)}</div><div class="mini list-card"><span class="card-label">معیارهای موفقیت</span>${listHtml(p.definition.successCriteria)}</div></section>
    <section class="panel"><h2>روند اجرا و بازبینی</h2>${r.iterations.length?r.iterations.map(iterationHtml).join(''):'<p class="muted">هنوز اجرایی شروع نشده است. «اجرای خودکار تا تکمیل» را بزن تا Supervisor مرحله بعدی را تعیین کند.</p>'}</section>`;
    bindProjectActions(p,awaiting);bindVoice('#directiveVoiceBtn','#directive','#directiveVoiceStatus');if(awaiting)bindVoice('#manualVoiceBtn','#manualResult','#manualVoiceStatus');
  }catch(e){$('#main').innerHTML=`<div class="error">نمایش پروژه ممکن نشد: ${esc(e.message)}</div>`;}
}

function manualBox(i){return `<div class="mini manual-box"><h3>نتیجه اجرای دستی لازم است</h3><p>پرامپت زیر را به اجراکننده بده و نتیجه واقعی را برگردان.</p><div class="prompt">${esc(i.executionPrompt)}</div><div class="field-head"><label for="manualResult">نتیجه اجراکننده</label><button id="manualVoiceBtn" class="voice-btn small" type="button">🎙 گفتن نتیجه</button></div><textarea id="manualResult" rows="9"></textarea><div id="manualVoiceStatus" class="voice-status"></div><button id="submitManual" class="primary">ارسال برای بازبینی</button></div>`;}
function iterationHtml(i){
  const score=i.reviewer?`<span class="score">${i.reviewer.score}</span>/100`:'';
  const review=i.reviewer?` · ${esc(fa(reviewFa,i.reviewer.status))}`:'';
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
