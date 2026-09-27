(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mini = document.getElementById('minimap');
  const mctx = mini.getContext('2d');
  const W = 2600, H = 1900, ROAD_W = 154, ROAD_H = 136;
  const roadX = [250, 850, 1450, 2050, 2550];
  const roadY = [210, 690, 1170, 1650];
  const keys = new Set();
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(Math.random() * items.length)];
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const colors = ['#e9b64f', '#ed697c', '#68c9bd', '#5a86b8', '#e8dbb9', '#b76a9c', '#ca684c', '#75a58c'];

  const buildings = [];
  const palms = [];
  const decorations = [];
  const avenues = [];
  const vehicles = [];
  let dpr = 1, viewW = 0, viewH = 0, camX = 0, camY = 0, lastTime = 0, toastTimer = 0;

  const player = { x: 330, y: 210, angle: 0, health: 100, cash: 250, vehicle: null, heat: 0, hitCooldown: 0, collisionCooldown: 0 };
  const job = { phase: 'pickup', from: { x: 625, y: 285, name: 'Ocean Drive' }, to: { x: 2060, y: 1120, name: 'Little Havana' }, reward: 350 };
  const cops = [];
  let paused = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = rect.width; viewH = rect.height;
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);

  function isOnRoad(x, y) {
    return roadX.some(rx => Math.abs(x - rx) < ROAD_W * .5) || roadY.some(ry => Math.abs(y - ry) < ROAD_H * .5);
  }
  function addBuilding(x, y, w, h, hue, style = 0) {
    const colorsByHue = [
      ['#caa976', '#ddc99d', '#ad8964'], ['#62888b', '#83a5a1', '#4f7379'],
      ['#b27469', '#d39983', '#8f625e'], ['#898695', '#adaab2', '#777783'],
      ['#b4a369', '#d0bf82', '#978a5e'], ['#6c8582', '#91a396', '#596f70']
    ];
    const palette = colorsByHue[hue % colorsByHue.length];
    buildings.push({ x, y, w, h, base: palette[0], roof: palette[1], shadow: palette[2], style });
    for (let i = 0; i < 3; i++) {
      palms.push({ x: x + rand(5, w - 5), y: y + h + rand(8, 22), size: rand(8, 13), angle: rand(0, Math.PI * 2) });
    }
  }

  function buildCity() {
    // The city grid creates broad boulevards, small service lanes and pocket parks.
    for (let i = 0; i < roadX.length - 1; i++) {
      avenues.push({ x1: roadX[i] + ROAD_W / 2, x2: roadX[i + 1] - ROAD_W / 2, kind: 'block' });
    }
    for (let row = 0; row < roadY.length - 1; row++) {
      for (let col = 0; col < roadX.length - 1; col++) {
        const left = roadX[col] + ROAD_W / 2 + 13;
        const right = roadX[col + 1] - ROAD_W / 2 - 13;
        const top = roadY[row] + ROAD_H / 2 + 13;
        const bottom = roadY[row + 1] - ROAD_H / 2 - 13;
        const bw = right - left, bh = bottom - top;
        const seed = row * 7 + col * 3;
        if ((row === 1 && col === 2) || (row === 2 && col === 0)) {
          decorations.push({ x: left, y: top, w: bw, h: bh, kind: 'park' });
          continue;
        }
        if (seed % 4 === 0) {
          addBuilding(left + 16, top + 15, bw - 32, bh - 30, seed, 1);
        } else {
          const gap = 16;
          const split = bw * (seed % 2 ? .56 : .45);
          addBuilding(left + 9, top + 18, split - gap, bh * .58, seed + 1, seed % 3);
          addBuilding(left + split + 2, top + 11, bw - split - 11, bh * .43, seed + 2, (seed + 1) % 3);
          addBuilding(left + split + 4, top + bh * .56, bw - split - 14, bh * .36, seed + 3, (seed + 2) % 3);
        }
      }
    }
    for (let i = 0; i < 15; i++) {
      const x = 80 + (i % 5) * 590 + rand(-60, 60);
      const y = 75 + Math.floor(i / 5) * 640 + rand(-40, 40);
      if (!isOnRoad(x, y)) decorations.push({ x, y, w: 130, h: 70, kind: 'pool' });
    }
    // Parked rides and moving traffic share the street grid.
    for (let i = 0; i < 14; i++) {
      const vertical = i % 2 === 0;
      const lane = pick(vertical ? roadX : roadY);
      const position = vertical ? rand(120, H - 100) : rand(120, W - 100);
      const side = i % 4 < 2 ? -1 : 1;
      vehicles.push({ x: vertical ? lane + side * 42 : position, y: vertical ? position : lane + side * 37,
        angle: vertical ? Math.PI / 2 : 0, color: pick(colors), speed: 0, parked: true, type: 'civilian', length: 47, width: 23 });
    }
    for (let i = 0; i < 20; i++) {
      const vertical = i % 2 === 0;
      const lane = pick(vertical ? roadX : roadY);
      const position = vertical ? rand(100, H - 100) : rand(100, W - 100);
      const direction = i % 4 < 2 ? 1 : -1;
      vehicles.push({ x: vertical ? lane + direction * 13 : position, y: vertical ? position : lane + direction * 13,
        angle: vertical ? (direction > 0 ? Math.PI / 2 : -Math.PI / 2) : (direction > 0 ? 0 : Math.PI),
        color: pick(colors), speed: rand(45, 85), parked: false, type: 'civilian', length: 45, width: 22 });
    }
  }
  buildCity();
  vehicles.push({ x: 300, y: 252, angle: 0, color: '#e9b64f', speed: 0, parked: true, type: 'civilian', length: 47, width: 23 });

  function rectHit(x, y, radius = 0) {
    if (x < 103) return true;
    return buildings.some(b => {
      const nx = clamp(x, b.x, b.x + b.w), ny = clamp(y, b.y, b.y + b.h);
      return Math.hypot(x - nx, y - ny) < radius;
    });
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.roundRect(x, y, w, h, r);
  }

  function drawPalm(x, y, size, rotation = 0) {
    ctx.fillStyle = '#0003'; ctx.beginPath(); ctx.ellipse(x + size * .55, y + size * .3, size * .92, size * .42, -.35, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#795c3d'; ctx.lineWidth = Math.max(2, size * .16); ctx.beginPath(); ctx.moveTo(x, y + size * .25); ctx.lineTo(x + 2, y - size * .2); ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const a = rotation + i * Math.PI * 2 / 7;
      ctx.strokeStyle = i % 2 ? '#365d4b' : '#47735a'; ctx.lineWidth = Math.max(1.5, size * .13); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + 2, y - size * .2); ctx.quadraticCurveTo(x + Math.cos(a) * size * .42, y - size * .2 + Math.sin(a) * size * .25, x + Math.cos(a) * size, y - size * .2 + Math.sin(a) * size * .61); ctx.stroke();
    }
  }

  function drawCity() {
    ctx.fillStyle = '#88a88e'; ctx.fillRect(0, 0, W, H);
    // Soft checker of lawns and sandy vacant lots gives the neighborhoods a sun-bleached texture.
    for (let x = 0; x < W; x += 96) for (let y = 0; y < H; y += 96) {
      ctx.fillStyle = ((x / 96 + y / 96) % 2) ? '#88a98e' : '#8dad91'; ctx.fillRect(x, y, 96, 96);
    }
    for (const d of decorations) {
      if (d.kind === 'park') {
        ctx.fillStyle = '#618870'; ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeStyle = '#c9bd91'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(d.x + 18, d.y + d.h - 25); ctx.lineTo(d.x + d.w - 20, d.y + 20); ctx.stroke();
        for (let i = 0; i < 16; i++) drawPalm(d.x + rand(20, d.w - 20), d.y + rand(20, d.h - 20), rand(8, 14), i * .3);
      } else if (d.kind === 'pool') {
        ctx.fillStyle = '#d2c097'; ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.fillStyle = '#61bdb7'; ctx.fillRect(d.x + 7, d.y + 7, d.w - 14, d.h - 14);
        ctx.fillStyle = '#b5ded0'; ctx.fillRect(d.x + 12, d.y + 12, d.w - 26, 2);
      }
    }
    // A narrow Atlantic edge and a long strip of sand make the coastal grid legible.
    const sea = ctx.createLinearGradient(0, 0, 115, 0);
    sea.addColorStop(0, '#397f85'); sea.addColorStop(.62, '#56aaa0'); sea.addColorStop(1, '#83bd9c');
    ctx.fillStyle = sea; ctx.fillRect(0, 0, 110, H);
    ctx.fillStyle = '#d6c291'; ctx.fillRect(110, 0, 62, H);
    ctx.fillStyle = '#e4d5aa'; ctx.fillRect(110, 0, 5, H);
    ctx.strokeStyle = '#d6e3bb88'; ctx.lineWidth = 2;
    for (let y = 12; y < H; y += 44) {
      ctx.beginPath(); ctx.moveTo(12 + (y % 3) * 4, y); ctx.quadraticCurveTo(43, y - 4, 75, y + 1); ctx.stroke();
    }
    // Alleys and sidewalks under the buildings.
    for (const b of buildings) {
      ctx.fillStyle = '#c8b995'; ctx.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
      ctx.fillStyle = '#0003'; ctx.fillRect(b.x + 10, b.y + 12, b.w, b.h);
      ctx.fillStyle = b.base; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof; ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
      ctx.strokeStyle = '#f2e3bd88'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 7, b.y + 7, b.w - 14, b.h - 14);
      if (b.style === 1) {
        ctx.fillStyle = '#c3a171'; ctx.fillRect(b.x + b.w * .32, b.y + 6, b.w * .37, b.h - 12);
        ctx.fillStyle = '#6b8d88'; ctx.fillRect(b.x + b.w * .39, b.y + 12, b.w * .22, b.h * .28);
      } else {
        ctx.fillStyle = '#607f82'; ctx.fillRect(b.x + b.w * .14, b.y + b.h * .15, b.w * .29, b.h * .17);
        ctx.fillStyle = '#e4d09f'; ctx.fillRect(b.x + b.w * .57, b.y + b.h * .17, b.w * .25, 4);
        ctx.fillRect(b.x + b.w * .57, b.y + b.h * .26, b.w * .25, 4);
        if (b.w > 155) { ctx.fillStyle = '#7eaaa0'; ctx.fillRect(b.x + b.w * .2, b.y + b.h * .58, b.w * .58, b.h * .18); }
      }
      ctx.fillStyle = '#0002'; ctx.fillRect(b.x + 8, b.y + b.h - 7, b.w - 16, 2);
    }
    // The road ribbons are painted over block edges to form clean intersections.
    ctx.fillStyle = '#5b6261';
    for (const x of roadX) ctx.fillRect(x - ROAD_W / 2, 0, ROAD_W, H);
    for (const y of roadY) ctx.fillRect(0, y - ROAD_H / 2, W, ROAD_H);
    for (const x of roadX) {
      ctx.fillStyle = '#b5aa88'; ctx.fillRect(x - ROAD_W / 2, 0, 9, H); ctx.fillRect(x + ROAD_W / 2 - 9, 0, 9, H);
      ctx.fillStyle = '#777a70'; ctx.fillRect(x - ROAD_W / 2 + 9, 0, 3, H); ctx.fillRect(x + ROAD_W / 2 - 12, 0, 3, H);
      ctx.strokeStyle = '#c8bb80'; ctx.lineWidth = 2; ctx.setLineDash([17, 17]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#9b9a84'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 26, 0); ctx.lineTo(x - 26, H); ctx.moveTo(x + 26, 0); ctx.lineTo(x + 26, H); ctx.stroke();
    }
    for (const y of roadY) {
      ctx.fillStyle = '#b5aa88'; ctx.fillRect(0, y - ROAD_H / 2, W, 8); ctx.fillRect(0, y + ROAD_H / 2 - 8, W, 8);
      ctx.fillStyle = '#777a70'; ctx.fillRect(0, y - ROAD_H / 2 + 8, W, 3); ctx.fillRect(0, y + ROAD_H / 2 - 11, W, 3);
      ctx.strokeStyle = '#c8bb80'; ctx.lineWidth = 2; ctx.setLineDash([17, 17]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#9b9a84'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y - 24); ctx.lineTo(W, y - 24); ctx.moveTo(0, y + 24); ctx.lineTo(W, y + 24); ctx.stroke();
    }
    // Crosswalks at the busier corners.
    ctx.fillStyle = '#ddd6bd88';
    for (const x of roadX) for (const y of roadY) {
      for (let i = -4; i <= 4; i++) {
        ctx.fillRect(x - ROAD_W / 2 + 17 + i * 12, y - ROAD_H / 2 + 5, 7, 24);
        ctx.fillRect(x + ROAD_W / 2 - 26, y - ROAD_H / 2 + 16 + i * 12, 24, 7);
      }
    }
    for (const p of palms) drawPalm(p.x, p.y, p.size, p.angle);
    // Tiny pastel road-name plates lend the blocks a lived-in map feel.
    ctx.font = '8px "DM Mono", monospace'; ctx.textAlign = 'center';
    for (const x of roadX) for (const y of roadY) {
      ctx.fillStyle = '#e6dfc8'; ctx.fillRect(x - 60, y - 57, 48, 11);
      ctx.fillStyle = '#414b48'; ctx.fillText(x < 700 ? 'OCEAN DR' : x < 1700 ? 'COLLINS AVE' : 'BISCAYNE', x - 36, y - 49);
    }
  }

  function drawVehicle(v) {
    ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.angle);
    ctx.fillStyle = '#17212044'; roundRect(ctx, -v.length * .48 + 3, -v.width * .5 + 5, v.length, v.width, 6); ctx.fill();
    // Tires
    ctx.fillStyle = '#202725';
    ctx.fillRect(-v.length * .28, -v.width * .5 - 2, 10, 4); ctx.fillRect(v.length * .2, -v.width * .5 - 2, 10, 4);
    ctx.fillRect(-v.length * .28, v.width * .5 - 2, 10, 4); ctx.fillRect(v.length * .2, v.width * .5 - 2, 10, 4);
    const body = v.type === 'police' ? '#e9e7d7' : v.color;
    ctx.fillStyle = body; roundRect(ctx, -v.length / 2, -v.width / 2, v.length, v.width, 6); ctx.fill();
    ctx.fillStyle = v.type === 'police' ? '#526976' : '#273d48'; roundRect(ctx, -7, -v.width / 2 + 3, 17, v.width - 6, 4); ctx.fill();
    ctx.fillStyle = '#a7d5cc'; ctx.fillRect(-4, -v.width / 2 + 4, 7, v.width - 8);
    ctx.fillStyle = '#ffe6a3'; ctx.fillRect(v.length / 2 - 4, -v.width / 2 + 3, 3, 5); ctx.fillRect(v.length / 2 - 4, v.width / 2 - 8, 3, 5);
    ctx.fillStyle = '#e85d65'; ctx.fillRect(-v.length / 2 + 1, -v.width / 2 + 3, 3, 5); ctx.fillRect(-v.length / 2 + 1, v.width / 2 - 8, 3, 5);
    if (v.type === 'police') {
      const flash = Math.sin(performance.now() / 80) > 0;
      ctx.fillStyle = flash ? '#e74255' : '#4f9df0'; ctx.fillRect(-4, -v.width / 2 - 2, 5, 3);
      ctx.fillStyle = flash ? '#4f9df0' : '#e74255'; ctx.fillRect(1, -v.width / 2 - 2, 5, 3);
    }
    ctx.restore();
  }

  function drawPerson() {
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.angle);
    ctx.fillStyle = '#12201f55'; ctx.beginPath(); ctx.ellipse(2, 8, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0bd86'; ctx.beginPath(); ctx.arc(0, -5, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff0d5'; roundRect(ctx, -5, -2, 10, 12, 3); ctx.fill();
    ctx.fillStyle = '#ec6583'; ctx.fillRect(-5, 1, 10, 5);
    ctx.strokeStyle = '#293239'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-3, 9); ctx.lineTo(-4, 14); ctx.moveTo(3, 9); ctx.lineTo(4, 14); ctx.stroke();
    ctx.restore();
  }

  function drawMarker(point, color, label, t) {
    const pulse = 1 + Math.sin(t * 4) * .13;
    ctx.save(); ctx.translate(point.x, point.y);
    ctx.globalAlpha = .24; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 30 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 18 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#172024'; ctx.font = 'bold 9px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText(label, 0, -25 * pulse);
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, viewW, viewH);
    const focus = player.vehicle || player;
    camX = clamp(focus.x - viewW / 2, 0, W - viewW);
    camY = clamp(focus.y - viewH / 2, 0, H - viewH);
    ctx.save(); ctx.translate(-camX, -camY);
    drawCity();
    for (const v of vehicles) if (!v.parked || dist(v, focus) < Math.max(viewW, viewH)) drawVehicle(v);
    for (const cop of cops) drawVehicle(cop);
    drawMarker(job.phase === 'pickup' ? job.from : job.to, '#ff5e91', job.phase === 'pickup' ? 'PICKUP' : 'DROP', t);
    if (!player.vehicle) drawPerson();
    // A warm coastal haze softens the edge of the camera frame.
    const vignette = ctx.createRadialGradient(focus.x, focus.y, 120, focus.x, focus.y, Math.max(viewW, viewH) * .67);
    vignette.addColorStop(0, '#fff4d000'); vignette.addColorStop(1, '#16212547'); ctx.fillStyle = vignette;
    ctx.fillRect(camX, camY, viewW, viewH);
    ctx.restore();
    drawMinimap();
  }

  function drawMinimap() {
    const mw = mini.width, mh = mini.height;
    mctx.clearRect(0, 0, mw, mh); mctx.fillStyle = '#34544e'; mctx.fillRect(0, 0, mw, mh);
    for (let i = 0; i < 50; i++) {
      const x = (i * 67 + 23) % mw, y = (i * 41 + 11) % mh;
      mctx.fillStyle = i % 3 ? '#527360' : '#806f52'; mctx.fillRect(x, y, 6, 4);
    }
    mctx.fillStyle = '#79807a';
    for (const x of roadX) mctx.fillRect(x / W * mw - ROAD_W / W * mw / 2, 0, ROAD_W / W * mw, mh);
    for (const y of roadY) mctx.fillRect(0, y / H * mh - ROAD_H / H * mh / 2, mw, ROAD_H / H * mh);
    const target = job.phase === 'pickup' ? job.from : job.to;
    mctx.fillStyle = '#ff5e91'; mctx.beginPath(); mctx.arc(target.x / W * mw, target.y / H * mh, 3, 0, Math.PI * 2); mctx.fill();
    for (const cop of cops) { mctx.fillStyle = '#68aaf4'; mctx.fillRect(cop.x / W * mw - 1, cop.y / H * mh - 1, 3, 3); }
    const focus = player.vehicle || player;
    mctx.fillStyle = '#64f2d9'; mctx.beginPath(); mctx.arc(focus.x / W * mw, focus.y / H * mh, 3.2, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = '#d9fff2'; mctx.lineWidth = 1; mctx.stroke();
  }

  function announce(message) {
    const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
  }

  function updateHUD() {
    document.getElementById('cash').textContent = player.cash.toLocaleString('en-US');
    const stars = document.getElementById('stars');
    const count = Math.ceil(player.heat);
    stars.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < count ? 'lit' : ''}">${i < count ? '★' : '☆'}</span>`).join(' ');
    stars.setAttribute('aria-label', `${count} wanted stars`);
    document.getElementById('health-fill').style.width = `${player.health}%`;
    document.getElementById('health-value').textContent = Math.round(player.health);
    const target = job.phase === 'pickup' ? job.from : job.to;
    document.getElementById('mission-phase').textContent = job.phase === 'pickup' ? 'SIDE HUSTLE 01' : 'SIDE HUSTLE 01 / DELIVERY';
    document.getElementById('mission-title').textContent = job.phase === 'pickup' ? 'A little delivery' : 'Take it to the club';
    document.getElementById('mission-copy').textContent = job.phase === 'pickup' ? 'Collect the envelope at Ocean Drive. Drop it off before the sun goes down.' : 'The package is yours. Get it to the club in Little Havana and keep a low profile.';
    document.getElementById('mission-distance').textContent = `${Math.round(dist(player, target))} M TO ${job.phase === 'pickup' ? 'PICKUP' : 'DROP'}`;
    document.getElementById('mission-reward').textContent = `+$${job.reward}`;
    document.getElementById('mission-card').querySelector('.mission-live').textContent = job.phase === 'pickup' ? 'AVAILABLE' : 'IN PROGRESS';
    document.getElementById('district').textContent = player.x < 800 ? 'OCEAN DRIVE' : player.x < 1500 ? 'ARTS DISTRICT' : player.y > 1050 ? 'LITTLE HAVANA' : 'VICE POINT';
    const speed = player.vehicle ? Math.round(Math.abs(player.vehicle.speed) * .30) : 0;
    document.getElementById('speed').textContent = String(speed).padStart(2, '0');
    document.getElementById('needle').style.transform = `rotate(${-130 + Math.min(speed / 140, 1) * 260}deg)`;
    document.getElementById('vehicle-mode').textContent = player.vehicle ? 'COUPE' : 'ON FOOT';
    document.getElementById('gear').textContent = player.vehicle ? (player.vehicle.speed < -5 ? 'REV' : speed > 0 ? 'DRIVE' : 'IDLE') : 'WALK';
  }

  function tryEnterExit() {
    if (player.vehicle) {
      const v = player.vehicle;
      const side = v.angle + Math.PI / 2;
      const x = v.x + Math.cos(side) * 34, y = v.y + Math.sin(side) * 34;
      if (!rectHit(x, y, 12)) { player.x = x; player.y = y; }
      else { player.x = v.x - Math.cos(side) * 34; player.y = v.y - Math.sin(side) * 34; }
      player.angle = v.angle; player.vehicle = null; announce('OUT ON THE STREET. KEEP MOVING.');
    } else {
      let nearest = null, best = 62;
      for (const v of vehicles) { const d = dist(player, v); if (d < best) { nearest = v; best = d; } }
      if (nearest) { nearest.parked = false; player.vehicle = nearest; player.x = nearest.x; player.y = nearest.y; announce('NICE RIDE. MAKE IT COUNT.'); }
      else announce('NO RIDE CLOSE ENOUGH. WALK A LITTLE.');
    }
  }

  function spawnCop() {
    if (cops.length >= Math.ceil(player.heat) || cops.length >= 5) return;
    const angle = rand(0, Math.PI * 2), radius = Math.max(viewW, viewH) * .6;
    let x = clamp(player.x + Math.cos(angle) * radius, 35, W - 35);
    let y = clamp(player.y + Math.sin(angle) * radius, 35, H - 35);
    const vertical = Math.random() > .5, lane = pick(vertical ? roadX : roadY);
    if (vertical) x = lane + (Math.random() > .5 ? 13 : -13); else y = lane + (Math.random() > .5 ? 13 : -13);
    cops.push({ x, y, angle: Math.atan2(player.y - y, player.x - x), speed: 105, color: '#eee', parked: false, type: 'police', length: 48, width: 24 });
  }

  function move(dt) {
    if (paused) return;
    const up = keys.has('w') || keys.has('arrowup'), down = keys.has('s') || keys.has('arrowdown');
    const left = keys.has('a') || keys.has('arrowleft'), right = keys.has('d') || keys.has('arrowright');
    const handbrake = keys.has(' ');
    if (player.vehicle) {
      const v = player.vehicle;
      const throttle = (up ? 1 : 0) - (down ? 1 : 0);
      v.speed += throttle * 410 * dt;
      v.speed *= Math.pow(handbrake ? .88 : .986, dt * 60);
      v.speed = clamp(v.speed, -170, 460);
      if (handbrake) v.speed *= Math.pow(.91, dt * 60);
      const steer = (right ? 1 : 0) - (left ? 1 : 0);
      v.angle += steer * (v.speed >= 0 ? 1 : -1) * Math.min(Math.abs(v.speed) / 80, 1) * 2.3 * dt;
      const nx = clamp(v.x + Math.cos(v.angle) * v.speed * dt, 12, W - 12);
      const ny = clamp(v.y + Math.sin(v.angle) * v.speed * dt, 12, H - 12);
      if (rectHit(nx, ny, 17)) {
        if (Math.abs(v.speed) > 125 && player.collisionCooldown <= 0) {
          player.heat = clamp(player.heat + 1, 0, 5); player.health = Math.max(25, player.health - Math.min(12, Math.abs(v.speed) * .018));
          player.collisionCooldown = 1.8;
          announce('YOU CLIPPED A BUILDING. THE COPS NOTICED.');
        }
        v.speed *= -.22;
      } else { v.x = nx; v.y = ny; }
      player.x = v.x; player.y = v.y;
    } else {
      let dx = (right ? 1 : 0) - (left ? 1 : 0), dy = (down ? 1 : 0) - (up ? 1 : 0);
      const mag = Math.hypot(dx, dy) || 1; dx /= mag; dy /= mag;
      const nx = clamp(player.x + dx * 178 * dt, 8, W - 8), ny = clamp(player.y + dy * 178 * dt, 8, H - 8);
      if (!rectHit(nx, player.y, 12)) player.x = nx;
      if (!rectHit(player.x, ny, 12)) player.y = ny;
      if (dx || dy) player.angle = Math.atan2(dy, dx) + Math.PI / 2;
    }
    for (const v of vehicles) {
      if (v.parked || v === player.vehicle) continue;
      v.x += Math.cos(v.angle) * v.speed * dt; v.y += Math.sin(v.angle) * v.speed * dt;
      const margin = 90;
      if (v.x < -margin || v.x > W + margin || v.y < -margin || v.y > H + margin) {
        if (Math.abs(Math.cos(v.angle)) > .5) { v.x = v.x < 0 ? W : 0; v.y = pick(roadY) + rand(-17, 17); }
        else { v.y = v.y < 0 ? H : 0; v.x = pick(roadX) + rand(-17, 17); }
      }
    }
    while (cops.length < Math.ceil(player.heat) && player.heat >= .3) spawnCop();
    for (let i = cops.length - 1; i >= 0; i--) {
      const cop = cops[i];
      const focus = player.vehicle || player;
      const wantedAngle = Math.atan2(focus.y - cop.y, focus.x - cop.x);
      let diff = ((wantedAngle - cop.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cop.angle += clamp(diff, -1.2 * dt, 1.2 * dt);
      cop.speed = Math.min(155 + player.heat * 17, cop.speed + 18 * dt);
      const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt, ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
      if (!rectHit(nx, ny, 15)) { cop.x = nx; cop.y = ny; } else { cop.angle += Math.PI * .68; }
      if (dist(cop, focus) < 30 && player.hitCooldown <= 0) {
        player.health = Math.max(0, player.health - 12); player.hitCooldown = 1.3; announce('WATCH YOUR BACK!');
      }
      if (player.heat <= .02 && dist(cop, focus) > 450) cops.splice(i, 1);
    }
    player.hitCooldown = Math.max(0, player.hitCooldown - dt);
    player.collisionCooldown = Math.max(0, player.collisionCooldown - dt);
    if (player.heat > 0) player.heat = Math.max(0, player.heat - dt * .035);
    if (player.health <= 0) { player.health = 100; player.heat = 0; player.cash = Math.max(0, player.cash - 100); cops.length = 0; announce('ROUGH NIGHT. YOU LOST $100 AND GOT BACK UP.'); }
    const target = job.phase === 'pickup' ? job.from : job.to;
    if (dist(player, target) < 46) {
      if (job.phase === 'pickup') { job.phase = 'drop'; announce('ENVELOPE SECURED. NOW GET IT TO LITTLE HAVANA.'); }
      else {
        const stops = [
          { x: 315, y: 1155, name: 'Ocean Drive' }, { x: 895, y: 1630, name: 'Downtown' },
          { x: 2080, y: 260, name: 'Vice Point' }, { x: 1480, y: 690, name: 'Arts District' },
          { x: 325, y: 1660, name: 'South Beach' }, { x: 2080, y: 1140, name: 'Little Havana' }
        ];
        player.cash += job.reward; player.heat = Math.max(0, player.heat - .6); job.phase = 'pickup';
        job.from = pick(stops); job.to = pick(stops.filter(stop => stop !== job.from));
        announce(`DELIVERY COMPLETE. +$${job.reward} CASH.`);
      }
    }
    updateHUD();
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000 || 0, .04); lastTime = now;
    move(dt); draw(now / 1000); requestAnimationFrame(frame);
  }
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
    if (!keys.has(key) && key === 'p') { paused = !paused; document.getElementById('pause-overlay').hidden = !paused; }
    if (!paused && !keys.has(key) && key === 'e') tryEnterExit();
    keys.add(key);
  });
  document.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  document.getElementById('restart').addEventListener('click', () => location.reload());
  resize(); updateHUD(); requestAnimationFrame(frame);
})();
