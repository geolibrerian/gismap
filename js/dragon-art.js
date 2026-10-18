// Shared artwork keeps the game and the share card's dragon identical.
(()=>{'use strict';
function drawDragon(c, dragon, elapsed = 0){
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function line(points,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke()}
function ellipse(x,y,rx,ry,color){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill()}
function polygon(points,fill,stroke='#164b3f',sw=3){c.fillStyle=fill;c.strokeStyle=stroke;c.lineWidth=sw;c.lineJoin='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();if(sw)c.stroke()}
c.save();c.translate(dragon.x,dragon.y);c.rotate(clamp(dragon.vy/1250,-.26,.33));if(dragon.invuln>0&&Math.floor(elapsed*14)%2===0)c.globalAlpha=.42;
// long, sinuous tail
c.strokeStyle='#194d40';c.lineWidth=17;c.lineCap='round';c.beginPath();c.moveTo(-26,10);c.bezierCurveTo(-72,2,-79,44,-112,17);c.bezierCurveTo(-133,-2,-123,-28,-100,-20);c.stroke();c.strokeStyle='#31836e';c.lineWidth=11;c.stroke();
// hind legs
polygon([[-12,17],[-23,40],[-9,39],[1,27]],'#286d5b');polygon([[19,18],[11,42],[26,39],[32,23]],'#286d5b');
// Single sweeping, sail-like dragon wings. Each leading edge is one curved arc,
// with a scalloped bat membrane hanging below it (no jagged zigzag spires).
function batWing(scale,fill,stroke){
  c.save();c.scale(scale,scale);
  c.beginPath();c.moveTo(0,0);
  // Shoulder -> high arch -> outward swept wingtip.
  c.bezierCurveTo(-24,-34,-69,-101,-131,-94);
  // Four soft inverted scallops hanging from the spar.
  c.bezierCurveTo(-119,-78,-112,-69,-113,-53);
  c.quadraticCurveTo(-98,-67,-88,-73);
  c.bezierCurveTo(-85,-53,-79,-49,-71,-43);
  c.quadraticCurveTo(-59,-60,-48,-62);
  c.bezierCurveTo(-44,-41,-31,-26,-22,-21);
  c.quadraticCurveTo(-8,-15,0,0);
  c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle=stroke;c.lineWidth=3.3;c.lineJoin='round';c.stroke();
  // Radial wing-finger bones, kept within the same curved membrane.
  c.strokeStyle=stroke;c.lineWidth=1.8;c.globalAlpha=.5;
  for(const [ex,ey,cx,cy] of [[-131,-94,-59,-64],[-113,-53,-63,-38],[-88,-73,-47,-49],[-71,-43,-38,-25],[-48,-62,-26,-39]]){
    c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(cx,cy,ex,ey);c.stroke();
  }
  c.restore();
}
const wingBeat=dragon.flap>0?1:0.5+0.5*Math.sin(elapsed*12);
// Smaller, mistier rear wing gives depth without a butterfly silhouette.
c.save();c.translate(-20,-8);c.rotate(-.09+wingBeat*.1);
batWing(.68,'#6ea58c','#194d40');c.restore();
// Body stays in front of wing roots.
ellipse(0,5,51,26,'#287e69');ellipse(20,9,29,17,'#62a78d');
// Main wing sweeps backwards; subtle rotation and lift animate each flap.
c.save();c.translate(-8,-9-wingBeat*8);c.rotate(-.08+wingBeat*.16);
batWing(.88+wingBeat*.1,'#82b9a1','#154d3f');c.restore();
// Longer elegant swan-like neck, small dragon skull, horns, and tapered muzzle.
polygon([[27,1],[37,-13],[45,-39],[52,-63],[67,-66],[74,-51],[62,-43],[57,-25],[53,-3],[37,15]],'#287e69');
polygon([[59,-64],[81,-68],[94,-58],[94,-46],[81,-42],[66,-47]],'#287e69');
polygon([[69,-63],[65,-80],[77,-68]],'#c9974c','#164b3f',2);polygon([[81,-62],[84,-78],[90,-58]],'#c9974c','#164b3f',2);
ellipse(80,-57,3.7,3.7,'#fff9e9');ellipse(81,-57,1.8,1.8,'#122f2b');ellipse(91,-49,2.2,2.2,'#143e33');
line([[44,-25],[48,-43],[56,-55]],'#72aa91',3);
// front arms / talons
line([[29,7],[40,19],[49,16]],'#164c40',5);line([[12,18],[21,31],[31,28]],'#164c40',5);c.restore()}
globalThis.DragonArt = { drawDragon };
})();
