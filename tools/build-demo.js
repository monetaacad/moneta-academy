// 서버 없이 도는 단일 HTML 데모 (같은 규칙 엔진 + 브라우저 저장)
const fs = require('fs'), p = require('path'), R = (f) => fs.readFileSync(p.join(__dirname, '..', f), 'utf8');
const strip = (s) => s.replace(/<\/script>/gi, '<\\/script>');
const html = `<title>아르카눔 아카데미</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Hahmlet:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600;700&display=swap">
<style>
${R('public/style.css')}
</style>
<canvas id="sky" aria-hidden="true"></canvas>
<div id="app"><p style="padding:40px;text-align:center;color:#a3a8c6">학원 문을 여는 중…</p></div>
<div id="toasts" aria-live="polite"></div>
<div id="modal" hidden></div>
<script>
${strip(R('shared/data.js'))}
</script>
<script>
${strip(R('shared/rules.js'))}
</script>
<script>
${strip(R('public/draw.js'))}
${strip(R('public/sound.js'))}
${strip(R('public/net.js'))}
${strip(R('public/demo.js'))}
${strip(R('public/app.js'))}
</script>
`;
fs.writeFileSync(p.join(__dirname, '..', 'dist', 'arcanum-demo.html'), html);
fs.writeFileSync(p.join(__dirname, '..', 'dist', 'demo-test.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + html + '</body></html>');
console.log('demo', (html.length / 1024).toFixed(0) + 'KB');
