// 학년 제한 없이 전투력만으로 몇 단계까지 가는지
const R=require('../shared/rules.js'); R.stageCap=()=>1e9; R.canChallenge=()=>true;
process.argv[2]=process.argv[2]||'120'; require('./sim.js');
