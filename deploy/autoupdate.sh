#!/bin/sh
# 자동 반영: 깃허브 main에 새 커밋이 있으면 update.sh로 받아서 다시 켠다 (moneta-update.timer가 3분마다 실행)
# 설치 (서버에서 한 번):
#   cp /opt/moneta/deploy/moneta-update.service /opt/moneta/deploy/moneta-update.timer /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now moneta-update.timer
# 기록 보기: journalctl -u moneta-update -n 30
set -e
# systemd로 실행되면 HOME이 없어 git이 /root/.gitconfig(safe.directory)를 못 읽는다
export HOME=/root
cd /opt/moneta
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
echo "▶ 새 커밋 발견: $(git log -1 --format='%h %s' origin/main)"
exec sh /opt/moneta/deploy/update.sh
