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
    async backup(state, id) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(state)); },
    // 문제 그림 같은 파일은 상태와 따로 저장한다 (상태 JSON이 커지지 않게)
    async putImage(id, buf, mime) { const d = path.join(dir, 'images'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, id), buf); fs.writeFileSync(path.join(d, id + '.mime'), mime); },
    async getImage(id) { const d = path.join(dir, 'images'); try { return { buf: fs.readFileSync(path.join(d, id)), mime: fs.readFileSync(path.join(d, id + '.mime'), 'utf8') }; } catch (e) { return null; } },
    async delImage(id) { const d = path.join(dir, 'images'); for (const f of [id, id + '.mime']) try { fs.unlinkSync(path.join(d, f)); } catch (e) {} },
    async close() {},
  };
}

async function mongoStore(uri, dbName) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(dbName || 'mp2026');
  const col = db.collection('state');
  const imgs = db.collection('images');
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
    async backup(state, id) { await col.replaceOne({ _id: id }, { _id: id, json: JSON.stringify(state), savedAt: new Date() }, { upsert: true }); },
    async putImage(id, buf, mime) { await imgs.replaceOne({ _id: id }, { _id: id, data: buf, mime, savedAt: new Date() }, { upsert: true }); },
    async getImage(id) { const d = await imgs.findOne({ _id: id }); return d ? { buf: Buffer.from(d.data.buffer || d.data), mime: d.mime } : null; },
    async delImage(id) { await imgs.deleteOne({ _id: id }); },
    async close() { await client.close(); },
  };
}

module.exports = { fileStore, mongoStore };
