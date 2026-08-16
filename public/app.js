const $ = s => document.querySelector(s);
let projects = [], currentId = null, poll = null;

const statusFa = {
  DRAFT:'پیش‌نویس', READY:'آماده', RUNNING:'در حال اجرا', PAUSED:'مکث', NEEDS_HUMAN:'منتظر تصمیم شما',
  COMPLETED:'تکمیل‌شده', BLOCKED:'مسدود', STOPPED:'متوقف‌شده', ERROR:'خطا', AWAITING_MANUAL_RESULT:'منتظر نتیجه دستی',
  PASSED:'تأییدشده', FAILED:'ردشده', INTERRUPTED:'قطع‌شده'
};
const profileFa = { coding:'کدنویسی', writing:'نوشتن / کتاب', research:'پژوهش', planning:'برنامه‌ریزی', general:'عمومی' };
const complexityFa = { low:'کم', medium:'متوسط', high:'زیاد', very_high:'خیلی زیاد' };
const decisionFa = {
  CONTINUE:'ادامه', PROJECT_COMPLETE:'پروژه کامل شد', NEEDS_HUMAN:'نیازمند تصمیم شما', NO_PROGRESS:'پیشرفت کافی نیست',
  MAX_ITERATIONS:'حداکثر تکرارها', PAUSED:'مکث', STOPPED:'متوقف‌شده', ERROR:'خطا', EXECUTE:'اجرا', ASK_USER:'پرسش از شما', COMPLETE:'تکمیل'
};
const reviewFa = { PASS:'تأیید', FAIL:'رد', PARTIAL:'ناقص' };
const fa = (map, value) => map[value] || value || '—';

async function api(path, options={}){
  const res = await fetch(path,{headers:{"content-type":"application/json",...(options.headers||{})},...options});
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||`درخواست با خطای ${res.status} مواجه شد`);
  return body;
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setBusy(el,busy,text){if(!el)return;el.classList.toggle("loading",busy);if(text){if(!el.dataset.original)el.dataset.original=el.textContent;el.textContent=busy?text:el.dataset.original;}}
function show(sel,cls,text){const el=$(sel);if(!el)return;el.className=cls;el.textContent=text;}

function bindVoice(buttonSelector, targetSelector, statusSelector){
  const btn=$(buttonSelector), target=$(targetSelector), status=statusSelector?$(statusSelector):null;
  if(!btn || !target) return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){
    btn.classList.add('voice-unavailable');
    btn.title='ورودی صوتی در این مرورگر در دسترس نیست';
    btn.onclick=()=>{const msg='ورودی صوتی در این مرورگر فعال نیست. می‌توانی متن را تایپ کنی یا با مرورگری که Speech Recognition دارد امتحان کنی.';if(status)status.textContent=msg;else alert(msg);};
    return;
  }

  let recognition=null;
  btn.onclick=()=>{
    if(recognition){recognition.stop();return;}
    recognition=new Recognition();
    recognition.lang='fa-IR';
    recognition.interimResults=true;
    recognition.continuous=false;
    const base=target.value.trim();
    const original=btn.textContent;
    let hadError=false;

    recognition.onstart=()=>{
      btn.classList.add('listening');
      btn.textContent='■ پایان ضبط';
      if(status)status.textContent='در حال شنیدن… فارسی صحبت کن.';
    };
    recognition.onresult=event=>{
      let transcript='';
      for(let i=0;i<event.results.length;i++) transcript+=event.results[i][0].transcript;
      const spoken=transcript.trim();
      target.value=[base,spoken].filter(Boolean).join(base&&spoken?' ':'');
      target.dispatchEvent(new Event('input',{bubbles:true}));
    };
    recognition.onerror=event=>{
      hadError=true;
      if(status)status.textContent=`ضبط صوت کامل نشد (${event.error}). دوباره امتحان کن یا متن را تایپ کن.`;
    };
    recognition.onend=()=>{
      btn.classList.remove('listening');
      btn.textContent=original;
      recognition=null;
      if(status&&!hadError&&target.value.trim())status.textContent='متن صوتی ثبت شد؛ قبل از ادامه می‌توانی ویرایشش کنی.';
    };
    try{recognition.start();}catch(error){recognition=null;btn.classList.remove('listening');btn.textContent=original;if(status)status.textContent=`شروع ضبط ممکن نشد: ${error.message}`;}
  };
}

async function refreshHealth(){
  try{
    const h=await api('/api/health'),e=$('#health'),c=h.codex;
    if(c.available&&c.authenticated&&c.compatible!==false){e.className='health ok';e.textContent=`Codex آماده · ${c.version}`;}
    else if(!c.available){e.className='health bad';e.textContent='Codex روی سیستم پیدا نشد';}
    else if(!c.authenticated){e.className='health bad';e.textContent='Codex نیاز به ورود دارد';}
    else{e.className='health bad';e.textContent='نسخه Codex با اجرای خودکار سازگار نیست';}
  }catch{$('#health').className='health bad';$('#health').textContent='بررسی وضعیت ناموفق بود';}
}
async function refreshProjects(){const r=await api('/api/projects');projects=r.projects;renderList();}
function renderList(){
  const el=$('#projectList');
  el.innerHTML=projects.length?projects.map(p=>`<div class="project-link ${p.id===currentId?'active':''}" data-id="${p.id}"><strong>${esc(p.name)}</strong><small>${esc(fa(statusFa,p.status))} · ${esc(fa(profileFa,p.profile))}</small></div>`).join(''):'<div class="empty-side">هنوز پروژه‌ای اینجا نیست.<br>اولین پروژه را از بالا بساز.</div>';
  el.querySelectorAll('.project-link').forEach(x=>x.onclick=()=>openProject(x.dataset.id));
}
function newProject(){
  currentId=null;clearInterval(poll);renderList();
  const t=$('#newProjectTemplate').content.cloneNode(true);$('#main').replaceChildren(t);
  $('#analyzeBtn').onclick=analyze;
  $('#quickTestBtn').onclick=()=>{
    $('#idea').value='یک فایل hello.txt بساز و داخل آن دقیقاً عبارت Hello Project Brain را بنویس. سپس وجود فایل و محتوای آن را بررسی کن.';
    $('#profileHint').value='coding';$('#workspacePath').value='';$('#webSearch').checked=false;
    show('#discovery','success','نمونه تست آماده شد. حالا «ساخت نقشه پروژه» را بزن.');
  };
  bindVoice('#ideaVoiceBtn','#idea','#ideaVoiceStatus');
}
async function analyze(){
  const btn=$('#analyzeBtn'),description=$('#idea').value.trim();
  if(description.length<10)return show('#discovery','error','ایده هنوز خیلی کوتاه است؛ یک یا دو جمله درباره نتیجه‌ای که می‌خواهی اضافه کن.');
  setBusy(btn,true,'در حال ساخت نقشه…');show('#discovery','','');
  try{const r=await api('/api/discover',{method:'POST',body:JSON.stringify({description,profileHint:$('#profileHint').value,useWebSearch:$('#webSearch').checked})});renderDiscovery(r.discovery,description);}
  catch(e){show('#discovery','error',`معمار پروژه نتوانست تحلیل را کامل کند: ${e.message}`);}finally{setBusy(btn,false);}
}
function renderDiscovery(d,description){
  const el=$('#discovery');
  const approaches=(d.possibleApproaches||[]).map(a=>`<div class="mini approach-card"><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p><p class="muted"><b>ملاحظه:</b> ${esc(a.tradeoffs)}</p></div>`).join('');
  const questions=(d.questions||[]).map(q=>`<li><b>${esc(q.question)}</b><br><span class="muted">${esc(q.why)}</span></li>`).join('');
  const def=d.draftDefinition||{};
  const deliverables=(def.deliverables||[]).slice(0,5).map(x=>`<li>${esc(x)}</li>`).join('');
  const success=(def.successCriteria||[]).slice(0,5).map(x=>`<li>${esc(x)}</li>`).join('');

  el.innerHTML=`<div class="panel nested discovery-panel">
    <div class="section-head">
      <div><span class="eyebrow">نقشه پیشنهادی معمار پروژه</span><h2>${esc(d.suggestedProjectType)}</h2></div>
      <span class="stage-state">آماده بازبینی</span>
    </div>
    <p class="lead">${esc(d.understanding)}</p>

    <div class="overview-grid">
      <div class="mini emphasis"><span class="card-label">هدف اصلی</span><p>${esc(def.primaryGoal||'—')}</p></div>
      <div class="mini"><span class="card-label">خروجی نهایی</span><p>${esc(def.targetOutcome||'—')}</p></div>
      <div class="mini"><span class="card-label">معیار کیفیت</span><p>${esc(def.qualityBar||'—')}</p></div>
    </div>

    ${deliverables?`<div class="mini list-card"><span class="card-label">تحویل‌دادنی‌های اصلی</span><ul>${deliverables}</ul></div>`:''}

    ${approaches?`<h3 class="section-title">مسیرهای پیشنهادی اجرا</h3><div class="card-grid">${approaches}</div>`:''}

    <div class="mini summary-row">
      <span><b>پیچیدگی:</b> ${esc(fa(complexityFa,d.estimatedComplexity))}</span>
      <span><b>حجم کار:</b> ${esc(d.estimatedWorkload)}</span>
      <span><b>پژوهش:</b> ${d.researchNeeded?'پیشنهاد می‌شود':'فعلاً لازم نیست'}</span>
    </div>

    ${success?`<div class="mini list-card"><span class="card-label">پروژه چه زمانی موفق حساب می‌شود؟</span><ul>${success}</ul></div>`:''}
    ${questions?`<div class="decision-box"><h3>تصمیم‌هایی که واقعاً روی مسیر اثر دارند</h3><ol>${questions}</ol></div>`:''}

    <details class="advanced">
      <summary>ویرایش فنی تعریف پروژه (JSON)</summary>
      <p class="muted">فقط اگر می‌خواهی جزئیات ساختاری را دستی تغییر بدهی، این بخش را باز کن.</p>
      <textarea id="definitionJson" class="json-editor" rows="22">${esc(JSON.stringify(d.draftDefinition,null,2))}</textarea>
    </details>

    <div class="grid2 final-settings">
      <div><label>اجراکننده</label><select id="executorMode"><option value="codex">Codex — اجرای خودکار</option><option value="manual">دستی — انتقال پرامپت به ChatGPT/Work</option></select></div>
      <div><label>حداقل امتیاز کیفیت</label><input id="quality" type="number" min="1" max="100" value="90"></div>
    </div>
    <button id="createProjectBtn" class="primary large">تأیید نقشه و ساخت پروژه</button>
    <div id="createError"></div>
  </div>`;

  $('#createProjectBtn').onclick=async()=>{
    const btn=$('#createProjectBtn');setBusy(btn,true,'در حال ساخت پروژه…');
    try{
      const definition=JSON.parse($('#definitionJson').value);
      const created=await api('/api/projects',{method:'POST',body:JSON.stringify({description,definition,profile:d.suggestedProfile,workspacePath:$('#workspacePath').value,executorMode:$('#executorMode').value,minQualityScore:Number($('#quality').value)})});
      await refreshProjects();openProject(created.project.id);
    }catch(e){show('#createError','error',`ساخت پروژه انجام نشد: ${e.message}`);}finally{setBusy(btn,false);}
  };
}
async function openProject(id){currentId=id;renderList();clearInterval(poll);await renderProject();poll=setInterval(renderProject,3000);}
async function renderProject(){
  if(!currentId)return;
  try{
    const r=await api(`/api/projects/${currentId}`),p=r.project,awaiting=r.iterations.find(i=>i.status==='AWAITING_MANUAL_RESULT');
    const terminal=['COMPLETED','STOPPED'].includes(p.status),disabled=terminal?'disabled':'';
    $('#main').innerHTML=`
      <section class="panel project-hero">
        <div class="section-head project-title-row">
          <div><span class="eyebrow">پروژه ${esc(fa(profileFa,p.profile))}</span><h1>${esc(p.name)}</h1></div>
          <span class="pill status-${p.status}">${esc(fa(statusFa,p.status))}</span>
        </div>
        <p class="lead">${esc(p.definition.primaryGoal)}</p>
        <div class="actions project-actions">
          <button class="primary" id="runOnce" ${disabled}>اجرای یک مرحله</button>
          <button class="primary" id="runLoop" ${disabled}>اجرای خودکار حلقه</button>
          <button class="secondary" id="pause">مکث</button>
          <button class="danger" id="stop">توقف کامل</button>
        </div>

        <div class="card-grid project-facts">
          <div class="mini"><span class="card-label">پوشه کاری</span><p class="ltr path">${esc(p.workspacePath)}</p></div>
          <div class="mini"><span class="card-label">اجراکننده</span><p>${p.executorMode==='codex'?'Codex خودکار':'اجرای دستی'}</p></div>
          <div class="mini"><span class="card-label">خط کیفیت</span><p>${p.minQualityScore}/100 · حداکثر ${p.maxIterations} مرحله</p></div>
        </div>

        <div class="feedback-box">
          <div class="field-head">
            <div><label for="directive">بازخورد یا دستور برای ادامه پروژه</label><span class="field-hint">هر چیزی که باید در مرحله بعد رعایت، اصلاح یا حفظ شود را بنویس یا با صدا بگو.</span></div>
            <button id="directiveVoiceBtn" class="voice-btn" type="button">🎙 بیان صوتی</button>
          </div>
          <textarea id="directive" rows="3" placeholder="مثال: نتیجه خوب است، اما لحن رسمی‌تر شود و ساختار API فعلی تغییر نکند."></textarea>
          <div class="feedback-footer"><div id="directiveVoiceStatus" class="voice-status" aria-live="polite"></div><button class="secondary" id="addDirective">ثبت بازخورد</button></div>
        </div>
        ${awaiting?manualBox(awaiting):''}
      </section>

      <section class="panel">
        <div class="section-head"><div><span class="eyebrow">تصویر نهایی</span><h2>تعریف پروژه</h2></div></div>
        <div class="overview-grid">
          <div class="mini emphasis"><span class="card-label">خروجی هدف</span><p>${esc(p.definition.targetOutcome)}</p></div>
          <div class="mini list-card"><span class="card-label">معیارهای موفقیت</span><ul>${p.definition.successCriteria.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
        </div>
      </section>

      <section class="panel">
        <div class="section-head"><div><span class="eyebrow">ردپای اجرا</span><h2>مراحل پروژه</h2></div><span class="stage-state">${r.iterations.length} مرحله</span></div>
        ${r.iterations.length?r.iterations.map(iterationHtml).join(''):'<p class="muted empty-state">هنوز مرحله‌ای اجرا نشده است.</p>'}
      </section>`;
    bindProjectActions(p,awaiting);
    bindVoice('#directiveVoiceBtn','#directive','#directiveVoiceStatus');
    if(awaiting)bindVoice('#manualVoiceBtn','#manualResult','#manualVoiceStatus');
  }catch(e){$('#main').innerHTML=`<div class="error">نمایش پروژه ممکن نشد: ${esc(e.message)}</div>`;}
}
function manualBox(i){return `<div class="mini manual-box"><h3>نتیجه اجرای دستی لازم است</h3><p>این پرامپت را به ChatGPT/Work بده و نتیجه را پایین وارد کن.</p><div class="prompt">${esc(i.executionPrompt)}</div><div class="field-head"><div><label for="manualResult">نتیجه اجراکننده</label><span class="field-hint">می‌توانی نتیجه را تایپ کنی یا صوتی بگویی.</span></div><button id="manualVoiceBtn" class="voice-btn" type="button">🎙 بیان صوتی</button></div><textarea id="manualResult" rows="9"></textarea><div class="feedback-footer"><div id="manualVoiceStatus" class="voice-status"></div><button id="submitManual" class="primary">ارسال برای بازبینی</button></div></div>`;}
function iterationHtml(i){
  const score=i.reviewer?`<span class="score">${i.reviewer.score}</span>/100`:'';
  const review=i.reviewer?` · ${esc(fa(reviewFa,i.reviewer.status))}`:'';
  return `<div class="iteration"><div class="iteration-head"><div><b>مرحله ${i.number}: ${esc(i.supervisor?.taskTitle||'اجرا')}</b><div class="muted">${esc(fa(statusFa,i.status))} · ${esc(fa(decisionFa,i.decision))}${review}</div></div><div>${score}</div></div>${i.reviewer?`<p>${esc(i.reviewer.reasoningSummary)}</p><div class="muted"><b>قدم بعدی:</b> ${esc(i.reviewer.recommendedNextAction)}</div>`:''}</div>`;
}
function bindProjectActions(p,awaiting){
  $('#runOnce').onclick=()=>action('run-once');$('#runLoop').onclick=()=>action('run-loop');$('#pause').onclick=()=>action('pause');$('#stop').onclick=()=>action('stop');
  $('#addDirective').onclick=async()=>{const text=$('#directive').value.trim();if(!text)return;await api(`/api/projects/${p.id}/directives`,{method:'POST',body:JSON.stringify({text})});$('#directive').value='';show('#directiveVoiceStatus','voice-status','بازخورد ثبت شد و از این به بعد در تصمیم‌های پروژه لحاظ می‌شود.');};
  if(awaiting)$('#submitManual').onclick=async()=>{const result=$('#manualResult').value.trim();if(!result)return;await api(`/api/projects/${p.id}/manual-result`,{method:'POST',body:JSON.stringify({result})});await renderProject();};
  async function action(name){try{await api(`/api/projects/${p.id}/${name}`,{method:'POST',body:'{}'});await renderProject();}catch(e){alert(`عملیات انجام نشد: ${e.message}`);}}
}
$('#newProjectBtn').onclick=newProject;
await Promise.all([refreshHealth(),refreshProjects()]);newProject();
