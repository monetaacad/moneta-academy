#!/bin/sh
# 서버에서 깃으로 최신 코드를 받아 다시 켠다:  sudo sh /opt/moneta/deploy/update.sh
# data/ 와 /etc/moneta.env, /etc/systemd/system/moneta.service.d/site.conf 는 깃에 없으므로 건드리지 않는다.
set -e
cd /opt/moneta
echo "▶ 현재 버전: $(git log -1 --format='%h %s')"
git pull --ff-only                       # 배포 키가 root에 있으므로 root로 받고
chown -R moneta:moneta /opt/moneta   # 소유자를 게임 계정으로 되돌린다
echo "▶ 새 버전:   $(git log -1 --format='%h %s')"
# 서비스 파일이 바뀌었으면 반영 (주소·개교일은 site.conf 에 있으므로 덮어써도 안전)
if ! cmp -s deploy/moneta.service /etc/systemd/system/moneta.service; then
  cp deploy/moneta.service /etc/systemd/system/moneta.service
  systemctl daemon-reload
  echo "▶ 서비스 파일 갱신"
fi
systemctl restart moneta
sleep 2
systemctl --no-pager status moneta | head -3
curl -s http://127.0.0.1:8080/api/health; echo
