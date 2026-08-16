const $ = s => document.querySelector(s);
let projects = [], currentId = null, poll = null;

async function api(path, options={}){
  const res = await fetch(path,{headers:{"content-type":"application/json",...(options.headers||{})},...options});
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||`Request failed: ${res.status}`); return body;
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setBusy(el,busy,text){if(!el)return;el.classList.toggle("loading",busy);if(text){if(!el.dataset.original)el.dataset.original=el.textContent;el.textContent=busy?text:el.dataset.original;}}
async function refreshHealth(){
  try{const h=await api('/api/health');const e=$('#health');if(h.codex.available&&h.codex.authenticated){e.className='health ok';e.textContent=`Codex ready · ${h.codex.version}`;}else{e.className='health bad';e.textContent=h.codex.available?'Codex login required':'Codex CLI not found';}}
  catch{$('#health').className='health bad';$('#health').textContent='Health check failed';}
}
async function refreshProjects(){const r=await api('/api/projects');projects=r.projects;renderList();}
function renderList(){const el=$('#projectList');el.innerHTML=projects.map(p=>`<div class="project-link ${p.id===currentId?'active':''}" data-id="${p.id}">${esc(p.name)}<small>${esc(p.status)} · ${esc(p.profile)}</small></div>`).join('');el.querySelectorAll('.project-link').forEach(x=>x.onclick=()=>openProject(x.dataset.id));}
function newProject(){currentId=null;clearInterval(poll);renderList();const t=$('#newProjectTemplate').content.cloneNode(true);$('#main').replaceChildren(t);$('#analyzeBtn').onclick=analyze;}
async function analyze(){
 const btn=$('#analyzeBtn'),description=$('#idea').value.trim();if(description.length<10)return show('#discovery','error','Please describe the project with a little more detail.');
 setBusy(btn,true,'Analyzing…');show('#discovery','','');
 try{const r=await api('/api/discover',{method:'POST',body:JSON.stringify({description,profileHint:$('#profileHint').value,useWebSearch:$('#webSearch').checked})});renderDiscovery(r.discovery,description);}catch(e){show('#discovery','error',e.message);}finally{setBusy(btn,false);}
}
function show(sel,cls,text){const el=$(sel);el.className=cls;el.textContent=text;}
function renderDiscovery(d,description){
 const el=$('#discovery');const approaches=(d.possibleApproaches||[]).map(a=>`<div class="mini"><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p><p><b>Trade-offs:</b> ${esc(a.tradeoffs)}</p></div>`).join('');
 const questions=(d.questions||[]).map(q=>`<li><b>${esc(q.question)}</b><br><span class="muted">${esc(q.why)}</span></li>`).join('');
 el.innerHTML=`<div class="panel" style="margin-top:22px"><span class="eyebrow">DISCOVERY RESULT</span><h2>${esc(d.suggestedProjectType)}</h2><p>${esc(d.understanding)}</p><div class="card-grid">${approaches}</div><div class="mini"><b>Complexity:</b> ${esc(d.estimatedComplexity)} · <b>Workload:</b> ${esc(d.estimatedWorkload)}<br><b>Research:</b> ${d.researchNeeded?'Recommended':'Not required initially'}</div>${questions?`<h3>Decisions still worth answering</h3><ol>${questions}</ol>`:''}<label>Project Definition (editable JSON)</label><textarea id="definitionJson" rows="22">${esc(JSON.stringify(d.draftDefinition,null,2))}</textarea><div class="grid2"><div><label>Executor</label><select id="executorMode"><option value="codex">Codex — automatic loop</option><option value="manual">Manual — copy prompt to ChatGPT/Work</option></select></div><div><label>Minimum quality score</label><input id="quality" type="number" min="1" max="100" value="90"></div></div><button id="createProjectBtn" class="primary">Create & Approve Project</button><div id="createError"></div></div>`;
 $('#createProjectBtn').onclick=async()=>{const btn=$('#createProjectBtn');setBusy(btn,true,'Creating…');try{const definition=JSON.parse($('#definitionJson').value);const created=await api('/api/projects',{method:'POST',body:JSON.stringify({description,definition,profile:d.suggestedProfile,workspacePath:$('#workspacePath').value,executorMode:$('#executorMode').value,minQualityScore:Number($('#quality').value)})});await refreshProjects();openProject(created.project.id);}catch(e){show('#createError','error',e.message);}finally{setBusy(btn,false);}};
}
async function openProject(id){currentId=id;renderList();clearInterval(poll);await renderProject();poll=setInterval(renderProject,3000);}
async function renderProject(){
 if(!currentId)return;try{const r=await api(`/api/projects/${currentId}`),p=r.project;const awaiting=r.iterations.find(i=>i.status==='AWAITING_MANUAL_RESULT');
 $('#main').innerHTML=`<section class="panel"><span class="eyebrow">${esc(p.profile)} PROJECT</span><h1>${esc(p.name)}</h1><p>${esc(p.definition.primaryGoal)}</p><div class="actions"><span class="pill status-${p.status}">${esc(p.status)}</span><button class="primary" id="runOnce">Run one iteration</button><button class="primary" id="runLoop">Run loop</button><button class="secondary" id="pause">Pause</button><button class="danger" id="stop">Stop</button></div><div class="card-grid"><div class="mini"><h3>Workspace</h3><p>${esc(p.workspacePath)}</p></div><div class="mini"><h3>Executor</h3><p>${esc(p.executorMode)}</p></div><div class="mini"><h3>Quality bar</h3><p>${p.minQualityScore}/100 · max ${p.maxIterations} iterations</p></div></div><label>Add a human directive</label><div style="display:flex;gap:8px"><input id="directive" placeholder="Example: Preserve the author's voice in chapter 4"><button class="secondary" id="addDirective">Add</button></div>${awaiting?manualBox(awaiting):''}</section><section class="panel"><h2>Project definition</h2><div class="mini"><b>Outcome</b><p>${esc(p.definition.targetOutcome)}</p><b>Success criteria</b><ul>${p.definition.successCriteria.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></section><section class="panel"><h2>Iterations</h2>${r.iterations.length?r.iterations.map(iterationHtml).join(''):'<p class="muted">No iterations yet.</p>'}</section>`;
 bindProjectActions(p,awaiting);}catch(e){$('#main').innerHTML=`<div class="error">${esc(e.message)}</div>`;}
}
function manualBox(i){return `<div class="mini" style="margin-top:18px"><h3>Manual Executor required</h3><p>Copy this prompt to ChatGPT/Work, then paste the result below.</p><div class="prompt">${esc(i.executionPrompt)}</div><label>Executor result</label><textarea id="manualResult" rows="9"></textarea><button id="submitManual" class="primary">Submit for review</button></div>`;}
function iterationHtml(i){const score=i.reviewer?`<span class="score">${i.reviewer.score}</span>/100`:'';return `<div class="iteration"><div style="display:flex;justify-content:space-between;gap:10px"><div><b>#${i.number} ${esc(i.supervisor?.taskTitle||'Iteration')}</b><div class="muted">${esc(i.status)} · ${esc(i.decision)}</div></div><div>${score}</div></div>${i.reviewer?`<p>${esc(i.reviewer.reasoningSummary)}</p><div class="muted"><b>Next:</b> ${esc(i.reviewer.recommendedNextAction)}</div>`:''}</div>`;}
function bindProjectActions(p,awaiting){
 $('#runOnce').onclick=()=>action('run-once');$('#runLoop').onclick=()=>action('run-loop');$('#pause').onclick=()=>action('pause');$('#stop').onclick=()=>action('stop');
 $('#addDirective').onclick=async()=>{const text=$('#directive').value.trim();if(!text)return;await api(`/api/projects/${p.id}/directives`,{method:'POST',body:JSON.stringify({text})});$('#directive').value='';await renderProject();};
 if(awaiting)$('#submitManual').onclick=async()=>{const result=$('#manualResult').value.trim();if(!result)return;await api(`/api/projects/${p.id}/manual-result`,{method:'POST',body:JSON.stringify({result})});await renderProject();};
 async function action(name){try{await api(`/api/projects/${p.id}/${name}`,{method:'POST',body:'{}'});await renderProject();}catch(e){alert(e.message);}}
}
$('#newProjectBtn').onclick=newProject;
await Promise.all([refreshHealth(),refreshProjects()]);newProject();
