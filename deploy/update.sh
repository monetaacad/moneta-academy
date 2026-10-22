#!/bin/sh
# 서버에서 깃으로 최신 코드를 받아 다시 켠다:  sudo sh /opt/moneta/deploy/update.sh
# data/ 와 /etc/moneta.env, /etc/systemd/system/moneta.service.d/site.conf 는 깃에 없으므로 건드리지 않는다.
set -e
export HOME="${HOME:-/root}"   # 타이머(systemd)에서 실행될 때도 git 설정을 읽게
cd /opt/moneta
echo "▶ 현재 버전: $(git log -1 --format='%h %s')"
OLD=$(git rev-parse HEAD)
git pull --ff-only                       # 배포 키가 root에 있으므로 root로 받고
# 문법 오류가 있으면 켜지 않고 이전 버전으로 되돌린다 (되돌린 커밋은 /var/lib/moneta-bad-commit에 적어 자동 반영이 다시 받지 않게 한다)
for f in server/*.js shared/*.js public/*.js; do
  if ! node --check "$f"; then echo "✖ 문법 오류: $f → 이전 버전으로 되돌립니다"; git rev-parse HEAD > /var/lib/moneta-bad-commit; git reset -q --hard "$OLD"; chown -R moneta:moneta /opt/moneta; exit 1; fi
done
chown -R moneta:moneta /opt/moneta   # 소유자를 게임 계정으로 되돌린다
echo "▶ 새 버전:   $(git log -1 --format='%h %s')"
# 서비스 파일이 바뀌었으면 반영 (주소·개교일은 site.conf 에 있으므로 덮어써도 안전)
if ! cmp -s deploy/moneta.service /etc/systemd/system/moneta.service; then
  cp deploy/moneta.service /etc/systemd/system/moneta.service
  systemctl daemon-reload
  echo "▶ 서비스 파일 갱신"
fi
systemctl restart moneta
# 20초 안에 서버가 응답하지 않으면 이전 버전으로 되돌려 다시 켠다 (점검 중 503도 정상으로 본다)
ok=0; for i in $(seq 20); do sleep 1; c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health || true); [ "$c" = 200 ] || [ "$c" = 503 ] && { ok=1; break; }; done
if [ "$ok" != 1 ] && [ "$OLD" != "$(git rev-parse HEAD)" ]; then
  echo "✖ 새 버전이 켜지지 않음 → $(git log -1 --format='%h' "$OLD")로 되돌립니다"
  git rev-parse HEAD > /var/lib/moneta-bad-commit; git reset -q --hard "$OLD"; chown -R moneta:moneta /opt/moneta; systemctl restart moneta; sleep 3
fi
systemctl --no-pager status moneta | head -3
curl -s http://127.0.0.1:8080/api/health; echo
