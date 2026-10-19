# 처음부터 배포하기 — AWS Lightsail + 무료 도메인(DuckDNS) + 깃허브

순서: ① 깃허브에 코드 올리기 → ② 무료 도메인 → ③ AWS 가입 → ④ 서버 만들기 → ⑤ 서버 설치 → ⑥ 게임 받기 → ⑦ 비밀값 → ⑧ 게임 켜기 → ⑨ HTTPS → ⑩ 운영 시작 → ⑪ 업데이트
아래에서 `내아이디`는 깃허브 아이디, `내이름`은 DuckDNS에서 정한 이름, `1.2.3.4`는 서버 고정 IP로 바꿔 읽습니다.

---

## ① 깃허브에 코드 올리기 (내 컴퓨터)
1. github.com 가입 → 우측 상단 `+` › **New repository** → 이름 `moneta-academy`, **Private** → Create (README 추가 체크 안 함).
2. 깃 설치 (맥: 터미널에서 `xcode-select --install` / 윈도: git-scm.com). 처음 한 번:
   ```bash
   git config --global user.name "내 이름"
   git config --global user.email "내 이메일"
   ```
3. 압축을 푼 `moneta-academy` 폴더에서:
   ```bash
   cd moneta-academy
   git init -b main
   git add -A
   git status        # data/ · backup/ · .env 가 목록에 없는지 확인
   git commit -m "첫 버전"
   git remote add origin https://github.com/monetaacad/moneta-academy.git
   git push -u origin main
   ```
   비밀번호를 물으면 **토큰**을 넣습니다: GitHub › Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate → Repository access: 이 저장소만 · Permissions › Contents: Read and write.
   (터미널이 어렵다면 GitHub Desktop 앱: File › Add local repository → Publish repository, 「Keep this code private」 체크.)

## ② 무료 도메인 만들기 (DuckDNS)
1. duckdns.org → 깃허브 또는 구글 계정으로 로그인.
2. 「sub domain」에 원하는 이름 → **add domain** → `내이름.duckdns.org` 생성.
3. IP는 ④에서 서버를 만든 뒤 넣습니다. 이 창은 열어 둡니다.

## ③ AWS 가입
1. aws.amazon.com → 계정 만들기 (이메일 · 카드 · 휴대폰 인증 필요).
2. 요금 방식 선택에서 **유료 플랜(Paid plan)** 을 고릅니다. (무료 플랜은 6개월 뒤 계정이 닫히고 서버가 삭제됨. 유료 플랜도 크레딧과 Lightsail 3개월 무료는 그대로 받음)
3. **결제 알림 걸기**: 콘솔 검색창에 `Budgets` → Create budget → 템플릿 「Monthly cost budget」 → 금액 `5` USD · 내 이메일 → Create. 이후 5달러가 넘을 것 같으면 메일이 옵니다.

## ④ Lightsail 서버 만들기
1. 콘솔 검색창에 `Lightsail` → **인스턴스 생성**.
2. 「인스턴스 위치」 → **AWS 리전 및 가용 영역 변경** → **서울 (ap-northeast-2)**. (Lightsail은 리전을 이 생성 화면에서 고릅니다)
3. 플랫폼 **Linux/Unix** → 블루프린트 「운영 체제(OS) 전용」 → **Ubuntu 24.04 LTS**.
4. 요금제: **듀얼 스택 · 월 7달러 (1GB · 2vCPU · 40GB)** — 처음 3개월 무료.
5. 이름 `moneta` → 인스턴스 생성. 1~2분 기다리면 「실행 중」.
6. **고정 IP**: 인스턴스 › 「네트워킹」 탭 → 「고정 IP 연결」 → 생성 → 이 인스턴스에 연결. 나온 IP(예: `1.2.3.4`)를 적어 둡니다.
   *고정 IP는 서버에 붙어 있으면 무료, 서버를 지우고 IP만 남기면 요금이 붙습니다.*
7. **방화벽**: 같은 「네트워킹」 탭 › IPv4 방화벽 → 규칙 추가 → **HTTPS (443)** 추가. (SSH 22 · HTTP 80은 기본으로 열려 있음)
8. DuckDNS 창으로 돌아가 `내이름` 줄의 current ip에 `1.2.3.4` → **update ip**.

## ⑤ 서버에 접속해 기본 설치
Lightsail 인스턴스 화면의 **「SSH를 사용하여 연결」** 버튼 → 브라우저에 검은 창이 열립니다. (아래 명령을 복사 → 창에 붙여넣기: 우클릭 또는 Ctrl+Shift+V)
```bash
sudo -i                              # 관리자 모드 (이후 명령은 모두 여기서)
timedatectl set-timezone Asia/Seoul
apt-get update && apt-get upgrade -y
# 메모리 1GB 보완용 스왑 1GB
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Node.js 24 · nginx · git · certbot
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs nginx git certbot python3-certbot-nginx
node -v                              # v22.13 이상이면 OK
```
upgrade 중 보라색 창이 뜨면 그대로 Enter.

## ⑥ 깃허브에서 게임 받기
서버가 저장소를 **읽기만** 할 수 있는 열쇠(배포 키)를 만듭니다.
```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/moneta_deploy -C "moneta-academy"
cat /root/.ssh/moneta_deploy.pub
```
나온 한 줄(`ssh-ed25519 ...`)을 복사 → 깃허브 저장소 › Settings › **Deploy keys** › Add deploy key → 붙여 넣기 (**Allow write access는 끔**) → Add.

```bash
cat >> /root/.ssh/config <<'CFG'
Host github-moneta
  HostName github.com
  User git
  IdentityFile /root/.ssh/moneta_deploy
  IdentitiesOnly yes
CFG
ssh -T github-moneta                # yes 입력 → "successfully authenticated" 나오면 성공

git clone github-moneta:monetaacad/moneta-academy.git /opt/moneta
git config --global --add safe.directory /opt/moneta
useradd -r -s /usr/sbin/nologin moneta
mkdir -p /opt/moneta/data && chown -R moneta:moneta /opt/moneta && chmod 700 /opt/moneta/data
```

## ⑦ 비밀값 만들기
```bash
install -m 600 -o root -g root /dev/null /etc/moneta.env
echo "ADMIN_TOKEN=$(openssl rand -base64 33)" >> /etc/moneta.env
echo "DATA_KEY=$(openssl rand -base64 33)"    >> /etc/moneta.env
echo "BACKUP_KEY=$(openssl rand -base64 33)"  >> /etc/moneta.env
echo "ADMIN_NAMES=운영자"                      >> /etc/moneta.env
cat /etc/moneta.env
```
**나온 값을 비밀번호 관리자 등 서버 밖에 꼭 따로 보관합니다.** `DATA_KEY`를 잃으면 모든 비밀번호 · 개인정보를 되살릴 수 없고, `BACKUP_KEY`를 잃으면 백업을 풀 수 없습니다. `ADMIN_TOKEN`은 운영실 로그인용이며 남에게 보이지 않습니다. 이 파일은 깃에 올라가지 않습니다.

## ⑧ 게임 켜기
내 주소와 개교일은 깃 밖의 별도 파일(`site.conf`)에 둡니다. 그래야 나중에 `git pull`과 부딪히지 않습니다.
```bash
cp /opt/moneta/deploy/moneta.service /etc/systemd/system/
mkdir -p /etc/systemd/system/moneta.service.d
cat > /etc/systemd/system/moneta.service.d/site.conf <<'CFG'
[Service]
Environment=PUBLIC_ORIGIN=https://내이름.duckdns.org
Environment=SERVER_EPOCH=2026-11-02T00:00:00+09:00
CFG
systemctl daemon-reload
systemctl enable --now moneta
systemctl status moneta             # active (running) 이면 성공 (q로 나가기)
curl -s http://127.0.0.1:8080/api/health
```
- `SERVER_EPOCH` = **개교일**(아카데미력 1일째). 처음 켤 때 DB에 기록되고 이후 바뀌지 않습니다.
  시험 기간 뒤 정식 오픈 때 새로 시작하고 싶으면: `systemctl stop moneta` → `rm -rf /opt/moneta/data/*` → site.conf의 날짜 수정 → `systemctl daemon-reload && systemctl start moneta` (시험 계정은 모두 사라짐).

## ⑨ nginx와 HTTPS
```bash
cp /opt/moneta/deploy/nginx.conf /etc/nginx/sites-available/moneta
sed -i 's/game.example.com/내이름.duckdns.org/' /etc/nginx/sites-available/moneta
ln -s /etc/nginx/sites-available/moneta /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d 내이름.duckdns.org     # 이메일 입력 → 약관 Y → 끝 (자동 갱신 포함)
```
브라우저에서 `https://내이름.duckdns.org` 가 열리면 성공.

## ⑩ 운영 시작
1. `https://내이름.duckdns.org/admin.html` → `ADMIN_TOKEN` 값으로 로그인.
2. **초대코드 발급** (개수 · 코드당 사용 횟수 · 기간).
3. 그 코드로 가입, 이름을 `운영자`(ADMIN_NAMES에 적은 이름)로 → 채팅 운영자.
4. 운영실 「지금 백업」 한 번 → 이후 12시간마다 자동 백업.
5. 모바일 · PC에서 가입 → 수업 → 채팅 → 거래소 → 우편함 한 번씩 확인.

## ⑪ 이후 업데이트
내 컴퓨터에서 코드를 바꾼 뒤:
```bash
git add -A && git commit -m "무엇을 바꿨는지" && git push
```
서버(SSH 창)에서 (운영실에서 백업 한 번 먼저):
```bash
sudo sh /opt/moneta/deploy/update.sh
```
운영실 「새 버전 알림」에 화면 빌드 번호(`public/app.js`의 `BUILD`)를 넣으면 접속자에게 새로고침 안내가 나갑니다.
되돌리기: `cd /opt/moneta && git log --oneline` → `git reset --hard 이전번호 && systemctl restart moneta`.
서버에서 직접 파일을 고치지 않습니다(다음 pull이 막힘). 고칠 것은 늘 내 컴퓨터 → push → 서버 update.

## 나중에 .app 도메인으로 옮길 때
1. 새 도메인 DNS에 A 레코드 → `1.2.3.4`.
2. `site.conf`의 `PUBLIC_ORIGIN` 변경 → `systemctl daemon-reload && systemctl restart moneta`.
3. `/etc/nginx/sites-available/moneta` 의 `server_name` 에 새 도메인 추가 → `certbot --nginx -d 새도메인`.
학생 데이터는 그대로. 학생은 로그인 1회 · 앱 재설치 · 화면 설정 초기화가 생깁니다.

## 그만둘 때 (요금 안 나가게)
운영실에서 백업 받기 + `/etc/moneta.env` 보관 → Lightsail에서 **인스턴스 삭제 + 고정 IP 삭제**(둘 다).

## 자주 막히는 곳
- 사이트가 안 열린다 → DuckDNS IP가 고정 IP와 같은지, Lightsail 방화벽에 443이 있는지, `nginx -t`.
- certbot 실패 → 도메인이 아직 서버 IP를 가리키지 않음(DuckDNS update ip 확인) 또는 80번이 막힘.
- 502 Bad Gateway → 게임 서버가 꺼짐: `systemctl status moneta`, `journalctl -u moneta -n 50`.
- 켜자마자 꺼진다 → 대부분 `DATA_KEY` 문제. `journalctl -u moneta -n 50` 에 이유가 나옵니다.
- `git clone` 이 Permission denied → 배포 키를 저장소의 Deploy keys에 넣었는지, `ssh -T github-moneta` 확인.
