'use strict';
// 개인정보 암호화와 비밀번호 후추(pepper)
// - DATA_KEY(환경 변수) 하나에서 용도별 키를 뽑는다(HKDF). 없으면 데이터 폴더에 키 파일을 만들어 쓴다(경고).
// - 프로필 글, 두상, 채팅 내용, 신고 사유는 AES-256-GCM으로 암호화해 DB에 넣는다.
//   DB 파일이나 백업이 새어 나가도 키 없이는 읽을 수 없다.
// - 비밀번호는 HMAC(후추)을 거친 뒤 scrypt로 해시한다. DB만 훔쳐서는 비밀번호를 대입해 볼 수조차 없다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function create(dataDir, log) {
  let master = process.env.DATA_KEY || '';
  if (master && master.length < 32) { console.error('DATA_KEY는 32자 이상이어야 합니다 (예: openssl rand -base64 33)'); process.exit(1); }
  if (!master) {
    const f = path.join(dataDir, '.data.key');
    try { master = fs.readFileSync(f, 'utf8').trim(); }
    catch (e) { master = crypto.randomBytes(33).toString('base64'); fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(f, master, { mode: 0o600 }); }
    log('경고: DATA_KEY가 없어 ' + f + ' 의 키를 씁니다. 운영 서버에서는 이 값을 /etc/moneta.env 의 DATA_KEY로 옮기고 파일을 지우세요. 키를 잃으면 비밀번호와 개인정보를 되살릴 수 없습니다.');
  }
  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(master), Buffer.from('moneta'), Buffer.from(info), 32));
  const dataKey = derive('data-v1'), pepperKey = derive('pepper-v1'), idxKey = derive('index-v1');
  const fp = crypto.createHash('sha256').update(dataKey).digest('base64url').slice(0, 12);  // 키가 바뀌었는지 알아보는 지문

  function encBuf(buf) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([Buffer.from('E1'), iv, c.getAuthTag(), ct]);
  }
  function decBuf(buf) {
    if (!buf) return buf; buf = Buffer.from(buf);
    if (buf.length < 30 || buf[0] !== 0x45 || buf[1] !== 0x31) return buf;   // 예전 평문
    const d = crypto.createDecipheriv('aes-256-gcm', dataKey, buf.slice(2, 14)); d.setAuthTag(buf.slice(14, 30));
    return Buffer.concat([d.update(buf.slice(30)), d.final()]);
  }
  function enc(str) { return 'e1:' + encBuf(Buffer.from(String(str), 'utf8')).toString('base64'); }
  function dec(s) {
    if (typeof s !== 'string' || !s.startsWith('e1:')) return s;
    try { return decBuf(Buffer.from(s.slice(3), 'base64')).toString('utf8'); } catch (e) { return ''; }
  }
  const isEnc = (s) => typeof s === 'string' && s.startsWith('e1:');
  const isEncBuf = (b) => b && b.length > 2 && b[0] === 0x45 && b[1] === 0x31;
  function pepper(pw) { return crypto.createHmac('sha256', pepperKey).update(String(pw).normalize('NFC')).digest('base64'); }
  function index(s) { return crypto.createHmac('sha256', idxKey).update(String(s)).digest('base64url').slice(0, 24); }
  return { enc, dec, encBuf, decBuf, isEnc, isEncBuf, pepper, index, fingerprint: fp };
}
module.exports = { create };
