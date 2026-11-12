/* MP 2026 서버 시작점: 저장소(MongoDB 또는 파일)에서 상태를 불러온 뒤 게임 서버를 띄운다.
 *   환경변수: PORT, MONGODB_URI(있으면 MongoDB), MONGODB_DB(기본 mp2026), DATA_DIR(파일 저장 위치), TEST_MODE
 */
'use strict';
const path = require('path');
const { fileStore, mongoStore } = require('./storage');

(async () => {
  const uri = process.env.MONGODB_URI;
  const store = uri ? await mongoStore(uri, process.env.MONGODB_DB) : fileStore(path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')));
  const initial = await store.load();
  console.log(`저장소: ${store.kind} · ${initial ? '이전 상태를 이어서 시작' : '새로 시작'}`);
  global.__MP_BOOT = { store, initial };
  require('./game-server.js');
})().catch((e) => {
  console.error('서버 시작 실패 (저장소 연결 확인):', e.message);
  process.exit(1);
});
