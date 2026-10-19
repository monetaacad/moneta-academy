const R=require('../shared/rules.js'); const orig=R.newPlayer;
R.newPlayer=function(id,n,h,now,seed){ return orig(id,n,h,now+60*86400,seed); };
require('./sim.js');
