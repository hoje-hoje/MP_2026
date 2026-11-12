/* 부하 테스트: 가짜 접속자 N명이 지도 위를 걸어 다닌다.
 *   node test/bots.js [인원=150] [주소=ws://localhost:8080/ws] [초=30]
 * 절반은 한곳(우리 수도 근처)에 몰려 있게 해서 최악의 경우를 본다.
 */
'use strict';
const WebSocket = require('ws');
const N = +process.argv[2] || 150;
const URL_ = process.argv[3] || 'ws://localhost:8080/ws';
const SECS = +process.argv[4] || 30;

let recvBytes = 0, recvMsgs = 0, opened = 0, errors = 0;
const bots = [];
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(URL_);
  const crowd = i < N / 2;
  const b = { ws, x: crowd ? 11000 + Math.random() * 800 : 2000 + Math.random() * 18000, y: crowd ? 11000 + Math.random() * 600 : 2000 + Math.random() * 18000, a: Math.random() * 6.28 };
  ws.on('open', () => { opened++; ws.send(JSON.stringify({ t: 'hello', name: `봇${i}`, team: 1 + (i % 38), look: {} })); });
  ws.on('message', (d) => { recvBytes += d.length; recvMsgs++; });
  ws.on('error', () => { errors++; });
  bots.push(b);
}
const mover = setInterval(() => {
  for (const b of bots) {
    if (b.ws.readyState !== 1) continue;
    b.a += (Math.random() - 0.5) * 0.6;
    b.x += Math.cos(b.a) * 16; b.y += Math.sin(b.a) * 16;
    b.ws.send(JSON.stringify({ t: 'move', x: b.x, y: b.y, dir: Math.cos(b.a) < 0 ? -1 : 1, moving: 1, scene: 'ground' }));
  }
}, 100);
const chatter = setInterval(() => { const b = bots[(Math.random() * N) | 0]; if (b.ws.readyState === 1) b.ws.send(JSON.stringify({ t: 'chat', text: '테스트 메시지' })); }, 200);

const t0 = Date.now();
let lastB = 0;
const rep = setInterval(() => {
  const s = (Date.now() - t0) / 1000;
  console.log(`${s.toFixed(0)}s  접속 ${opened}/${N}  수신 ${(recvBytes / 1024 / s).toFixed(0)} KB/s 전체 (봇 1명당 ${((recvBytes - lastB) / 1024 / 5 / Math.max(1, opened)).toFixed(1)} KB/s)  메시지 ${recvMsgs}  오류 ${errors}`);
  lastB = recvBytes;
}, 5000);
setTimeout(() => { clearInterval(mover); clearInterval(chatter); clearInterval(rep); for (const b of bots) b.ws.close(); setTimeout(() => process.exit(0), 300); }, SECS * 1000);
