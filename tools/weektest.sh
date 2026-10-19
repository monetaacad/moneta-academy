#!/bin/sh
# 주간 정산 · 재시작 보존 테스트 (시간 5만 배속: 1주 ≈ 12초)
B=http://127.0.0.1:8096; set -e
rm -rf /tmp/arc-week; tools/srv.sh start week 8096 TIME_SCALE=50000 TEST_MODE=1 INVITE_REQUIRED=0 >/dev/null
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log($1)})"; }
for n in 가 나 다; do curl -s -c /tmp/wk$n -X POST $B/api/register -H 'content-type: application/json' -d "{\"name\":\"주간$n\",\"password\":\"weektest123\",\"cls\":\"mage\",\"house\":\"$( [ $n = 가 ] && echo corona || echo speculum )\"}" > /dev/null; done
for n in 가 나 다; do curl -s -b /tmp/wk$n -X POST $B/api/act -H 'content-type: application/json' -d '{"type":"wbAttack"}' | j "'공격 '+(o.error||o.r.dmg)"; done
curl -s -b /tmp/wk가 -X POST $B/api/act -H 'content-type: application/json' -d '{"type":"lecStart","a":{"slot":0,"s":"elem","d":"1h"}}' | j "'수업 '+(o.error||'ok')"
W1=$(curl -s $B/api/world | j "o.week"); echo "현재 주차 $W1"
sleep 16
curl -s $B/api/world | j "'주차 '+o.week+' / 지난주 결과: '+JSON.stringify(o.lastWeek&&{cup:o.lastWeek.cup,killed:o.lastWeek.killed,participants:o.lastWeek.participants})"
curl -s -b /tmp/wk가 $B/api/state | j "'지난주 기록 '+JSON.stringify(o.P.wkPrev)"
curl -s -b /tmp/wk가 -X POST $B/api/act -H 'content-type: application/json' -d '{"type":"weekClaim"}' | j "'보상 '+(o.error||JSON.stringify(o.r))"
curl -s -b /tmp/wk가 -X POST $B/api/act -H 'content-type: application/json' -d '{"type":"weekClaim"}' | j "'두 번째 수령 → '+(o.error||'받아짐(버그)')"
S1=$(curl -s -b /tmp/wk가 $B/api/state | j "o.P.res.shard+'/'+o.P.subj.elem.lv+'/'+o.P.st.lecJobs")
echo "재시작 전: 별조각/원소역학Lv/수업수 = $S1"
tools/srv.sh restart week 8096 TIME_SCALE=1 TEST_MODE=1 >/dev/null
S2=$(curl -s -b /tmp/wk가 $B/api/state | j "o.P.res.shard+'/'+o.P.subj.elem.lv+'/'+o.P.st.lecJobs")
echo "재시작 후: 별조각/원소역학Lv/수업수 = $S2"
[ "$S1" = "$S2" ] && echo "보존 OK" || echo "보존 실패"
tools/srv.sh stop week 0
grep -E "정산|토벌|보스 등장" /tmp/arc-week.log | head -5
