'use strict';
(() => {
 const $ = id => document.getElementById(id);
 const els = {
  home:$('home'), party:$('party'), name:$('name'), joinCode:$('joinCode'), create:$('create'),
  join:$('join'), connection:$('connection'), code:$('code'), people:$('people'),
  role:$('role'), memberCount:$('memberCount'), memberList:$('memberList'),
  invite:$('invite'), leave:$('leave'), moderator:$('moderator'), viewerPanel:$('viewerPanel'),
  remote:$('remote'), viewer:$('viewer'), waiting:$('waiting'), browserState:$('browserState'),
  broadcastState:$('broadcastState'), hint:$('hint'), toast:$('toast'), goLive:$('goLive'),
  stopLive:$('stopLive'), play:$('play'), typeText:$('typeText'), typeSend:$('typeSend'), reels:$('reels')
 };
 let state={active:false}; let events=null; let frameTimer=null;
 let previousBroadcast=false;let previewLoading=false;let toastTimer;
 const searchCode=new URL(location.href).searchParams.get('room');
 if(searchCode) els.joinCode.value=searchCode.trim().toUpperCase().slice(0,7);
 try { const saved=sessionStorage.getItem('reelparty_name');if(saved)els.name.value=saved; } catch {}

 function toast(message){
  els.toast.textContent=String(message||'');els.toast.style.display='block';
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.style.display='none',5200);
 }
 async function api(path,data){
  const opts={credentials:'same-origin',cache:'no-store'};
  if(data!==undefined){opts.method='POST';opts.headers={'Content-Type':'application/json'};opts.body=JSON.stringify(data);}
  let response;
  try{response=await fetch('/api/'+path,opts);}catch(e){throw Error('Keine Verbindung zum Server');}
  let result;try{result=await response.json();}catch{throw Error('Ungültige Serverantwort');}
  if(!response.ok)throw Error(result.error||'Anfrage fehlgeschlagen');
  return result;
 }
 const setWaiting=(heading,details)=>{
  els.waiting.hidden=false;
  els.waiting.querySelector('strong').textContent=heading;
  els.waiting.querySelector('p').textContent=details||'';
 };
 function disconnectEvents(){ if(events){events.close();events=null;} }
 function stopFrames(){if(frameTimer){clearInterval(frameTimer);frameTimer=null;}previewLoading=false;els.remote.hidden=true;els.remote.removeAttribute('src');}
 async function updateFrame(){
  if(previewLoading||document.hidden||!state?.active||!state.host||state.browserStatus!=='ready')return;
  previewLoading=true;
  try {
   const img=await fetch('/api/host/frame?frame='+Date.now(),{cache:'no-store',credentials:'same-origin'});
   if(!img.ok)throw Error('Bild nicht bereit');
   const bytes=await img.blob();const source=URL.createObjectURL(bytes);
   els.remote.onload=()=>{URL.revokeObjectURL(source);previewLoading=false;};
   els.remote.onerror=()=>{URL.revokeObjectURL(source);previewLoading=false;};
   els.remote.src=source;els.remote.hidden=false;els.waiting.hidden=true;
   setTimeout(()=>{if(previewLoading){previewLoading=false;URL.revokeObjectURL(source);}},5000);
  }catch{previewLoading=false;}
 }
 function startFrames(){if(frameTimer)return;updateFrame();frameTimer=setInterval(()=>{if(!document.hidden)updateFrame();},1000);}
 function setVideoUrl(){
  if(!state.active||state.host||!state.broadcast)return;
  const base='/hls/live.m3u8';
  if(els.viewer.dataset.src!==base) {
   els.viewer.dataset.src=base;
   els.viewer.src=base;
   els.viewer.load();
  }
 }
 function endViewer(){
  if(!els.viewer.paused)els.viewer.pause();
  els.viewer.removeAttribute('src');els.viewer.load();delete els.viewer.dataset.src;
  els.viewer.hidden=true;els.play.disabled=true;els.play.textContent='Live abspielen ▶';
 }
 function applyState(next){
  const old=state;
  state=next||{active:false};
  if(!state.active){
   disconnectEvents();stopFrames();endViewer();
   els.home.hidden=false;els.party.hidden=true;els.connection.textContent='Bereit';
   previousBroadcast=false;
   return;
  }
  els.home.hidden=true;els.party.hidden=false;
  els.code.textContent=state.code;
  els.role.textContent=state.host?'· Moderator':'· Zuschauer';
  els.people.textContent=state.members.length+' von 4 verbunden';
  els.memberCount.textContent=state.members.length+'/4';
  els.memberList.replaceChildren();
  for(const m of state.members){
   const tag=document.createElement('span');
   tag.className='member'+(m.host?' host':'');
   tag.textContent=m.name;
   els.memberList.appendChild(tag);
  }
  els.connection.textContent=state.broadcast?'Live':state.browserStatus==='ready'?'Verbunden':'Browser startet';
  els.browserState.textContent=({ready:'Browser bereit',starting:'Browser startet …',error:'Browserfehler'})[state.browserStatus]||'Browser lädt';
  els.broadcastState.textContent=state.broadcast?'LIVE – geteilte Ansicht':
   state.streamStatus==='starting'?'Stream startet …':state.streamStatus==='error'?'Stream-Fehler':'Noch nicht live';
  const dot=document.querySelector('.dot');
  dot.classList.toggle('live',!!state.broadcast);
  els.moderator.hidden=!state.host;
  els.viewerPanel.hidden=!!state.host;
  if(state.host){
   endViewer();els.viewer.hidden=true;
   els.goLive.hidden=!!state.broadcast;
   els.goLive.disabled=state.browserStatus!=='ready'||state.streamStatus==='starting';
   els.goLive.textContent=state.streamStatus==='starting'?'Stream startet …':'Liveübertragung starten ▶';
   els.stopLive.hidden=!state.broadcast;
   els.hint.textContent='Tippe auf die Vorschau, um den gemeinsamen Browser zu bedienen. Vor dem Livestart anmelden.';
   if(state.browserStatus==='ready'){els.waiting.hidden=true;startFrames();}else{stopFrames();setWaiting('Browser wird vorbereitet',state.message||'Bitte warten …');}
  }else{
   stopFrames();
   els.remote.hidden=true;
   els.hint.textContent=state.broadcast?'Tippe auf „Live abspielen“, um zuzuschauen.':'Sobald der Moderator den Stream startet, erscheint das Video hier.';
   els.play.disabled=!state.broadcast;
   els.viewer.hidden=!state.broadcast;
   if(state.broadcast){
    els.waiting.hidden=true;
    setVideoUrl();
    if(!previousBroadcast)toast('Der Moderator hat die Liveübertragung gestartet.');
   } else{
    endViewer();
    setWaiting('Warten auf Liveübertragung',state.message||'Der Moderator meldet sich gerade bei Instagram an.');
   }
  }
  if(state.streamStatus==='error'&&old.streamStatus!=='error')toast(state.message||'Streaming konnte nicht starten.');
  if(state.browserStatus==='error'&&old.browserStatus!=='error')toast(state.message||'Browser konnte nicht starten.');
  previousBroadcast=!!state.broadcast;
 }
 function attachEvents(){
  disconnectEvents();
  events=new EventSource('/api/events');
  events.addEventListener('state',e=>{try{applyState(JSON.parse(e.data));}catch{}});
  events.addEventListener('closed',()=>{toast('Die Party wurde beendet.');applyState({active:false});});
  events.onerror=()=>{
   els.connection.textContent='Verbindung prüfen';
  };
 }
 async function createOrJoin(kind){
  const name=els.name.value.trim();
  if(!name){toast('Gib zuerst deinen Namen ein.');els.name.focus();return;}
  const code=els.joinCode.value.trim().toUpperCase();
  if(kind==='join'&&!code){toast('Party-Code fehlt.');return;}
  els.create.disabled=true;els.join.disabled=true;
  try {
   const response=await api(kind,kind==='join'?{name,code}:{name});
   try{sessionStorage.setItem('reelparty_name',name);}catch{}
   applyState(response.state);attachEvents();
   if(kind==='create')toast('Party erstellt! Melde dich jetzt privat bei Instagram an.');
   else toast('Du bist der Party beigetreten.');
  }catch(e){toast(e.message);}
  finally{els.create.disabled=false;els.join.disabled=false;}
 }
 async function send(action,extras={}){
  try{return await api('host/action',{type:action,...extras});}
  catch(e){toast(e.message);throw e;}
 }
 els.create.addEventListener('click',()=>createOrJoin('create'));
 els.join.addEventListener('click',()=>createOrJoin('join'));
 els.joinCode.addEventListener('keydown',e=>{if(e.key==='Enter')createOrJoin('join');});
 els.leave.addEventListener('click',async()=>{
  if(!confirm('Party wirklich verlassen? Als Moderator beendest du den Raum für alle.'))return;
  try{await api('leave',{});applyState({active:false});history.replaceState(null,'',location.pathname);}catch(e){toast(e.message);}
 });
 els.invite.addEventListener('click',async()=>{
  const link=new URL(location.href);link.searchParams.set('room',state.code);
  try{await navigator.share({title:'ReelParty Live',text:'Schau mit mir Instagram Reels!',url:link.href});}
  catch{try{await navigator.clipboard.writeText(link.href);toast('Einladungslink kopiert');}catch{toast('Einladungslink: '+link.href);}}
 });
 els.remote.addEventListener('click',async e=>{
  if(!state.host||state.browserStatus!=='ready')return;
  const rect=els.remote.getBoundingClientRect();
  const dims=state.dimensions||{width:480,height:900};
  const x=Math.round((e.clientX-rect.left)/rect.width*dims.width);
  const y=Math.round((e.clientY-rect.top)/rect.height*dims.height);
  try{await send('tap',{x,y});setTimeout(updateFrame,200);}catch{}
 });
 document.querySelectorAll('[data-scroll]').forEach(btn=>{
  btn.addEventListener('click',async()=>{try{await send('scroll',{amount:Number(btn.dataset.scroll)});setTimeout(updateFrame,180);}catch{}});
 });
 document.querySelectorAll('[data-key]').forEach(btn=>{
  btn.addEventListener('click',async()=>{try{await send('key',{key:btn.dataset.key});setTimeout(updateFrame,100);}catch{}});
 });
 els.typeSend.addEventListener('click',async()=>{
  try{await send('type',{value:els.typeText.value});els.typeText.value='';setTimeout(updateFrame,100);}catch{}
 });
 els.typeText.addEventListener('keydown',e=>{if(e.key==='Enter')els.typeSend.click();});
 els.reels.addEventListener('click',async()=>{try{await send('reels');toast('Reels-Seite geöffnet.');}catch{}});
 els.goLive.addEventListener('click',async()=>{
  if(!confirm('Jetzt den Instagram-Bildschirm an alle Teilnehmer übertragen? Prüfe vorher, dass dein Passwort nicht sichtbar ist.'))return;
  try{await api('host/start',{});toast('Streaming wird gestartet …');}catch(e){toast(e.message);}
 });
 els.stopLive.addEventListener('click',async()=>{try{await api('host/stop',{});toast('Liveübertragung beendet.');}catch(e){toast(e.message);}});
 els.play.addEventListener('click',async()=>{
  if(!state.broadcast)return;
  setVideoUrl();
  els.viewer.hidden=false;
  try{await els.viewer.play();els.play.textContent='Wird abgespielt ▶';els.waiting.hidden=true;}
  catch{toast('Tippe zum Abspielen auf das Video.');}
 });
 els.viewer.addEventListener('error',()=>{if(state.broadcast)toast('Stream noch nicht verfügbar – bitte erneut versuchen.');});
 api('state').then(response=>{
  if(response.active){applyState(response);attachEvents();}
  else applyState({active:false});
 }).catch(()=>{applyState({active:false});toast('Server gerade nicht erreichbar.');});
})();
