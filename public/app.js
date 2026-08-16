const $ = s => document.querySelector(s);
let projects = [], currentId = null, poll = null;

const statusFa = {
  DRAFT:'پیش‌نویس', READY:'آماده', RUNNING:'در حال اجرا', PAUSED:'متوقف موقت', NEEDS_HUMAN:'نیازمند تصمیم شما',
  COMPLETED:'تکمیل‌شده', BLOCKED:'مسدود', STOPPED:'متوقف‌شده', ERROR:'خطا', AWAITING_MANUAL_RESULT:'منتظر نتیجه دستی',
  PASSED:'تأییدشده', FAILED:'ردشده', INTERRUPTED:'قطع‌شده'
};
const profileFa = { coding:'کدنویسی', writing:'نوشتن / کتاب', research:'پژوهش', planning:'برنامه‌ریزی', general:'عمومی' };
const complexityFa = { low:'کم', medium:'متوسط', high:'زیاد', very_high:'خیلی زیاد' };
const decisionFa = {
  CONTINUE:'ادامه', PROJECT_COMPLETE:'پروژه کامل شد', NEEDS_HUMAN:'نیازمند تصمیم شما', NO_PROGRESS:'پیشرفت کافی نیست',
  MAX_ITERATIONS:'حداکثر تکرارها', PAUSED:'متوقف موقت', STOPPED:'متوقف‌شده', ERROR:'خطا', EXECUTE:'اجرا', ASK_USER:'پرسش از کاربر', COMPLETE:'تکمیل'
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
  el.innerHTML=projects.length?projects.map(p=>`<div class="project-link ${p.id===currentId?'active':''}" data-id="${p.id}">${esc(p.name)}<small>${esc(fa(statusFa,p.status))} · ${esc(fa(profileFa,p.profile))}</small></div>`).join(''):'<div class="empty-side">هنوز پروژه‌ای ساخته نشده</div>';
  el.querySelectorAll('.project-link').forEach(x=>x.onclick=()=>openProject(x.dataset.id));
}
function newProject(){
  currentId=null;clearInterval(poll);renderList();
  const t=$('#newProjectTemplate').content.cloneNode(true);$('#main').replaceChildren(t);
  $('#analyzeBtn').onclick=analyze;
  $('#quickTestBtn').onclick=()=>{
    $('#idea').value='یک فایل hello.txt بساز و داخل آن دقیقاً عبارت Hello Project Brain را بنویس. سپس وجود فایل و محتوای آن را بررسی کن.';
    $('#profileHint').value='coding';$('#workspacePath').value='';$('#webSearch').checked=false;
    show('#discovery','success','تست سریع آماده شد. حالا «تحلیل پروژه» را بزن.');
  };
}
async function analyze(){
  const btn=$('#analyzeBtn'),description=$('#idea').value.trim();
  if(description.length<10)return show('#discovery','error','کمی بیشتر درباره نتیجه‌ای که می‌خواهی توضیح بده.');
  setBusy(btn,true,'در حال تحلیل…');show('#discovery','','');
  try{const r=await api('/api/discover',{method:'POST',body:JSON.stringify({description,profileHint:$('#profileHint').value,useWebSearch:$('#webSearch').checked})});renderDiscovery(r.discovery,description);}
  catch(e){show('#discovery','error',`تحلیل انجام نشد: ${e.message}`);}finally{setBusy(btn,false);}
}
function renderDiscovery(d,description){
  const el=$('#discovery');
  const approaches=(d.possibleApproaches||[]).map(a=>`<div class="mini"><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p><p><b>ملاحظات:</b> ${esc(a.tradeoffs)}</p></div>`).join('');
  const questions=(d.questions||[]).map(q=>`<li><b>${esc(q.question)}</b><br><span class="muted">${esc(q.why)}</span></li>`).join('');
  el.innerHTML=`<div class="panel nested"><span class="eyebrow">نتیجه تحلیل</span><h2>${esc(d.suggestedProjectType)}</h2><p>${esc(d.understanding)}</p><div class="card-grid">${approaches}</div><div class="mini summary-row"><span><b>پیچیدگی:</b> ${esc(fa(complexityFa,d.estimatedComplexity))}</span><span><b>حجم کار:</b> ${esc(d.estimatedWorkload)}</span><span><b>پژوهش:</b> ${d.researchNeeded?'پیشنهاد می‌شود':'فعلاً لازم نیست'}</span></div>${questions?`<h3>تصمیم‌هایی که بهتر است مشخص شوند</h3><ol>${questions}</ol>`:''}<label>تعریف پروژه (JSON قابل ویرایش)</label><textarea id="definitionJson" class="json-editor" rows="22">${esc(JSON.stringify(d.draftDefinition,null,2))}</textarea><div class="grid2"><div><label>اجراکننده</label><select id="executorMode"><option value="codex">Codex — اجرای خودکار</option><option value="manual">دستی — انتقال پرامپت به ChatGPT/Work</option></select></div><div><label>حداقل امتیاز کیفیت</label><input id="quality" type="number" min="1" max="100" value="90"></div></div><button id="createProjectBtn" class="primary">تأیید و ساخت پروژه</button><div id="createError"></div></div>`;
  $('#createProjectBtn').onclick=async()=>{
    const btn=$('#createProjectBtn');setBusy(btn,true,'در حال ساخت…');
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
    $('#main').innerHTML=`<section class="panel"><span class="eyebrow">پروژه ${esc(fa(profileFa,p.profile))}</span><h1>${esc(p.name)}</h1><p class="lead">${esc(p.definition.primaryGoal)}</p><div class="actions"><span class="pill status-${p.status}">${esc(fa(statusFa,p.status))}</span><button class="primary" id="runOnce" ${disabled}>اجرای یک مرحله</button><button class="primary" id="runLoop" ${disabled}>اجرای حلقه</button><button class="secondary" id="pause">توقف موقت</button><button class="danger" id="stop">توقف کامل</button></div><div class="card-grid"><div class="mini"><h3>پوشه کاری</h3><p class="ltr path">${esc(p.workspacePath)}</p></div><div class="mini"><h3>اجراکننده</h3><p>${p.executorMode==='codex'?'Codex خودکار':'اجرای دستی'}</p></div><div class="mini"><h3>معیار کیفیت</h3><p>${p.minQualityScore}/100 · حداکثر ${p.maxIterations} مرحله</p></div></div><label>دستور مستقیم برای پروژه</label><div class="inline-form"><input id="directive" placeholder="مثال: ساختار API فعلی تغییر نکند"><button class="secondary" id="addDirective">افزودن</button></div>${awaiting?manualBox(awaiting):''}</section><section class="panel"><h2>تعریف پروژه</h2><div class="mini"><b>خروجی هدف</b><p>${esc(p.definition.targetOutcome)}</p><b>معیارهای موفقیت</b><ul>${p.definition.successCriteria.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></section><section class="panel"><h2>مراحل اجرا</h2>${r.iterations.length?r.iterations.map(iterationHtml).join(''):'<p class="muted">هنوز مرحله‌ای اجرا نشده است.</p>'}</section>`;
    bindProjectActions(p,awaiting);
  }catch(e){$('#main').innerHTML=`<div class="error">نمایش پروژه ممکن نشد: ${esc(e.message)}</div>`;}
}
function manualBox(i){return `<div class="mini manual-box"><h3>نتیجه اجرای دستی لازم است</h3><p>این پرامپت را به ChatGPT/Work بده و نتیجه را پایین وارد کن.</p><div class="prompt">${esc(i.executionPrompt)}</div><label>نتیجه اجراکننده</label><textarea id="manualResult" rows="9"></textarea><button id="submitManual" class="primary">ارسال برای بازبینی</button></div>`;}
function iterationHtml(i){
  const score=i.reviewer?`<span class="score">${i.reviewer.score}</span>/100`:'';
  const review=i.reviewer?` · ${esc(fa(reviewFa,i.reviewer.status))}`:'';
  return `<div class="iteration"><div class="iteration-head"><div><b>مرحله ${i.number}: ${esc(i.supervisor?.taskTitle||'اجرا')}</b><div class="muted">${esc(fa(statusFa,i.status))} · ${esc(fa(decisionFa,i.decision))}${review}</div></div><div>${score}</div></div>${i.reviewer?`<p>${esc(i.reviewer.reasoningSummary)}</p><div class="muted"><b>اقدام بعدی:</b> ${esc(i.reviewer.recommendedNextAction)}</div>`:''}</div>`;
}
function bindProjectActions(p,awaiting){
  $('#runOnce').onclick=()=>action('run-once');$('#runLoop').onclick=()=>action('run-loop');$('#pause').onclick=()=>action('pause');$('#stop').onclick=()=>action('stop');
  $('#addDirective').onclick=async()=>{const text=$('#directive').value.trim();if(!text)return;await api(`/api/projects/${p.id}/directives`,{method:'POST',body:JSON.stringify({text})});$('#directive').value='';await renderProject();};
  if(awaiting)$('#submitManual').onclick=async()=>{const result=$('#manualResult').value.trim();if(!result)return;await api(`/api/projects/${p.id}/manual-result`,{method:'POST',body:JSON.stringify({result})});await renderProject();};
  async function action(name){try{await api(`/api/projects/${p.id}/${name}`,{method:'POST',body:'{}'});await renderProject();}catch(e){alert(`عملیات انجام نشد: ${e.message}`);}}
}
$('#newProjectBtn').onclick=newProject;
await Promise.all([refreshHealth(),refreshProjects()]);newProject();
