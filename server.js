'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 3000);
const MAX_MEMBERS = 4;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FRAME = { width: 360, height: 640 };
const PUBLIC = path.join(__dirname, 'public');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml'};
const safeCode = () => Array.from(crypto.randomBytes(7), x => ROOM_CHARS[x % ROOM_CHARS.length]).join('');
const safeName = name => typeof name === 'string' ? name.trim().replace(/[<>]/g,'').slice(0,24) : '';
const sessions = new Map();
let room = null; // Nur EIN gemeinsamer Remote-Browser pro Serverinstanz.
let busyFrame = false;

function json(res, status, data, cookie) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    ...(cookie ? {'Set-Cookie':cookie} : {})
  });
  res.end(JSON.stringify(data));
}
function bad(res, status, error) { json(res, status, {error}); }
function parseCookies(req) {
  const result = {};
  for (const item of (req.headers.cookie || '').split(';')) {
    const pos = item.indexOf('='); if (pos > 0) result[item.slice(0,pos).trim()] = item.slice(pos+1).trim();
  }
  return result;
}
function memberOf(req) {
  const token = parseCookies(req).rp_session;
  const member = sessions.get(token);
  return room && member?.room === room ? member : null;
}
function sessionCookie(token) {
  return `rp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function guardRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {return new URL(origin).host === host;} catch {return false;}
}
function readBody(req, limit=8192) {
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data',chunk=> { data+=chunk; if(data.length>limit){reject(Error('Anfrage zu groß'));req.destroy();}});
    req.on('end',()=>{try{resolve(JSON.parse(data||'{}'));}catch{reject(Error('Ungültige Anfrage'));}});
    req.on('error',reject);
  });
}
function snapshot(member) {
  if(!room) return {active:false};
  return {
    active:true, code:room.code, host:room.host===member?.id,
    members:[...room.members.values()].map(m=>({id:m.id,name:m.name,host:m.id===room.host})),
    browserStatus:room.browserStatus, broadcast:room.broadcast,
    streamStatus:room.streamStatus,
    message:room.message,
    dimensions:FRAME
  };
}
function sse(res,type,value) { if(res.destroyed || res.writableEnded) return; try{res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);}catch{}}
function notify() {
  if(!room)return;
  for(const m of room.members.values()) for(const res of m.listeners) sse(res,'state',snapshot(m));
}
function addMember(name) {
  if(!room || room.members.size >= MAX_MEMBERS) return null;
  const m={id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex'),name,room,listeners:new Set()};
  room.members.set(m.id,m); sessions.set(m.token,m); notify(); return m;
}
function killProc(proc) {if(proc && !proc.killed) try{proc.kill('SIGTERM');}catch{}}
async function cleanupRoom() {
  if(!room) return;
  const previous=room; room=null;
  for(const m of previous.members.values()) {sessions.delete(m.token);for(const res of m.listeners){sse(res,'closed',{});res.end();}}
  killProc(previous.encoder);
  try{await previous.context?.close();}catch{}
  try{await previous.browser?.close();}catch{}
  try{if(previous.profileDir)fs.rmSync(previous.profileDir,{recursive:true,force:true});}catch{}
  try{fs.rmSync(previous.hlsDir,{recursive:true,force:true});}catch{}
}
async function setupBrowser(r) {
  r.browserStatus='starting'; notify();
  if(process.env.MOCK_BROWSER === '1') {
    r.browserStatus='ready'; r.page={ screenshot:async()=>Buffer.from('fake-image'), mouse:{click:async()=>{},wheel:async()=>{}}, keyboard:{press:async()=>{},insertText:async()=>{}},locator:()=>({fill:async()=>{}}),goto:async()=>{} };
    notify(); return;
  }
  try {
    const {chromium} = require('playwright');
    r.profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'reelparty-profile-'));
    const context=await chromium.launchPersistentContext(r.profileDir,{
      headless:false,chromiumSandbox:false,viewport:FRAME,deviceScaleFactor:1,
      hasTouch:true,isMobile:true,locale:'de-DE',permissions:[],
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-timer-throttling','--window-size=360,640',
        '--window-position=0,0','--app=https://www.instagram.com/reels/',
        '--autoplay-policy=no-user-gesture-required','--disable-notifications']
    });
    if(room!==r){await context.close();return;}
    r.context=context;
    const pages=context.pages();
    const page=pages[0]||await context.newPage();
    r.page=page;
    page.setDefaultTimeout(7000);
    await page.goto('https://www.instagram.com/reels/',{waitUntil:'domcontentloaded',timeout:35000}).catch(()=>{});
    if(room!==r){await context.close();return;}
    r.browserStatus='ready'; notify();
  } catch(e) {if(room===r){r.browserStatus='error';r.message='Browser konnte nicht gestartet werden: '+e.message.slice(0,160);notify();}}
}
function isHost(m) {return m && room && m.id===room.host;}
async function hostAction(data) {
  const page=room?.page;
  if (!page || room.browserStatus!=='ready') throw Error('Browser noch nicht bereit');
  const type = data?.type;
  if(type==='tap') {
    const x=Number(data.x),y=Number(data.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>FRAME.width||y<0||y>FRAME.height)throw Error('Ungültige Koordinaten');
    await page.mouse.click(x,y);
  } else if(type==='scroll') {
    const amount=Number(data.amount);
    if(![-1,1].includes(amount))throw Error('Ungültige Richtung');
    await page.mouse.wheel(0,amount*550);
  } else if(type==='type') {
    const value=data.value;
    if(typeof value!=='string'||value.length>512)throw Error('Text zu lang');
    await page.keyboard.insertText(value);
  } else if(type==='key') {
    if(!['Enter','Tab','Backspace','Escape'].includes(data.key)) throw Error('Taste nicht erlaubt');
    await page.keyboard.press(data.key);
  } else if(type==='reels') {
    await page.goto('https://www.instagram.com/reels/',{waitUntil:'domcontentloaded',timeout:25000});
  } else throw Error('Aktion nicht erlaubt');
}
function waitUntilFile(file,timeout=18000) {
  return new Promise(resolve=>{
    const started=Date.now();const timer=setInterval(()=>{
      if(fs.existsSync(file)){clearInterval(timer);resolve(true);}
      else if(Date.now()-started>timeout){clearInterval(timer);resolve(false);}
    },500); timer.unref?.();
  });
}
async function startStream(r) {
  if(r.broadcast || r.streamStatus==='starting') return;
  if(r.browserStatus!=='ready')throw Error('Instagram-Browser noch nicht bereit');
  fs.mkdirSync(r.hlsDir,{recursive:true});
  r.streamStatus='starting';r.message='Liveübertragung wird gestartet …';notify();
  if(process.env.MOCK_BROWSER === '1') {r.streamStatus='mock';r.message='Testmodus: keine echte Videoaufnahme';notify();return;}
  const dir=r.hlsDir;
  const ffargs=[
    '-hide_banner','-loglevel','error','-y',
    '-thread_queue_size','512','-f','x11grab','-draw_mouse','0','-framerate','24',
    '-video_size','360x640','-i',`${process.env.DISPLAY||':99'}.0+0,0`,
    '-thread_queue_size','512','-f','pulse','-i','reelparty.monitor',
    '-map','0:v:0','-map','1:a:0',
    '-c:v','libx264','-preset','ultrafast','-tune','zerolatency',
    '-pix_fmt','yuv420p','-r','24','-g','24','-b:v','650k','-maxrate','800k','-bufsize','800k',
    '-c:a','aac','-b:a','72k','-ar','44100','-ac','2',
    '-f','hls','-hls_time','1','-hls_list_size','3','-hls_flags','delete_segments+independent_segments',
    '-hls_segment_filename',path.join(dir,'clip%05d.ts'),path.join(dir,'live.m3u8')
  ];
  const ff=spawn('ffmpeg',ffargs,{stdio:['ignore','ignore','pipe']});
  r.encoder=ff;
  let diagnostic='';
  ff.stderr.on('data',buf=>diagnostic=(diagnostic+buf.toString()).slice(-800));
  ff.on('error',err=>{ if(room===r){r.streamStatus='error';r.message=err.message;notify();}});
  ff.on('exit',()=>{if(room===r && r.encoder===ff){r.encoder=null;r.broadcast=false;r.streamStatus='error';r.message='Streaming gestoppt. '+diagnostic.slice(-180);notify();}});
  const ready=await waitUntilFile(path.join(dir,'live.m3u8'));
  if(room!==r)return;
  if(!ready) {killProc(ff);r.streamStatus='error';r.message='Kein Videostream verfügbar. Bitte Log und Audio-Konfiguration prüfen. '+diagnostic.slice(-180);notify();return;}
  r.broadcast=true;r.streamStatus='live';r.message='Live! Alle verbundenen iPads sehen dieselbe Instagram-Ansicht.';notify();
}
async function stopStream(r) {
  r.broadcast=false;r.streamStatus='off';r.message='Übertragung beendet';
  const encoder=r.encoder;r.encoder=null;killProc(encoder);
  try{fs.rmSync(r.hlsDir,{recursive:true,force:true});}catch{}
  notify();
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    const route=url.pathname;
    if(route==='/health')return json(res,200,{ok:true,room:!!room});
    if(route==='/api/state'&&req.method==='GET')return json(res,200,memberOf(req)?snapshot(memberOf(req)):{active:false,session:false});
    if(route==='/api/events'&&req.method==='GET') {
      const m=memberOf(req);if(!m)return bad(res,401,'Nicht angemeldet');
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      m.listeners.add(res);sse(res,'state',snapshot(m));
      const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},18000);
      req.on('close',()=>{clearInterval(heartbeat);m.listeners.delete(res);});return;
    }
    if(route==='/api/host/frame'&&req.method==='GET') {
      const m=memberOf(req);if(!isHost(m))return bad(res,403,'Nur Moderator');
      if(room.browserStatus!=='ready')return bad(res,503,'Browser startet');
      if(busyFrame)return bad(res,429,'Frame bereits angefordert');
      busyFrame=true;
      try{const bytes=await room.page.screenshot({type:'jpeg',quality:52,timeout:4500});
        res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
      }catch(e){bad(res,503,'Bild nicht verfügbar');}finally{busyFrame=false;}
      return;
    }
    if(route.startsWith('/hls/')&&req.method==='GET') {
      const m=memberOf(req);if(!m||!room.broadcast)return bad(res,403,'Kein Zugriff');
      const filename=route.slice('/hls/'.length);
      if(!/^live\.m3u8$|^clip\d{5,8}\.ts$/.test(filename))return bad(res,404,'Nicht gefunden');
      const full=path.join(room.hlsDir,filename);
      if(!fs.existsSync(full))return bad(res,404,'Stream wird vorbereitet');
      res.writeHead(200,{'Content-Type':filename.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t',
        'Cache-Control':'no-store','Access-Control-Allow-Origin':'same-origin','X-Content-Type-Options':'nosniff'});
      fs.createReadStream(full).on('error',()=>{try{res.end();}catch{}}).pipe(res);return;
    }
    if(req.method==='POST'&&route.startsWith('/api/')) {
      if(!guardRequest(req))return bad(res,403,'Ungültiger Ursprung');
      const body=await readBody(req);
      if(route==='/api/create') {
        if(room)return bad(res,409,'Auf diesem Server läuft bereits eine Watch-Party.');
        const name=safeName(body.name);if(!name)return bad(res,400,'Namen eingeben');
        const r={code:safeCode(),host:null,members:new Map(),browserStatus:'starting',broadcast:false,
          streamStatus:'off',message:'Browser wird gestartet …',browser:null,context:null,page:null,encoder:null,
          hlsDir:fs.mkdtempSync(path.join(os.tmpdir(),'reelparty-hls-'))};
        room=r;
        const m=addMember(name);r.host=m.id;
        setupBrowser(r);
        return json(res,201,{ok:true,state:snapshot(m)},sessionCookie(m.token));
      }
      if(route==='/api/join') {
        if(!room||String(body.code||'').trim().toUpperCase()!==room.code)return bad(res,404,'Raum nicht gefunden');
        const existing=memberOf(req);if(existing)return json(res,200,{ok:true,state:snapshot(existing)});
        const name=safeName(body.name);if(!name)return bad(res,400,'Bitte Namen eingeben');
        const m=addMember(name);if(!m)return bad(res,409,'Vier Personen sind bereits im Raum');
        return json(res,200,{ok:true,state:snapshot(m)},sessionCookie(m.token));
      }
      const m=memberOf(req);if(!m)return bad(res,401,'Bitte zuerst beitreten');
      if(route==='/api/leave') {
        if(isHost(m)){await cleanupRoom();}
        else {room.members.delete(m.id);sessions.delete(m.token);for(const s of m.listeners){s.end();}notify();}
        return json(res,200,{ok:true},'rp_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      }
      if(!isHost(m))return bad(res,403,'Diese Funktion ist nur für den Moderator');
      if(route==='/api/host/action') {
        await hostAction(body);return json(res,200,{ok:true});
      }
      if(route==='/api/host/start') {
        startStream(room).catch(e=>{if(room){room.streamStatus='error';room.message=e.message;notify();}});
        return json(res,202,{ok:true,starting:true});
      }
      if(route==='/api/host/stop') {
        await stopStream(room);return json(res,200,{ok:true});
      }
      return bad(res,404,'Unbekannte Aktion');
    }
    if(req.method!=='GET')return bad(res,405,'Methode nicht erlaubt');
    const requested=route==='/'?'index.html':route.slice(1);
    if(!['index.html','style.css','app.js','icon.svg'].includes(requested))return bad(res,404,'Nicht gefunden');
    const file=path.join(PUBLIC,requested);
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});
    fs.createReadStream(file).pipe(res);
  }catch(e){if(!res.headersSent)bad(res,400,e.message.slice(0,120));else res.end();}
});
if(require.main===module){server.listen(PORT,'0.0.0.0',()=>console.log(`ReelParty Live startet auf Port ${PORT}`));}
module.exports={server,cleanupRoom};
