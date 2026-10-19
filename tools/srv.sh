#!/bin/sh
# 테스트 서버 켜기/끄기: tools/srv.sh start|stop 이름 포트 [추가 환경변수...]
cmd=$1; name=$2; port=$3; shift $(( $# < 3 ? $# : 3 ))
pidf=/tmp/arc-$name.pid
if [ "$cmd" = stop ] || [ "$cmd" = restart ]; then [ -f $pidf ] && kill $(cat $pidf) 2>/dev/null; rm -f $pidf; sleep 0.5; fi
if [ "$cmd" = start ] || [ "$cmd" = restart ]; then
  env DATA_DIR=/tmp/arc-$name PORT=$port "$@" nohup node server/server.js > /tmp/arc-$name.log 2>&1 &
  echo $! > $pidf; sleep 1.2; curl -s http://127.0.0.1:$port/api/health; echo
fi
