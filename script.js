'use strict';

// ------- Utils -------
const $ = (sel) => document.querySelector(sel);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------- Canvas & DPR scaling -------
const canvas = $('#game');
const ctx = canvas.getContext('2d');
// Cap DPR modestly to reduce GPU/CPU load on some devices
let DPR = Math.max(1, Math.min(1.5, Math.floor(window.devicePixelRatio || 1)));
const BASE_W = 800, BASE_H = 300; // logical size

// Optional external sprite for the cat with background removal (chroma key)
const catSprite = new Image();
let catSpriteReady = false;
let catProcessedReady = false;
let catTex = null; // offscreen canvas with transparent background

function processCatSprite(img){
  try{
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);
    const data = octx.getImageData(0,0,w,h);
    const px = data.data;
    // sample corners to estimate background color
    const corners = [0, (w-1)*4, (h-1)*w*4, ((h-1)*w + (w-1))*4];
    let sr=0, sg=0, sb=0, sc=0;
    for (const idx of corners){ sr += px[idx]; sg += px[idx+1]; sb += px[idx+2]; sc++; }
    const bg = { r: sr/sc, g: sg/sc, b: sb/sc };
    const thr = 36; // tolerance in color distance
    const thr2 = thr*thr;
    for (let i=0; i<px.length; i+=4){
      const r = px[i], g = px[i+1], b = px[i+2];
      // distance to background
      const dr = r - bg.r, dg = g - bg.g, db = b - bg.b;
      const dist2 = dr*dr + dg*dg + db*db;
      const avg = (r+g+b)/3;
      const maxc = Math.max(r,g,b), minc = Math.min(r,g,b);
      const nearGray = (maxc - minc) < 12 && avg > 240; // near white/gray
      if (dist2 < thr2 || nearGray){
        px[i+3] = 0; // make transparent
      }
    }
    octx.putImageData(data, 0, 0);
    catTex = off; catProcessedReady = true;
  } catch(e){ catProcessedReady = false; }
}

catSprite.onload = () => { catSpriteReady = true; processCatSprite(catSprite); };
catSprite.onerror = () => { catSpriteReady = false; };
// Put a file named 'cat.png' in the project root to use your custom cat image
catSprite.src = 'cat.png';

function resizeCanvas() {
  // Keep capped DPR to avoid excessive pixel work
  DPR = Math.max(1, Math.min(1.5, Math.floor(window.devicePixelRatio || 1)));
  canvas.width = BASE_W * DPR;
  canvas.height = BASE_H * DPR;
  canvas.style.width = BASE_W + 'px';
  canvas.style.height = BASE_H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // scale drawing ops by DPR
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ------- Game State -------
const GRAVITY = 0.7;
const JUMP_FORCE = 13.5;
const GROUND_Y = BASE_H - 48; // ground baseline

let game = {
  running: true, // auto-start
  over: false,
  speed: 3.2, // start slower
  time: 0,
  score: 0,
  high: Number(localStorage.getItem('runnerHighScore') || 0),
  level: 1,
};

// ------- Performance & Quality -------
const perf = {
  fps: 60,
  quality: 'high', // 'high' | 'med' | 'low'
};

function updateQuality(sampleFps){
  perf.fps = perf.fps * 0.9 + sampleFps * 0.1; // EMA smoothing
  const f = perf.fps;
  const prev = perf.quality;
  if (f < 45) perf.quality = 'low';
  else if (f < 55) perf.quality = 'med';
  else perf.quality = 'high';
  // No dynamic DPR switching (can cause blurs); keep simpler pipeline
}

// ------- Player (Pixel Cat) -------
const player = {
  x: 80, y: GROUND_Y,
  spriteW: 16, spriteH: 16, scale: 3,
  get w(){ return this.spriteW * this.scale; },
  get h(){ return this.spriteH * this.scale; },
  vy: 0,
  onGround: true,
  jump() {
    if (!game.running) return;
    if (this.onGround) {
      this.vy = -JUMP_FORCE;
      this.onGround = false;
    }
  },
  reset() {
    this.y = GROUND_Y; this.vy = 0; this.onGround = true;
  },
  update(dt) {
    this.vy += GRAVITY;
    this.y += this.vy;
    if (this.y >= GROUND_Y) { this.y = GROUND_Y; this.vy = 0; this.onGround = true; }
  },
  draw() {
    ctx.save();
    // draw external sprite if available; fallback to pixel cat
    if (catProcessedReady && catTex){
      ctx.imageSmoothingEnabled = false; // keep pixel crispness if the image is pixel art
      ctx.drawImage(catTex, this.x, this.y - this.h, this.w, this.h);
    } else if (catSpriteReady){
      // Fallback to raw image if processing not ready
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(catSprite, this.x, this.y - this.h, this.w, this.h);
    } else {
      const frame = Math.floor(game.time * 10) % 2; // simple 2-frame wiggle
      drawPixelCat(ctx, this.x, this.y - this.h, this.scale, frame);
    }

    // shadow
    ctx.globalAlpha = clamp(1 - (GROUND_Y - this.y) / 120, 0.25, 1);
    ctx.fillStyle = 'rgba(15,23,42,.35)';
    ctx.beginPath();
    ctx.ellipse(this.x + this.w/2, GROUND_Y + 10, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
};

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Draw an orange/white pixel cat (16x16). Uses simple pixel map with two frames for tail.
function drawPixelCat(ctx, x, y, s, frame){
  const OR = '#d97706';      // Orange (base)
  const ORL = '#f59e0b';     // Orange light
  const SH = '#b45309';      // Shadow orange
  const CH = '#f4a460';      // Chest patch (sandy)
  const DK = '#2b1f14';      // Dark (outline/eyes/muzzle)

  // Legend: . empty, O base orange, L light orange, S shadow, C chest patch, D dark
  // 16x16 facing left (head at left, tail up at right). Two frames for tail tip.
  const rowsA = [
    '....DDO.OOD.....',
    '...DOOOLOOO D...',
    '..DOOOOOOOOO D..',
    '.DOOOOOOOOOOO D.',
    '.DOOOOLOOOOOO D.',
    '.DOOOOCCCCOOO D.',
    '.DOOOOCCCCOOO D.',
    '.DOOOOOOOOOOO D.',
    '.DOOOSOOOOOOO D.',
    '.DOOOOOOOOOOO D.',
    '.DOOOOOOOOOOO D.',
    '.DOOOO D OOOO D.',
    '.DOOOO D OOOO D.',
    '..DOOO   OOO D..',
    '...DOD   DOD...',
    '.....D   D.....',
  ];
  const rowsB = [
    '....DDO.OOD.....',
    '...DOOOLOOO D...',
    '..DOOOOOOOOO D..',
    '.DOOOOOOOOOOO D.',
    '.DOOOOLOOOOOO D.',
    '.DOOOOCCCCOOO D.',
    '.DOOOOCCCCOOO D.',
    '.DOOOOOOOOOOO D.',
    '.DOOOSOOOOOOO D.',
    '.DOOOOOOOOOOO D.',
    '.DOOOOOOOOOOO D.',
    '.DOOOO D OOOO D.',
    '.DOOOO D OOOO D.',
    '..DOOO   OOO D..',
    '...DOD   DOD..O',
    '.....D   D..O..',
  ];
  const rows = frame ? rowsB : rowsA;

  const colorFor = (ch) =>
    ch === 'O' ? OR :
    ch === 'L' ? ORL :
    ch === 'S' ? SH :
    ch === 'C' ? CH :
    ch === 'D' ? DK : null;

  for (let j = 0; j < rows.length; j++){
    const row = rows[j];
    for (let i = 0; i < row.length; i++){
      const col = colorFor(row[i]);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + i*s, y + j*s, s, s);
    }
  }

  // Cheek tufts (dark whisker-like blocks)
  ctx.fillStyle = DK;
  ctx.fillRect(x + 2*s, y + 6*s, 1*s, 1*s);
  ctx.fillRect(x + 2*s, y + 7*s, 1*s, 1*s);
  ctx.fillRect(x + 5*s, y + 6*s, 1*s, 1*s);
  ctx.fillRect(x + 5*s, y + 7*s, 1*s, 1*s);

  // Eyes and nose (ensure visible)
  ctx.fillRect(x + 4*s, y + 5*s, 1*s, 1*s);
  ctx.fillRect(x + 7*s, y + 5*s, 1*s, 1*s);
  ctx.fillRect(x + 6*s, y + 6*s, 1*s, 1*s);
}

// ------- Obstacles & Scenery -------
const obstacles = [];
const clouds = [];
// no powerups
const LIMITS = { obstaclesHigh: 8, obstaclesMed: 7, obstaclesLow: 6, cloudsHigh: 12, cloudsMed: 8, cloudsLow: 5 };

function spawnObstacle(probBird){
  // Weighted selection: bird probability grows, then split ground types
  const pBird = probBird || 0.15;
  if (Math.random() < pBird){
    const spread = 80 - Math.min(40, game.level * 2);
    const flyY = GROUND_Y - (60 + Math.floor(Math.random() * spread));
    obstacles.push({ type: 'bird', x: BASE_W + 30, y: flyY, w: 34, h: 22, wing: 0, color: '#f59e0b' });
    return 34; // block width in px
  }
  // Ground obstacles: cactus, rock, cactus cluster
  const r = Math.random();
  if (r < 0.5){
    // Single cactus
    const h = 30 + Math.floor(Math.random() * 36);
    const w = 18 + Math.random()*12;
    obstacles.push({ type: 'cactus', x: BASE_W + 30, y: GROUND_Y, w, h, color: '#22c55e' });
    return w;
  } else if (r < 0.75){
    // Rock: small and low profile
    const size = 14 + Math.random()*10;
    obstacles.push({ type: 'rock', x: BASE_W + 30, y: GROUND_Y, w: size, h: size*0.7, color: '#64748b', spin: Math.random()*Math.PI });
    return size;
  } else {
    // Cactus cluster: 2-3 small cactus with slight spacing
    const count = 2 + Math.floor(Math.random()*2);
    let x = BASE_W + 30;
    let totalW = 0;
    for (let i = 0; i < count; i++){
      const h = 26 + Math.floor(Math.random()*22);
      const w = 14 + Math.random()*10;
      obstacles.push({ type: 'cactus', x, y: GROUND_Y, w, h, color: '#16a34a' });
      const spacing = 8 + Math.random()*6;
      x += w + spacing; // tight cluster spacing
      totalW += w + spacing;
    }
    return Math.max(28, totalW);
  }
}

function spawnCloud(){
  clouds.push({ x: BASE_W + 20, y: 40 + Math.random()*100, w: 40 + Math.random()*50, h: 20 + Math.random()*10, spd: 1 + Math.random()*0.8, a: 0.35 + Math.random()*0.25 });
}

let spawnTimer = 0;
let cloudTimer = 0;
// no power timer

// ------- Input -------
function handleKey(e){
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW'){
    e.preventDefault();
    if (!game.running && !game.over) startGame();
    player.jump();
  }
  if (e.code === 'Enter' && game.over){ restart(); }
}
window.addEventListener('keydown', handleKey);

canvas.addEventListener('pointerdown', () => {
  if (game.over){ restart(); return; }
  player.jump();
});
$('#jumpBtn').addEventListener('click', () => {
  if (game.over){ restart(); return; }
  player.jump();
});

// ------- Loop -------
let last = 0;
function loop(ts){
  if (!last) last = ts;
  const dt = Math.min(32, ts - last) / 16.666; // normalize to ~60fps units
  const instFps = 1000 / Math.max(1, (ts - last));
  last = ts;
  updateQuality(instFps);
  if (game.running) update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt){
  game.time += dt;
  // level & speed progression estilo Dino: aumenta por umbrales de puntaje
  game.level = clamp(1 + Math.floor(game.score / 300), 1, 99);
  const stepEvery = 100;           // puntos por incremento
  const stepInc = 0.35;            // incremento por paso
  const baseSpeed = 3.0;           // más lento al inicio
  const maxSpeed = 10.0;           // velocidad máxima
  const steps = Math.floor(game.score / stepEvery);
  const targetSpeed = clamp(baseSpeed + steps * stepInc, baseSpeed, maxSpeed);
  game.speed += (targetSpeed - game.speed) * 0.08; // easing hacia la meta

  // score (slightly amplified by level and current speed)
  game.score += dt * (2 + game.level * 0.2) * (game.speed / 6);
  $('#score').textContent = Math.floor(game.score);
  $('#level').textContent = game.level;

  // player
  player.update(dt);

  // spawn obstacle
  spawnTimer -= dt;
  if (spawnTimer <= 0){
    // aves se habilitan tras 200 puntos
    const birdEnabled = game.score >= 200;
    const baseProbBird = birdEnabled ? clamp(0.05 + (game.level - 1) * 0.03, 0.05, 0.5) : 0;
    const probBird = baseProbBird;
    // Avoid overspawning if too many active obstacles
    const maxObs = perf.quality === 'low' ? LIMITS.obstaclesLow : perf.quality === 'med' ? LIMITS.obstaclesMed : LIMITS.obstaclesHigh;
    if (obstacles.length >= maxObs){
      spawnTimer = 0.3; // short delay before trying again
      return;
    }
    const blockW = spawnObstacle(probBird) || 28;
    // Gap seguro: más generoso para dar tiempo a aterrizar y preparar el siguiente salto
    const minReactMs = clamp(520 - game.level * 6, 340, 520); // ventana de reacción mayor
    const jumpPrepPx = 120 + Math.min(200, game.level * 8);   // pista extra
    const baseSafePx = 160 + jumpPrepPx;
    // convertir tiempo de reacción a píxeles en función de la velocidad actual
    const reactPx = (minReactMs / 1000) * (game.speed * 60) * 0.35; // factor más amplio
    // adicional: ensure clearance proportional al ancho del bloque
    const widthClearance = blockW * 1.6;
    const safeGapPx = Math.max(220, baseSafePx + reactPx + widthClearance);
    const totalPx = blockW + safeGapPx;
    // tiempo hasta el siguiente spawn
    spawnTimer = totalPx / Math.max(3, game.speed);
  }

  // spawn clouds
  cloudTimer -= dt;
  if (cloudTimer <= 0){
    const maxClouds = perf.quality === 'low' ? LIMITS.cloudsLow : perf.quality === 'med' ? LIMITS.cloudsMed : LIMITS.cloudsHigh;
    if (clouds.length < maxClouds) spawnCloud();
    // fewer clouds on low for less overdraw
    const base = perf.quality === 'low' ? 2.0 : perf.quality === 'med' ? 1.6 : 1.4;
    cloudTimer = base + Math.random()*1.2;
  }

  // no powerups spawn

  // move obstacles
  for (let i = obstacles.length - 1; i >= 0; i--){
    const o = obstacles[i];
    o.x -= game.speed;
    if (o.type === 'bird'){
      o.wing += dt * 10;
    }
    if (o.x + o.w < -20) obstacles.splice(i,1);
  }

  // move clouds (parallax)
  for (let i = clouds.length - 1; i >= 0; i--){
    const c = clouds[i];
    c.x -= c.spd;
    if (c.x + c.w < -20) clouds.splice(i,1);
  }

  // no powerups movement

  // collisions
  for (const o of obstacles){
    const px = player.x, py = player.y - player.h, pw = player.w, ph = player.h;
    const ox = o.x, oy = o.y - o.h, ow = o.w, oh = o.h;
    if (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy){
      return gameOver();
    }
  }

  // no powerups collection
}

function draw(){
  // sky gradient already in CSS; clear canvas with transparent
  ctx.clearRect(0,0,BASE_W,BASE_H);

  // day-night tint
  drawSkyTint();

  // distant hills
  if (perf.quality !== 'low') drawHills(); // skip hills on low quality

  // clouds
  for (const c of clouds){ drawCloud(c); }

  // ground
  drawGround();

  // obstacles
  for (const o of obstacles){ drawObstacle(o); }

  // no powerups drawing

  // player
  player.draw();

  // Game Over banner
  if (game.over) drawGameOverBanner();
}

function drawHills(){
  ctx.save();
  // far hill
  ctx.fillStyle = perf.quality === 'high' ? 'rgba(15,23,42,.45)' : 'rgba(15,23,42,.5)';
  ctx.beginPath();
  ctx.moveTo(0, BASE_H);
  ctx.quadraticCurveTo(180, 200, 360, BASE_H);
  ctx.quadraticCurveTo(560, 180, 800, BASE_H);
  ctx.lineTo(0, BASE_H);
  ctx.fill();
  // near hill
  ctx.fillStyle = perf.quality === 'high' ? 'rgba(15,23,42,.65)' : 'rgba(15,23,42,.6)';
  ctx.beginPath();
  ctx.moveTo(0, BASE_H);
  ctx.quadraticCurveTo(140, 220, 300, BASE_H);
  ctx.quadraticCurveTo(520, 210, 800, BASE_H);
  ctx.lineTo(0, BASE_H);
  ctx.fill();
  ctx.restore();
}

function drawCloud(c){
  ctx.save();
  ctx.globalAlpha = c.a;
  ctx.fillStyle = '#ffffff';
  roundedCloud(c.x, c.y, c.w, c.h);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function roundedCloud(x, y, w, h){
  ctx.beginPath();
  ctx.arc(x + w*0.25, y + h*0.6, h*0.4, 0, Math.PI*2);
  ctx.arc(x + w*0.45, y + h*0.5, h*0.5, 0, Math.PI*2);
  ctx.arc(x + w*0.65, y + h*0.6, h*0.45, 0, Math.PI*2);
  ctx.arc(x + w*0.50, y + h*0.7, h*0.55, 0, Math.PI*2);
}

function drawGround(){
  // base ground line
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 1);
  ctx.lineTo(BASE_W, GROUND_Y + 1);
  ctx.stroke();

  // dashed strip moving
  const stripeY = GROUND_Y + 14;
  const segW = 20, gap = 14;
  if (perf.quality !== 'low'){
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.setLineDash([segW, gap]);
    ctx.lineDashOffset = - (game.time * 12) % (segW + gap);
    ctx.beginPath();
    ctx.moveTo(0, stripeY);
    ctx.lineTo(BASE_W, stripeY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawObstacle(o){
  ctx.save();
  if (o.type === 'cactus'){
    ctx.fillStyle = o.color;
    roundRect(ctx, o.x, o.y - o.h, o.w, o.h, 4);
    ctx.fill();
    ctx.fillRect(o.x + o.w*0.6, o.y - o.h*0.6, 4, o.h*0.3);
    ctx.fillRect(o.x + o.w*0.2, o.y - o.h*0.45, 4, o.h*0.25);
  } else if (o.type === 'bird') {
    // bird
    const flap = Math.sin(o.wing) * (perf.quality === 'low' ? 4 : 6);
    ctx.fillStyle = o.color;
    roundRect(ctx, o.x, o.y - o.h, o.w, o.h, 6);
    ctx.fill();
    // wings
    ctx.fillStyle = '#fbbf24';
    roundRect(ctx, o.x + 4, o.y - o.h - 6 - flap, 10, 10, 4);
    ctx.fill();
  } else if (o.type === 'rock') {
    // rock with simple shading
    ctx.translate(o.x + o.w/2, o.y - o.h/2);
    ctx.rotate(o.spin || 0);
    ctx.fillStyle = o.color;
    roundRect(ctx, -o.w/2, -o.h/2, o.w, o.h, Math.min(6, o.h/2));
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#e2e8f0';
    roundRect(ctx, -o.w/2 + 3, -o.h/2 + 2, o.w*0.6, o.h*0.3, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ------- Coins / Powerups / Sky helpers -------
function drawCoin(c){
  ctx.save();
  const g = ctx.createLinearGradient(c.x-c.r, c.y-c.r, c.x+c.r, c.y+c.r);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y, c.r, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r*0.6, -0.2, Math.PI-0.2); ctx.stroke();
  ctx.restore();
}

// removed drawShieldPU

function spawnCoinsPattern(){
  const pattern = Math.random();
  const baseX = BASE_W + 40;
  if (pattern < 0.5){
    // line
    const y = GROUND_Y - (50 + Math.random()*60);
    const n = 5 + Math.floor(Math.random()*4);
    for (let i=0;i<n;i++) coins.push({ x: baseX + i*26, y, r: 7 });
  } else {
    // arc
    const cx = baseX + 60;
    const cy = GROUND_Y - 40 - Math.random()*50;
    const n = 6;
    for (let i=0;i<n;i++){
      const t = (i/(n-1)) * Math.PI;
      coins.push({ x: cx + Math.cos(t)*50, y: cy - Math.sin(t)*28, r: 7 });
    }
  }
}

// removed spawnShield

// removed updateShieldHud

function drawSkyTint(){
  const t = (Math.floor(game.score) % 600) / 600;
  let col = 'rgba(0,0,0,0)';
  if (t < 0.33) col = 'rgba(0,0,0,0.0)';
  else if (t < 0.66) col = 'rgba(10,14,40,0.18)';
  else col = 'rgba(6,9,25,0.32)';
  ctx.save();
  ctx.fillStyle = col;
  ctx.fillRect(0,0,BASE_W,BASE_H);
  ctx.restore();
}

// Simple SFX
let audioCtx = null;
function getCtx(){ if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function beep(freq, dur, type='sine', vol=0.08){
  try{
    const ctxA = getCtx();
    const o = ctxA.createOscillator();
    const g = ctxA.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol; o.connect(g); g.connect(ctxA.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctxA.currentTime + dur);
    o.stop(ctxA.currentTime + dur);
  }catch(e){}
}
function sfxCoin(){ beep(880, 0.08, 'square', 0.05); }
// removed sfxPower/sfxHit

// ------- Game Control -------
function startGame(){
  // no-op now; auto-start is enabled
  game.running = true;
}

function gameOver(){
  game.over = true; game.running = false;
  // high score
  game.high = Math.max(game.high, Math.floor(game.score));
  localStorage.setItem('runnerHighScore', String(game.high));
  $('#highScore').textContent = game.high;
}

function restart(){
  obstacles.length = 0;
  clouds.length = 0;
  spawnTimer = 0; cloudTimer = 0; last = 0;
  game.time = 0; game.score = 0; game.over = false; game.level = 1; game.speed = 3.2; game.running = true;
  player.reset();
  $('#score').textContent = '0';
  $('#highScore').textContent = game.high;
  $('#level').textContent = game.level;
}

// Init UI
$('#highScore').textContent = game.high;
$('#level').textContent = game.level;

function drawGameOverBanner(){
  ctx.save();
  const msg = 'muy mala mami';
  const sub = 'Enter / Click para reiniciar';
  ctx.fillStyle = 'rgba(17,24,39,0.7)';
  roundRect(ctx, BASE_W/2 - 170, BASE_H/2 - 50, 340, 100, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Nunito, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(msg, BASE_W/2, BASE_H/2 - 8);
  ctx.font = '16px Nunito, system-ui';
  ctx.fillText(sub, BASE_W/2, BASE_H/2 + 18);
  ctx.restore();
}

// Accessibility: prevent space from scrolling page when focused on button
window.addEventListener('keydown', (e)=>{
  if (e.code === 'Space' && (document.activeElement?.tagName === 'BUTTON')){
    e.preventDefault();
  }
});
