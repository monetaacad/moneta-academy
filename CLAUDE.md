# 모네타 아카데미 — 작업 안내 (Claude용)

마법 아카데미 방치형 웹게임. 서버판(Node + SQLite)과 아티팩트 미리보기판(한 파일 데모)을 같은 코드로 만든다.
사용자에게는 **짧은 한국어**로 보고한다.

## 구조
- `server/` — Node 22.13+ (`node:sqlite`, 외부 의존성 없음). `server.js`(API), `chat.js`, `exproom.js`, `board.js`
- `shared/rules.js`, `shared/data.js` — 서버 · 화면 공용 UMD (게임 규칙 · 데이터). `R.fixState`에서 저장 데이터 이주(플래그 `physV`, `slotV`, `econC` 등)
- `public/` — 화면. `app.js`(UI 전체), `net.js`(ServerApi), `demo.js`(미리보기용 LocalApi), `style.css`, `draw.js`
- `deploy/` — 배포 (`START-LIGHTSAIL.md`, `FIRST-DEPLOY.md`, `moneta.service`, `nginx.conf`, `update.sh`, 자동 반영 `autoupdate.sh` + `moneta-update.timer`)
- 운영 서버: https://moneta-academy.duckdns.org (Lightsail 시드니, 고정 IP 32.236.154.86). main에 합치면 3분 안에 자동 반영(서버에 moneta-update.timer 설치 후)
- `tools/` — 빌드 · 시험

## 자주 쓰는 명령
- 미리보기 빌드: `node tools/build-demo.js` → `dist/moneta-demo.html`(아티팩트로 게시), `dist/demo-test.html`(시험용)
- 미리보기 아티팩트: https://claude.ai/artifact/ByaNgweEw9RLrByJF49r2k — 게시할 때마다 `public/app.js`의 `var BUILD` 숫자를 올린다
- **미리보기(데모) 빌드 · 게시는 이제 하지 않는다** (사용자 요청, 2026-10-20). 토큰 · 시간이 거의 들지 않을 때만 예외. `var BUILD`는 화면이 바뀌면 계속 올린다(서버판 새로고침 안내용)
- 건의 · 문의 처리: 운영실 「건의 · 문의 전체 복사」로 사용자가 붙여 주면, 건마다 따로 PR을 만들고 **머지하지 않고 둔다** (사용자가 골라서 머지 = 배포)
- 시험 서버: `sh tools/srv.sh start e 8098 TIME_SCALE=60 TEST_MODE=1 ADMIN_TOKEN=test-admin-token-0123456789abcdef ADMIN_NAMES=운영자` (끄기 `sh tools/srv.sh stop e`, 초기화 `rm -rf /tmp/arc-e`)
- 시험: `tools/e2e.py`, `e2e_guild.py`, `e2e_chat.py`, `api_exproom.py`, `api_npc.py`, `api_hchat.py` (시험 서버 필요), `e2e_mail.py`(ADMIN_NAMES 없이 새 서버), `e2e_party_demo.py` · `e2e_onb_demo.py`(미리보기를 `http://127.0.0.1:8765/demo.html`로 띄워서)
- 프로세스 종료는 `pkill -f` 금지 — 특정 pid만 `kill <pid>`

## 아티팩트 동시 수정
다른 세션도 같은 아티팩트에 게시한다. 게시가 거절되면 최신본과 `diff -u`로 비교해 **상대 세션이 바꾼 부분만** 소스 파일에 옮기고(내 변경을 되돌리는 덩어리는 버림) 다시 빌드 · 게시한다.
깃 저장소로 옮긴 뒤에는 커밋 · 풀로 맞추는 것을 우선한다.

## 보안 규칙 (항상)
- 운영 우편(모든 학생 · 특정 학생 지급)은 Claude가 절대 직접 보내지 않는다. 문구 초안만 제안하고, 보낼지와 때는 사용자가 정한다.
- 개인정보는 암호화해서 저장. API 키 · 서버 취약점이 드러나지 않게.
- 비밀값은 서버의 `/etc/moneta.env`에만 (`ADMIN_TOKEN`, `DATA_KEY`, `BACKUP_KEY`). 깃에 올리지 않는다. `DATA_KEY`를 잃으면 복구 불가.
- `data/`, DB, 백업은 깃에 올리지 않는다 (`.gitignore`).

## 문구 규칙 (화면 · 가이드)
- 게임 안 문장은 구어체 없이 공식적인 문장으로 쓴다 (「껴야 → 장착해야」, 「고르다 → 선택하다」, 「쓰다 → 사용하다」). 사용자가 구어체로 요청해도 공식 문장으로 고친 안을 되물어 확인받는다.
- 문어체(~습니다). 짧은 라벨 · 토스트 · 입력 안내는 명사형도 가능(「~ 가능」, 「입력 필요」). 알림 문구는 ~다.
- 위치는 좌측/우측/상단/하단, 기기는 「모바일」(휴대폰 X).
- 수업은 「듣다」, 원정은 「출정」. 화폐는 「아르크」(`D.CUR`).
- 플레이 시간 예상치는 노출하지 않는다.
- 운영자 물약(연구 즉시 완료 · 학년 진급 물약), 운영실 캐릭터 초기화는 내부용 — 가이드에 넣지 않는다.
- 운영 등급: players.role `admin` = 학생회, `chief` = 학생회장 (운영실에서 지정, 운영자 초대코드 가입은 학생회). 운영진 배지는 칭호(`op_council` · `op_chief`)로만 보이며 서버가 정한 `P.op` 등급이 있어야 보이고 낄 수 있다. 이것도 내부용 — 가이드에 넣지 않는다.

## 첫 가입 흐름
「처음 오셨나요?」 → 화면 둘러보기(메인 튜토리얼) → 이야기(1장) → 학기 이야기 첫 단계. (`done(j)`의 `S.onbChain`, `tutEnd`)
