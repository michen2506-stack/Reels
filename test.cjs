'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
process.env.MOCK_BROWSER = '1';
process.env.REELPARTY_ACCESS_PASSWORD = 'ci-example-password';
const {server,cleanupRoom} = require('./server');
const cookie = headers => headers.get('set-cookie')?.split(';')[0] || '';
test('Watch Party: up to four users, private moderator actions', async () => {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url = 'http://127.0.0.1:' + server.address().port;
 async function request(route, method='GET', data={}, session='') {
  const response = await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{})},...(method==='POST'?{body:JSON.stringify(data)}:{})});
  return {status:response.status,data:await response.json(),cookie:cookie(response.headers)};
 }
 try {
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/api/host/frame')).status,401);
  const access=await request('/api/access/login','POST',{password:'ci-example-password'});
  assert.equal(access.status,200);
  const accessCookie=access.cookie;
  const authenticated=(session='')=>[accessCookie,session].filter(Boolean).join('; ');
  const host=await request('/api/create','POST',{name:'Host'},authenticated());
  assert.equal(host.status,201);
  const code=host.data.state.code;
  const guests=[];
  for(let i=0;i<3;i++){const r=await request('/api/join','POST',{name:'Guest'+i,code},authenticated());assert.equal(r.status,200);guests.push(r);}
  assert.equal((await request('/api/join','POST',{name:'Guest4',code},authenticated())).status,409);
  assert.equal((await request('/api/state','GET',{},authenticated(host.cookie))).data.members.length,4);
  assert.equal((await request('/api/host/action','POST',{type:'scroll',amount:1},authenticated(guests[0].cookie))).status,403);
  assert.equal((await request('/api/host/action','POST',{type:'scroll',amount:1},authenticated(host.cookie))).status,200);
  assert.equal((await request('/api/host/action','POST',{type:'tap',x:9999,y:2},authenticated(host.cookie))).status,400);
  assert.equal((await request('/api/leave','POST',{},authenticated(host.cookie))).status,200);
  assert.equal((await request('/api/state','GET',{},authenticated(guests[0].cookie))).data.active,false);
 } finally {await cleanupRoom();await new Promise(resolve=>server.close(resolve));}
});
