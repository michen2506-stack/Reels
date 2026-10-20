'use strict';
const $=id=>document.getElementById(id);
const ui={ lobby:$('lobby'),party:$('party'),name:$('name'),roomCode:$('roomCode'),
  hostOnly:$('hostOnly'),remoteFrame:$('remoteFrame'),remoteImage:$('remoteImage'),remoteWait:$('remoteWait'),
  video:$('video'),cover:$('videoCover'),roomBadge:$('roomBadge'),toast:$('toast'),
  liveStatus:$('liveStatus'),goLive:$('goLive'),stopLive:$('stopLive')};
let state=null,events=null,frameTimer=null,frameBusy=false,lastLive=false,videoLoading=false;
function toast(text){ui.toast.textContent=text;ui.toast.classList.add('shown');clearTimeout(toast.t);toast.t=setTimeout(()=>ui.toast.classList.remove('shown'),4300);}
function show(el,visible){el.classList.toggle('hidden',!visible);}
async function api(path,payload) {
  const res=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
  const json=await res.json().catch(()=>({error:'Server antwortet nicht'}));
  if(!res.ok)throw Error(json.error||`HTTP ${res.status}`);
  return json;
}
async function stateLoad(){
  const r=await fetch('/api/state',{credentials:'same-origin'});if(r.ok)applyState(await r.json());
}
function avatar(name){return name.trim().slice(0,1).toUpperCase()||'?';}
function applyState(next){
  state=next;
  if(!next.active) {show(ui.lobby,true);show(ui.party,false);closeEvents();stopFrames();stopVideo();return;}
  show(ui.lobby,false);show(ui.party,true);
  $('codeLabel').textContent=next.code;
  $('roomBadge').textContent=next.host?'DU BIST MODERATOR':'LIVE-GAST';
  $('subtitle').textContent=next.message||'Gemeinsam Reels schauen';
  $('count').textContent=`${next.members.length}/4`;
  const people=$('people');people.replaceChildren();
  next.members.forEach((m)=>{
    const p=document.createElement('div');p.className='person';
    const a=document.createElement('div');a.className='avatar';a.textContent=avatar(m.name);
    const n=document.createElement('span');n.textContent=m.name;
    p.append(a,n);
    if(m.host){const b=document.createElement('span');b.className='role';b.textContent='HOST';p.append(b);}
    people.append(p);
  });
  show(ui.hostOnly,next.host);
  if(next.host && !frameTimer) startFrames();
  if(!next.host && frameTimer) stopFrames();
  show(ui.goLive,next.host && !next.broadcast && next.streamStatus!=='starting');
  show(ui.stopLive,next.host && next.broadcast);
  ui.goLive.disabled=next.browserStatus!=='ready';
  const live=next.streamStatus==='live';
  ui.liveStatus.classList.toggle('online',live);
  ui.liveStatus.innerHTML=live?'<i></i> LIVE':'<i></i> OFFLINE';
  $('videoStatus').textContent=next.streamStatus==='starting'?'Stream startet …':
    next.browserStatus==='error'?'Browserfehler': live?'Instagram ist live':'Noch nicht live';
  $('videoDescription').textContent=next.message||'Der Host richtet den Instagram-Browser ein.';
  if(live && !lastLive){videoLoading=true;tryPlayVideo();}
  if(!live && lastLive){stopVideo();}
  lastLive=live;
  show($('playStream'),live);
  show(ui.cover,!live||(!ui.video.currentTime&&!videoLoading));
  if(next.host) ui.remoteWait.textContent=next.browserStatus==='ready'?'Instagram-Bild wird geladen …':next.message||'Browser startet …';
}
function closeEvents(){if(events){events.close();events=null;}}
function openEvents(){if(events)return;
  events=new EventSource('/api/events');
  events.addEventListener('state',e=>{try{applyState(JSON.parse(e.data));}catch{}});
  events.addEventListener('closed',()=>{closeEvents();applyState({active:false});toast('Die Party wurde beendet.');});
  events.onerror=()=>{};
}
function stopFrames(){if(frameTimer)clearInterval(frameTimer);frameTimer=null;}
function startFrames(){loadFrame();frameTimer=setInterval(loadFrame,1600);}
async function loadFrame(){
  if(frameBusy||!state?.host||state.browserStatus!=='ready')return;
  frameBusy=true;
  try {const res=await fetch('/api/host/frame',{cache:'no-store'});
    if(!res.ok)throw Error('Bild nicht geladen');
    const blob=await res.blob();const src=URL.createObjectURL(blob);
    const old=ui.remoteImage.dataset.objectUrl;
    ui.remoteImage.src=src;ui.remoteImage.dataset.objectUrl=src;
    ui.remoteWait.classList.add('hidden');
    if(old)URL.revokeObjectURL(old);
  }catch{ui.remoteWait.classList.remove('hidden');}finally{frameBusy=false;}
}
function stopVideo(){ui.video.pause();ui.video.removeAttribute('src');ui.video.load();videoLoading=false;lastLive=false;show(ui.cover,true);}
async function tryPlayVideo(){
  if(!state?.broadcast)return;
  if(!ui.video.getAttribute('src'))ui.video.src='/hls/live.m3u8?t='+Date.now();
  try{await ui.video.play();videoLoading=false;show(ui.cover,false);}
  catch{videoLoading=false;show(ui.cover,true);show($('playStream'),true);}
}
ui.video.addEventListener('playing',()=>{show(ui.cover,false);videoLoading=false;});
ui.video.addEventListener('error',()=>{if(state?.broadcast){ui.video.removeAttribute('src');ui.video.load();setTimeout(()=>{if(state?.broadcast)tryPlayVideo();},2500);}});
$('playStream').onclick=()=>{tryPlayVideo();};
function restoreName(){const value=localStorage.getItem('rp_name');if(value)ui.name.value=value;}
function captureName(){const name=ui.name.value.trim();if(name)localStorage.setItem('rp_name',name);return name;}
$('create').onclick=async()=>{try{const result=await api('/api/create',{name:captureName()});applyState(result.state);openEvents();history.replaceState(null,'','?room='+result.state.code);}catch(e){toast(e.message);}};
$('join').onclick=async()=>{try{const result=await api('/api/join',{name:captureName(),code:ui.roomCode.value.trim().toUpperCase()});applyState(result.state);openEvents();history.replaceState(null,'','?room='+result.state.code);}catch(e){toast(e.message);}};
$('leave').onclick=async()=>{if(!confirm(state?.host?'Wenn du gehst, wird der gemeinsame Instagram-Browser für alle geschlossen. Wirklich beenden?':'Raum wirklich verlassen?'))return;
  try{await api('/api/leave',{});closeEvents();applyState({active:false});history.replaceState(null,'',location.pathname);}catch(e){toast(e.message);}};
$('invite').onclick=async()=>{const link=location.origin+'/?room='+state.code;
  if(navigator.share)try{await navigator.share({title:'ReelParty',text:'Schau mit mir Instagram Reels!',url:link});return;}catch{}
  try{await navigator.clipboard.writeText(link);toast('Einladungslink kopiert.');}catch{prompt('Link kopieren:',link);}};
async function action(payload){try{await api('/api/host/action',payload);setTimeout(loadFrame,320);}catch(e){toast(e.message);}}
ui.remoteFrame.addEventListener('click',e=>{
  if(!state?.host||state.browserStatus!=='ready'||ui.remoteWait.classList.contains('hidden')===false)return;
  const rect=ui.remoteImage.getBoundingClientRect();
  const x=Math.max(0,Math.min(480,Math.round((e.clientX-rect.left)/rect.width*480)));
  const y=Math.max(0,Math.min(900,Math.round((e.clientY-rect.top)/rect.height*900)));
  action({type:'tap',x,y});
});
$('remoteSend').onclick=async()=>{const inp=$('remoteText');if(!inp.value)return;
  await action({type:'type',value:inp.value});inp.value='';};
$('remoteText').addEventListener('keydown',e=>{if(e.key==='Enter'){$('remoteSend').click();e.preventDefault();}});
document.querySelectorAll('[data-act]').forEach(btn=>btn.onclick=()=>{
  const cmd=btn.dataset.act;
  if(cmd==='enter')action({type:'key',key:'Enter'});
  if(cmd==='back')action({type:'scroll',amount:-1});
  if(cmd==='next')action({type:'scroll',amount:1});
  if(cmd==='reels')action({type:'reels'});
});
$('goLive').onclick=async()=>{
  if(!confirm('Bist du bereits bei Instagram angemeldet? Alle Teilnehmer sehen ab jetzt den Browserbildschirm. Keine Passwörter oder Sicherheitscodes während der Übertragung eingeben.'))return;
  try{await api('/api/host/start',{});toast('Übertragung startet. Das kann bis zu 20 Sekunden dauern.');}catch(e){toast(e.message);}
};
$('stopLive').onclick=async()=>{try{await api('/api/host/stop',{});toast('Übertragung angehalten.');}catch(e){toast(e.message);}};
(async()=>{restoreName();const code=new URL(location.href).searchParams.get('room');if(code)ui.roomCode.value=code.toUpperCase();await stateLoad().catch(()=>{});if(state?.active)openEvents();})();
