'use strict';
// 암호화된 백업 풀기: BACKUP_KEY=... node tools/decrypt-backup.js data/backups/arcanum-2026111200.db.enc [출력.db]
const fs = require('fs'), crypto = require('crypto');
const [, , src, dst] = process.argv, key0 = process.env.BACKUP_KEY;
if (!src || !key0) { console.error('사용법: BACKUP_KEY=키 node tools/decrypt-backup.js 백업파일.db.enc [출력.db]'); process.exit(1); }
const buf = fs.readFileSync(src);
if (buf.slice(0, 5).toString() !== 'ARCB1') { console.error('모네타 암호화 백업이 아닙니다'); process.exit(1); }
const salt = buf.slice(5, 21), iv = buf.slice(21, 33), tag = buf.slice(33, 49), body = buf.slice(49);
const key = crypto.scryptSync(key0, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
let out; try { out = Buffer.concat([d.update(body), d.final()]); } catch (e) { console.error('키가 틀렸거나 파일이 손상되었습니다'); process.exit(1); }
const file = dst || src.replace(/\.enc$/, '');
fs.writeFileSync(file, out, { mode: 0o600 }); console.log('풀었습니다:', file);
