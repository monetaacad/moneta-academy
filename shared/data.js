/* 모네타 아카데미 — 세계관 및 게임 데이터 */
var DATA = (function () {
  var D = {};
  // 아카데미 화폐 이름: 여기 한 곳만 바꾸면 화면·기록·서버 메시지가 모두 바뀐다 (조사는 받침 없는 이름 기준: 가·를·는)
  var CUR = D.CUR = '아르크';

  D.WORLD = {
    title: '모네타 아카데미',
    calendarMonths: ['서사달', '기록달', '피리달', '웃음달', '가면달', '춤달', '연가달', '별무리달', '침묵달'],   // 아홉 무사이 (칼리오페 → 폴리힘니아)
    baseYear: 1024
  };

  /* ───────── 서버형: 시간제 작업 ─────────
     효율(eff)은 시간당 효율. 짧게 자주 들어올수록 약간 이득, 길게 맡기면 편하다. */
  D.DURATIONS = [
    { k: '30m', s: 1800, eff: 1.00, label: '30분' },
    { k: '1h', s: 3600, eff: 1.00, label: '1시간' },
    { k: '2h', s: 7200, eff: 0.97, label: '2시간' },
    { k: '3h', s: 10800, eff: 0.94, label: '3시간' }
  ];
  // 게시판 말머리
  D.BOARD_TAGS = [{ id: 'q', name: '질문', c: '#7fc8ff' }, { id: 'recruit', name: '모집', c: '#8ad08a' }, { id: 'trade', name: '거래', c: '#f2c84b' }, { id: 'rp', name: 'RP', c: '#c4a5ff' }, { id: 'chat', name: '잡담', c: '#b9bccb' }, { id: 'idea', name: '건의', c: '#ff9a7a' }];

  // 정보 카드 꾸미기: 아르크로 사서 고른다 (한 번 사면 계속 쓸 수 있다)
  D.DECO_SLOTS = [{ id: 'frame', name: '테두리' }, { id: 'bg', name: '배경' }, { id: 'stamp', name: '인장' }, { id: 'ink', name: '이름 잉크' }];
  // c: 대표 색(테두리·잉크), g: 배경 그라데이션, st: 테두리 모양(solid·dashed·double·glow·aurora·spring), pat: 배경 무늬, anim: 잉크가 반짝인다
  // 가격은 모두 5만 아르크 이하
  D.DECO = [
    { id: 'f_brass', slot: 'frame', name: '놋쇠', price: 1000, c: '#b98c3e', st: 'solid' },
    { id: 'f_jade', slot: 'frame', name: '비취', price: 2000, c: '#4fb39a', st: 'solid' },
    { id: 'f_amethyst', slot: 'frame', name: '자수정', price: 2000, c: '#9b6fe0', st: 'solid' },
    { id: 'f_ruby', slot: 'frame', name: '홍옥', price: 2000, c: '#d9505a', st: 'solid' },
    { id: 'f_sapphire', slot: 'frame', name: '청옥', price: 2000, c: '#4a7fe0', st: 'solid' },
    { id: 'f_amber', slot: 'frame', name: '호박', price: 2000, c: '#e0a040', st: 'solid' },
    { id: 'f_silver', slot: 'frame', name: '은빛 별', price: 3000, c: '#c9d2e8', st: 'glow' },
    { id: 'f_moss', slot: 'frame', name: '이끼 넝쿨', price: 4000, c: '#6f9a4a', st: 'dashed' },
    { id: 'f_ink', slot: 'frame', name: '먹선', price: 4000, c: '#55556a', st: 'double' },
    { id: 'f_pearl', slot: 'frame', name: '진주', price: 5000, c: '#efe6da', st: 'double' },
    { id: 'f_sakura', slot: 'frame', name: '벚꽃', price: 5000, c: '#f2a7c3', st: 'dashed' },
    { id: 'f_vine', slot: 'frame', name: '장미 넝쿨', price: 6000, c: '#c0566a', st: 'dashed' },
    { id: 'f_frost', slot: 'frame', name: '서리', price: 8000, c: '#a8e0f0', st: 'glow' },
    { id: 'f_ember', slot: 'frame', name: '잿불', price: 8000, c: '#ff7a3a', st: 'glow' },
    { id: 'f_aurora', slot: 'frame', name: '오로라', price: 30000, c: '#7cf0c0', st: 'aurora' },
    { id: 'f_spring', slot: 'frame', name: '일곱 별샘', price: 50000, c: '#f2c84b', st: 'spring' },
    { id: 'b_parch', slot: 'bg', name: '양피지', price: 1000, g: ['#e8d6aa', '#c4a064'], pat: 'lines' },
    { id: 'b_mint', slot: 'bg', name: '박하', price: 3000, g: ['#c8f0e0', '#7fd0b8'] },
    { id: 'b_lav', slot: 'bg', name: '라벤더 밭', price: 3000, g: ['#d8c8f0', '#9b7fd0'] },
    { id: 'b_stars', slot: 'bg', name: '별자리 지도', price: 4000, g: ['#3a4890', '#11152a'], pat: 'stars' },
    { id: 'b_moss', slot: 'bg', name: '이끼 정원', price: 4000, g: ['#4f7a48', '#1d3324'], pat: 'dots' },
    { id: 'b_dawn', slot: 'bg', name: '새벽 하늘', price: 4000, g: ['#ffd7a8', '#9fb8ff'] },
    { id: 'b_sakura', slot: 'bg', name: '벚꽃비', price: 6000, g: ['#ffd6e6', '#f2a7c3'], pat: 'dots' },
    { id: 'b_sea', slot: 'bg', name: '바다', price: 6000, g: ['#2f8fb0', '#123a5a'], pat: 'lines' },
    { id: 'b_cloud', slot: 'bg', name: '구름섬 노을', price: 8000, g: ['#ff966e', '#be78c8', '#505aaa'] },
    { id: 'b_snow', slot: 'bg', name: '눈 내리는 밤', price: 8000, g: ['#2a3a5a', '#121a2e'], pat: 'snow' },
    { id: 'b_ember', slot: 'bg', name: '잿불', price: 8000, g: ['#7a2a14', '#1a0a08'], pat: 'dots' },
    { id: 'b_deep', slot: 'bg', name: '심연의 서고', price: 15000, g: ['#28143c', '#0a0c1e'], pat: 'stars' },
    { id: 'b_gold', slot: 'bg', name: '금박 장부', price: 20000, g: ['#f6dc9c', '#b98c3e'], pat: 'lines' },
    { id: 'b_void', slot: 'bg', name: '별의 틈', price: 30000, g: ['#05051a', '#4a2a8a', '#05051a'], pat: 'stars' },
    { id: 's_moon', slot: 'stamp', name: '초승달', price: 500, glyph: '☾' },
    { id: 's_quill', slot: 'stamp', name: '깃펜', price: 1000, glyph: '✒' },
    { id: 's_flower', slot: 'stamp', name: '꽃', price: 1000, glyph: '✿' },
    { id: 's_clover', slot: 'stamp', name: '클로버', price: 1500, glyph: '♣' },
    { id: 's_sun', slot: 'stamp', name: '해', price: 2000, glyph: '☀' },
    { id: 's_snow', slot: 'stamp', name: '눈꽃', price: 2000, glyph: '❄' },
    { id: 's_star', slot: 'stamp', name: '별', price: 3000, glyph: '✦' },
    { id: 's_heart', slot: 'stamp', name: '하트', price: 3000, glyph: '♥' },
    { id: 's_rune', slot: 'stamp', name: '룬', price: 8000, glyph: '❖' },
    { id: 's_lily', slot: 'stamp', name: '백합 문장', price: 12000, glyph: '⚜' },
    { id: 's_crown', slot: 'stamp', name: '왕관', price: 20000, glyph: '♛' },
    { id: 'i_rose', slot: 'ink', name: '장밋빛', price: 1500, c: ['#ff8fa3'] },
    { id: 'i_coral', slot: 'ink', name: '산호', price: 1500, c: ['#ff9a7a'] },
    { id: 'i_peach', slot: 'ink', name: '복숭아', price: 1500, c: ['#ffb88a'] },
    { id: 'i_lemon', slot: 'ink', name: '레몬', price: 1500, c: ['#f2e06a'] },
    { id: 'i_leaf', slot: 'ink', name: '새싹', price: 1500, c: ['#8fdc7a'] },
    { id: 'i_mint', slot: 'ink', name: '박하', price: 1500, c: ['#7fe0c8'] },
    { id: 'i_sky', slot: 'ink', name: '하늘빛', price: 1500, c: ['#8fc8ff'] },
    { id: 'i_lav', slot: 'ink', name: '라벤더', price: 1500, c: ['#c8b0ff'] },
    { id: 'i_violet', slot: 'ink', name: '제비꽃', price: 1500, c: ['#b98cf0'] },
    { id: 'i_snow', slot: 'ink', name: '눈꽃', price: 2000, c: ['#eef4ff'] },
    { id: 'i_amber', slot: 'ink', name: '호박', price: 2500, c: ['#ffb030'] },
    { id: 'i_ruby', slot: 'ink', name: '홍옥', price: 2500, c: ['#ff5a6a'] },
    { id: 'i_sapphire', slot: 'ink', name: '청옥', price: 2500, c: ['#6a96ff'] },
    { id: 'i_jade', slot: 'ink', name: '비취', price: 2500, c: ['#3fc8a0'] },
    { id: 'i_sea', slot: 'ink', name: '바다', price: 6000, c: ['#7fd8ff', '#3a8fd0'] },
    { id: 'i_forest', slot: 'ink', name: '숲속', price: 6000, c: ['#c8f08a', '#3fae6a'] },
    { id: 'i_dusk', slot: 'ink', name: '황혼', price: 6000, c: ['#ffc0a0', '#a07ad0'] },
    { id: 'i_candy', slot: 'ink', name: '솜사탕', price: 6000, c: ['#ffb8e0', '#a8d8ff'] },
    { id: 'i_silver', slot: 'ink', name: '은박', price: 8000, c: ['#dfe6f5', '#9aa6c0', '#f4f7ff'] },
    { id: 'i_sunset', slot: 'ink', name: '노을', price: 10000, c: ['#ffb070', '#ff6f91', '#b78cff'] },
    { id: 'i_flame', slot: 'ink', name: '불꽃', price: 10000, c: ['#ffe08a', '#ff7a3a', '#ff3a5a'] },
    { id: 'i_aurora', slot: 'ink', name: '오로라', price: 12000, c: ['#7cf0c0', '#9fb8ff', '#c79bff'] },
    { id: 'i_gold', slot: 'ink', name: '금박', price: 15000, c: ['#f6dc9c', '#b98c3e', '#fff0b8'] },
    { id: 'i_star', slot: 'ink', name: '별빛', price: 30000, c: ['#fff4c8', '#f0cf8a', '#ffffff', '#f0cf8a'], anim: true },
    { id: 'i_spring', slot: 'ink', name: '일곱 별샘', price: 50000, c: ['#ff7a5a', '#f2c84b', '#8ad08a', '#7fc8ff', '#b8a8e8', '#c084fc', '#ff7a5a'], anim: true }
  ];

  // 잠자는 동안: 꿈길 (1학년부터, 한 번에 하나, 6시간 이상)
  D.DREAM_DUR = [
    { k: '6h', s: 21600, label: '6시간' }, { k: '8h', s: 28800, label: '8시간' },
    { k: '10h', s: 36000, label: '10시간' }, { k: '12h', s: 43200, label: '12시간' }
  ];
  D.DREAMS = [
    { id: 'study', name: '복습하는 꿈', desc: '고른 과목을 꿈속에서 한 번 더 듣습니다. 과목 경험치와 지식', pick: true },
    { id: 'stars', name: '별을 헤아리는 꿈', desc: '천문대 지붕에서 별샘을 셉니다. 별조각과 지식, 가끔 환수의 알' },
    { id: 'wander', name: '구름섬을 떠도는 꿈', desc: '가 본 섬을 다시 걷습니다. ' + CUR + '·재료·마석' }
  ];
  D.DREAM_LINES = [
    '복도 끝 문이 열리더니, 교수님이 거꾸로 매달린 채 수업을 하고 계셨습니다.', '별샘 위를 맨발로 걸었습니다. 발이 닿는 곳마다 물 대신 빛이 찰랑였습니다.',
    '도서관 책들이 저마다 제 이야기를 먼저 읽어 달라고 졸랐습니다.', '사역마가 사람 말을 하더니, 내일 간식을 두 배로 달라고 했습니다.',
    '구름 고래 등 위에서 낮잠을 잤습니다. 꿈속의 꿈이었습니다.', '시험지가 전부 백지였는데, 이상하게 답이 다 보였습니다.',
    '기숙사 굴뚝에서 별 모양 연기가 피어올랐습니다.', '오래전 졸업생이 남긴 쪽지를 주웠습니다. “너도 언젠가 여기서 잠들겠지.”',
    '일곱 별샘이 한 줄로 늘어서 노래를 불렀습니다.', '지팡이 끝에서 작은 새가 태어나 창밖으로 날아갔습니다.'
  ];

  // 밤 방치용: 사역마 파견 (연구는 단계마다 길이가 정해져 있다)
  D.DISPATCH_DUR = [
    { k: '2h', s: 7200, label: '2시간' }, { k: '4h', s: 14400, label: '4시간' },
    { k: '8h', s: 28800, label: '8시간', night: true }, { k: '12h', s: 43200, label: '12시간', night: true }
  ];
  // 아카데미력: 실제 1일 = 아카데미 1일, 한 달 28일(4주), 한 해 9달(아홉 무사이). 달마다 그 무사이의 축복.
  D.MONTH_BONUS = [
    { eff: { xpPct: 0.15 }, text: '서사달 — 경험치 +15%' },
    { eff: { knowPct: 0.10 }, text: '기록달 — 지식 획득 +10%' },
    { eff: { manaPct: 0.15 }, text: '피리달 — 마나 재생 +15%' },
    { eff: { goldPct: 0.15 }, text: '웃음달 — ' + CUR + ' +15%' },
    { eff: { atkPct: 0.10 }, text: '가면달 — 공격력 +10%' },
    { eff: { brewSpd: 0.20 }, text: '춤달 — 양조 비용 -17%' },
    { eff: { hatchSpd: 0.20 }, text: '연가달 — 부화 비용 -17%' },
    { eff: { dropPct: 0.10 }, text: '별무리달 — 전리품 확률 +10%' },
    { eff: { examBonus: 5 }, text: '침묵달 — 기말시험 총점 +5점' }
  ];
  D.WEEKEND = { eff: { manaPct: 0.25, lectureSpd: 0.10 }, text: '유성우 주말 — 마나 재생 +25%, 수업 속도 +10% (토·일)' };

  /* ───────── 주간 월드 보스 (서버 공동 토벌) ───────── */
  D.WORLD_BOSSES = [
    { id: 'wb_keeper', name: '깨어난 저장고의 군주', arch: 'golem', c1: '#b8a07a', c2: '#4a3f30', lore: '아카데미 지하 가장 깊은 저장고에서 백 년 동안 쌓인 마나 먼지가 몸을 이루었다.' },
    { id: 'wb_tree', name: '천 년 속삭임의 어머니나무', arch: 'golem', c1: '#7a9a5a', c2: '#2a3a1c', lore: '숲의 모든 나무가 뿌리로 이어진 하나의 의지. 섬의 비밀을 지키려 한다.' },
    { id: 'wb_whale', name: '구름바다의 늙은 별고래', arch: 'eye', c1: '#7aa8ff', c2: '#1a2a6a', lore: '침몰한 천문대를 등에 지고 헤엄치는 거대한 고래. 노래가 들리면 섬이 흔들린다.' },
    { id: 'wb_queen', name: '프리즘 여제', arch: 'eye', c1: '#e0b8ff', c2: '#4a1a7a', lore: '수정여왕 아라크니아의 어머니. 광맥 전체가 그녀의 거미줄이다.' },
    { id: 'wb_ember', name: '실패한 대주문의 화신', arch: 'wisp', c1: '#ff8a4a', c2: '#5a1408', lore: '오백 년 전 끝나지 않은 주문이 스스로 몸을 얻었다. 마지막 음절을 찾고 있다.' },
    { id: 'wb_rift', name: '균열 너머의 눈', arch: 'eye', c1: '#a08aff', c2: '#1a0a5a', lore: '하늘의 틈 너머에서 이쪽을 보던 그것이 처음으로 손을 뻗었다.' },
    { id: 'wb_book', name: '찢긴 장의 주인', arch: 'book', c1: '#d04a5a', c2: '#2a0a14', lore: '금서고의 모든 금서가 한 권으로 엮였다. 읽는 자의 이름을 지운다.' },
    { id: 'wb_clock', name: '멈춘 종의 그림자', arch: 'construct', c1: '#f0d080', c2: '#4a3a10', lore: '별의 종이 침묵한 시간이 모여 만들어진 그림자. 울리지 않은 종소리만큼 강하다.' }
  ];

  /* ───────── 기숙사 ───────── */
  D.HOUSES = [
    { id: 'lanterna', name: '등불관', latin: 'Lanterna', color: '#e8c36a',
      motto: '꺼지지 않는 질문이 길을 밝힌다',
      desc: '탐구와 기록을 중시하는 기숙사. 밤새 켜진 등불 아래에서 가장 많은 논문이 쓰인다.',
      bonus: { knowPct: 0.15, lectureSpd: 0.05 }, bonusText: '지식 획득 +15%, 수업 속도 +5%' },
    { id: 'clepsydra', name: '물시계관', latin: 'Clepsydra', color: '#6fb5c9',
      motto: '한 방울씩, 그러나 멈추지 않고',
      desc: '인내와 명상의 기숙사. 탑 꼭대기의 거대한 물시계는 아카데미가 세워진 날부터 단 한 번도 멈춘 적이 없다.',
      bonus: { dispPct: 0.25, manaPct: 0.10 }, bonusText: '사역마 파견 보상 +25%, 마나 +10%' },
    { id: 'corona', name: '가시왕관관', latin: 'Corona Spina', color: '#d9736b',
      motto: '상처 없는 왕관은 없다',
      desc: '결투와 실전 마법을 숭상하는 기숙사. 매년 아카데미 대항 결투제의 우승기는 대부분 이곳에 걸린다.',
      bonus: { atkPct: 0.12, hpPct: 0.05 }, bonusText: '공격력 +12%, 생명력 +5%' },
    { id: 'speculum', name: '거울관', latin: 'Speculum', color: '#b99be6',
      motto: '보이는 것의 뒤편을 보라',
      desc: '환영술과 교역의 기숙사. 졸업생 대부분이 상단주나 외교관이 되며, 이들의 거래는 늘 조금 수상하다.',
      bonus: { goldPct: 0.15, dropPct: 0.10 }, bonusText: CUR + ' +15%, 전리품 확률 +10%' }
  ];

  /* ───────── 학과: 입학할 때 고른다 (한 번 바꿀 수 있음). 예전 학생은 마법사로 시작해 한 번 고를 수 있다 ───────── */
  D.CLASSES = [
    { id: 'mage', name: '마법사', desc: '뒤에서 주문을 쏟아붓는다. 주문이 강하지만 몸은 약하다.', bonus: { spellPct: 0.25, hpPct: -0.10 }, bonusText: '주문 피해 +25%, 생명력 −10%', pos: '후열 · 지원', spells: '비전 폭발 · 마나 폭주', subj: '비전학' },
    { id: 'knight', name: '기사', desc: '검과 방패로 맨 앞에 선다. 단단하고 몬스터를 더 잘 끈다.', bonus: { atkPct: 0.10, hpPct: 0.20, defPct: 0.25, spellPct: -0.20 }, bonusText: '공격력 +10%, 생명력 +20%, 방어 +25%, 주문 피해 −20%', pos: '선봉 (몬스터를 끄는 확률 +5%p)', spells: '방패 강타 · 수호의 함성', subj: '검술·방패술' },
  ];

  /* ───────── 과목 · 교수 ───────── */
  D.SUBJECTS = [
    { id: 'elem', name: '원소역학', prof: '이그나 벨로르 교수', unlock: 1, stat: 'int', stat2: 'wil',
      desc: '불, 물, 바람, 흙. 네 원소가 서로를 밀고 당기는 힘의 법칙을 배운다.',
      line: '마나는 강물과 같다네. 막으면 넘치고, 흘리면 길이 되지.' },
    { id: 'syntax', name: '주문구문학', prof: '마르텐 오웰 교수', unlock: 1, stat: 'int', stat2: 'luk',
      desc: '주문의 어순, 억양, 숨 고르기. 한 음절이 틀리면 화염구가 꽃다발이 된다.',
      line: '주문은 문장일세. 주어 없는 주문은 주인 없는 칼이야.' },
    { id: 'ward', name: '결계공학', prof: '브람 하일 교수', unlock: 1, stat: 'vit', stat2: 'wil',
      desc: '마력의 벽을 세우고, 엮고, 수리하는 법. 아카데미 섬을 지탱하는 결계도 이 과목의 산물이다.',
      line: '튼튼한 벽보다 금 간 자리를 아는 눈이 먼저야.' },
    { id: 'alch', name: '연금화학', prof: '세라핀 루 교수', unlock: 2, stat: 'wil', stat2: 'luk',
      desc: '재료의 본질을 끓이고 거르고 응축한다. 실습실 천장의 그을음은 선배들의 흔적이다.',
      line: '폭발했다고요? 좋아요, 재료가 아주 솔직하게 대답한 거예요.' },
    { id: 'beast', name: '환수생태학', prof: '고드릭 펜 교수', unlock: 3, stat: 'vit', stat2: 'agi',
      desc: '마나를 먹고 자라는 생물들의 습성과 교감법. 출석부에 사역마 이름이 더 많은 수업.',
      line: '고르려 들지 마라. 녀석들이 먼저 너를 고른다.' },
    { id: 'astro', name: '성도해석학', prof: '아스트라 노엘 교수', unlock: 4, stat: 'luk', stat2: 'int',
      desc: '일곱 별샘의 위치와 흐름을 읽어 마나의 조류와 운명을 점친다.',
      line: '별은 거짓말을 하지 않아요. 다만 늘 조금 늦게 도착하죠.' },
    { id: 'flight', name: '체술·비행', prof: '카야 린 교관', unlock: 5, stat: 'agi', stat2: 'vit',
      desc: '빗자루, 바람발판, 낙하 제어. 그리고 넘어지는 법. 의무실이 가장 가까운 강의실이다.',
      line: '떨어지는 건 괜찮아. 착지를 못 하는 게 문제지!' },
    { id: 'rune', name: '고대 룬어', prof: '이름 없는 사서', unlock: 6, stat: 'wil', stat2: 'int',
      desc: '창립기 이전의 문자. 읽을 수 있는 사람은 아카데미에 단 한 명뿐이며, 그는 이름을 말하지 않는다.',
      line: '……이 문자는 눈으로 읽히지 않는다. 오래 들여다보면 기억이 먼저 떠오른다.' },
    // 학과 전용 수업: 그 학과 학생에게만 보인다 (cls)
    { id: 'sword', name: '검술·방패술', prof: '레온 바르크 교관', unlock: 1, cls: 'knight', stat: 'vit', stat2: 'agi',
      desc: '기사과 전용. 검을 휘두르는 법보다 방패를 드는 법을 먼저 배운다. 훈련장 모래에는 늘 발자국이 가득하다.',
      line: '방패는 너를 위한 게 아니다. 네 뒤에 선 사람을 위한 거다.' },
    { id: 'arcana', name: '비전학', prof: '오렐 미스트 교수', unlock: 1, cls: 'mage', stat: 'int', stat2: 'wil',
      desc: '마법과 전용. 마나를 원소에 싣지 않고 날것 그대로 다루는 위험한 학문. 강의실 벽에는 그을린 별 모양이 남아 있다.',
      line: '마나에 이름을 붙이지 마세요. 이름을 붙이는 순간 작아집니다.' }
  ];

  /* ───────── 주문 ───────── */
  D.SPELLS = [
    { id: 'bolt', name: '마력 화살', req: null, cd: 4, mult: 2.0, type: 'dmg', desc: '주문 공격력의 200% 피해' },
    { id: 'fireball', name: '화염구', req: ['elem', 5], cd: 8, mult: 4.5, type: 'dmg', desc: '주문 공격력의 450% 피해' },
    { id: 'ward', name: '수호 결계', req: ['ward', 5], cd: 15, mult: 0.3, type: 'shield', desc: '최대 생명력 30%의 보호막' },
    { id: 'chain', name: '연쇄 번개', req: ['syntax', 10], cd: 12, mult: 7, type: 'dmg', desc: '주문 공격력의 700% 피해' },
    { id: 'heal', name: '재생의 노래', req: ['alch', 8], cd: 18, mult: 0.35, type: 'heal', desc: '생명력이 60% 미만일 때 35% 회복' },
    { id: 'frost', name: '얼음 감옥', req: ['elem', 15], cd: 14, mult: 3.5, type: 'stun', stun: 2.5, desc: '주문 공격력의 350% 피해, 2.5초 빙결' },
    { id: 'beastcall', name: '환수 소환', req: ['beast', 8], cd: 20, mult: 10, type: 'dmg', desc: '사역마와 함께 주문 공격력의 1000% 피해' },
    { id: 'meteor', name: '별똥별', req: ['astro', 10], cd: 25, mult: 15, type: 'dmg', desc: '주문 공격력의 1500% 피해' },
    { id: 'haste', name: '그림자 분신', req: ['flight', 8], cd: 28, mult: 2, dur: 6, type: 'haste', desc: '6초간 공격 속도 2배' },
    { id: 'timestop', name: '시간 정지', req: ['rune', 12], cd: 40, mult: 2, dur: 5, type: 'amp', desc: '5초간 모든 피해 2배, 적 정지' },
    // 학과 전용 주문 (cls: 배울 수 있는 학과). 기사도 수업으로 배운 일반 주문은 낄 수 있다 (= 마검사)
    { id: 'shieldbash', name: '방패 강타', req: null, cls: ['knight'], cd: 9, mult: 3, type: 'stun', stun: 1.5, phys: true, desc: '기사 전용 · 물리 공격력의 300% 피해, 1.5초 기절 (주문 위력과 무관)' },
    { id: 'warcry', name: '수호의 함성', req: ['sword', 8], cls: ['knight'], cd: 18, mult: 0.4, type: 'shield', desc: '기사 전용 · 최대 생명력 40%의 보호막 · 함께 원정 선봉일 때 몬스터를 끄는 확률 +5%p' },
    { id: 'arcane', name: '비전 폭발', req: null, cls: ['mage'], cd: 10, mult: 6, type: 'dmg', desc: '마법사 전용 · 주문 공격력의 600% 피해' },
    { id: 'manaflare', name: '마나 폭주', req: ['arcana', 12], cls: ['mage'], cd: 32, mult: 2, dur: 5, type: 'amp', desc: '마법사 전용 · 5초간 모든 피해 2배' }
  ];

  /* ───────── 탐사 지역 · 몬스터 ───────── */
  // arch: blob, wisp, beast, golem, eye, book, construct
  D.ZONES = [
    { id: 'cellar', name: '아카데미 지하 저장고', from: 1, mat: 'dust', bg: ['#1d1a2b', '#2c2637'],
      desc: '오래된 실험 도구와 버려진 교과서가 잠든 곳. 신입생의 첫 실전 장소.',
      mons: [
        { id: 'dustmouse', name: '먼지 생쥐', arch: 'beast', c1: '#9a8f86', c2: '#5c544e', lore: '저장고의 먼지를 먹고 사는 생쥐. 마나를 머금은 먼지 탓에 이빨이 은빛이다.' },
        { id: 'inkslime', name: '잉크 슬라임', arch: 'blob', c1: '#3a4a8a', c2: '#1f2650', lore: '쏟아진 마법 잉크가 굳지 않고 기어다니게 된 것. 밟으면 숙제가 번진다.' },
        { id: 'broom', name: '떠도는 빗자루', arch: 'construct', c1: '#b8894c', c2: '#6e4e28', lore: '주인을 잃은 비행 빗자루. 아직도 누군가를 태우려고 저장고를 맴돈다.' }
      ],
      boss: { id: 'keeper', name: '저장고지기 골렘', arch: 'golem', c1: '#8c8172', c2: '#4a4239', lore: '백 년 전 연금화학과가 만든 경비 골렘. 명령어를 잊어버려 모든 것을 지킨다.' } },
    { id: 'forest', name: '속삭이는 숲', from: 11, mat: 'moonherb', bg: ['#14241d', '#21382c'],
      desc: '아카데미 섬 동쪽 끝의 숲. 나무들이 지나가는 학생의 비밀을 서로에게 전한다.',
      mons: [
        { id: 'mosswisp', name: '이끼 도깨비불', arch: 'wisp', c1: '#9fe08a', c2: '#3f7a3a', lore: '길 잃은 이를 더 깊은 곳으로 데려가는 녹색 불빛.' },
        { id: 'thornwolf', name: '가시 늑대', arch: 'beast', c1: '#5e7a4e', c2: '#2c3d24', lore: '등에 가시덤불이 자라는 늑대. 무리 지어 다니며 달이 뜨면 노래한다.' },
        { id: 'gossipcap', name: '수다쟁이 버섯', arch: 'blob', c1: '#c96b5a', c2: '#7a3428', lore: '포자 대신 소문을 퍼뜨린다. 이 버섯 근처에서 한 말은 다음 날 아카데미 전체가 안다.' }
      ],
      boss: { id: 'eldertree', name: '늙은 속삭임나무', arch: 'golem', c1: '#6b5a3a', c2: '#2f2618', lore: '숲의 모든 비밀을 아는 고목. 아카데미 창립자의 마지막 말을 기억한다고 한다.' } },
    { id: 'observatory', name: '침몰한 천문대', from: 21, mat: 'cog', bg: ['#10202c', '#1b3344'],
      desc: '섬 가장자리에서 구름 아래로 가라앉은 옛 천문대. 섬이 가라앉고 있다는 첫 번째 증거.',
      mons: [
        { id: 'cogull', name: '태엽 갈매기', arch: 'construct', c1: '#c0a060', c2: '#6a5428', lore: '천문대 관측원이 만든 기계 새. 지금도 존재하지 않는 별의 위치를 보고한다.' },
        { id: 'scopeeye', name: '망원경의 눈', arch: 'eye', c1: '#7fb8d6', c2: '#2b5168', lore: '렌즈에 깃든 관측 정령. 너무 오래 별을 본 나머지 눈만 남았다.' },
        { id: 'coralbones', name: '산호 해골', arch: 'golem', c1: '#e0a3a0', c2: '#7a4744', lore: '구름바다의 산호가 자라난 옛 관측원의 유해.' }
      ],
      boss: { id: 'warden', name: '천문대의 파수꾼', arch: 'eye', c1: '#f0d080', c2: '#6a5420', lore: '가라앉는 순간에도 망원경을 놓지 않았던 마지막 천문학자의 집념.' } },
    { id: 'crystal', name: '수정 동굴', from: 31, mat: 'crystal', bg: ['#1a1830', '#2c2850'],
      desc: '아카데미 섬의 뿌리를 이루는 마나 수정 광맥. 수정이 흐려지고 있다.',
      mons: [
        { id: 'crysbat', name: '수정 박쥐', arch: 'beast', c1: '#a8c8ff', c2: '#4a5a9a', lore: '날개막이 얇은 수정으로 된 박쥐. 울음소리로 수정의 균열을 찾는다.' },
        { id: 'prismslime', name: '반사 슬라임', arch: 'blob', c1: '#d0a8ff', c2: '#5a3a8a', lore: '빛을 삼켜 일곱 색으로 뱉는다. 거울관 학생들이 몰래 기른다는 소문이 있다.' },
        { id: 'prismgolem', name: '프리즘 골렘', arch: 'golem', c1: '#9ad0e0', c2: '#3a6070', lore: '광맥이 스스로를 지키기 위해 빚어낸 수호자.' }
      ],
      boss: { id: 'crysqueen', name: '수정여왕 아라크니아', arch: 'eye', c1: '#e0b8ff', c2: '#5a2a7a', lore: '광맥의 심장에 거미줄을 친 여왕. 그녀의 실은 마나 그 자체로 짜여 있다.' } },
    { id: 'ashland', name: '잿빛 황야', from: 41, mat: 'ember', bg: ['#2a1814', '#40241c'],
      desc: '오백 년 전 실패한 대주문이 남긴 불탄 땅. 여전히 재가 따뜻하다.',
      mons: [
        { id: 'emberlizard', name: '잿불 도마뱀', arch: 'beast', c1: '#e07a3a', c2: '#6a2a10', lore: '재 속에서 태어나 재를 먹는다. 꼬리가 끊어지면 작은 불씨가 된다.' },
        { id: 'ashwraith', name: '재의 망령', arch: 'wisp', c1: '#b0a8a0', c2: '#4a4440', lore: '대주문에 휘말린 마법사들의 잔상. 아직 주문을 끝내지 못했다고 믿는다.' },
        { id: 'flamescorp', name: '불꽃 전갈', arch: 'construct', c1: '#ff9a4a', c2: '#7a3010', lore: '독 대신 응축된 열을 쏜다. 연금화학과의 귀한 재료 공급원.' }
      ],
      boss: { id: 'volcanoheart', name: '잠든 화산의 심장', arch: 'golem', c1: '#ff6a3a', c2: '#5a1408', lore: '대주문의 중심에 남은 불의 핵. 숨을 쉴 때마다 황야가 붉어진다.' } },
    { id: 'rift', name: '별의 균열', from: 51, mat: 'stardust', bg: ['#0e1028', '#1c1a44'],
      desc: '하늘에 생긴 틈. 일곱 별샘 중 하나가 이 틈으로 새어 나가고 있다.',
      mons: [
        { id: 'riftmaw', name: '균열 촉수', arch: 'eye', c1: '#7a6aff', c2: '#2a1a6a', lore: '균열 너머에서 뻗어 오는 무언가의 일부. 본체를 본 사람은 없다.' },
        { id: 'fallenstar', name: '떨어진 별조각', arch: 'wisp', c1: '#fff0a0', c2: '#8a7a30', lore: '별샘에서 떨어져 나온 빛. 돌아갈 곳을 잃고 분노한다.' },
        { id: 'voidhound', name: '공허 하운드', arch: 'beast', c1: '#4a4a7a', c2: '#14142a', lore: '그림자가 없는 사냥개. 마나의 냄새를 따라 균열 밖으로 나온다.' }
      ],
      boss: { id: 'riftwatcher', name: '균열의 감시자', arch: 'eye', c1: '#a08aff', c2: '#2a1870', lore: '균열이 생긴 날부터 이쪽을 지켜보던 거대한 눈. 처음으로 눈을 깜빡였다.' } },
    { id: 'voidlib', name: '공허의 도서관', from: 61, mat: 'voidink', bg: ['#12101a', '#221c30'],
      desc: '아카데미 도서관 지하 금서고의 더 아래. 지도에 없는 층.',
      mons: [
        { id: 'ragebook', name: '날뛰는 금서', arch: 'book', c1: '#8a3a4a', c2: '#3a1018', lore: '읽은 사람을 대신 읽으려 드는 책. 표지에 이빨 자국이 있다.' },
        { id: 'wordeater', name: '문장 포식자', arch: 'blob', c1: '#2a2a3a', c2: '#0a0a14', lore: '책의 글자를 먹어 치운다. 포식자가 지나간 페이지는 하얗게 비어 있다.' },
        { id: 'shadowlib', name: '그림자 사서', arch: 'wisp', c1: '#6a5a8a', c2: '#1a1428', lore: '이름 없는 사서의 그림자들. 조용히 하라는 손짓만 반복한다.' }
      ],
      boss: { id: 'forbidden', name: '금지된 장의 화신', arch: 'book', c1: '#c04a5a', c2: '#2a0a14', lore: '창립자가 찢어낸 마지막 장. 별의 종을 멈추는 방법이 적혀 있었다.' } },
    { id: 'clocktower', name: '시간의 탑', from: 71, mat: 'sand', bg: ['#201a10', '#3a2e18'],
      desc: '아카데미 중앙에 서 있지만 아무도 들어가 본 적 없는 탑. 별의 종이 걸린 곳.',
      mons: [
        { id: 'clockknight', name: '태엽 기사', arch: 'construct', c1: '#d0b070', c2: '#5a4420', lore: '탑의 계단을 지키는 기사. 태엽이 다 풀리기 전에는 쓰러지지 않는다.' },
        { id: 'rewind', name: '역행 망령', arch: 'wisp', c1: '#a0d0c0', c2: '#2a5a4a', lore: '시간을 거꾸로 사는 존재. 당신을 처음 만난 것을 이미 기억한다.' },
        { id: 'sandgolem', name: '모래시계 골렘', arch: 'golem', c1: '#e0c080', c2: '#6a5428', lore: '몸속의 모래가 다 떨어지면 처음부터 다시 태어난다.' }
      ],
      boss: { id: 'stillguard', name: '멈춘 시간의 수호자', arch: 'golem', c1: '#f0e0a0', c2: '#4a3a10', lore: '별의 종 앞에 선 마지막 문지기. 천 년 전 창립자의 제자였다.' } },
    { id: 'abyss', name: '심연', from: 81, mat: 'abyssgem', bg: ['#08080e', '#16142a'], abyss: true,
      desc: '종이 다시 울린 뒤 드러난 섬 아래의 끝없는 어둠. 졸업생들만이 내려간다.',
      mons: [
        { id: 'abyssmaw', name: '심연의 아가리', arch: 'blob', c1: '#3a2a5a', c2: '#0a0614', lore: '빛을 먹는 젤리. 깊이 내려갈수록 커진다.' },
        { id: 'abysseye', name: '심연의 눈', arch: 'eye', c1: '#5affd0', c2: '#0a3a2a', lore: '모든 층에서 같은 눈이 당신을 본다.' },
        { id: 'abyssknight', name: '타락한 졸업생', arch: 'construct', c1: '#8a8aa0', c2: '#2a2a3a', lore: '더 깊이 내려가다 돌아오지 못한 선배. 아카데미 배지를 아직 달고 있다.' }
      ],
      boss: { id: 'abysslord', name: '심연의 군주', arch: 'eye', c1: '#ff4a8a', c2: '#3a0a1a', lore: '열 층마다 모습을 바꿔 나타나는 심연의 주인.' } }
  ];

  /* ───────── 재료 ───────── */
  D.MATS = {
    dust: { name: '먼지 가루', desc: '마나를 머금은 저장고의 먼지' },
    moonherb: { name: '월광초', desc: '달빛을 받아야만 피는 약초' },
    cog: { name: '녹슨 톱니', desc: '천문대 기계에서 떨어진 정밀 부품' },
    crystal: { name: '수정 조각', desc: '흐려진 마나 수정의 파편' },
    ember: { name: '잿불씨', desc: '꺼지지 않는 재 속의 불씨' },
    stardust: { name: '별가루', desc: '별샘에서 흘러내린 빛의 가루' },
    voidink: { name: '공허 잉크', desc: '글자를 지우는 검은 잉크' },
    sand: { name: '시간 모래', desc: '거꾸로 떨어지는 모래' },
    abyssgem: { name: '심연 결정', desc: '심연에서만 맺히는 검은 결정' }
  };

  /* ───────── 장비 ───────── */
  D.SLOTS = [
    { id: 'staff', name: '무기', main: 'atk', base: 3.2 },   // 무기 칸: 지팡이 또는 검 (it.wk === 'sword'). 능력치는 같고 모양만 다르다
    { id: 'robe', name: '로브', main: 'hp', base: 16, sub: 'def', subBase: 1.4 },
    { id: 'hat', name: '모자', main: 'int', base: 1.6 },
    { id: 'charm', name: '장신구', main: 'luk', base: 1.4, sub: 'critC', subBase: 0.02 },
    { id: 'tome', name: '마도서', main: 'spellPct', base: 0.08, sub: 'atk', subBase: 1.2 }
  ];
  D.ITEM_NAMES = {
    sword: ['훈련용 목검', '참나무 목검', '월광 장검', '황동 기사검', '수정 검', '잿불 대검', '별철 검', '공허의 칼날', '시간의 검', '심연의 검'],
    staff: ['견습생의 나뭇가지', '참나무 지팡이', '월광 지팡이', '황동 천문 지팡이', '수정 지팡이', '잿불 지팡이', '별철 지팡이', '공허 깃펜 지팡이', '시간의 바늘', '심연의 홀'],
    robe: ['무명 교복 로브', '이끼 짠 로브', '은사 로브', '해무 로브', '프리즘 로브', '잿빛 망토', '성운 로브', '침묵의 로브', '모래시계 로브', '심연의 장막'],
    hat: ['뾰족 모자', '깃털 모자', '달빛 두건', '항해사 삼각모', '수정관', '재의 후드', '별관', '사서의 베일', '시간의 왕관', '심연의 관'],
    charm: ['유리구슬 목걸이', '도토리 부적', '월장석 반지', '나침반 펜던트', '프리즘 귀걸이', '불씨 브로치', '유성 반지', '공허의 눈', '영원의 모래시계', '심연의 심장'],
    tome: ['낡은 교과서', '약초 도감', '성도 노트', '항해 일지', '결정 사본', '화염 비망록', '별의 서', '금서의 조각', '시간의 연대기', '심연 문서']
  };
  D.RARITY = [
    { id: 0, name: '일반', color: '#b9bccb', mult: 1.0, affix: 0, w: 62 },
    { id: 1, name: '고급', color: '#7cc68a', mult: 1.3, affix: 1, w: 26 },
    { id: 2, name: '희귀', color: '#6aa8ff', mult: 1.7, affix: 2, w: 9 },
    { id: 3, name: '영웅', color: '#c084fc', mult: 2.3, affix: 3, w: 2.6 },
    { id: 4, name: '전설', color: '#f2b84b', mult: 3.2, affix: 4, w: 0.4 }
  ];
  // 접두사(대표 옵션에 따라)
  D.AFFIXES = [
    { id: 'int', name: '지력', prefix: '현자의', flat: 1.3 },
    { id: 'wil', name: '의지', prefix: '굳건한', flat: 1.3 },
    { id: 'agi', name: '민첩', prefix: '날랜', flat: 1.0 },
    { id: 'vit', name: '체력', prefix: '튼튼한', flat: 1.3 },
    { id: 'luk', name: '행운', prefix: '행운의', flat: 1.1 },
    { id: 'atkPct', name: '공격력', prefix: '사나운', pct: [0.03, 0.10] },
    { id: 'hpPct', name: '생명력', prefix: '생기 있는', pct: [0.03, 0.10] },
    { id: 'critC', name: '치명타 확률', prefix: '날카로운', pct: [0.01, 0.05] },
    { id: 'critD', name: '치명타 피해', prefix: '잔혹한', pct: [0.10, 0.35] },
    { id: 'spellPct', name: '주문 위력', prefix: '공명하는', pct: [0.05, 0.18] },
    { id: 'physPct', name: '물리 피해', prefix: '단련된', pct: [0.05, 0.18] },
    { id: 'goldPct', name: CUR + ' 획득', prefix: '반짝이는', pct: [0.05, 0.20] },
    { id: 'knowPct', name: '지식 획득', prefix: '박식한', pct: [0.03, 0.12] },
    { id: 'manaPct', name: '마나 재생', prefix: '샘솟는', pct: [0.05, 0.15] },
    { id: 'leech', name: '생명력 흡수', prefix: '흡혈의', pct: [0.005, 0.02] },
    { id: 'dropPct', name: '전리품 확률', prefix: '탐욕스러운', pct: [0.03, 0.10] }
  ];
  // 전설 장비에만 붙는 고유 각인
  D.ENGRAVES = [
    { id: 'bossDmg', name: '파수꾼 사냥꾼의 각인', desc: '보스에게 주는 피해', range: [0.25, 0.45], pct: true },
    { id: 'cdr', name: '흐르는 시간의 각인', desc: '주문 재사용 대기시간 감소', range: [0.08, 0.16], pct: true },
    { id: 'killMana', name: '별샘의 각인', desc: '처치할 때마다 마나 재생 N초분 획득', range: [2, 5], pct: false }
  ];
  D.STAT_NAMES = { int: '지력', wil: '의지', agi: '민첩', vit: '체력', luk: '행운', atk: '공격력', patk: '물리 공격력', matk: '주문 공격력', hp: '생명력', def: '방어력' };

  /* ───────── 물약 ───────── */
  D.POTIONS = [
    { id: 'focus', name: '집중의 물약', unlock: 1, time: 900, mana: 1500, mats: { dust: 6 }, dur: 7200, eff: { lectureSpd: 0.3 }, desc: '2시간 수업 속도 +30%', color: '#7fc8ff' },
    { id: 'valor', name: '투지의 물약', unlock: 3, time: 1200, mana: 4000, mats: { dust: 4, moonherb: 4 }, dur: 7200, eff: { atkPct: 0.25 }, desc: '2시간 공격력 +25%', color: '#ff7a5a' },
    { id: 'guard', name: '수호의 물약', unlock: 4, time: 1200, mana: 4000, mats: { dust: 6, moonherb: 2 }, dur: 7200, eff: { hpPct: 0.25, defPct: 0.2 }, desc: '2시간 생명력 +25%, 방어력 +20%', color: '#8ad08a' },
    { id: 'gilded', name: '황금 물약', unlock: 6, time: 1800, mana: 12000, mats: { cog: 4, moonherb: 4 }, dur: 7200, eff: { goldPct: 0.4 }, desc: '2시간 ' + CUR + ' +40%', color: '#f2c84b' },
    { id: 'sleep', name: '숙면의 차', unlock: 8, time: 3600, mana: 20000, mats: { moonherb: 8, crystal: 2 }, dur: 36000, eff: { dispPct: 0.4, manaPct: 0.3 }, desc: '10시간 사역마 파견 보상 +40%, 마나 재생 +30% (자기 전에)', color: '#b8a8e8' },
    { id: 'fortune', name: '행운의 물약', unlock: 10, time: 2400, mana: 30000, mats: { crystal: 4, moonherb: 6 }, dur: 7200, eff: { dropPct: 0.35, rarity: 0.3 }, desc: '2시간 전리품 확률 +35%, 등급 상승', color: '#c084fc' },
    { id: 'sage', name: '현자의 물약', unlock: 14, time: 3600, mana: 90000, mats: { ember: 4, crystal: 2 }, dur: 7200, eff: { xpPct: 0.6, knowPct: 0.4 }, desc: '2시간 경험치 +60%, 지식 +40%', color: '#e8e2d0' },
    { id: 'starlight', name: '별빛 영약', unlock: 20, time: 7200, mana: 400000, mats: { stardust: 4, voidink: 2 }, dur: 21600, eff: { atkPct: 0.2, hpPct: 0.2, goldPct: 0.2, knowPct: 0.2, lectureSpd: 0.2 }, desc: '6시간 모든 능력 +20%', color: '#fff0a0' }
  ];

  /* ───────── 사역마 ───────── */
  D.FAMILIARS = [
    { id: 'inkbat', name: '잉크박쥐', r: 0, bonus: 'goldPct', base: 0.05, desc: '잉크병 속에서 잠드는 작은 박쥐. 반짝이는 동전을 좋아한다.', c1: '#4a5a9a' },
    { id: 'candlelizard', name: '촛불도마뱀', r: 0, bonus: 'atkPct', base: 0.04, desc: '꼬리 끝에 영원히 꺼지지 않는 촛불을 단 도마뱀.', c1: '#e09a4a' },
    { id: 'mossturtle', name: '이끼거북', r: 0, bonus: 'hpPct', base: 0.05, desc: '등 위에 작은 정원을 키우는 거북. 백 년째 같은 꽃이 핀다.', c1: '#6a9a5a' },
    { id: 'moonrabbit', name: '달토끼', r: 1, bonus: 'lectureSpd', base: 0.05, desc: '보름달이 뜨면 강의 노트를 대신 정리해 준다.', c1: '#e0e0f0' },
    { id: 'crysowl', name: '수정올빼미', r: 1, bonus: 'knowPct', base: 0.06, desc: '눈이 수정으로 된 올빼미. 한 번 본 문장은 잊지 않는다.', c1: '#9ad0f0' },
    { id: 'zapweasel', name: '번개족제비', r: 1, bonus: 'aps', base: 0.04, desc: '털을 쓰다듬으면 정전기가 튄다. 그만큼 빠르다.', c1: '#f0e04a' },
    { id: 'ashfox', name: '잿빛여우', r: 2, bonus: 'dropPct', base: 0.06, desc: '황야에서 온 여우. 숨겨진 보물 냄새를 맡는다.', c1: '#b0a8a0' },
    { id: 'dreammoth', name: '꿈나방', r: 2, bonus: 'offlineEff', base: 0.06, desc: '잠든 주인의 꿈속에서도 공부를 이어 간다.', c1: '#c0a0e0' },
    { id: 'clockcat', name: '태엽 고양이', r: 2, bonus: 'critC', base: 0.025, desc: '정확히 세 시 십 분마다 하품한다. 사냥은 그보다 정확하다.', c1: '#d0b070' },
    { id: 'shadowcrow', name: '그림자까마귀', r: 3, bonus: 'critD', base: 0.18, desc: '주인의 그림자 속에 사는 까마귀. 적의 약점을 속삭인다.', c1: '#3a3450' },
    { id: 'starwhale', name: '별고래 새끼', r: 3, bonus: 'manaPct', base: 0.15, desc: '구름바다를 헤엄치는 별고래의 새끼. 숨을 쉴 때마다 마나가 흩날린다.', c1: '#6a8aff' },
    { id: 'starwyrm', name: '작은 성룡', r: 3, bonus: 'atkPct', base: 0.12, desc: '별샘에서 태어난다는 용의 새끼. 아직은 손바닥만 하다.', c1: '#ff9a6a' }
  ];
  D.FAM_RARITY = [
    { name: '평범', color: '#b9bccb', w: 60 },
    { name: '희귀', color: '#6aa8ff', w: 28 },
    { name: '귀한', color: '#c084fc', w: 10 },
    { name: '전설', color: '#f2b84b', w: 2 }
  ];
  D.BONUS_NAMES = {
    goldPct: CUR + ' 획득', atkPct: '공격력', physPct: '물리 피해', hpPct: '생명력', lectureSpd: '수업 속도', knowPct: '지식 획득',
    aps: '공격 속도', dropPct: '전리품 확률', critC: '치명타 확률', critD: '치명타 피해',
    manaPct: '마나 재생', xpPct: '경험치', defPct: '방어력', spellPct: '주문 위력', leech: '생명력 흡수', rarity: '등급 상승', brewSpd: '양조 효율', manaCap: '마나 저장 한도', examBonus: '시험 가산점', bossDmg: '보스 피해', cdr: '재사용 대기 감소', killMana: '처치 시 마나(초)', hatchSpd: '부화 효율', enhBonus: '강화 성공률', dispPct: '파견 보상'
  };

  /* ───────── 서고 연구 ───────── */
  // time: 첫 단계 소요 초, tg: 단계마다 시간 배율 (최대 48시간)
  D.RESEARCH = [
    { id: 'manaspring', name: '마나 샘 개척', desc: '마나 재생 +15%', eff: { manaPct: 0.15 }, mana: 400, know: 0, g: 1.42, max: 60, time: 300, tg: 1.32 },
    { id: 'storage', name: '마나 저장고 확장', desc: '마나 저장 한도 +3시간분', eff: { manaCap: 10800 }, mana: 1500, know: 40, g: 1.9, max: 8, time: 1800, tg: 1.6 },
    { id: 'speedread', name: '속독술', desc: '수업 속도 +2%', eff: { lectureSpd: 0.02 }, mana: 800, know: 30, g: 1.4, max: 50, time: 600, tg: 1.3 },
    { id: 'combat', name: '전투 마법 이론', desc: '공격력 +8%', eff: { atkPct: 0.08 }, mana: 1000, know: 40, g: 1.38, max: 80, time: 600, tg: 1.28 },
    { id: 'sigil', name: '수호 문양학', desc: '생명력 +8%, 방어력 +4%', eff: { hpPct: 0.08, defPct: 0.04 }, mana: 1000, know: 40, g: 1.38, max: 80, time: 600, tg: 1.28 },
    { id: 'merchant', name: '상인의 화술', desc: CUR + ' 획득 +10%', eff: { goldPct: 0.1 }, mana: 1500, know: 60, g: 1.42, max: 50, time: 900, tg: 1.3 },
    { id: 'focus', name: '집중 명상', desc: '지식 획득 +10%', eff: { knowPct: 0.1 }, mana: 1800, know: 50, g: 1.42, max: 50, time: 900, tg: 1.3 },
    { id: 'veteran', name: '실전 경험록', desc: '경험치 +10%', eff: { xpPct: 0.1 }, mana: 1800, know: 70, g: 1.42, max: 50, time: 900, tg: 1.3 },
    { id: 'luckystar', name: '행운의 별자리', desc: '전리품 확률 +5%, 등급 상승', eff: { dropPct: 0.05, rarity: 0.05 }, mana: 6000, know: 200, g: 1.5, max: 30, time: 3600, tg: 1.35, grade: 2 },
    { id: 'brewing', name: '연금 효율', desc: '양조 비용 -13%', eff: { brewSpd: 0.15 }, mana: 5000, know: 150, g: 1.55, max: 20, time: 3600, tg: 1.35, grade: 2 },
    { id: 'hatching', name: '부화 촉진', desc: '부화 비용 -13%', eff: { hatchSpd: 0.15 }, mana: 9000, know: 250, g: 1.55, max: 20, time: 5400, tg: 1.35, grade: 3 },
    { id: 'bag', name: '공간 확장 주문', desc: '가방 칸 +5', eff: { bag: 5 }, mana: 3000, know: 80, g: 1.8, max: 10, time: 1800, tg: 1.5 },
    { id: 'dual', gone: true, name: '이중 수강 허가', desc: '수업 슬롯 +1', eff: { lectureSlot: 1 }, mana: 60000, know: 3000, g: 25, max: 2, time: 43200, tg: 3, grade: 2 },
    { id: 'assistant', gone: true, name: '연구 조교 고용', desc: '연구를 두 개 동시에 진행', eff: { researchSlot: 1 }, mana: 60000, know: 2000, g: 1, max: 1, time: 43200, tg: 1, grade: 3 },
    { id: 'expedition', gone: true, name: '원정대 편성', desc: '원정 슬롯 +1', eff: { expSlot: 1 }, mana: 250000, know: 8000, g: 1, max: 1, time: 86400, tg: 1, grade: 4 },
    { id: 'abyss', name: '심연 연구', desc: '공격력·생명력 +4% (마스터 과정, 단계 제한 없음)', eff: { atkPct: 0.04, hpPct: 0.04 }, mana: 2000000, know: 100000, g: 1.08, max: 999, time: 86400, tg: 1, grade: 8 },
    { id: 'sorter', name: '분류 마법', desc: '자동 판매 기능 해금', eff: { autosell: 1 }, mana: 2000, know: 50, g: 1, max: 1, time: 1200, tg: 1 },
    { id: 'runeforge', name: '룬 각인술', desc: '강화 성공률 +3%p', eff: { enhBonus: 0.03 }, mana: 40000, know: 1500, g: 1.7, max: 10, time: 14400, tg: 1.4, grade: 4 }
  ];

  /* ───────── 시험 ───────── */
  /* ───────── 학기 이야기 (메인 퀘스트) ─────────
     한 학년 = 한 장. 단계마다 장면(sc) · 목표(g) · 보상(rw) · 끝 장면(end). 기말시험이 늘 장의 마지막 단계다.
     레벨 디자인: 1장 1~3단계는 수업 → 원정 → 연구를 바로 해 보는 튜토리얼(맡기기만 하면 완료, 보상으로 다음 것을 할 마나를 준다),
     그다음은 그 학년 지역의 보스 → 기말 순서. 보스는 늘 기말보다 먼저 잡을 수 있다(시뮬레이션 기준).
     목표 종류: lecRun · expRun · resRun(지금 하고 있거나 이 단계에서 한 번 이상) · cnt(이 단계부터 센 통계) · st(통계 누적) · subj(과목 레벨)
               boss(그 단계 보스 처치) · elig(이번 기말 응시 자격) · exam(그 학년 기말 합격) · badge(휘장 달기) · fam(사역마 종류 수) */
  D.MQ = [
    { title: '종이 울리지 않은 입학식', steps: [
      { t: '첫 교시', who: '기숙사 반장 선배', tut: 'lec', go: ['lecture'], g: [{ k: 'lecRun' }], rw: { mana: 200, shard: 3 },
        sc: '입학식이 끝나고 나서 기숙사 반장 선배가 시간표를 건넸다. “오늘 첫 교시는 원소역학이네. 벨로르 교수님은 지각을 싫어하시니까 얼른 가 봐.” 시간표를 집어넣던 차에 다른 선배들이 수군거리는 소리를 들었다. “올해는 정말 안 울리네.” 매년 울려야 한다던 종탑 이야기인 듯싶다.' },
      { t: '저장고의 소리', who: '브람 하일 교수', tut: 'exp', go: ['explore'], g: [{ k: 'expRun' }], rw: { mana: 200, shard: 3 },
        sc: '브람 하일 교수가 결계 도면을 펼쳤다. “밤마다 지하 저장고 결계 안쪽에서 긁히는 듯한 소리가 난다더구나. 쥐는 아닌 것 같고.” 교수는 당신을 보며 말했다. “1학년이 연습 삼아 가 보기 좋을 것 같군. 다녀오도록.”' },
      { t: '읽을 수 없는 글자', who: '마르텐 오웰 교수', tut: 'res', go: ['lib'], g: [{ k: 'resRun' }], rw: { know: 60, shard: 5 },
        sc: '돋보기안경을 쓴 마르텐 오웰 교수는 열쇠를 한참이나 들여다보았다. “이걸 해석하느라 시간을 쏟고 있으니 네가 심부름을 좀 해 줘야겠다. 서고에 가서 『기초 해석』을 빌려와.”',
        end: '책을 받아 든 교수는 열쇠를 돌려주며 말했다. “이건 한 음절에 불과하네. 그 자체로는 아무 의미가 없어.”' },
      { t: '삐걱이는 골렘', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 10 }], rw: { gear: 1, shard: 8 },
        sc: '저장고 안쪽 깊은 곳. 골렘이 같은 동작을 되풀이하고 있었다. 무언가를 지키는 듯한 몸짓이었다.',
        end: '골렘을 쓰러뜨리자 그것의 가슴이 열리고, 안에서 녹슨 종 모양 열쇠가 굴러 나왔다.' },
      { t: '첫 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 1 }], rw: { shard: 10 },
        sc: '1학년 기말 시험장에서 일어난 작은 사건. 그날의 시험 보조로 들어온 골렘의 이마에 낯익은 글자가 새겨져 있었다.',
        end: '마지막 차례였던 마틴이 주문을 외운 순간, 당신은 멀고도 가까운, 묵직한 진동을 느꼈다. 대부분의 학생들은 아무것도 느끼지 못한 것 같지만…….' }
    ] },
    { title: '속삭이는 숲', steps: [
      { t: '냄비 태우기', who: '세라핀 루 교수', go: ['lecture'], g: [{ k: 'subj', s: 'alch', n: 1 }], rw: { shard: 5 },
        sc: '세라핀 루 교수의 실습실에서는 늘 무언가 끓고 있었다. “2학년부터는 손으로 배워요. 첫 시간엔 냄비 태우는 것부터.” 교수는 웃으며 당신 앞에 작은 솥을 놓았다.' },
      { t: '숲의 소문', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 2 }], rw: { stone: 5, shard: 5 },
        sc: '동쪽 숲으로 나가는 허가가 났다. 수다쟁이 버섯들이 같은 이야기를 되풀이했다. “섬이 한 뼘 내려갔대. 작년보다 한 뼘.”',
        end: '버섯들 말이 사실인지 확인할 방법은 하나뿐이었다. 숲에서 가장 오래 산 나무에게 묻는 것.' },
      { t: '빈손으로는', who: '세라핀 루 교수', go: ['work', 'alch'], g: [{ k: 'cnt', s: 'brews', n: 1 }], rw: { mana: 1500, shard: 5 },
        sc: '“늙은 속삭임나무를 만나러 간다고요?” 루 교수가 눈을 동그랗게 떴다. “그럼 물약 하나는 만들어 가요. 그 나무는 빈손으로 찾아오는 사람과는 말을 안 하거든요.”' },
      { t: '늙은 속삭임나무', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 20 }], rw: { gear: 1, shard: 8 },
        sc: '숲 한가운데, 늙은 속삭임나무가 가지를 휘두르며 길을 막았다. “증명해라, 작은 마법사. 들을 자격이 있는지.”',
        end: '나무는 쓰러지지 않고, 고개를 숙이듯 가지를 내렸다. “섬은 가라앉고 있다. 창립자는 마지막에 이렇게 말했지. 종이 멈추면, 시간을 거슬러 오르라.”' },
      { t: '시간을 거슬러', who: '이그나 벨로르 교수', go: ['lecture'], g: [{ k: 'elig' }], rw: { know: 200, shard: 5 },
        sc: '벨로르 교수는 그 말을 듣고 콧방귀를 뀌었다. “옛날 사람들은 말을 꼭 그렇게 어렵게 해. 시험 공부나 해. 그게 제일 빠른 길이야.” 교수는 그렇게 말하면서도 종탑 쪽을 오래 쳐다보았다.' },
      { t: '두 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 2 }], rw: { shard: 10 },
        sc: '연금 키메라가 시험장 바닥을 긁으며 들어왔다. 키메라 목줄에 달린 패에, 또 그 글자가 있었다. 지난번과는 조금 다른 모양으로.',
        end: '이번 진동은 조금 더 묵직했다. 옆자리 학생이 고개를 갸웃했다. “방금 뭐가 울리지 않았어?” 당신은 대답 대신 녹슨 열쇠를 꼭 쥐었다.' }
    ] },
    { title: '가라앉은 천문대', steps: [
      { t: '따뜻한 알', who: '고드릭 펜 교수', go: ['work', 'fam'], g: [{ k: 'fam', n: 1 }], rw: { shard: 5 },
        sc: '고드릭 펜 교수가 따뜻한 알 하나를 당신 손에 올려놓았다. “3학년 첫 숙제다. 깨어나면 이름은 네가 지어. 다만 이 녀석이 널 고르는 거지, 네가 고르는 게 아니야.”' },
      { t: '로브의 브로치', who: '학장', go: ['gear', 'badge'], g: [{ k: 'badge' }], rw: { shard: 5 },
        sc: '학장이 2학년을 마친 학생들의 로브에 직접 휘장을 달아 주었다. “이 브로치는 여러분이 걸은 길을 기억합니다. 많이 걸을수록 빛나지요.”' },
      { t: '구름 아래로', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 4 }], rw: { stone: 10, shard: 5 },
        sc: '구름 아래로 가라앉은 옛 천문대. 망원경들은 아직도 하늘이 아니라 바닥을 향해 있었다. 누군가 일부러 돌려놓은 것처럼.' },
      { t: '좁은 아래층', who: '고드릭 펜 교수', go: ['work', 'fam'], g: [{ k: 'cnt', s: 'dispatches', n: 1 }], rw: { shard: 8 },
        sc: '“천문대 아래층은 사람이 들어가기엔 좁아.” 펜 교수가 말했다. “네 사역마를 보내 봐. 작은 녀석들이 의외로 많은 걸 물어 온다.”',
        end: '사역마가 물어 온 것은 물에 젖은 관측 일지 한 권이었다. 마지막 몇 장은 천문대 꼭대기에 두고 온 듯 찢겨 있었다.' },
      { t: '천문대의 파수꾼', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 30 }], rw: { gear: 1, shard: 10 },
        sc: '일지의 나머지 장은 천문대 꼭대기, 파수꾼이 지키는 방에 있었다.',
        end: '오십 년 전의 기록. 별샘 하나의 빛이 해마다 약해지고 있었다. 마지막 페이지에는 떨리는 글씨로 적혀 있었다. “균열이 열린다. 사서에게 알려야 한다.”' },
      { t: '사서에게', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'elig' }], rw: { know: 500, shard: 5 },
        sc: '일지를 내밀자 이름 없는 사서는 마지막 장을 오래 들여다보았다. “오십 년이라.” 사서는 일지를 덮고 당신을 보았다. “시험부터 보게. 아직은 들려줄 수 있는 게 없네.”' },
      { t: '세 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 3 }], rw: { shard: 12 },
        sc: '환수 사육사의 그리핀이 날개를 펴자 시험장에 바람이 불었다. 그리핀의 발목 고리에도 그 글자가 새겨져 있었다.',
        end: '그 묵직한 진동이 다시 지나갔다. 이번에는 사서가 시험장 뒤편에 서 있었다. 사서는 아무 말 없이 고개를 한 번 끄덕이고 나갔다.' }
    ] },
    { title: '흐려지는 수정', steps: [
      { t: '기다리는 수업', who: '아스트라 노엘 교수', go: ['lecture'], g: [{ k: 'subj', s: 'astro', n: 3 }], rw: { shard: 5 },
        sc: '아스트라 노엘 교수의 첫 수업은 불을 끄는 것으로 시작했다. “별은 눈으로 읽는 게 아니에요. 기다리는 거예요.”' },
      { t: '출입 허가서', who: '아스트라 노엘 교수', go: ['lecture'], g: [{ k: 'cnt', s: 'tasksDone', n: 1 }], rw: { stone: 10, shard: 8 },
        sc: '“수정 동굴에 들어가려면 허가서가 있어야 해요.” 노엘 교수가 서류를 흔들었다. “교수님 과제 하나. 해 오면 서명해 줄게요.”' },
      { t: '숨을 참는 수정', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 6 }], rw: { stone: 15, shard: 5 },
        sc: '섬의 뿌리인 수정 광맥이 흐려지고 있었다. 광부들은 “수정이 숨을 참는다”고 했다. 깊이 들어갈수록 빛이 옅어졌다.' },
      { t: '수정여왕', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 40 }], rw: { gear: 1, shard: 10 },
        sc: '광맥 가장 깊은 곳에서 수정여왕 아라크니아가 실을 짜고 있었다. 실은 광맥 전체로 이어져, 빛을 조금씩 빨아들이고 있었다.',
        end: '실을 끊어 내자 광맥 깊은 곳에서 오래된 룬이 드러났다. 노엘 교수는 그 룬을 보고 얼굴이 하얗게 질렸다. “이건 창립 이전의 문자예요. 이걸 읽을 수 있는 사람은…….”' },
      { t: '교수의 침묵', who: '아스트라 노엘 교수', go: ['lib'], g: [{ k: 'cnt', s: 'researchDone', n: 2 }, { k: 'subj', s: 'astro', n: 10 }], rw: { know: 1500, shard: 8 },
        sc: '노엘 교수는 그 뒤로 룬 이야기를 꺼내지 않았다. 대신 별자리 숙제를 두 배로 냈다. “읽을 수 있게 되면, 그때 이야기해요.”' },
      { t: '도서관 쪽 창문', who: '', go: ['lecture'], g: [{ k: 'elig' }], rw: { shard: 5 },
        sc: '수업이 끝날 때마다 노엘 교수는 도서관 쪽 창문을 바라보았다. 그 창문에는 밤새 등불 하나가 켜져 있었다.' },
      { t: '네 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 4 }], rw: { shard: 12 },
        sc: '별자리 수호상이 천천히 고개를 들었다. 받침돌에 새겨진 별자리 사이로, 그 글자가 숨어 있었다.',
        end: '묵직한 진동, 네 번째. 녹슨 열쇠가 손안에서 미지근하게 데워졌다. 이제 알 것 같았다. 시험을 볼 때마다 무언가가 하나씩 맞춰지고 있다는 것을.' }
    ] },
    { title: '꺼지지 않는 재', steps: [
      { t: '떨어지면 다시 타', who: '카야 린 교관', go: ['lecture'], g: [{ k: 'subj', s: 'flight', n: 3 }], rw: { shard: 5 },
        sc: '카야 린 교관은 인사 대신 빗자루를 던졌다. “떨어지면 다시 타. 그게 수업이야.”' },
      { t: '황야 채비', who: '카야 린 교관', go: ['work', 'alch'], g: [{ k: 'cnt', s: 'brews', n: 3 }], rw: { mana: 20000, shard: 8 },
        sc: '“황야 열기에 맨몸으로 가면 큰일 나.” 카야 교관이 혀를 찼다. “루 교수님한테 가서 물약 챙겨. 세 병은 있어야 해.”' },
      { t: '재의 망령', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 8 }], rw: { stone: 20, shard: 5 },
        sc: '잿빛 황야는 오백 년 전 누군가 별의 종을 강제로 울리려다 실패한 자리였다. 재의 망령들은 아직도 같은 주문을 외우고 있었다.',
        end: '망령들의 주문은 마지막 음절만 비어 있었다. 그 빈자리의 모양이, 당신이 지금까지 들은 네 번의 진동과 똑같았다.' },
      { t: '날아서만 가는 곳', who: '카야 린 교관', go: ['lecture'], g: [{ k: 'subj', s: 'flight', n: 10 }], rw: { shard: 8 },
        sc: '“화산 꼭대기는 날아서만 가.” 카야 교관이 단호하게 말했다. “비행 10단계 전엔 안 보내. 떨어지는 건 수업 시간에만 해.”' },
      { t: '잠든 화산의 심장', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 50 }], rw: { gear: 1, shard: 12 },
        sc: '화산의 심장이 한 번 뛸 때마다 황야의 재가 하늘로 솟았다.',
        end: '카야 교관이 처음으로 웃지 않고 말했다. “너, 이제부터는 진짜로 조심해야 돼. 하늘이 갈라지고 있어.”' },
      { t: '보충 수업', who: '브람 하일 교수', go: ['lecture'], g: [{ k: 'subj', s: 'ward', n: 15 }, { k: 'subj', s: 'astro', n: 15 }], rw: { know: 3000, shard: 6 },
        sc: '하늘의 실금을 본 교수들이 보충 수업을 열었다. 하일 교수는 칠판에 결계 도면을, 노엘 교수는 별자리를 그렸다. “균열은 결계와 별, 둘 다로 읽어야 해.”' },
      { t: '바람을 읽다', who: '카야 린 교관', go: ['lecture'], g: [{ k: 'subj', s: 'flight', n: 15 }], rw: { shard: 8 },
        sc: '“이제 빗자루가 아니라 바람을 타.” 카야 교관이 말했다. “바람은 하늘이 갈라진 쪽으로 분다. 그걸 읽을 줄 알아야 해.”' },
      { t: '갈라지는 하늘', who: '', go: ['lecture'], g: [{ k: 'elig' }], rw: { know: 5000, shard: 5 },
        sc: '밤하늘에 실금 같은 선이 생겼다. 학생들은 별똥별 자국이라고 했지만, 그 선은 다음 날에도 그 자리에 있었다.' },
      { t: '다섯 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 5 }], rw: { shard: 15 },
        sc: '카야 교관의 분신이 빗자루 위에서 씩 웃었다. “봐주는 거 없다.” 분신의 빗자루 손잡이에도 그 글자가 새겨져 있었다.',
        end: '묵직한 진동, 다섯 번째. 이번엔 카야 교관도 느꼈다. 교관은 하늘을 올려다보며 중얼거렸다. “……이게 무슨.”' }
    ] },
    { title: '하늘의 균열과 금서', steps: [
      { t: '사서의 수업', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'subj', s: 'rune', n: 3 }], rw: { shard: 8 },
        sc: '6학년 시간표에 처음 보는 과목이 있었다. 고대 룬어, 담당 이름 없는 사서. 첫 시간, 사서는 칠판에 그 글자를 썼다. 당신의 열쇠에 새겨진 바로 그 글자를.' },
      { t: '하늘의 눈', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 10 }], rw: { stone: 25, shard: 5 },
        sc: '하늘의 균열 너머에서 거대한 눈이 아카데미를 내려다보고 있었다. 밤마다 균열이 한 뼘씩 넓어졌다.' },
      { t: '사람 냄새', who: '고드릭 펜 교수', go: ['work', 'fam'], g: [{ k: 'cnt', s: 'dispatches', n: 5 }], rw: { shard: 10 },
        sc: '“균열 근처는 사람 냄새를 맡으면 닫혀 버려.” 펜 교수가 말했다. “사역마들을 보내. 다섯 번쯤 다녀오면 길이 그려질 거다.”' },
      { t: '버티는 독서', who: '이름 없는 사서', go: ['lib'], g: [{ k: 'cnt', s: 'researchDone', n: 3 }, { k: 'subj', s: 'rune', n: 12 }], rw: { know: 20000, shard: 10 },
        sc: '균열을 막을 방법을 찾으려고, 이름 없는 사서가 처음으로 금서고의 문을 열어 주었다. 금서고의 책들은 펼칠 때마다 내용이 바뀌었다. 사서는 “읽는 게 아니라 버티는 것”이라고 했다.' },
      { t: '보내지 못한 편지', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'subj', s: 'rune', n: 18 }], rw: { shard: 10 },
        sc: '“룬은 외우는 게 아니다. 쓰는 사람의 숨을 따라가는 것이다.” 사서는 숙제로 천 년 전 편지 한 통을 내주었다. 스승에게 끝내 보내지 못한 편지였다.' },
      { t: '두 갈래 공부', who: '마르텐 오웰 교수', go: ['lecture'], g: [{ k: 'subj', s: 'syntax', n: 20 }, { k: 'subj', s: 'flight', n: 20 }], rw: { know: 30000, shard: 8 },
        sc: '오웰 교수와 카야 교관이 드물게 한목소리를 냈다. “주문은 정확하게, 몸은 가볍게. 마지막 장 앞에서는 둘 다 필요할 거다.”' },
      { t: '균열의 감시자', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 60 }], rw: { gear: 1, shard: 12 },
        sc: '균열 가장자리에 감시자가 떠 있었다. 감시자는 눈을 깜빡이지 않았다. 깜빡이는 법을 잊은 것처럼.',
        end: '감시자가 무너지자 균열이 잠시 좁아졌다. 그 틈 너머로, 공허의 도서관 가장 깊은 곳이 보였다.' },
      { t: '찢겨 나간 장', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'elig' }], rw: { shard: 8 },
        sc: '공허의 도서관 가장 깊은 곳, 찢겨 나간 마지막 장이 살아 움직이고 있었다. 사서는 낮게 말했다. “그 장을 찢은 것은 나다. 천 년 전, 스승의 부탁으로.”' },
      { t: '여섯 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 6 }], rw: { shard: 15 },
        sc: '룬 각인 기사의 갑옷에는 빈틈없이 룬이 새겨져 있었다. 당신은 이제 그 대부분을 읽을 수 있었다.',
        end: '묵직한 진동, 여섯 번째. 사서가 시험장 문간에서 말했다. “하나 남았네.”' }
    ] },
    { title: '별의 종', steps: [
      { t: '첫 번째 제자', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'cnt', s: 'lecJobs', n: 10 }], rw: { shard: 10 },
        sc: '사서는 당신을 금서고 맨 안쪽으로 데려갔다. “나는 오렐리아 베스퍼의 첫 번째 제자였다. 스승은 종이 언젠가 멈출 것을 알고, 다시 울릴 주문을 시간 속에 나누어 숨겼지.”' },
      { t: '일곱 과목, 일곱 해', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'subj', s: 'rune', n: 20 }], rw: { know: 50000, shard: 10 },
        sc: '“일곱 과목, 일곱 해, 일곱 번의 시험.” 사서가 말했다. “이 아카데미의 교육 과정 자체가 하나의 주문이다. 너는 여섯 음절을 외웠다. 마지막 하나는 내가 찢은 장에 있다.”' },
      { t: '글자가 사람을 먹는 곳', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 12 }], rw: { stone: 30, shard: 8 },
        sc: '공허의 도서관에서는 글자가 사람을 먹는다. 책장 사이로 그림자 사서들이 조용히 하라고 손짓했다.' },
      { t: '한 조각씩', who: '브람 하일 교수', go: ['lib'], g: [{ k: 'cnt', s: 'researchDone', n: 2 }], rw: { shard: 10 },
        sc: '교수들이 하나둘 당신을 찾아왔다. 벨로르, 오웰, 하일, 루, 펜, 노엘, 카야. “우리도 알고 있었다.” 하일 교수가 말했다. “각자 한 조각씩만. 서고에 우리 조각을 맡겨 두었다. 연구로 이어 붙여라.”' },
      { t: '별을 다시 읽다', who: '아스트라 노엘 교수', go: ['lecture'], g: [{ k: 'subj', s: 'astro', n: 22 }, { k: 'subj', s: 'elem', n: 22 }], rw: { know: 80000, shard: 10 },
        sc: '노엘 교수가 오랜만에 불을 끄고 수업을 열었다. 벨로르 교수도 맨 뒷줄에 앉아 있었다. “이번엔 기다리지 않아도 돼요. 별이 먼저 당신을 기다리고 있으니까.”' },
      { t: '금지된 장의 화신', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 70 }], rw: { gear: 1, shard: 15 },
        sc: '찢겨 나간 마지막 장은 스스로 몸을 만들어 서 있었다. 천 년 동안 혼자 기다린 글자들이었다.',
        end: '마지막 장이 당신 손에 들어왔다. 거기엔 단 한 줄, 일곱 번째 음절이 적혀 있었다. 읽으면 안 되는 글자였다. 아직은.' },
      { t: '읽으면 안 되는 글자', who: '이름 없는 사서', go: ['lecture'], g: [{ k: 'subj', s: 'rune', n: 24 }], rw: { know: 100000, shard: 10 },
        sc: '“아직 읽지 마라.” 사서가 마지막 장을 덮었다. “일곱 번째 음절은 종 앞에서 처음 소리 내야 한다. 그때까지 네 혀가 그 무게를 견딜 수 있게 만들어 두어라.”' },
      { t: '탑 아래에서', who: '학장', go: ['lecture'], g: [{ k: 'elig' }], rw: { shard: 8 },
        sc: '시간의 탑으로 오르는 계단 앞에서 학장이 기다리고 있었다. “졸업 시험은 탑 꼭대기에서 봅니다. 준비가 되면 오세요. 종은 기다려 줍니다. 천 년도 기다렸으니까요.”' },
      { t: '일곱 번째 음절', who: '', go: ['exam'], g: [{ k: 'exam', n: 7 }], rw: { shard: 20 },
        sc: '창립자의 잔영이 종 아래에 서 있었다. 오렐리아 베스퍼는 당신을 보고 미소 지었다. “늦지 않았구나.”',
        end: '시간의 탑 꼭대기에서 당신은 마지막 음절을 외웠다. 천 년 만에, 종이 울렸다. 섬이 떠오른다. 그리고 종소리가 닿지 않는 섬 아래, 끝없는 심연이 모습을 드러냈다.' }
    ] },
    { title: '끝나지 않는 수업', steps: [
      { t: '별의 인장', who: '학장', go: ['explore', 'boss'], g: [{ k: 'boss', n: 80 }], rw: { gear: 1, shard: 15 },
        sc: '종이 다시 울린 날, 학장은 당신에게 별의 인장을 건넸다. “졸업은 미뤄 두세요. 시간의 탑에는 아직 멈춘 채로 남은 것이 있습니다.”',
        end: '멈춘 시간의 수호자가 무너지며 탑의 모래시계가 다시 흘렀다. 아래로, 아래로.' },
      { t: '배지를 단 그림자', who: '', go: ['explore'], g: [{ k: 'cnt', s: 'expJobs', n: 10 }], rw: { stone: 40, shard: 10 },
        sc: '종소리가 닿지 않는 섬 아래, 끝없는 심연. 내려갈수록 아카데미 배지를 단 그림자들이 늘어났다. 오래전 이곳에 내려온 선배들이었다.' },
      { t: '심연의 군주', who: '', go: ['explore', 'boss'], g: [{ k: 'boss', n: 90 }], rw: { gear: 1, shard: 20 },
        sc: '심연의 군주는 종소리를 싫어했다. 종이 울릴 때마다 조금씩 작아졌으니까.',
        end: '군주가 무너지며 웃었다. “종은 또 멈춘다. 그때도 네가 있을까?”' },
      { t: '다음 종을 위해', who: '', go: ['lib'], g: [{ k: 'cnt', s: 'researchDone', n: 3 }], rw: { shard: 20 },
        sc: '당신은 마스터 과정 연구생이 되었다. 같은 하늘 아래의 모든 학생과 함께, 다음에 종이 멈출 날을 대비한다.',
        end: '여기까지가 지금의 이야기. 하지만 수업은 끝나지 않는다.' }
    ] }
  ];
  D.EXAMS = [
    { grade: 1, title: '1학년 기말: 기초 마법 이론', subj: ['elem', 'syntax', 'ward'], req: 3, duel: 9, examiner: '견습 시험관 골렘' },
    { grade: 2, title: '2학년 기말: 원소와 연금', subj: ['elem', 'ward', 'alch'], req: 6, duel: 17, examiner: '연금 키메라' },
    { grade: 3, title: '3학년 기말: 생명과 주문', subj: ['syntax', 'alch', 'beast'], req: 10, duel: 26, examiner: '환수 사육사의 그리핀' },
    { grade: 4, title: '4학년 기말: 하늘을 읽는 자', subj: ['elem', 'beast', 'astro'], req: 14, duel: 35, examiner: '별자리 수호상' },
    { grade: 5, title: '5학년 기말: 결계와 비행', subj: ['ward', 'astro', 'flight'], req: 18, duel: 45, examiner: '카야 교관의 분신' },
    { grade: 6, title: '6학년 기말: 잊힌 문자', subj: ['syntax', 'flight', 'rune'], req: 22, duel: 55, examiner: '룬 각인 기사' },
    { grade: 7, title: '졸업 시험: 별의 종 앞에서', subj: ['elem', 'astro', 'rune'], req: 26, duel: 66, examiner: '창립자의 잔영' }
  ];

  /* ───────── 이야기 ───────── */
  D.STORY = [
    { grade: 1, title: '1장. 구름 위의 입학식',
      text: '그해 봄, 창틀에 아홉 무사이의 인장이 찍힌 봉투가 놓여 있었다. 몇 해 전부터 당신에게만 들리던 낮고 먼 울림, 아무도 믿어 주지 않던 그 소리가 별의 종의 여운이라는 것을 봉투 속 초대장이 알려 주었다. "이 울림을 듣는 이에게, 모네타의 문은 열려 있습니다."\n\n입학식 날 새벽, 에테라 대륙 끝의 카메나 샘역에 하얀 증기를 두른 입학 열차 칼리오페호가 들어왔다. 초대장을 내밀자 차장은 말없이 고개를 끄덕였다. 기적이 아홉 음으로 울리고, 열차는 구름 위에 걸린 금빛 현을 따라 밤새 달렸다. 창밖으로 일곱 별샘이 마나의 비를 뿌렸다.\n\n동이 틀 무렵 구름 사이로 섬 하나가 떠올랐다. 구름섬 라디아. 천 년 전 대마법사 오렐리아 베스퍼가 "별의 종"을 주조해 띄운 섬, 그 위에 모네타 아카데미가 있다. 라디아 종탑역에 내리자 시간의 탑이 머리 위로 솟아 있었다.\n\n입학식 날, 학장은 짧게 말했다. "올해는 종이 울리지 않았습니다. 하지만 수업은 평소대로 진행합니다." 강당이 술렁였지만, 신입생인 당신에겐 그 말의 무게가 아직 와닿지 않았다.' },
    { grade: 2, title: '2장. 속삭이는 숲의 소문',
      text: '2학년이 되자 동쪽 숲으로 나가는 허가가 났다. 수다쟁이 버섯들이 같은 이야기를 반복했다. "섬이 한 뼘 내려갔대. 작년보다 한 뼘."\n\n늙은 속삭임나무는 당신을 내려다보며 창립자의 마지막 말을 들려주었다. "종이 멈추면, 시간을 거슬러 오르라." 무슨 뜻인지 아는 사람은 없었다.' },
    { grade: 3, title: '3장. 가라앉은 천문대',
      text: '구름 아래로 가라앉은 옛 천문대. 그곳의 관측 일지에는 오십 년 전부터 별샘 하나의 빛이 약해지고 있었다는 기록이 남아 있었다.\n\n마지막 페이지에는 떨리는 글씨로 이렇게 적혀 있었다. "균열이 열린다. 사서에게 알려야 한다." 아카데미에 사서는 단 한 명, 이름 없는 그 사람뿐이다.' },
    { grade: 4, title: '4장. 흐려지는 수정',
      text: '섬의 뿌리인 수정 광맥이 흐려지고 있었다. 수정여왕의 실을 끊어 내자, 광맥 깊은 곳에서 오래된 룬이 드러났다. 아스트라 노엘 교수는 그 룬을 보고 얼굴이 하얗게 질렸다.\n\n"이건 창립 이전의 문자예요. 이걸 읽을 수 있는 사람은……." 교수는 말끝을 흐리고 도서관 쪽을 바라보았다.' },
    { grade: 5, title: '5장. 꺼지지 않는 재',
      text: '잿빛 황야는 오백 년 전 누군가 별의 종을 강제로 울리려다 실패한 자리였다. 재의 망령들은 아직도 같은 주문을 외우고 있었다. 그 주문의 마지막 음절만이 비어 있었다.\n\n카야 교관이 처음으로 웃지 않고 말했다. "너, 이제부터는 진짜로 조심해야 돼. 하늘이 갈라지고 있어."' },
    { grade: 6, title: '6장. 하늘의 균열과 금서',
      text: '하늘의 균열 너머에서 거대한 눈이 아카데미를 보고 있었다. 균열을 막기 위해 이름 없는 사서가 처음으로 금서고의 문을 열어 주었다.\n\n공허의 도서관 가장 깊은 곳, 찢겨 나간 마지막 장이 살아 움직이고 있었다. 사서는 낮게 말했다. "그 장을 찢은 것은 나다. 천 년 전, 스승의 부탁으로."' },
    { grade: 7, title: '7장. 별의 종',
      text: '이름 없는 사서는 오렐리아 베스퍼의 첫 번째 제자였다. 스승은 종이 언젠가 멈출 것을 알고, 그것을 다시 울릴 주문을 시간 속에 나누어 숨겼다. 일곱 과목, 일곱 해, 일곱 번의 시험. 모네타의 교육 과정 자체가 하나의 거대한 주문이었다.\n\n시간의 탑 꼭대기에서 당신은 마지막 음절을 외웠다. 천 년 만에, 종이 울렸다. 섬이 떠오른다. 그리고 종소리가 닿지 않는 섬 아래, 끝없는 심연이 모습을 드러냈다.' },
    { grade: 8, title: '8장. 끝나지 않는 수업',
      text: '종이 다시 울린 날, 학장은 당신에게 별의 인장을 건네며 말했다. "졸업은 미뤄 두세요. 종소리가 닿지 않는 저 아래가 아직 남았습니다."\n\n당신은 마스터 과정 연구생이 되었다. 같은 하늘 아래의 모든 학생과 함께, 끝없는 심연으로 내려가며 다음에 종이 멈출 날을 대비한다.' }
  ];

  /* ───────── 세계관 도감 ───────── */
  D.LORE = [
    { id: 'aethera', title: '에테라 대륙', text: '하늘에 떠 있는 일곱 개의 별샘에서 마나가 비처럼 내리는 대륙. 마나 비가 많이 내리는 곳일수록 마법이 번성했고, 그 중심에 구름섬 라디아가 있다.' },
    { id: 'wells', title: '일곱 별샘', text: '등불, 물시계, 가시, 거울, 은빛, 잿불, 별무리. 에테라 하늘에 뜬 일곱 샘으로, 저마다 빛깔이 다른 마나를 비처럼 내린다. 별의 종은 이 일곱 빛을 녹여 만들었다. 아홉째 달인 침묵달에는 별샘이 하나도 보이지 않는다.' },
    { id: 'radia', title: '구름섬 라디아', text: '모네타 아카데미가 세워진 떠 있는 섬. 섬을 띄우는 것은 아카데미 중앙 시간의 탑에 걸린 별의 종이며, 종은 매년 입학식 날 저절로 울려 섬을 다시 들어 올린다.' },
    { id: 'orelia', title: '오렐리아 베스퍼', text: '모네타의 창립자이자 별의 종을 주조한 대마법사. 아카데미의 일곱 과목 체계를 직접 설계했다. 그녀의 초상화는 교수 회의실에 걸려 있지만, 얼굴 부분만 늘 그림자에 가려져 있다.' },
    { id: 'bell', title: '별의 종', text: '일곱 별샘의 빛을 녹여 만든 종. 종이 울릴 때마다 섬 전체의 결계가 새로 짜인다. 종이 울리지 않은 해는 아카데미 역사상 단 한 번도 없었다. 올해까지는.' },
    { id: 'houses', title: '네 기숙사', text: '등불관, 물시계관, 가시왕관관, 거울관. 입학생은 기숙사 문 앞의 거울에 손을 대고, 거울이 비추는 빛의 색에 따라 배정된다. 기숙사 간 경쟁은 아카데미 축제의 가장 큰 볼거리다.' },
    { id: 'librarian', title: '이름 없는 사서', text: '아카데미 도서관을 홀로 지키는 사서. 고대 룬어를 가르치는 유일한 사람이다. 누구도 그의 이름을 모르고, 아카데미의 가장 오래된 졸업 앨범에도 그가 지금 모습 그대로 찍혀 있다.' },
    { id: 'mana', title: '마나의 세 형태', text: '아카데미에서는 마나를 세 가지로 나눠 가르친다. 흐르는 마나(재생), 고인 마나(마석), 새긴 마나(룬). 마석은 고인 마나가 굳은 것으로 장비 강화에 쓰인다.' },
    { id: 'seals', title: '별의 인장', text: '졸업생에게만 주어지는 인장. 인장에는 졸업생이 배운 것의 일부가 봉인되어 있어, 다음 세대의 학생에게 유산으로 전해질 수 있다.' },
    { id: 'spirits', title: '반딧불 정령', text: '별샘에서 떨어진 작은 빛 조각이 의지를 가진 것. 아카데미 곳곳을 떠돌다 학생들의 유리병에 스스로 들어와 쉬고, 풀어 준 학생에게 작은 선물을 남기고 사라진다.' },
    { id: 'calendar', title: '아카데미력', text: '모네타는 창립년을 원년으로 하는 아카데미력을 쓴다. 올해는 아카데미력 1024년이다. 한 해는 아홉 달, 한 달은 스물여덟 날이며, 달마다 무사이 한 명의 이름을 따른다. 서사달(칼리오페), 기록달(클리오), 피리달(에우테르페), 웃음달(탈리아), 가면달(멜포메네), 춤달(테르프시코레), 연가달(에라토), 별무리달(우라니아), 그리고 아홉째 침묵달(폴리힘니아). 학생들 사이에서는 "침묵달에 치른 시험은 반드시 붙는다"는 미신이 있다.' },
    { id: 'musai', title: '아홉 무사이', text: '기억의 여신 므네모시네의 아홉 딸. 모네타라는 이름도 므네모시네를 부르는 로마식 이름에서 왔다. 오렐리아 베스퍼는 여덟 학년마다 무사이 한 명을 수호자로 두었고, 학생은 해마다 그 무사이의 음을 하나씩 얻어 화음을 쌓아 간다고 전해진다. 아홉째 폴리힘니아만은 어느 학년에도 속하지 않는다. 그녀는 늘 손가락을 입술에 댄 모습으로 그려진다.' },
    { id: 'invite', title: '초대장', text: '별의 종은 울리고 나면 한 해 내내 사람의 귀에는 들리지 않는 낮은 여운을 남긴다. 에테라 대륙에서 그 여운을 듣는 아이는 한 해에 손에 꼽을 만큼뿐이고, 모네타는 오직 그들에게만 아홉 무사이의 인장이 찍힌 초대장을 보낸다. 가문도 재산도 묻지 않는다. 초대장은 그대로 입학 열차의 승차권이 된다. 올해의 신입생은 지난해 종의 여운을 마지막으로 들은 아이들이다.' },
    { id: 'calliope', title: '칼리오페호', text: '한 해에 단 한 번, 입학식 날 새벽에만 달리는 입학 열차. 기적이 아홉 음으로 울린다. 칼리오페는 서사의 무사이 이름이자, 증기로 노래하는 오르간의 이름이기도 하다. 졸업생들은 마지막 날 이 열차를 다시 타고 대륙으로 돌아간다.' },
    { id: 'camena', title: '카메나 샘역', text: '에테라 대륙에서 오선 철도가 시작되는 단 하나의 역. 로마 사람들이 무사이를 부르던 이름 "카메나이"에서 따왔다. 역 한가운데 맑은 샘이 솟고, 입학생들은 열차를 타기 전 그 물로 손을 씻는 것이 관례다.' },
    { id: 'staff', title: '오선 철도', text: '라디아 둘레의 하늘에는 금빛 현 다섯 줄이 걸려 있다. 위에서 내려다보면 오선지, 줄 위에 뜬 하늘섬들은 음표처럼 보인다. 열차가 현 위를 지나가면 줄이 울려, 섬마다 다른 화음으로 기차 소리가 들린다. 올해는 현이 조금 느슨해져 열차가 반음 낮게 운다는 소문이 돈다.' },
    { id: 'station', title: '라디아 종탑역', text: '시간의 탑 바로 아래에 있는 아카데미의 역. 현마다 하나씩 다섯 승강장이 있고, 사감의 허가가 있어야 들어가는 "쉼표 승강장"이 따로 있다. 막차인 자장가 열차는 밤 열 시에 떠나며, 이 열차를 놓치면 벌점이다. 주말 외출에는 기숙사 사감의 도장이 찍힌 외출증이 필요하다.' },
    { id: 'isles', title: '주말의 하늘섬', text: '포르타 마을: 종탑역에서 가장 가까운 섬. 반음 찻집과 꿀사과주를 파는 쉼표 여관이 있다.\n칸토 섬: 현악 골목을 따라 지팡이 공방, 중고 마도서 가게, 사역마 먹이 상점, 교복 수선집, 종이학 우체국이 늘어서 있다.\n테아트론 섬: 연극과 서커스, 기숙사 대항 결투 대회가 열린다.\n테르프시코레 섬: 학기 말 무도회장.\n우라니아 섬: 밤에만 열차가 서는 천문대 섬.\n클리오 섬: 역대 졸업 앨범과 옛 신문을 모아 둔 기록 보관소.\n\n1학년은 포르타와 칸토까지만 다녀올 수 있고, 학년이 오를수록 갈 수 있는 섬이 늘어난다.' },
    { id: 'silentisle', title: '침묵의 섬', text: '몇 해 전 현 한 줄이 끊어지며 열차가 끊긴 섬. 녹슨 폐역과 멈춘 시계만 남아 있다. 출입 금지 구역이지만, 담력 시험을 한다며 몰래 건너가는 학생이 해마다 나온다. 그곳에 다녀온 학생들은 하나같이 "아무 소리도 들리지 않았다"고 말한다.' }
  ];

  /* ───────── 교수님의 과제 (평생 1회) ───────── */
  // k: subj(과목 레벨) | st(누적 통계) | stage(최고 단계)
  D.TASKS = {
    elem: [
      { k: 'subj', n: 3, t: '불씨를 다루는 법부터. 원소역학 3레벨까지 와 보게.' },
      { k: 'st', s: 'kills', n: 30, t: '이론만으로는 부족하지. 몬스터 30마리를 상대해 보게.' },
      { k: 'stage', n: 41, t: '잿빛 황야에 가 보게. 실패한 대주문의 열기를 직접 느껴야 하네.', item: 'staff' }
    ],
    syntax: [
      { k: 'st', s: 'lecJobs', n: 15, t: '주문은 문장이라 했지. 수업을 열다섯 번 마치고 오게.' },
      { k: 'subj', n: 10, t: '연쇄 번개의 구문을 익힐 때가 됐네. 주문구문학 10레벨.' },
      { k: 'st', s: 'lecJobs', n: 200, t: '틀린 음절 하나 없이. 수업 200번.', item: 'tome' }
    ],
    ward: [
      { k: 'subj', n: 5, t: '수호 결계부터 세워 보자. 결계공학 5레벨.' },
      { k: 'st', s: 'bosses', n: 10, t: '벽은 두드려 봐야 안다. 보스를 10번 쓰러뜨려 봐.' },
      { k: 'st', s: 'bossTries', n: 30, t: '…부딪혀 본 사람만이 금을 찾는다. 보스나 결투에 30번 도전해 봐.', item: 'robe' }
    ],
    alch: [
      { k: 'st', s: 'brews', n: 3, t: '첫 물약을 세 병 끓여 보세요. 그을음은 훈장이에요.' },
      { k: 'subj', n: 12, t: '현자의 물약을 끓일 실력이 되면 다시 오세요. 연금화학 12레벨.' },
      { k: 'st', s: 'brews', n: 60, t: '실습실 단골 되기. 물약 60병.', item: 'charm' }
    ],
    beast: [
      { k: 'st', s: 'famKinds', n: 2, t: '녀석들이 너를 고르게 둬. 사역마 두 종을 만나 봐라.' },
      { k: 'subj', n: 8, t: '환수 소환을 배울 때다. 환수생태학 8레벨.' },
      { k: 'st', s: 'famKinds', n: 6, t: '여섯 종. 그 정도면 사육장 열쇠를 맡겨도 되겠지.', item: 'hat' }
    ],
    astro: [
      { k: 'st', s: 'spirits', n: 5, t: '정령 병에 모인 반딧불 정령을 다섯 마리 풀어 주기.' },
      { k: 'subj', n: 10, t: '별똥별을 부를 차례예요. 성도해석학 10레벨.' },
      { k: 'stage', n: 51, t: '하늘의 균열을 직접 보고 오세요. 별은 늦게 말하니까요.', item: 'charm' }
    ],
    flight: [
      { k: 'subj', n: 5, t: '빗자루에서 떨어지지 않는 것부터! 체술·비행 5레벨.' },
      { k: 'st', s: 'nightJobs', n: 20, t: '밤새 날아 본 적 있어? 8시간 넘는 파견이나 연구를 20번 끝내 봐!' },
      { k: 'stage', n: 71, t: '시간의 탑 계단을 뛰어올라 봐. 착지는 알아서!', item: 'robe' }
    ],
    rune: [
      { k: 'subj', n: 5, t: '……첫 룬을 기억해 내라. 고대 룬어 5레벨.' },
      { k: 'st', s: 'maxEnh', n: 10, t: '룬은 쇠에도 새겨진다. 장비를 +10까지 강화해라.' },
      { k: 'stage', n: 81, t: '종을 울려라. 그리고 그 아래를 보아라.', item: 'staff' }
    ]
  };

  /* ───────── 안내서 ───────── */
  // 플레이 가이드 (상단 「가이드」 버튼에서 검색할 수 있다). c: 분류, go: [화면, 위치] 바로 가기
  /* ───────── 칭호: 이름 앞에 붙는다. 조건을 채우면 내 정보에서 고를 수 있다 ───────── */
  D.TITLES = [
    { id: 'fresh', name: '신입생', how: '처음부터' },
    { id: 'g2', name: '2학년 선배', grade: 2, how: '2학년 진급' },
    { id: 'g4', name: '중견 학생', grade: 4, how: '4학년 진급' },
    { id: 'g6', name: '상급생', grade: 6, how: '6학년 진급' },
    { id: 'g8', name: '별의 종을 울린 자', grade: 8, how: '졸업 시험 합격' },
    { id: 'lamp', name: '등불 아래 서생', stat: 'lecHours', n: 100, how: '수업 100시간' },
    { id: 'owl', name: '밤샘 올빼미', stat: 'nightJobs', n: 30, how: '8시간 넘는 작업 30번' },
    { id: 'forest', name: '숲의 친구', stat: 'maxStageAll', n: 11, how: '속삭이는 숲 도달' },
    { id: 'crystal', name: '수정 채굴꾼', stat: 'maxStageAll', n: 31, how: '수정 동굴 도달' },
    { id: 'rift', name: '균열을 본 자', stat: 'maxStageAll', n: 51, how: '별의 균열 도달' },
    { id: 'abyss', name: '심연의 방랑자', stat: 'maxStageAll', n: 81, how: '심연 도달' },
    { id: 'hunter', name: '파수꾼 사냥꾼', stat: 'bosses', n: 20, how: '보스 20번 처치' },
    { id: 'alch', name: '그을린 앞치마', stat: 'brews', n: 30, how: '물약 30병' },
    { id: 'firefly', name: '반딧불의 벗', stat: 'spirits', n: 100, how: '정령 100마리 풀어 주기' },
    { id: 'smith', name: '강화 장인', stat: 'maxEnh', n: 10, how: '장비 +10 강화' },
    { id: 'duel', name: '결투제 우승자', stat: 'duelBest', n: 15, how: '결투제 우승' },
    { id: 'raid', name: '토벌대원', stat: 'wbKills', n: 1, how: '월드 보스 토벌 참여' },
    { id: 'cup', name: '대항전의 영웅', stat: 'cupWins', n: 1, how: '기숙사 대항전 1위' },
    { id: 'cum', name: '우등생', stat: 'aGrades', n: 3, how: '기말시험 A 이상 세 번' },
    { id: 'honor', name: '수석', stat: 'sGrades', n: 3, how: '기말시험 S 세 번' },
    { id: 'summa', name: '전 학년 수석', stat: 'sGrades', n: 7, how: '일곱 기말시험 모두 S' },
    { id: 'loyal', name: '개근상', stat: 'streak', n: 30, how: '30일 연속 출석' },
    { id: 'house', name: '', house: true, how: '내 기숙사의 상징 (기숙사마다 다름)' },
    // 운영진 전용 칭호: 서버가 운영자에게만 P.op를 켜 준다. 운영자가 아니면 목록에도 나오지 않고 달 수도 없다
    { id: 'op_bell', name: '종지기', op: true, how: '운영진 전용' },
    { id: 'op_clerk', name: '아카데미 서기', op: true, how: '운영진 전용' },
    { id: 'op_warden', name: '사감', op: true, how: '운영진 전용' },
    { id: 'op_admit', name: '입학처장', op: true, how: '운영진 전용' },
    { id: 'op_dean', name: '학장 대리', op: true, how: '운영진 전용' }
  ];
  D.HOUSE_TITLE = { lanterna: '등불관의 별', clepsydra: '물시계관의 물방울', corona: '가시왕관관의 칼날', speculum: '거울관의 그림자' };

  // 강의실이 붐빈 날 교수님 한마디 (그날 같은 과목을 들은 학생이 많으면 공지에 한 줄, 수업 보고서에도)
  D.PROF_CROWD = {
    elem: ['오늘은 강의실이 꽉 찼군. 불씨가 많으니 방이 다 따뜻하네.', '이렇게 많이들 오다니, 내일은 실습으로 화염구를 하나씩 띄워 보세.'],
    syntax: ['한 목소리로 주문을 외우니 벽이 다 울리더군. 오늘 발음은 합격일세.', '자리가 모자라 복도까지 앉았다지? 주어 없는 주문만 조심하게.'],
    ward: ['이만큼 모였으니 결계도 여럿이 함께 세워 볼 수 있겠어. 금 간 데부터 찾아보자.', '오늘은 다들 손발이 잘 맞았다. 벽은 여럿이 세워야 버틴다.'],
    alch: ['실습실 천장이 오늘따라 많이 그을렸네요. 그만큼 많이 왔다는 뜻이죠.', '가마솥이 모자랄 뻔했어요. 다음엔 둘씩 짝지어 끓여 볼까요?'],
    beast: ['오늘은 녀석들이 너희를 많이도 골랐구나. 사육장이 시끌벅적했다.', '이렇게 많은 학생이 오니 알들도 들썩이더군.'],
    astro: ['오늘 밤 관측대에 이렇게 많은 눈이 모인 건 처음이에요. 별이 조금 빨리 대답했죠.', '다 같이 본 별은 오래 기억된답니다.'],
    flight: ['하늘이 붐볐어! 오늘은 아무도 안 떨어졌다는 게 기적이야!', '착지 줄이 이렇게 길었던 적은 없었지. 다들 잘했어!'],
    rune: ['……오늘은 많은 이가 같은 문자를 기억해 냈다. 드문 일이다.', '……서고가 이렇게 시끄러웠던 적이 있었던가. 나쁘지 않다.']
  };
  D.GUIDE_CATS = ['처음', '자원', '아카데미 생활', '전투', '교류', '계정·서버'];
  D.GUIDE = [
    { c: '처음', t: '이 게임은 어떻게 하나요?', b: '수업과 원정을 30분~3시간 단위로 진행하고, 끝나면 다음 교시를 이어 가는 방치형 게임입니다. 뽀모도로 타이머처럼 활용할 수 있습니다. 창을 닫아도 서버에서 그대로 진행되며, 다시 접속하면 끝난 작업의 결과가 표시됩니다. 잠들기 전에는 연구 · 사역마 파견처럼 오래 걸리는 작업을 시작해 두면 좋습니다.', go: ['home'] },
    { c: '처음', t: '첫날 할 일', b: '1) 「수업·연구」에서 수업을 듣고 2) 「원정·전투」에서 추천 단계로 출정하고 3) 「수업·연구 → 서고」에서 연구를 하나 시작합니다. 아카데미 광장의 「다음 할 일」이 지금 할 일을 알려 주며, 「이동」 버튼으로 해당 화면에 바로 갈 수 있습니다. 화면 좌측(모바일에서는 하단)의 안내도는 비슷한 활동끼리 묶여 있습니다.', go: ['home'] },
    { c: '처음', t: '서버와 시간', b: '모든 학생이 같은 시간을 공유합니다. 아카데미력은 현실의 하루가 아카데미의 하루이며, 4주가 한 달, 아홉 달이 한 해입니다. 달마다 별샘의 축복이 바뀌고, 토 · 일요일에는 유성우가 내려 마나 재생과 수업 속도가 오릅니다. 학년은 달력과 관계없이 기말시험에 합격할 때마다 오릅니다.' },
    { c: '처음', t: '아카데미 광장 화면', b: '상단의 풍경에는 현재 하늘(하늘 이벤트 · 다음 일정)과 오늘의 축복이 표시되며, 좌측의 반딧불 병을 눌러 반딧불 정령을 풀어 줄 수 있습니다. 그 아래에서 공지 · 시간표 · 다음 할 일 · 일일 목표를 확인합니다. 잠자리 · 꿈길은 광장 하단에 있습니다.', go: ['home'] },
    { c: '처음', t: '밑줄 친 용어와 화면별 안내', b: '점선 밑줄이 있는 용어는 이 게임에서만 쓰는 고유명사입니다. 마우스를 올리면(모바일에서는 누르면) 가이드 요약이 표시되며, 누르면(모바일에서는 요약을 한 번 더 누르면) 가이드에서 해당 용어를 검색합니다. 각 화면에 처음 들어가면 화면별 안내가 한 번 표시되며, 가이드 › 처음의 「화면별 둘러보기 다시 보기」로 다시 볼 수 있습니다.' },
    { c: '처음', t: '적용 중인 효과 (버프)', b: '화면 상단의 아카데미력 아래에 지금 받고 있는 효과(신입생 오리엔테이션 · 별샘의 축복 · 물약 · 하늘 이벤트 등)가 남은 시간과 함께 표시됩니다. 마우스를 올리면 효과가, 누르면 적용 중인 효과 전체와 남은 시간이 팝업으로 표시됩니다.' },
    { c: '처음', t: '툴팁과 이동 버튼', b: '화면 우측 상단의 마나 · ' + CUR + ' · 지식 · 마석 · 별조각에 마우스를 올리면(모바일에서는 누르면) 얻는 방법과 현재 획득량이 표시됩니다. 일일 목표 · 업적 옆의 「이동」 버튼을 누르면 해당 화면으로 바로 이동합니다.' },
    { c: '자원', t: '마나', b: '시간이 지나면 자동으로 차오르며, 창을 닫아도 계속 쌓입니다. 저장 한도에 도달하면 더 이상 쌓이지 않으므로 한도를 늘리거나 틈틈이 사용하는 편이 좋습니다. 연구 · 물약 · 알 부화에 씁니다. 늘리는 방법: 의지 능력치, 연구 「마나 샘 개척」「마나 저장고 확장」, 물시계관, 물시계달, 유성우 주말, 숙면의 차, 반딧불 정령.', go: ['lib'] },
    { c: '자원', t: '아르크', b: '게임 내 화폐입니다. 대부분 원정에서 몬스터를 처치해 얻으며, 반딧불 정령 · 일일 목표 · 결투제 · 장비 판매 · 거래소 판매로도 얻습니다. 장비 강화 · 사역마 먹이 · 매점 · 거래소에서 씁니다. 높은 단계일수록 많이 주지만, 위험한 단계는 자주 쓰러져 오히려 손해일 수 있습니다.', go: ['explore'] },
    { c: '자원', t: '지식', b: '수업에서 얻습니다. 과목 레벨이 높을수록 시간당 획득량이 늘어납니다. 서고의 연구에 씁니다.', go: ['lecture'] },
    { c: '자원', t: '마석', b: '원정 중 가끔 떨어지며, 반딧불 정령 · 사역마 파견 · 보스 · 출석 · 매점 「마석 꾸러미」 · 거래소에서도 얻습니다. 장비 강화에 씁니다.', go: ['gear'] },
    { c: '자원', t: '별조각', b: '업적 · 일일 목표 · 출석 · 보스 첫 처치 · 기말시험 · 결투제 · 교수 과제 · 월드 보스 · 기숙사 대항전에서 얻는 귀한 재화입니다. 매점에서 환수의 알, 가방 확장 등을 구입합니다.', go: ['shop'] },
    { c: '자원', t: '재료', b: '원정 지역마다 다른 재료가 나옵니다(지하 저장고: 먼지 가루, 속삭이는 숲: 월광초 등). 물약 제조에 쓰며, 남는 재료는 거래소에서 판매할 수 있습니다.', go: ['work',  'alch'] },
    { c: '아카데미 생활', t: '수업과 과목', b: '수업은 한 번에 하나만 들을 수 있으며, 수업을 들으면 과목 경험치와 지식을 얻습니다. 과목 레벨이 오르면 능력치가 오르고, 특정 레벨에서 새 주문을 배웁니다. 수업 효율은 30분 · 1시간 100%, 2시간 97%, 3시간 94%입니다.', go: ['lecture'] },
    { c: '아카데미 생활', t: '반딧불 정령 병', b: '40분마다 한 마리씩 병에 모이며, 4마리가 되면 가득 찹니다(2시간 40분). 접속했을 때 「풀어 주기」를 누르면 마나 · ' + CUR + ' · 별조각 · 마석 중 하나씩을 남깁니다. 반딧불 병은 광장 풍경 좌측에 있습니다.', go: ['home',  'care'] },
    { c: '아카데미 생활', t: '연구와 사역마 파견 (장시간 방치)', b: '연구는 한 번에 하나만 진행되며 단계마다 몇 시간에서 이틀까지 걸리고, 사역마 파견은 2~12시간 걸립니다. 잠들기 전에 시작해 두세요. 「숙면의 차」를 마시면 파견 보상과 마나 재생이 늘어납니다.', go: ['lib'] },
    { c: '아카데미 생활', t: '물약과 부화', b: '공방에서 재료와 마나가 있으면 물약이 즉시 완성됩니다. 알 부화도 마나를 불어넣으면 그 자리에서 깨어납니다. 물약 효과는 마신 뒤 현실 시간으로 흐르며, 진행 중인 작업과 겹친 시간만큼 적용됩니다.', go: ['work',  'alch'] },
    { c: '아카데미 생활', t: '일일 목표와 출석', b: '매일 자정(한국 시간)에 일일 목표 세 개가 새로 나옵니다. 목표마다 보상(별조각 · ' + CUR + ')이 표시되며, 「이동」을 누르면 해당 화면으로 갑니다. 마음에 들지 않는 목표는 「바꾸기」로 교체할 수 있습니다(하루 1회 무료, 이후 별조각 5 · 10 · 20…). 출석은 연속일수록 보상이 커집니다.', go: ['home'] },
    { c: '아카데미 생활', t: '기말시험', b: '이론 30점(시험 과목 평균 레벨) + 실기 40점(시험 과목 레벨) + 대련 30점(시험관과의 전투) 합계 60점 이상이면 진급합니다. 문제를 풀 필요는 없으며, 시험 과목이 모두 기준 레벨에 도달하면 응시 버튼으로 바로 채점합니다. 기준보다 레벨이 높을수록 점수가 오릅니다.', go: ['exam'] },
    { c: '아카데미 생활', t: '시험 등급 (S · A · B · C)', b: '95점 이상 S, 85점 A, 75점 B, 60점 C입니다. 합격하면 즉시 다음 학년이 되어 같은 시험은 다시 볼 수 없으므로, 시험장의 「예상 성적」을 확인한 뒤 응시할지 과목 레벨을 더 올릴지 정합니다. S는 별조각 · ' + CUR + ' 2배와 영웅 이상 장비 · 환수의 알, A는 1.5배와 희귀 이상 장비를 받습니다. S를 받으려면 대련에서 이겨야 합니다. 성적은 칭호 「우등생」(A 이상 3회) · 「수석」(S 3회) · 「전 학년 수석」(S 7회)으로 남습니다.', go: ['exam'] },
    { c: '아카데미 생활', t: '수업 예약 · 제때 입실', b: '수업 중에 「다음 교시」를 하나 예약할 수 있습니다. 종이 울리면 예약한 수업이 자동으로 시작되며(꿈길 중이면 깨어난 뒤), 예약은 한 칸뿐이므로 그다음 교시는 다시 예약해야 합니다. 수업이 끝나고 15분 안에 직접 다음 수업을 들으면 「제때 입실」로 과목 경험치 +10%를 받습니다. 예약으로 자동 시작된 교시에는 적용되지 않습니다.', go: ['lecture'] },
    { c: '아카데미 생활', t: '시간표 프리셋', b: '강의실 상단 「시간표」에 과목과 수업 길이를 세 벌까지 저장할 수 있습니다. 누르면 수업 슬롯이 비어 있을 때는 바로 수업을 시작하고, 수업 중일 때는 다음 교시로 예약합니다.', go: ['lecture'] },
    { c: '전투', t: '레벨로 여는 원정 단계', b: '원정 단계는 학년 상한(학년×10+9)까지 열리며, 레벨이 그보다 높으면 레벨만큼 더 출정할 수 있습니다(학년 상한 +10단계까지). 해당 구역의 보스도 레벨이 닿으면 도전할 수 있습니다. 시간당 효율은 대체로 조금 낮은 단계가 좋고, 높은 단계는 장비 레벨과 다음 구역 재료가 좋습니다.', go: ['explore'] },
    { c: '전투', t: '쓰러짐과 귀환', b: '「무모함」 단계로 출정하면 도중에 쓰러져 돌아올 수 있으며, 이때는 그때까지 모은 것의 80%를 받습니다. 원정 중 「귀환」을 누르면 그때까지 모은 것을 모두 받고 즉시 돌아옵니다(수업 · 연구 취소는 절반).', go: ['explore'] },
    { c: '자원', t: '분해 · 마석가루 · 재련', b: '쓰지 않는 장비는 판매(' + CUR + ') 대신 분해해 마석과 마석가루를 얻을 수 있습니다. 등급 · 레벨이 높을수록 많이 나옵니다. 마석가루로 장비를 재련하면 등급 · 레벨 · 강화는 유지한 채 옵션만 새로 정해집니다. 분류 마법을 연구하면 자동 처리를 판매 대신 분해로 바꿀 수 있습니다.', go: ['gear'] },
    { c: '아카데미 생활', t: '아카데미 휘장', b: '로브 가슴에 다는 브로치입니다. 2학년 기말시험을 통과해 3학년이 되면 아카데미에서 하나를 수여하며, 매점 「휘장 원석」 · 보스 전리품 · 거래소에서도 얻을 수 있습니다. 보석마다 대표 효과가 다릅니다(홍옥 공격력, 청옥 주문 위력, 석류석 물리 피해, 녹옥 생명력, 자수정 수업 속도, 황옥 ' + CUR + ', 월장석 경험치, 남옥 마나, 흑요석 치명타 피해, 단백석 전리품). 달고 있는 휘장 하나만 효과가 있으며, 원정 · 수업 · 전투에서 별빛을 모아 Lv 20까지 성장합니다. 5 · 10 · 15 · 20레벨에 세공(옵션)이 한 줄씩 붙습니다. 강화 방법: 마석가루와 ' + CUR + '로 「닦기」(별빛 · 레벨), 별조각으로 「광내기」(보석 품질 · 대표 효과, 최대 125%), 별조각으로 「세공 다시 새기기」(옵션 한 줄 재설정). 거래소에서 사고팔 수 있고, 필요 없는 휘장은 깨뜨려 마석가루로 돌려받습니다. 「잠금」을 걸면 달기 · 떼기만 가능하고 닦기 · 광내기 · 세공 · 깨뜨리기 · 거래소가 막힙니다. 원정 · 수업으로 모이는 별빛은 잠금과 관계없이 쌓입니다.', go: ['gear',  'badge'] },
    { c: '처음', t: '학기 이야기', b: '광장 상단 카드에 현재 진행할 이야기 단계가 표시됩니다. 학년마다 한 장(章)씩 진행되며, 단계마다 목표가 있어 달성하면 「보상 받기」로 다음 장면이 열립니다. 무엇을 할지 모르겠다면 「하러 가기」를 누르세요. 각 장의 마지막 단계는 해당 학년의 기말시험입니다.', go: ['home'] },
    { c: '아카데미 생활', t: '진급 안내', b: '기말시험에 합격하면 해당 학년에 새로 열린 과목 · 화면 · 연구 · 매점 품목을 모아 보여 주며, 「바로 가기」로 각 화면에 갈 수 있습니다. 창을 닫은 뒤에도 우측 상단 「알림」(종 모양)이나 시험장 「성적표」의 「안내」에서 다시 볼 수 있습니다.', go: ['exam'] },
    { c: '아카데미 생활', t: '중도 취소', b: '진행 중인 작업을 취소하면 지난 시간만큼의 보상 중 절반만 받습니다. 다시 접속할 시간에 맞춰 작업 길이를 고르세요.' },
    { c: '전투', t: '원정과 보스', b: '원정은 한 번에 하나만 진행할 수 있으며, 고른 단계에서 정해진 시간 동안 몬스터를 사냥합니다. 원정 화면의 「원정 일지」에 진행 상황이 수십 초마다 한 줄씩 기록됩니다. 10단계마다 있는 보스를 쓰러뜨려야 다음 구역이 열리며, 학년이 오를수록 더 높은 보스에 도전할 수 있습니다. 결과는 출정 시점의 능력치로 정해집니다.', go: ['explore',  'boss'] },
    { c: '전투', t: '함께 원정', b: '「원정·전투 → 원정」의 「함께 원정」에서 방을 열거나 열린 방에 들어가 최대 4명이 함께 출정합니다. 방장이 「지금 출발」을 누르면 출정하며(혼자여도 가능), 4명이 모이면 15초 뒤 자동으로 출정합니다. 인원이 모이지 않으면 방장이 아카데미 친구(방장 능력의 60%)를 동행시킬 수 있습니다. 처치한 몬스터는 함께 나누되 한 명 늘 때마다 각자 몫이 +5% 늘고, 전리품은 각자 따로 나옵니다. 각자 자신의 원정 슬롯을 씁니다. 파티에 소속되어 있으면 「파티로 열기 · 파티로 참가」로 출정 가능한 파티원을 함께 데려가고, 「혼자 참가」는 파티를 유지한 채 본인만 참가합니다. 파티 단위 참가는 파티장만 가능하며, 파티장이 파티 화면에서 「파티원도 파티 단위로 원정 참가」를 켜면 파티원도 가능합니다. 방에 있는 동안에는 방 카드가 원정 화면 상단에 표시되고, 원정 슬롯이 「함께 원정 출발 대기」로 잡히므로 혼자 출정할 수 없습니다. 혼자 출정하려면 먼저 방에서 나오세요. 방에 들어가 있는 동안에는 채팅에 「원정」 탭이 생겨 같은 방 사람끼리 대화할 수 있으며, 방에서 나오거나 출정하면 탭이 사라집니다. 방 카드의 「빈자리 채우기」에서 파티원 함께 참가 · 친구 · 동아리원 초대 · 아카데미 친구 동행을 바로 고를 수 있습니다. 출정한 뒤에는 원정 슬롯에 일행의 포지션 · HP 막대 · 지금까지 넣은 피해와 피해 몫(%)이 표시되어, 선봉이 얼마나 버티고 있는지 볼 수 있습니다.', go: ['explore'] },
    { c: '전투', t: '포지션: 선봉 · 후열 · 지원', b: '선봉: 누구나 고를 수 있습니다. 몬스터가 80% 확률로 선봉을 노립니다(기사 +5%p, 수호 결계 장착 시 +5%p). 방어 +25%. 후열: 공격 주문을 장착해야 고를 수 있습니다(마력 화살 · 화염구 · 연쇄 번개 · 얼음 감옥 · 환수 소환 · 별똥별 · 비전 폭발 · 방패 강타 중 하나). 공격 +10%, 받는 피해 +10%. 지원: 보호막 · 치유 주문을 장착해야 고를 수 있습니다(수호 결계 · 재생의 노래 · 수호의 함성 중 하나). 파티 전체가 받는 피해 −15%, 본인 공격 −15%. 주문은 「원정·전투 → 원정」 하단의 「장착 주문」 칸에 넣어야 하며, 칸 수는 학년에 따라 늘어납니다. 출발할 때 조건이 맞지 않으면 선봉으로 출정합니다. 마법사는 처음부터 마력 화살을 장착하고 있어 후열을 고를 수 있고, 기사는 방패 강타를 배우면 후열, 수호의 함성을 배우면 지원을 고를 수 있습니다.', go: ['explore'] },
    { c: '전투', t: '모집 알림 · 초대', b: '채팅 「모집」 탭에는 세 가지 모집 카드가 올라옵니다(모두 한 줄 메모 추가 가능). 함께 원정: 방에서 「모집 알림」을 누릅니다(방마다 1분에 한 번). 다른 학생은 「살펴보기」로 방 인원의 포지션 · 학과 · 전투력을 확인한 뒤 참가합니다. 동아리 홍보: 동아리 화면의 「모집 홍보」에서 보냅니다(초대 권한이 있는 부원, 동아리마다 10분에 한 번). 카드의 「살펴보기」로 회장 · 소개 · 부원을 보고 가입합니다. 파티원 모집: 파티장이 파티 화면의 「파티원 모집」에서 보냅니다(5분에 한 번). 별의 탑 진행 층이 함께 표시되며, 알림을 본 학생은 30분 동안 초대 없이 「파티 들어가기」로 바로 들어올 수 있습니다. 함께 원정 방에서는 「친구 · 동아리원 초대」로 한 명씩 골라 초대할 수도 있습니다(이름 검색).', go: ['explore'] },
    { c: '전투', t: '학과: 기사 · 마법사', b: '입학할 때 고르는 전투 방식입니다. 기사는 단단하고 몬스터를 잘 끌어 선봉에, 마법사는 주문이 강해 후열 · 지원에 적합합니다. 기사의 평타와 방패 강타는 물리 피해로 체력을, 마법사의 평타(마력 화살)와 모든 주문은 주문 피해로 지력을 따릅니다. 기사도 수업으로 배운 주문을 장착하면 검과 주문을 함께 쓰는 마검사가 됩니다(해당 주문은 지력을 따릅니다). 학과마다 전용 수업(기사: 검술·방패술, 마법사: 비전학)과 전용 주문(기사: 방패 강타 · 수호의 함성, 마법사: 비전 폭발 · 마나 폭주)이 있으며, 본인 학과의 것만 표시됩니다. 학과를 바꾸려면 내 정보 › 편집의 「전과시험」에서 옮길 학과로 시험관과 대련해 이겨야 합니다(응시료 필요, 패배 시 하루 뒤 재응시). 학과를 고른 적 없는 기존 학생은 시험 없이 한 번 고를 수 있습니다.' },
    { c: '전투', t: '능력치 다섯 가지', b: '지력: 주문 공격력 +1%, 수업 속도 소폭 증가. 체력: 물리 공격력 +1%, 생명력 +1.2%, 방어력 +0.6%. 민첩: 공격 속도 +1%. 의지: 마나 재생 +4%, 생명력 소폭 증가. 행운: 치명타 확률 · 전리품 · 높은 등급 장비 확률. 피해는 물리와 주문 두 가지이며, 기사의 평타와 방패 강타는 물리 공격력, 마법사의 평타와 모든 주문은 주문 공격력(× 주문 위력)이 적용됩니다. 장비 · 연구 · 물약의 「공격력 +%」는 양쪽 모두에, 장비 옵션 · 휘장의 「물리 피해」(석류석)는 물리 쪽에만, 「주문 위력」(청옥)은 주문 쪽에만 적용됩니다. 과목 레벨이 오를 때마다 해당 과목의 능력치가 오르며, 레벨업 포인트는 직접 분배합니다. 「레벨업 시 자동 분배」를 켜면 선택한 프리셋(균형 · 공격 · 생존 · 학구, 학과별 비율)대로 자동 분배됩니다(기본값은 꺼짐).', go: ['gear'] },
    { c: '전투', t: '장비와 강화', b: '원정에서 장비가 나옵니다. 초록 ▲ 표시는 현재보다 전투력이 오르는 장비입니다. 강화에는 ' + CUR + '와 마석이 들며, 실패해도 장비는 사라지지 않습니다. 쓰지 않는 장비는 판매 · 분해하거나 거래소에 올리세요. 무기는 지팡이와 검이 있으며 능력치는 같습니다. 아끼는 장비는 「잠금」을 걸면 장착 · 해제만 가능하고 강화 · 재련 · 분해 · 판매 · 거래소 · 동아리 창고 보관이 모두 막힙니다(거래소 판매 목록에도 표시되지 않음).', go: ['gear'] },
    { c: '전투', t: '월드 보스', b: '매주 월요일에 새 월드 보스가 나타나며, 서버의 모든 학생이 함께 체력을 깎습니다. 도전권은 8시간마다 하나씩 충전되며 최대 3장입니다. 다음 주에 참여 · 토벌 · 피해 순위 보상이 지급됩니다.', go: ['world',  'wb'] },
    { c: '전투', t: '결투제', b: '시험장에서 아카데미의 라이벌들과 차례로 겨룹니다. 이기면 별조각과 ' + CUR + '를 받고, 지면 1시간 뒤 다시 도전할 수 있습니다.', go: ['exam'] },
    { c: '교류', t: '채팅 (공지 · 모집 · RP · 월드 · 파티 · 원정 · 동아리 · 기숙사 · 학과 · 1:1)', b: '채팅창은 모든 화면에 표시되며, 열지 않은 탭의 글도 실시간으로 받습니다. 새 글이 오면 탭에 숫자가 표시되고, 탭을 열면 「여기부터 새 글」 위치부터 보여 줍니다. 공지 탭은 운영진 공지와 월드 보스 소식, 모집 탭은 함께 원정 · 동아리 · 파티 모집 카드가 올라오는 곳으로 직접 쓸 수 없습니다. 함께 원정 방에 들어가 있는 동안에는 같은 방 사람끼리 대화하는 「원정」 탭이 생깁니다. 탭이 많아 넘칠 때는 탭 줄 끝이 흐려지며, 옆으로 밀거나(마우스는 휠 · 좌우 화살표) 넘겨 볼 수 있습니다. 파티 · 동아리 · 기숙사 · 학과 탭은 같은 소속끼리 대화하며, 동아리 · 기숙사 · 학과 탭에는 RP와 사담(오너) 채널이 따로 있습니다. 1:1 탭은 친구와 대화합니다. 입력 후 우측 보내기 버튼(또는 Enter)으로 전송합니다. RP에서는 대사 중간에 *별표 사이*로 행동을 넣을 수 있고, /me 로 시작하면 전체가 행동으로 표시됩니다. 이름을 누르면 해당 학생의 정보창이 열립니다. 필요 없는 탭은 설정 › 채팅 탭에서 숨길 수 있습니다(최소 하나는 유지).' },
    { c: '교류', t: '내 정보와 두상', b: '상단의 내 이름을 누르면 다른 학생에게 보이는 내 정보가 먼저 표시되며, 「편집」 탭에서 두상 · 한 줄 소개 · 자기소개 · 공개 범위를 설정합니다. 두상은 고른 그림의 가운데를 100×100으로 줄여 올립니다. 자기소개는 친구에게만 공개할 수도 있습니다.' },
    { c: '교류', t: '칭호', b: '조건을 채우면 칭호가 열립니다. 기록 → 칭호 도감의 「달기」나 내 정보 → 편집에서 골라 이름 앞에 붙일 수 있습니다. 채팅에서 칭호를 보고 싶지 않으면 설정에서 내 칭호 · 다른 학생 칭호를 각각 숨길 수 있습니다(정보창에는 그대로 표시).' },
    { c: '교류', t: '친구', b: '교류 → 친구 탭(또는 내 정보 → 친구)에서 이름으로 신청하거나, 채팅에서 이름을 눌러 신청합니다. 상대가 수락하면 접속 중인 친구가 상단에 표시되며, 1:1 대화와 파티 초대를 바로 할 수 있습니다.' },
    { c: '교류', t: '파티', b: '최대 4명입니다. 파티원 한 명당 원정 ' + CUR + ' · 경험치가 3%씩(최대 9%) 오르며, 파티 전용 채팅을 쓸 수 있습니다. 「교류·상점 → 파티」에서 만들고, 이름으로 초대하거나 정보창의 「파티 초대」로 초대합니다. 빈자리에는 결투제 대진표의 아카데미 친구(NPC)를 부를 수 있습니다(보너스 제외). 파티장은 파티원을 내보내거나 파티장을 넘길 수 있고, 「파티원 모집」으로 채팅 「모집」 탭에 모집 카드를 올릴 수 있습니다(알림을 본 학생은 30분 동안 초대 없이 들어올 수 있음).', go: ['party'] },
    { c: '교류', t: '별의 탑 (파티)', b: '파티가 한 주 동안 함께 오르는 탑입니다. 도전은 학생마다 하루 3회이며, 도전한 학생의 전투에 파티원 모두의 능력(미접속 포함)이 합산됩니다. NPC 파티원은 내 능력의 30%씩 보탭니다. 층을 처음 넘을 때마다 당시 파티원 모두에게 보상 우편이 발송됩니다(5층마다 장비 상자, 10층마다 환수의 알). 1층 난이도는 그 주 첫 도전 시 파티원들의 진도에 맞춰 정해지며, 매주 월요일에 0층부터 다시 시작합니다.', go: ['party',  'tower'] },
    { c: '교류', t: '별의 탑 일지 · 파티가 없어지면', b: '누군가 도전하면 파티 화면 상단 「별의 탑 일지」에 전투가 원정 일지처럼 한 줄씩 기록됩니다(최대 30초). 파티원 모두가 같은 시각에 같은 장면을 보며, 결과와 보상 우편은 일지가 끝난 뒤 알려 줍니다. 일지가 진행되는 동안에는 다른 파티원이 도전할 수 없습니다. 파티장이 나가면 다음 파티원이 파티장이 되며 탑 기록은 유지됩니다. 마지막 한 명까지 나가 파티가 해산되면 그 주의 탑 기록도 사라집니다. 이미 받은 보상은 유지되며, 새 파티에서 다시 오를 때 이번 주에 보상받은 층까지는 보상 없이 지나갑니다.', go: ['party',  'twlog'] },
    { c: '아카데미 생활', t: '하늘 이벤트', b: '하루 세 번 유성 소나기 · 별샘 오로라 · 꼬리별 · 구름 위의 별고래 중 하나가 30~60분 동안 나타납니다. 모든 학생이 같은 하늘을 봅니다. 진행 중인 작업에는 겹친 시간만큼 효과가 적용되며, 「올려다보기」를 누르면 작은 선물을 받습니다. 지금 하늘과 다음 일정은 광장 풍경 상단에 표시됩니다.', go: ['home',  'events'] },
    { c: '아카데미 생활', t: '별샘 의식', b: '하루 한 번 마나를 조금 봉헌해 모두 함께 목표를 채웁니다. 목표를 채우면 봉헌한 모두에게 4시간 동안 경험치 · 지식 +15%, ' + CUR + ' +10% 축복이 적용됩니다. 목표를 채운 뒤에 봉헌해도 축복을 받습니다.', go: ['home',  'events'] },
    { c: '교류', t: '떠돌이 상인 경매', b: '매일 낮 12시와 밤 8시에 떠돌이 상인이 찾아와 2시간 동안 귀한 장비 세 점을 경매에 붙입니다. 입찰한 ' + CUR + '는 맡겨 두며, 더 높은 입찰이 나오면 즉시 돌려받습니다. 종료 2분 이내에 입찰하면 2분 연장됩니다. 낙찰품은 우편으로 받습니다.', go: ['auction'] },
    { c: '아카데미 생활', t: '함께 듣는 수업', b: '강의실에서 같은 과목을 수강 중인 학생 수를 볼 수 있습니다. 같은 과목을 듣는 다른 학생 1명당 과목 경험치 +1%(최대 +5%)이며, 수업을 시작할 때 정해집니다. 그날 같은 과목을 들은 학생이 많으면 교수가 공지에 한마디를 남깁니다.', go: ['lecture'] },
    { c: '교류', t: '우편함', b: '화면 우측 상단의 편지 모양 버튼입니다. 운영진 선물(오픈 보상, 점검 보상 등), 별의 탑 보상, 경매 낙찰품을 받습니다. 친구 신청 · 거래소 판매 같은 소식은 우편이 아닌 알림(종 모양)으로 옵니다. 우편을 열어 봐도 보상은 기한 안에 언제든 받을 수 있으며, 새 우편이 오면 버튼에 숫자가 표시됩니다. 남은 기한은 우편마다 표시됩니다.' },
    { c: '계정·서버', t: '테마', b: '설정 → 화면 → 테마. 기본값 「기기 설정 따라」는 기기가 어두운 화면이면 밤하늘, 밝은 화면이면 한낮의 서고를 적용합니다. 밤하늘 · 한낮의 서고 · 노을 천문대(붉은 보랏빛 밤) · 새벽 안개(차가운 푸른 회색) 중 하나를 고르면 이 기기에 저장되어 계속 유지됩니다.' },
    { c: '교류', t: '알림', b: '화면 우측 상단의 종 모양 버튼입니다. 거래소 판매, 친구 신청 · 수락, 파티 · 동아리 초대, 함께 원정 초대 · 파티 참가, 게시판 댓글 · 답글이 오면 숫자가 표시됩니다. 알림을 누르면 해당 화면으로 바로 이동합니다. 보상이 있는 소식은 알림이 아닌 우편으로 옵니다.' },
    { c: '교류', t: '거래소', b: '2학년부터 이용할 수 있습니다. 장비 · 재료 · 연금술 물약 · 아카데미 휘장을 ' + CUR + '로 사고팝니다(착용 중인 휘장은 등록 불가). 「사기」 목록은 한 줄씩 표시되며, 장비 이름을 누르면 능력치가 펼쳐집니다. 「팔기」에서는 물건마다 최근 30일 시세(평균가와 최근 판매 5건)를 보여 주며 「평균가」로 가격을 바로 입력할 수 있습니다. 「실시간 거래」에는 방금 팔린 물건이 표시됩니다(구매자 비공개). 가방에서 장비를 누르고 「거래소에서 팔기」로 바로 이동할 수도 있습니다. 판매되면 수수료 5%를 뺀 ' + CUR + '가 들어오며, 3일 안에 팔리지 않으면 돌려받습니다. 한 번에 10개까지 등록할 수 있습니다. 「사기」에서는 장비 종류(지팡이 · 검 · 로브 · 모자 · 장신구 · 마도서)와 등급으로 골라 볼 수 있습니다.', go: ['market'] },
    { c: '교류', t: '동아리 찾기 · 가입 · 만들기', b: '「교류·상점 → 동아리」의 「찾기 · 만들기」에서 동아리를 찾습니다. 「들어가기」나 「가입 신청」을 누르면 먼저 동아리 정보(회장 · 소개 · 부원 · 가입 방식)가 열리고, 그 창에서 가입합니다. 「신청 후 승인」 동아리는 한마디를 덧붙여 신청하며, 초대 권한이 있는 부원이 승인하면 들어갑니다. 동아리를 만들 때 쓰던 이름 · 소개는 다른 화면이나 채팅 탭으로 옮겨 다녀도 남아 있습니다.', go: ['guild'] },
    { c: '교류', t: '동아리 레벨과 기여도', b: '부원이 하루 한 번 동아리 출석(+10)을 하고 ' + CUR + '를 기부하면(하루 200점까지, 1점은 일일 목표 ' + CUR + ' 보상의 1/20) 기여도가 쌓이고, 그만큼 동아리 경험치가 올라 레벨이 오릅니다(최대 10). 레벨마다 정원 +2명, 창고 +5칸, 부원 전원 ' + CUR + ' · 경험치 +0.5%.', go: ['guild'] },
    { c: '교류', t: '동아리 부실 창고', b: '동아리 화면의 「부실 창고」에 ' + CUR + '와 장비를 보관할 수 있습니다. 보관은 누구나, 꺼내기는 「창고에서 꺼내기」 권한이 있는 부원만 가능하며, 모든 출입은 「기록」에 남습니다. 동아리를 해산하면 남은 물품은 회장에게 우편으로 돌아갑니다.', go: ['guild'] },
    { c: '교류', t: '동아리 계급과 권한', b: '회장 아래에 부회장(최대 2명)과, 회장이 이름과 권한을 정하는 부원 계급(기본 「부원」 외 3개까지)이 있습니다. 권한: 초대 · 가입 승인, 부원 내보내기, 공지 · 소개 수정, 창고에서 꺼내기. 부원이 있으면 회장은 탈퇴하거나 동아리를 해산할 수 없으므로 먼저 회장을 넘겨야 합니다. 채팅창의 「동아리 정보」를 누르면 현재 화면에서 바로 요약을 볼 수 있습니다.', go: ['guild'] },
    { c: '교류', t: '학생 정보 카드', b: '채팅이나 목록에서 이름을 누르면 정보 카드가 열립니다. 기숙사 · 학년 · 학과(기사 · 마법사), 동아리 이름과 직책이 표시되며, 친구 추가 · 1:1 대화(친구끼리) · 파티 초대(파티가 없으면 새로 만들어 초대) · 동아리 초대(권한이 있을 때) 버튼이 있습니다.' },
    { c: '처음', t: '아카데미 공지와 아카데미 소식', b: '아카데미 광장 풍경 아래 한 줄에 가장 최근 공지나 소식(새 학생 입학, 진급)이 표시됩니다. 「더보기」로 지난 공지와 소식을 모아 볼 수 있습니다.', go: ['home'] },
    { c: '교류', t: '기숙사 대항전', b: '모든 활동이 내 기숙사 점수로 쌓입니다. 매주 기숙사별 상위 30명의 점수 합계로 순위를 정하며, 다음 주에 순위 보상이 지급됩니다.', go: ['world'] },
    { c: '교류', t: '기숙사 성장', b: '기숙사 혜택은 처음에 적힌 효과의 1/10만 받습니다. 대항전 점수가 기숙사에 쌓일수록 혜택이 커져, 기숙사 성장 100%가 되면 적힌 효과를 그대로 받습니다(그 이상 커지지는 않습니다). 기숙사 혜택은 「지금 받는 값 / 최대 값」으로 표시되며, 월드 보스 · 랭킹 화면의 「기숙사 성장」에서 모든 기숙사의 성장을 볼 수 있습니다.', go: ['world'] },
    { c: '아카데미 생활', t: '잠자리 · 꿈길 (1학년부터)', b: '광장 하단의 「잠자리 · 꿈길」에서 잠들기 전에 6~12시간짜리 꿈을 꿉니다. 꿈을 꾸는 동안에는 새로 수업을 듣거나 출정할 수 없습니다(진행 중인 것은 계속되며, 연구 · 물약 · 사역마 파견은 가능). 복습하는 꿈(고른 과목 경험치 · 지식), 별을 헤아리는 꿈(별조각 · 지식 · 가끔 환수의 알), 구름섬을 떠도는 꿈(' + CUR + ' · 재료 · 마석)이 있습니다. 10% 확률로 자각몽이 되어 1.5배를 받습니다. 도중에 깨우면 아무것도 얻지 못합니다.', go: ['home',  'dream'] },
    { c: '교류', t: '정보 카드 꾸미기', b: '내 정보 → 꾸미기에서 ' + CUR + '로 테두리 · 배경 · 인장 · 이름 잉크를 구입합니다. 항목을 눌러 미리 착용해 본 뒤 상단의 「사기」를 누르며, 구입한 것은 언제든 바꿔 달거나 뺄 수 있습니다. 모두 5만 ' + CUR + ' 이하입니다. 다른 학생이 내 이름을 누르면 꾸민 카드가 보이며, 이름 잉크는 채팅 이름에도 적용됩니다.' },
    { c: '교류', t: '게시판', b: '교류 → 게시판. 질문 · 모집 · 거래 · RP · 잡담 · 건의 말머리를 골라 글을 쓰며, 말머리별로 보거나 제목+내용 · 제목 · 작성자로 검색할 수 있습니다. 「관리자만 보기」로 쓰면 목록에 나오지 않고 본인과 운영진만 볼 수 있어 문의 · 건의 · 신고 창구로 쓰입니다. 운영진이 답하면 우편으로 알려 드리며, 「내 글」에서 이어서 볼 수 있습니다. 댓글에는 답글을 달 수 있으며(3개 이상이면 2개만 표시되고 「더보기」로 펼침), 내 글에 댓글이 달리거나 내 댓글에 답글이 달리면 알림(종 모양)으로 알려 드립니다. 글은 30초에 하나, 하루 30개까지 쓸 수 있습니다.' },
    { c: '교류', t: '다른 동아리 · 순위', b: '동아리에 소속되어 있으면 동아리 탭 › 「다른 동아리」, 아니면 「목록 · 순위」에서 모든 동아리의 소개와 순위를 봅니다. 레벨순(같으면 경험치) · 부원 전투력 합 · 부원 수 · 최신순으로 정렬하며, 이름이나 소개로 검색할 수 있습니다. 랭킹 탭에도 상위 10곳이 표시됩니다. 1분마다 갱신됩니다.' },
    { c: '전투', t: '전투 일지', b: '보스 · 결투제 · 월드 보스 · 실기 대련은 글로 된 전투 일지로 진행됩니다. 주문 · 치명타 · 반격 · 남은 체력이 몇 초마다 한 줄씩 기록되며, 「건너뛰기」를 누르면 바로 결과로 넘어갑니다. 원정 일지에는 실제로 획득한 장비가 해당 시각에 기록됩니다.' },
    { c: '계정·서버', t: '입학과 로그인', b: '초대코드로 가입한 뒤 아이디와 비밀번호로 어느 기기에서든 로그인합니다. 아이디(영문 · 숫자 · 밑줄 4~20자)는 로그인에만 쓰이며 다른 학생에게 보이지 않습니다. 게임 안에서 보이는 것은 학생 이름입니다. 이름은 2~12자이며 단어 사이 띄어쓰기를 쓸 수 있고, 같은 이름은 쓸 수 없습니다(대소문자 · 띄어쓰기만 다른 이름도 같은 이름으로 봅니다). 운영진 사칭이나 욕설이 들어간 이름은 쓸 수 없습니다.' },
    { c: '계정·서버', t: '이름 바꾸기', b: '내 정보 → 편집의 「이름 바꾸기」에서 바꿉니다. 처음 정한 이름은 언제든 한 번 바꿀 수 있으며, 이후에는 30일이 지나야 다시 바꿀 수 있습니다. 친구 · 파티 · 동아리는 그대로 유지되며, 이미 올라간 채팅에는 예전 이름이 남습니다.' },
    { c: '계정·서버', t: '새 버전과 점검', b: '새 버전이 나오면 화면 상단에 안내 띠가 표시됩니다. 새로고침하면 적용되며, 새로고침하지 않아도 현재 화면으로 계속 플레이할 수 있습니다. 꼭 필요한 업데이트일 때만 10초 뒤 자동으로 새로고침합니다(작성 중인 채팅 글은 유지). 점검이 예정되면 미리 안내 띠로 알려 드리며, 점검 중에는 안내 화면이 표시되다가 끝나면 자동으로 다시 접속합니다. 진행 중인 작업은 시간 기준으로 계산되어 점검 뒤에도 그대로 반영됩니다.' },
    { c: '계정·서버', t: '비밀번호와 개인정보', b: '비밀번호는 8자 이상이어야 하며, 너무 쉬운 비밀번호나 이름이 들어간 비밀번호는 쓸 수 없습니다. 비밀번호는 복원할 수 없는 방식으로 저장되고, 프로필 · 두상 · 채팅은 서버에 암호화되어 저장됩니다. 로그인하지 않은 방문자는 학생 정보와 랭킹을 볼 수 없습니다.' },
    { c: '계정·서버', t: '푸시 알림', b: '설정의 「푸시 알림」을 켜면 게임을 닫아 두어도 수업 · 원정 · 연구 등이 끝났을 때 기기로 알림이 옵니다(지원하는 브라우저만, 아이폰 · 아이패드는 홈 화면에 추가한 앱에서만). 비슷한 때 끝난 일은 한 번에 묶어서 보냅니다. 「방해 금지 시간」(기본 켜짐)은 밤 11시~오전 8시에 끝난 일을 아침에 한 번에 알려 줍니다. 기기마다 따로 켜고 끕니다.' },
    { c: '계정·서버', t: '앱처럼 설치하기', b: '설정의 「앱으로 쓰기」에서 홈 화면이나 바탕화면에 모네타 아카데미를 앱처럼 추가할 수 있습니다. 안드로이드 · PC 크롬/엣지는 버튼 한 번, 아이폰은 사파리 공유 버튼 › 「홈 화면에 추가」입니다. 주소창 없이 열릴 뿐 계정과 진행 상황은 웹과 같습니다.' },
    { c: '계정·서버', t: '마스터 과정', b: '졸업 시험을 통과해도 학적은 초기화되지 않습니다. 마스터 과정 연구생이 되어 끝없는 심연 · 월드 보스 · 랭킹에 도전합니다.' },
    { c: '계정·서버', t: '숫자 읽는 법', b: '큰 수는 만(10⁴) · 억(10⁸) · 조(10¹²) · 경(10¹⁶) 단위로 표기합니다.' }
  ];

  /* ───────── 아카데미 결투제 ───────── */
  D.RIVALS = [
    { name: '노아 벨', who: '등불관 1학년', stage: 6, hello: '도서관에서 연습만 했지만… 해 볼게!', lose: '역시 실전은 다르구나. 다음엔 지지 않을 거야.' },
    { name: '미라 손', who: '물시계관 2학년', stage: 11, hello: '서두르지 않아. 네가 지칠 때까지 기다리면 되니까.', lose: '…물시계도 가끔은 넘치는구나.' },
    { name: '테오 카브', who: '가시왕관관 2학년', stage: 16, hello: '가시왕관관은 물러서지 않는다!', lose: '좋아, 인정하지. 이 상처는 훈장이다.' },
    { name: '시엔', who: '거울관 3학년', stage: 21, hello: '내가 보이는 곳에 내가 있다고 생각해?', lose: '이번엔 환영으로도 못 빠져나가네. 재밌다.' },
    { name: '루카 페른', who: '등불관 3학년', stage: 27, hello: '네 주문 구문, 세 군데 틀렸어. 보여 줄게.', lose: '…두 군데였나 봐.' },
    { name: '하나 이브', who: '물시계관 4학년', stage: 33, hello: '결계가 무너지는 소리를 들어 본 적 있어?', lose: '이번엔 내 결계에 금이 갔네.' },
    { name: '다리우스 크로', who: '가시왕관관 4학년', stage: 39, hello: '작년 결투제 준우승. 올해는 우승이다.', lose: '올해도 준우승이면… 나쁘지 않을지도.' },
    { name: '엘라 미스트', who: '거울관 5학년', stage: 45, hello: '거래하자. 네가 지면 금화 한 자루.', lose: '거래는 거래지. 이건 네 몫이야.' },
    { name: '오르와 렌', who: '가시왕관관 쌍둥이', stage: 51, hello: '둘이서 하나야. 반칙 아니야!', lose: '다음엔 셋이서 올게.' },
    { name: '세레나 볼', who: '학생회장 · 등불관 6학년', stage: 57, hello: '학생회장으로서, 그리고 선배로서 상대해 줄게.', lose: '훌륭해. 학생회에 들어올 생각 없어?' },
    { name: '펠릭스 조교', who: '졸업생 · 원소역학 조교', stage: 63, hello: '이그나 교수님이 너를 잘 봐 두라고 하셨어.', lose: '보고서에 "기대 이상"이라고 쓸게.' },
    { name: '카야 린 교관', who: '체술·비행 교관', stage: 69, hello: '착지 연습은 충분히 했지?', lose: '좋아! 이제 넘어지는 법은 안 가르쳐도 되겠네.' },
    { name: '브람 하일 교수', who: '결계공학 교수', stage: 76, hello: '내 결계의 금을 찾을 수 있겠나?', lose: '찾았군. 그거면 됐네.' },
    { name: '학장의 그림자', who: '정체불명', stage: 84, hello: '……종은 누구를 위해 울리는가.', lose: '그림자는 말없이 흩어졌다.' },
    { name: '이름 없는 사서', who: '도서관의 주인', stage: 95, hello: '천 년 동안 이 자리를 지켰다. 이제 네가 증명해라.', lose: '……스승님. 드디어 다음 사람이 왔습니다.' }
  ];

  /* ───────── 업적 ───────── */
  D.ACH = [
    { id: 'lec1', name: '첫 출석', desc: '수업 1회 마치기', stat: 'lecJobs', n: 1, r: 3 },
    { id: 'lech100', name: '성실한 학생', desc: '수업 누적 100시간', stat: 'lecHours', n: 100, r: 10 },
    { id: 'lech500', name: '도서관의 유령', desc: '수업 누적 500시간', stat: 'lecHours', n: 500, r: 25 },
    { id: 'lech1500', name: '살아있는 교과서', desc: '수업 누적 1,500시간', stat: 'lecHours', n: 1500, r: 50 },
    { id: 'night10', name: '밤의 학생', desc: '8시간 이상 파견·연구 10번 마치기', stat: 'nightJobs', n: 10, r: 10 },
    { id: 'night100', name: '불 꺼진 기숙사', desc: '8시간 이상 파견·연구 100번 마치기', stat: 'nightJobs', n: 100, r: 30 },
    { id: 'kill1', name: '첫 실전', desc: '몬스터 1마리 처치', stat: 'kills', n: 1, r: 3 },
    { id: 'kill10k', name: '저장고 청소부', desc: '몬스터 100마리 처치', stat: 'kills', n: 100, r: 10 },
    { id: 'kill100k', name: '사냥꾼', desc: '몬스터 1천 마리 처치', stat: 'kills', n: 1000, r: 25 },
    { id: 'kill1m', name: '전설의 사냥꾼', desc: '몬스터 1만 마리 처치', stat: 'kills', n: 10000, r: 60 },
    { id: 'boss1', name: '첫 번째 문지기', desc: '보스 1회 처치', stat: 'bosses', n: 1, r: 5 },
    { id: 'boss5', name: '문지기 사냥꾼', desc: '보스 5종 처치', stat: 'bosses', n: 5, r: 15 },
    { id: 'st30', name: '천문대 탐험가', desc: '30단계 개방', stat: 'maxStageAll', n: 30, r: 10 },
    { id: 'st50', name: '황야를 건넌 자', desc: '50단계 개방', stat: 'maxStageAll', n: 50, r: 20 },
    { id: 'st80', name: '종을 울린 자', desc: '80단계 개방', stat: 'maxStageAll', n: 80, r: 40 },
    { id: 'st100', name: '심연의 방랑자', desc: '100단계 개방', stat: 'maxStageAll', n: 100, r: 60 },
    { id: 'gr2', name: '2학년 진급', desc: '1학년 기말시험 통과', stat: 'maxGrade', n: 2, r: 5 },
    { id: 'gr4', name: '상급생', desc: '4학년 진급', stat: 'maxGrade', n: 4, r: 15 },
    { id: 'gr7', name: '졸업반', desc: '7학년 진급', stat: 'maxGrade', n: 7, r: 30 },
    { id: 'gr8', name: '종을 울리다', desc: '졸업 시험 통과, 마스터 과정 진입', stat: 'maxGrade', n: 8, r: 60 },
    { id: 'grS', name: '수석의 자질', desc: '시험에서 S등급 받기', stat: 'sGrades', n: 1, r: 15 },
    { id: 'grA3', name: '우등생의 길', desc: '기말시험에서 A 이상 세 번 받기', stat: 'aGrades', n: 3, r: 15 },
    { id: 'grS7', name: '완벽한 성적표', desc: '일곱 기말시험 모두 S 받기', stat: 'sGrades', n: 7, r: 60 },
    { id: 'quiz50', name: '척척박사', desc: '수업 150번 마치기', stat: 'lecJobs', n: 150, r: 10 },
    { id: 'quiz300', name: '걸어다니는 도서관', desc: '수업 1,000번 마치기', stat: 'lecJobs', n: 1000, r: 30 },
    { id: 'epic', name: '영웅의 무구', desc: '영웅 등급 장비 획득', stat: 'epicFound', n: 1, r: 8 },
    { id: 'legend', name: '전설과의 조우', desc: '전설 등급 장비 획득', stat: 'legendFound', n: 1, r: 20 },
    { id: 'enh5', name: '대장장이 견습', desc: '장비를 +5까지 강화', stat: 'maxEnh', n: 5, r: 5 },
    { id: 'enh10', name: '룬 대장장이', desc: '장비를 +10까지 강화', stat: 'maxEnh', n: 10, r: 15 },
    { id: 'enh15', name: '전설의 장인', desc: '장비를 +15까지 강화', stat: 'maxEnh', n: 15, r: 40 },
    { id: 'enh20', name: '신화의 대장장이', desc: '장비를 +20까지 강화', stat: 'maxEnh', n: 20, r: 80 },
    { id: 'brew10', name: '실습실 단골', desc: '물약 10개 양조', stat: 'brews', n: 10, r: 5 },
    { id: 'brew200', name: '연금술사', desc: '물약 200개 양조', stat: 'brews', n: 200, r: 25 },
    { id: 'fam3', name: '작은 동물원', desc: '사역마 3종 보유', stat: 'famKinds', n: 3, r: 8 },
    { id: 'fam8', name: '환수 사육사', desc: '사역마 8종 보유', stat: 'famKinds', n: 8, r: 25 },
    { id: 'fam12', name: '모든 생명의 친구', desc: '사역마 12종 모두 보유', stat: 'famKinds', n: 12, r: 60 },
    { id: 'disp20', name: '심부름의 달인', desc: '사역마 파견 20번', stat: 'dispatches', n: 20, r: 10 },
    { id: 'spirit20', name: '정령 채집가', desc: '반딧불 정령 20마리 풀어 주기', stat: 'spirits', n: 20, r: 8 },
    { id: 'spirit200', name: '빛을 쫓는 자', desc: '반딧불 정령 200마리 풀어 주기', stat: 'spirits', n: 200, r: 30 },
    { id: 'lv25', name: '중견 마법사', desc: '레벨 25 달성', stat: 'maxLevel', n: 25, r: 8 },
    { id: 'lv60', name: '대마법사의 길', desc: '레벨 60 달성', stat: 'maxLevel', n: 60, r: 20 },
    { id: 'lv100', name: '살아있는 전설', desc: '레벨 100 달성', stat: 'maxLevel', n: 100, r: 50 },
    { id: 'res50', name: '서고의 단골', desc: '연구 50단계 완료', stat: 'researchDone', n: 50, r: 15 },
    { id: 'res200', name: '서고의 주인', desc: '연구 200단계 완료', stat: 'researchDone', n: 200, r: 40 },
    { id: 'wb1', name: '공동 토벌', desc: '월드 보스에 처음 도전', stat: 'wbAttacks', n: 1, r: 5 },
    { id: 'wb50', name: '토벌대의 기둥', desc: '월드 보스 50번 공격', stat: 'wbAttacks', n: 50, r: 20 },
    { id: 'wbk1', name: '함께 쓰러뜨린 거인', desc: '쓰러진 월드 보스 토벌에 참여', stat: 'wbKills', n: 1, r: 15 },
    { id: 'cup1', name: '기숙사의 자랑', desc: '기숙사 대항전 우승 기숙사에서 보상 받기', stat: 'cupWins', n: 1, r: 15 },
    { id: 'daily7', name: '개근상', desc: '출석 7일 연속', stat: 'streak', n: 7, r: 15 },
    { id: 'daily30', name: '한 달 개근', desc: '출석 30일 연속', stat: 'streak', n: 30, r: 50 },
    { id: 'duel5', name: '결투제 본선', desc: '결투제 상대 5명 이기기', stat: 'duelBest', n: 5, r: 10 },
    { id: 'duel10', name: '결투제 4강', desc: '결투제 상대 10명 이기기', stat: 'duelBest', n: 10, r: 25 },
    { id: 'duel15', name: '결투제 우승', desc: '이름 없는 사서를 이기기', stat: 'duelBest', n: 15, r: 60 },
    { id: 'task8', name: '교수님의 신뢰', desc: '교수님의 과제 8개 완료', stat: 'tasksDone', n: 8, r: 10 },
    { id: 'task24', name: '모든 교수의 제자', desc: '교수님의 과제 24개 모두 완료', stat: 'tasksDone', n: 24, r: 50 }
  ];

  /* ───────── 일일 의뢰 ───────── */
  D.DAILY = [
    { type: 'lecJobs', name: '수업 마치기', base: 3 },
    { type: 'expJobs', name: '원정 마치기', base: 3 },
    { type: 'bossTries', name: '보스 또는 결투 도전', base: 2 },
    { type: 'brews', name: '물약 양조', base: 2, grade: 2 },
    { type: 'spirits', name: '반딧불 정령 풀어 주기', base: 2 },
    { type: 'enh', name: '장비 강화 시도', base: 5 },
    { type: 'wbAttacks', name: '월드 보스 공격', base: 2 },
    { type: 'dispatches', name: '사역마 파견', base: 1, grade: 3 }
  ];

  /* ───────── 아카데미 휘장: 로브 가슴에 다는 성장형 브로치 ─────────
     보석마다 대표 효과가 달라 느낌이 다르다. 달고 다니면 별빛을 모아 Lv 1→20으로 자라고, 5·10·15·20레벨에 세공(옵션)이 한 줄씩 붙는다. */
  D.BADGE_GEMS = [
    { id: 'ruby', name: '홍옥', feel: '투지', bonus: 'atkPct', base: 0.03, color: '#e0525a', desc: '싸울수록 붉은빛이 짙어지는 돌. 결투제 우승자들이 즐겨 단다.' },
    { id: 'sapphire', name: '청옥', feel: '주문', bonus: 'spellPct', base: 0.045, color: '#4f7fe0', desc: '주문을 외면 안쪽에서 물결이 인다. 마법학 교수실 창문과 같은 빛.' },
    { id: 'garnet', name: '석류석', feel: '무예', bonus: 'physPct', base: 0.045, color: '#c8643a', desc: '훈련장 모래 속에서 캐낸 돌. 검을 쥔 손에 단단한 열이 돈다.' },
    { id: 'emerald', name: '녹옥', feel: '수호', bonus: 'hpPct', base: 0.035, color: '#3fb27a', desc: '숲의 정령이 깃들었다는 돌. 다친 곳에 대면 따뜻하다.' },
    { id: 'amethyst', name: '자수정', feel: '학구', bonus: 'lectureSpd', base: 0.03, color: '#9b6be0', desc: '밤새 책을 읽어도 졸리지 않게 해 준다는 수험생의 부적.' },
    { id: 'topaz', name: '황옥', feel: '재물', bonus: 'goldPct', base: 0.045, color: '#e8b23a', desc: '부엉이 상단 상인들이 대대로 단 돌. 동전 소리를 좋아한다.' },
    { id: 'moonstone', name: '월장석', feel: '성장', bonus: 'xpPct', base: 0.04, color: '#b9c6e6', desc: '보름달 아래서만 투명해지는 돌. 단 사람이 자라는 것을 지켜본다.' },
    { id: 'aquamarine', name: '남옥', feel: '마나', bonus: 'manaPct', base: 0.06, color: '#4fbfcc', desc: '별샘 바닥에서 건져 올린 돌. 숨을 쉴 때마다 마나가 맺힌다.' },
    { id: 'obsidian', name: '흑요석', feel: '일격', bonus: 'critD', base: 0.08, color: '#7a68a0', desc: '빛을 삼키는 검은 돌. 단 사람의 일격이 무거워진다.' },
    { id: 'opal', name: '단백석', feel: '행운', bonus: 'dropPct', base: 0.04, color: '#ee9cc2', desc: '보는 각도마다 색이 바뀌는 돌. 원정에서 뜻밖의 것을 줍게 한다.' }
  ];
  D.BADGE_FACET_LV = [5, 10, 15, 20];   // 이 레벨에 세공 한 줄씩 더

  /* ───────── 상점 ───────── */
  D.SHOP = [
    { id: 'stone10', name: '마석 꾸러미', desc: '마석 10개', cur: 'gold', price: 'stone', give: { stone: 10 } },
    { id: 'gearbox', name: '부엉이 보급 상자', desc: '현재 최고 단계 기준 장비 1개 (고급 이상)', cur: 'gold', price: 'gearbox' },
    { id: 'egg', name: '환수의 알', desc: '사역마 알 1개', cur: 'shard', price: 25, grade: 3 },
    { id: 'manavial', name: '압축 마나병', desc: '마나 4시간 생산분을 즉시 획득 (저장 한도 무시)', cur: 'shard', price: 12 },
    { id: 'ticket', name: '토벌 도전권', desc: '월드 보스 도전권 +1 (하루 2번까지)', cur: 'shard', price: 10 },
    { id: 'bagslot', name: '마법 가방 확장', desc: '가방 칸 +5 (영구, 졸업 후에도 유지)', cur: 'shard', price: 'bag' },
    { id: 'badgebox', name: '휘장 원석', desc: '무작위 보석이 박힌 아카데미 휘장 1개 (Lv 1)', cur: 'shard', price: 40, grade: 3 },
    { id: 'matbox', name: '연금 재료 상자', desc: '해금된 지역 재료 무작위 12개', cur: 'shard', price: 8, grade: 2 },
    { id: 'respec', name: '망각의 차', desc: '능력치 포인트 초기화', cur: 'shard', price: 5 }
  ];



  return D;
})();
if (typeof module !== 'undefined') module.exports = DATA;
