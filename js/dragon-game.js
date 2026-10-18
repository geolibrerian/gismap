(()=>{'use strict';
const canvas=document.querySelector('#canvas'),c=canvas.getContext('2d');let W=960;const H=480;
const wrap=document.querySelector('#game'),overlay=document.querySelector('#overlay'),title=document.querySelector('#overlayTitle'),description=document.querySelector('#overlayText'),start=document.querySelector('#start');
const flapButton=document.querySelector('#flapButton'),pauseButton=document.querySelector('#pauseButton'),sharedChallenge=document.querySelector('#sharedChallenge');
let challenge = null;const scoreEl=document.querySelector('#score'),distEl=document.querySelector('#distance'),livesEl=document.querySelector('#lives');
let state='ready',last=0,frameId=0,elapsed=0,offset=0,score=0,distance=0,lives=3,nextSpawn=0,hazards=[],particles=[],dragon={x:225,y:205,vy:0,flap:0,invuln:0},clouds=Array.from({length:9},(_,i)=>({x:i*143+40,y:35+(i*59)%145,s:.7+(i%3)*.3}));
const rnd=(a,b)=>a+Math.random()*(b-a);const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Mobile uses a narrower *logical* world, not a squashed 960px canvas.
// This keeps characters and approaching obstacles large enough to see on phones.
function resizeGame(){
  const width=wrap.clientWidth;
  const newW=width<650?Math.round(clamp(width*1.28,440,760)):960;
  if(newW!==W){W=newW;canvas.width=W;canvas.height=H;
    dragon.x=W<760?Math.round(W*.29):225;
    hazards=hazards.filter(h=>h.x<W+120);
  }
  canvas.style.height='auto';
  render();
}
function reset(){elapsed=0;offset=0;score=0;distance=0;lives=3;nextSpawn=1.25;hazards=[];particles=[];dragon={x:W<760?Math.round(W*.29):225,y:205,vy:0,flap:0,invuln:0};updateHud()}
function updateHud(){scoreEl.textContent=`MAIDENS ${score}`;distEl.textContent=`DISTANCE ${Math.floor(distance)}`;livesEl.textContent=Array.from({length:3},(_,i)=>i<lives?'♥':'♡').join(' ')}
function begin(){sharedChallenge.hidden=true;DragonResults.hide();reset();state='playing';overlay.classList.add('hidden');pauseButton.disabled=false;pauseButton.textContent='Pause';last=0;scheduleFrame()}
function showLegend(result){state='over';title.textContent='The legend of the dragon';description.textContent='A tale told by the knights who finally slew the beast…';start.textContent='Fly again ↗';DragonResults.show(result);overlay.classList.remove('hidden')}
function end(){state='recording';pauseButton.disabled=true;pauseButton.textContent='Pause';const result={score,distance,beaten:DragonResults.beats({score,distance:Math.floor(distance)},challenge)?challenge:null};DragonResults.record(result,showLegend)}
function flap(){if(state==='ready'||state==='over'){begin()}if(state==='paused'){togglePause()}if(state==='playing'){dragon.vy=-258;dragon.flap=0.26;for(let i=0;i<5;i++)particles.push({x:dragon.x-27,y:dragon.y+10,vx:rnd(-65,-20),vy:rnd(15,65),life:.5,color:'#a7c7a6'})}}
function togglePause(){if(state==='playing'){state='paused';if(frameId){cancelAnimationFrame(frameId);frameId=0}title.textContent='Paused in the clouds';description.textContent='Press P or select Continue to return to your flight.';start.textContent='Continue';pauseButton.textContent='Continue';overlay.classList.remove('hidden')}else if(state==='paused'){state='playing';pauseButton.textContent='Pause';overlay.classList.add('hidden');last=0;scheduleFrame()}}
function spawn(){const types=['serpent','knight','kraken','castle'];let type=types[Math.floor(Math.random()*types.length)];if(distance<60)type='castle';const y=type==='kraken'?353:type==='knight'?340:type==='castle'?320:385;hazards.push({type,x:W+90,y,w:type==='castle'?105:type==='kraken'?85:76,h:type==='castle'?118:75,t:0,taken:false,phase:rnd(0,Math.PI*2)});nextSpawn=rnd(1.55,2.3)}
function hit(a,b){return a.x+a.w>b.x&&a.x<b.x+b.w&&a.y+a.h>b.y&&a.y<b.y+b.h}
function burst(x,y,color,n=12){for(let i=0;i<n;i++)particles.push({x,y,vx:rnd(-130,130),vy:rnd(-170,60),life:rnd(.25,.7),color})}
function update(dt){if(state!=='playing')return;dt=Math.min(.038,dt);elapsed+=dt;const speed=clamp(176+elapsed*1.4,176,280);offset+=speed*dt;distance+=speed*dt/15;dragon.vy+=610*dt;dragon.y+=dragon.vy*dt;dragon.flap=Math.max(0,dragon.flap-dt);dragon.invuln=Math.max(0,dragon.invuln-dt);if(dragon.y<35){dragon.y=35;dragon.vy=45}if(dragon.y>H-94){dragon.y=H-94;dragon.vy=-110;if(dragon.invuln<=0)damage()}
nextSpawn-=dt;if(nextSpawn<=0)spawn();for(const h of hazards){h.x-=speed*dt;h.t+=dt;const box={x:dragon.x-25,y:dragon.y-20,w:58,h:42};if(h.type==='castle'){const princess={x:h.x+38,y:h.y-66+Math.sin(h.t*4)*4,w:25,h:48};if(!h.taken&&hit(box,princess)){h.taken=true;score++;burst(princess.x+12,princess.y+18,'#c9903c',18);updateHud()}const castle={x:h.x+8,y:h.y+3,w:95,h:100};if(dragon.invuln<=0&&hit(box,castle))damage()}
else{let box2;if(h.type==='serpent'){const rise=serpentRise(h);box2={x:h.x+7,y:h.y-rise-30,w:70,h:66}}else if(h.type==='knight'){const thrust=knightThrust(h);box2={x:h.x+8,y:h.y-103-thrust,w:66,h:174+thrust}}else{box2={x:h.x+8,y:h.y-48,w:h.w-15,h:124}}if(dragon.invuln<=0&&hit(box,box2))damage()}}
hazards=hazards.filter(h=>h.x>-160);for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt}particles=particles.filter(p=>p.life>0);updateHud()}
function damage(){lives--;dragon.invuln=1.5;dragon.vy=-155;burst(dragon.x,dragon.y,'#bb6744');updateHud();if(lives<=0)end()}
function line(points,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke()}
function ellipse(x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill()}
function polygon(points,fill,stroke='#164b3f',sw=3){c.fillStyle=fill;c.strokeStyle=stroke;c.lineWidth=sw;c.lineJoin='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();if(sw)c.stroke()}
function background(){const sky=c.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#f5f1df');sky.addColorStop(.75,'#dbe9d7');sky.addColorStop(1,'#c2d9be');c.fillStyle=sky;c.fillRect(0,0,W,H);
// Cartographic graticule and distant coastlines.
c.strokeStyle='#7da79925';c.lineWidth=1;for(let x=(-offset*.09)%90;x<W;x+=90){c.beginPath();c.moveTo(x,0);c.lineTo(x,H);c.stroke()}for(let y=0;y<H;y+=72){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke()}
for(const cloud of clouds){let x=((cloud.x-offset*.2)%(W+200)+(W+200))%(W+200)-90;ellipse(x,cloud.y,35*cloud.s,12*cloud.s,'#fffdf1bc');ellipse(x+22*cloud.s,cloud.y-6,28*cloud.s,14*cloud.s,'#fffdf1bc')}
for(let i=-1;i<7;i++){let x=i*235-(offset*.27%235);polygon([[x,328],[x+118,174+(i%3)*23],[x+246,328]],'#bad2bb','#92b69f',2)}
polygon([[0,340],[W*.14,327],[W*.28,344],[W*.39,319],[W*.55,344],[W*.69,326],[W*.80,344],[W,322],[W,H],[0,H]],'#84b09c','#669c88',1);
c.fillStyle='#83b6ad';c.fillRect(0,397,W,83);for(let i=0;i<14;i++){let x=(i*105-offset*.64)%(W+115);if(x<0)x+=W+115;line([[x,421+(i%3)*13],[x+35,419+(i%3)*13],[x+75,424+(i%3)*13]],'#c8ded1a8',2)}
// Foreground rolling land / rocky shoals.
for(let i=-1;i<9;i++){let x=i*155-(offset%155);polygon([[x,471],[x+43,451],[x+105,459],[x+170,480]],'#547f6b','#547f6b',1)}
}
function serpentRise(h){const cycle=(h.t*0.68+h.phase*.08)%3.45; if(cycle<.65)return 90*Math.sin((cycle/.65)*Math.PI/2);if(cycle<1.5)return 90+15*Math.sin((cycle-.65)/.85*Math.PI);if(cycle<3.3)return Math.max(0,90*(1-(cycle-1.5)/1.8));return 0}
function knightThrust(h){return 22*Math.sin(h.t*5+h.phase)}
function drawDragon(){DragonArt.drawDragon(c,dragon,elapsed)}
function drawCastle(h){const x=h.x,y=h.y;c.save();c.translate(x,y);
// stone castle and towers
polygon([[8,23],[94,23],[94,105],[8,105]],'#d4cbb0','#6b806c',2);for(const tx of [4,74]){polygon([[tx,5],[tx+24,5],[tx+24,104],[tx,104]],'#e6d6b7','#6b806c',2);for(let j=0;j<3;j++)c.fillRect(tx+j*9,0,6,11)}polygon([[32,23],[46,6],[67,23]],'#af754c','#80543b',2);c.fillStyle='#6f8d79';c.fillRect(39,57,13,23);c.fillRect(69,58,12,22);c.fillStyle='#5a786c';c.beginPath();c.arc(50,104,17,Math.PI,0);c.fill();c.fillRect(33,104,34,10);line([[51,6],[51,-18]],'#7e694f',2);polygon([[51,-18],[76,-13],[51,-8]],'#c59146','#986d36',1);
if(!h.taken){const bounce=Math.sin(h.t*4)*4;ellipse(51,-42+bounce,18,23,'#f8e5a4a0');ellipse(51,-55+bounce,9,10,'#d9a57b');polygon([[41,-45+bounce],[61,-45+bounce],[65,-21+bounce],[37,-21+bounce]],'#b96d73','#93515f',1);polygon([[43,-65+bounce],[48,-73+bounce],[53,-65+bounce],[59,-72+bounce],[61,-62+bounce]],'#d4a344','#936b28',1)}c.restore()}
function drawKnight(h){const x=h.x,y=h.y+Math.sin(h.t*9)*2;c.save();c.translate(x,y);ellipse(32,33,36,19,'#b49b74');ellipse(57,23,18,12,'#b49b74');polygon([[68,17],[72,8],[75,20]],'#8a785f','#8a785f',1);for(let j of [11,46])line([[j,42],[j-4,74]],'#685a48',6);line([[26,43],[27,69]],'#685a48',6);ellipse(33,5,12,16,'#5f8080');polygon([[23,-5],[37,-19],[47,5]],'#607f7d','#365b55',2);ellipse(35,-19,11,10,'#c9ccc0');polygon([[30,-30],[42,-30],[37,-37]],'#bd9250','#8d6b3c',1);
// The lance and gauntlet pump visibly up and down, while the horse gallops.
const thrust=knightThrust(h);line([[44,-5],[48,-96-thrust]],'#756849',5);polygon([[48,-109-thrust],[40,-92-thrust],[56,-92-thrust]],'#b3c3b5','#667a6f',2);ellipse(44,-5+thrust*.12,5,5,'#9ba99a');c.restore()}
function drawSerpent(h){const x=h.x,y=h.y-serpentRise(h);c.save();c.translate(x,y);
// Loch Ness creature: curved long neck, arched torso and trailing tail.
const bend=Math.sin(h.t*3+h.phase)*6;
c.strokeStyle='#355f50';c.lineWidth=20;c.lineCap='round';c.beginPath();c.moveTo(-11,53);c.bezierCurveTo(8,19,28,24,37,49);c.bezierCurveTo(54,71,79,47,67,18);c.stroke();c.strokeStyle='#67977a';c.lineWidth=12;c.stroke();
line([[66,24],[71+bend*.3,-9],[77+bend,-39]],'#355f50',15);line([[69,22],[75+bend*.3,-8],[79+bend,-38]],'#67977a',8);
ellipse(84+bend,-44,16,10,'#67977a');polygon([[92+bend,-44],[106+bend,-39],[93+bend,-34]],'#67977a','#355f50',2);ellipse(88+bend,-48,2.8,2.8,'#1e3a33');
for(let i=0;i<3;i++)polygon([[22+i*16,33],[27+i*16,19],[34+i*16,35]],'#42775f','#355f50',1);
c.restore()}
function drawKraken(h){const x=h.x,y=h.y;c.save();c.translate(x,y);ellipse(45,63,39,17,'#3e867b');ellipse(45,33,26,33,'#478b80');
// Segmented Bézier tentacles undulate along their entire length, not just at the tips.
for(let i=0;i<5;i++){let root=15+i*15,phase=h.t*3.4+i*.92,tip=18+i*13+Math.sin(phase)*19,reach=32+(i%2)*21;
c.strokeStyle='#245e5b';c.lineWidth=13;c.lineCap='round';c.beginPath();c.moveTo(root,62);c.bezierCurveTo(root-20+Math.sin(phase)*9,27,root+26+Math.sin(phase+1)*23,1,tip,-reach+Math.sin(phase+.7)*9);c.stroke();
c.strokeStyle='#52988a';c.lineWidth=5;c.stroke();ellipse(tip,-reach+Math.sin(phase+.7)*9,6,6,'#245e5b');
for(let k=0;k<3;k++){const t=(k+1)/4;ellipse(root+(tip-root)*t+Math.sin(phase+t*3)*7,60-(60+reach)*t,2.8,2.8,'#b7b18b')}}
ellipse(35,27,5,6,'#f3e8ce');ellipse(55,27,5,6,'#f3e8ce');ellipse(36,27,2.5,3,'#153c38');ellipse(54,27,2.5,3,'#153c38');c.restore()}
function render(){background();for(const h of hazards){if(h.type==='castle')drawCastle(h);if(h.type==='knight')drawKnight(h);if(h.type==='serpent')drawSerpent(h);if(h.type==='kraken')drawKraken(h)}drawDragon();for(const p of particles){c.globalAlpha=clamp(p.life*1.8,0,1);ellipse(p.x,p.y,3,3,p.color)}c.globalAlpha=1}
function scheduleFrame(){if(!frameId&&state==='playing')frameId=requestAnimationFrame(frame)}
function frame(now){frameId=0;if(state!=='playing')return;if(!last)last=now;const dt=(now-last)/1000;last=now;update(dt);render();scheduleFrame()}
// Only pointerdown is used, so touch + mouse never double-flap.
// Tapping inside the game stops the browser from scrolling/zooming during play.
wrap.addEventListener('pointerdown',e=>{
  if(e.target.closest('button')||e.target.closest('.panel')||state==='paused')return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  e.preventDefault();wrap.focus({preventScroll:true});flap();
},{passive:false});
flapButton.addEventListener('pointerdown',e=>{e.preventDefault();flap()},{passive:false});
// Fallback for older iOS Safari versions lacking Pointer Events.
if(!window.PointerEvent){wrap.addEventListener('touchstart',e=>{if(e.target.closest('.panel'))return;e.preventDefault();flap()},{passive:false});flapButton.addEventListener('touchstart',e=>{e.preventDefault();flap()},{passive:false})}
start.addEventListener('click',()=>{if(state==='paused')togglePause();else begin();wrap.focus({preventScroll:true})});
pauseButton.addEventListener('click',()=>{const resume=state==='paused';togglePause();if(resume)wrap.focus({preventScroll:true})});
// Pointer presses are handled above; keyboard and assistive-technology activation use click.
flapButton.addEventListener('click',e=>{if(e.detail===0)flap()});
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest?.('button, a, input, select, textarea, [contenteditable="true"]'))return;
  if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();if(!e.repeat)flap()}
  if(e.code==='KeyP'&&!e.repeat)togglePause();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='playing')togglePause()});
window.addEventListener('resize',resizeGame,{passive:true});
// Shared scores are untrusted keepsakes, not verified achievements.
const shared = DragonResults.parse(location.href);
if (shared) { challenge={name:shared.name,score:shared.score,distance:shared.distance}; DragonResults.setChallenge(challenge); showLegend(shared); sharedChallenge.textContent=DragonResults.challengeMessage(challenge); sharedChallenge.hidden=false; start.textContent='Take the challenge ↗'; }
// The game is still until the visitor deliberately starts it, including for reduced motion.
resizeGame();
})();
