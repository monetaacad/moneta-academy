# 처음 서버에 올리기 (리눅스 VPS · Ubuntu 24.04 기준)

> AWS Lightsail + 무료 도메인(DuckDNS) + 깃허브로 처음부터 하는 단계별 안내는 **`deploy/START-LIGHTSAIL.md`** 에 있습니다. 이 문서는 일반 VPS용 참고서입니다.

준비물: 서버(VPS) 1대, 도메인 1개, 내 컴퓨터의 터미널(맥: 터미널, 윈도: PowerShell).
아래에서 `game.example.com`은 내 도메인, `1.2.3.4`는 서버 IP로 바꿔 읽으세요.

## 0. 서버와 도메인 준비
1. VPS를 만듭니다 (Ubuntu 24.04, 1~2 vCPU, 메모리 1GB 이상, 디스크 10GB 이상). 만들 때 SSH 키 또는 root 비밀번호를 받습니다.
2. 도메인 관리 화면에서 **A 레코드**를 추가합니다: 이름 `game`(또는 원하는 것) → 값 `1.2.3.4`. 반영까지 몇 분~몇 시간.

## 1. 서버 접속과 기본 보안
```bash
ssh root@1.2.3.4
apt-get update && apt-get upgrade -y
# 방화벽: SSH와 웹만 연다 (8080은 열지 않는다. 게임 서버는 nginx 뒤에서만)
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Node.js와 nginx 설치
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs nginx unzip
node -v    # v22.13 이상이어야 합니다 (DB에 node:sqlite를 씀)
```

## 3. 코드 올리기
내 컴퓨터에서 (압축 파일이 있는 폴더에서):
```bash
scp moneta-academy.zip root@1.2.3.4:/root/
```
서버에서:
```bash
cd /root && unzip -q moneta-academy.zip
mkdir -p /opt/moneta && cp -r /root/moneta-academy/. /opt/moneta/
useradd -r -s /usr/sbin/nologin moneta
mkdir -p /opt/moneta/data && chown -R moneta:moneta /opt/moneta && chmod 700 /opt/moneta/data
```

## 4. 비밀값 만들기 (/etc/moneta.env)
```bash
install -m 600 -o root -g root /dev/null /etc/moneta.env
echo "ADMIN_TOKEN=$(openssl rand -base64 33)" >> /etc/moneta.env
echo "DATA_KEY=$(openssl rand -base64 33)"    >> /etc/moneta.env
echo "BACKUP_KEY=$(openssl rand -base64 33)"  >> /etc/moneta.env
echo "ADMIN_NAMES=운영자"                      >> /etc/moneta.env   # 채팅 운영자로 쓸 학생 이름 (쉼표로 여러 명)
cat /etc/moneta.env
```
**`cat`으로 나온 세 값을 비밀번호 관리자 등 서버 밖에 꼭 따로 보관하세요.**
- `DATA_KEY`를 잃으면 모든 비밀번호·개인정보를 되살릴 수 없습니다.
- `BACKUP_KEY`를 잃으면 백업을 풀 수 없습니다.
- `ADMIN_TOKEN`은 아카데미 운영실(`/admin.html`) 로그인에 씁니다. 남에게 보이지 마세요.

## 5. 서비스 설정 고치고 켜기
```bash
nano /opt/moneta/deploy/moneta.service
```
다음 두 줄을 내 값으로 고칩니다:
- `Environment=SERVER_EPOCH=2026-11-02T00:00:00+09:00` → **개교일**(아카데미력 1일째). 처음 켤 때 DB에 기록되고 이후 바뀌지 않으니 신중히.
- `Environment=PUBLIC_ORIGIN=https://game.example.com` → 내 주소.

```bash
cp /opt/moneta/deploy/moneta.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now moneta
systemctl status moneta          # active (running) 이면 성공
curl -s http://127.0.0.1:8080/api/health    # {"ok":true,...}
journalctl -u moneta -f          # 로그 보기 (Ctrl+C로 나가기)
```

## 6. nginx와 HTTPS
```bash
sed -i 's/game.example.com/내도메인/' /opt/moneta/deploy/nginx.conf
cp /opt/moneta/deploy/nginx.conf /etc/nginx/sites-available/moneta
ln -s /etc/nginx/sites-available/moneta /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d 내도메인          # 이메일 입력, 약관 동의 → HTTPS 자동 설정 (자동 갱신도 켜짐)
```
이제 브라우저에서 `https://내도메인` 이 열립니다.

## 7. 처음 운영 설정
1. `https://내도메인/admin.html` → `ADMIN_TOKEN` 값을 넣고 들어갑니다.
2. **초대코드 발급**: 개수 · 코드당 사용 횟수 · 기간을 정해 만듭니다.
3. 그 코드로 게임에 가입합니다. 이름을 `ADMIN_NAMES`에 적은 이름(예: 운영자)으로 하면 채팅 운영자가 됩니다.
4. 운영실에서 「지금 백업」을 한 번 눌러 `data/backups/`에 백업이 생기는지 확인합니다 (이후 12시간마다 자동).
5. 휴대폰과 PC에서 한 번씩: 가입 → 수업 맡기기 → 채팅 → 거래소 → 우편함.

## 8. 이후 업데이트할 때
1. 운영실에서 백업 · (필요하면) 점검 예약.
2. 새 압축 파일을 올리고, `data/`는 건드리지 않고 덮어쓰기:
   ```bash
   cd /root && rm -rf moneta-academy && unzip -q moneta-academy.zip
   rsync -a --exclude data/ /root/moneta-academy/ /opt/moneta/
   chown -R moneta:moneta /opt/moneta
   cp /opt/moneta/deploy/moneta.service /etc/systemd/system/ && systemctl daemon-reload   # 서비스 파일이 바뀌었을 때 (SERVER_EPOCH·PUBLIC_ORIGIN 다시 확인)
   systemctl restart moneta && journalctl -u moneta -n 30
   ```
3. 운영실 「새 버전 알림」에 화면 빌드 번호(`public/app.js`의 `BUILD`)를 넣어 접속자에게 새로고침 안내.
4. 문제가 생기면 이전 압축 파일로 같은 방법으로 덮고 다시 켭니다. DB를 되돌릴 때만 백업을 `data/moneta.db`로 복사(README 6장).

## 9. 깃(GitHub)으로 코드 관리 · 배포 (압축 파일 대신)
압축 파일을 매번 올리는 대신, 코드를 GitHub 비공개 저장소에 두고 서버에서 `git pull`로 받는 방식입니다.
`.gitignore`가 `data/`(DB · 백업), `.env`, 작업 폴더를 빼 주므로 **개인정보와 비밀값은 깃에 올라가지 않습니다.** `/etc/moneta.env`는 원래 서버에만 있습니다.

### 9-1. 내 컴퓨터: 저장소 만들기 (처음 한 번)
1. github.com 가입 → 우측 상단 `+` › **New repository** → 이름 `moneta-academy`, **Private** 선택 → Create (README 추가는 체크하지 않음).
2. 내 컴퓨터에 깃 설치 (맥: `xcode-select --install`, 윈도: git-scm.com). 처음이면 이름 · 이메일 등록:
   ```bash
   git config --global user.name "내 이름"
   git config --global user.email "내 이메일"
   ```
3. 압축을 푼 `moneta-academy` 폴더에서:
   ```bash
   cd moneta-academy
   git init -b main
   git add -A
   git status            # data/ · backup/ · .env 가 목록에 없는지 꼭 확인
   git commit -m "첫 버전"
   git remote add origin https://github.com/monetaacad/moneta-academy.git
   git push -u origin main
   ```
   push 때 비밀번호를 물으면 GitHub 비밀번호가 아니라 **토큰**을 넣습니다: GitHub › Settings › Developer settings › Personal access tokens › Fine-grained › 이 저장소만 · Contents: Read and write.
   (GitHub Desktop 앱을 쓰면 3번을 버튼으로 할 수 있습니다: File › Add local repository → Publish repository, 「Keep this code private」 체크.)

### 9-2. 서버: 깃에서 받도록 바꾸기 (처음 한 번)
서버가 저장소를 **읽기만** 할 수 있는 배포 키를 만듭니다.
```bash
apt-get install -y git
ssh-keygen -t ed25519 -N "" -f /root/.ssh/moneta_deploy -C "moneta-academy"
cat /root/.ssh/moneta_deploy.pub
```
나온 한 줄을 GitHub 저장소 › Settings › **Deploy keys** › Add deploy key 에 붙여 넣습니다 (**Allow write access는 끔**).

```bash
cat >> /root/.ssh/config <<'CFG'
Host github-moneta
  HostName github.com
  User git
  IdentityFile /root/.ssh/moneta_deploy
  IdentitiesOnly yes
CFG
ssh -T github-moneta        # "successfully authenticated" 가 나오면 성공 (yes 입력)

# 이미 압축 파일로 올린 /opt/moneta 을 깃 저장소로 바꾼다 (data/ 는 그대로 둔다)
cd /opt/moneta
git init -b main
git remote add origin github-moneta:monetaacad/moneta-academy.git
git fetch origin
git reset --hard origin/main     # 코드만 깃 버전으로 맞춤. data/ 는 .gitignore 라 지워지지 않음
git config --global --add safe.directory /opt/moneta
chown -R moneta:moneta /opt/moneta
```
처음부터 깃으로 시작한다면 3번 대신 `git clone github-moneta:monetaacad/moneta-academy.git /opt/moneta` 후 3번의 `useradd` · `mkdir data` · `chown` 줄만 실행합니다.

### 9-3. 이후 업데이트
내 컴퓨터에서 코드를 고친 뒤:
```bash
git add -A && git commit -m "무엇을 바꿨는지" && git push
```
서버에서 (운영실에서 백업을 먼저 한 번):
```bash
cd /opt/moneta && git pull --ff-only && chown -R moneta:moneta /opt/moneta && systemctl restart moneta
# 또는 같은 일을 하는 스크립트:  sh /opt/moneta/deploy/update.sh
```
되돌리기: `git log --oneline`으로 이전 버전 번호를 보고 `git reset --hard 번호 && systemctl restart moneta`.
주의: 서버에서 직접 파일을 고치지 마세요(다음 pull이 막힘). 고칠 것은 늘 내 컴퓨터 → push → 서버 pull 순서로.

## 자주 막히는 곳
- `node -v`가 22.13보다 낮다 → 2번을 다시 (setup_24.x).
- 사이트가 안 열린다 → DNS 반영 대기, `ufw status`에 80/443이 있는지, `nginx -t`.
- 502 Bad Gateway → 게임 서버가 꺼져 있음: `systemctl status moneta`, `journalctl -u moneta -n 50`.
- 서버가 켜지자마자 꺼진다 → 대부분 `DATA_KEY`가 32자보다 짧거나, 이미 쓰던 DB와 다른 `DATA_KEY`. 로그(`journalctl -u moneta -n 50`)에 이유가 나옵니다.
- 운영실에 못 들어간다 → `ADMIN_TOKEN`이 24자보다 짧으면 관리자 기능이 꺼집니다.

## 웹앱으로 설치하기 (PWA) · .app 주소
게임에 이미 들어 있습니다: `public/manifest.webmanifest`(이름 · 아이콘 · 「standalone」 = 주소창 없이 열기), `public/sw.js`(서비스 워커, 게임 정보는 저장하지 않음), `public/icons/`.
- **HTTPS여야** 설치 버튼이 뜹니다 (6번 certbot까지 하면 됨). 로컬(127.0.0.1)에서는 http로도 시험 가능.
- PC 크롬/엣지: 주소창 오른쪽 「설치」 아이콘, 또는 게임 설정 › 「앱으로 쓰기」 › 「앱으로 설치」.
- 안드로이드 크롬: 메뉴 › 「앱 설치」(또는 설정의 버튼).
- 아이폰 사파리: 공유 버튼 › 「홈 화면에 추가」 (iOS는 설치 버튼을 띄울 수 없어 안내만 나옴).
- 이름 · 아이콘을 바꾸려면 manifest의 `name`/`short_name`과 `icons/` 그림을 바꾸면 됩니다.

**.app 주소**: 도메인 판매처(가비아 · Cloudflare Registrar · Porkbun · Namecheap 등)에서 `원하는이름.app`을 사면 됩니다 (보통 1년 2~3만 원대).
.app은 구글이 운영하는 도메인이라 **반드시 HTTPS로만 열립니다**(브라우저가 http를 막음). 이 게임은 certbot으로 HTTPS를 켜므로 그대로 쓰면 됩니다.
사는 곳의 DNS 관리에서 0번처럼 A 레코드(`@` 또는 `game` → 서버 IP)를 넣고, 6번의 도메인 자리에 그 주소를 넣으면 끝.
