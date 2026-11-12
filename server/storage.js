/* 게임 상태 저장소
 *  - MONGODB_URI 가 있으면 MongoDB(예: Atlas 무료)에 저장 → 무료 서버가 잠들거나 재시작해도 이어짐
 *  - 없으면 data/state.json 파일에 저장 (내 컴퓨터에서 돌릴 때)
 * 상태 전체를 JSON 글자 하나로 저장한다 (Mongo 키 규칙에 안 걸리게).
 */
'use strict';
const fs = require('fs');
const path = require('path');

function fileStore(dir) {
  const file = path.join(dir, 'state.json');
  return {
    kind: `파일 (${file})`,
    async load() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } },
    async save(state) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    },
    async close() {},
  };
}

async function mongoStore(uri, dbName) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const col = client.db(dbName || 'mp2026').collection('state');
  let lastBackupDay = '';
  return {
    kind: `MongoDB (${dbName || 'mp2026'}.state)`,
    async load() {
      const doc = await col.findOne({ _id: 'main' });
      return doc ? JSON.parse(doc.json) : null;
    },
    async save(state) {
      const json = JSON.stringify(state);
      await col.replaceOne({ _id: 'main' }, { _id: 'main', json, savedAt: new Date() }, { upsert: true });
      // 하루 한 번 백업본도 남긴다 (실수로 망가져도 되돌릴 수 있게)
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      if (day !== lastBackupDay) {
        await col.replaceOne({ _id: 'backup-' + day }, { _id: 'backup-' + day, json, savedAt: new Date() }, { upsert: true });
        lastBackupDay = day;
      }
    },
    async close() { await client.close(); },
  };
}

module.exports = { fileStore, mongoStore };
