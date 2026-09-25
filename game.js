(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const el = {
    hud: document.getElementById("hud"),
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    combo: document.getElementById("combo"),
    comboWrap: document.getElementById("comboWrap"),
    hint: document.getElementById("hint"),
    menu: document.getElementById("menu"),
    gameover: document.getElementById("gameover"),
    startBtn: document.getElementById("startBtn"),
    restartBtn: document.getElementById("restartBtn"),
    continueBtn: document.getElementById("continueBtn"),
    menuBtn: document.getElementById("menuBtn"),
    menuContinueBtn: document.getElementById("menuContinueBtn"),
    menuBest: document.getElementById("menuBest"),
    finalScore: document.getElementById("finalScore"),
    finalCombo: document.getElementById("finalCombo"),
    finalBest: document.getElementById("finalBest"),
    newRecord: document.getElementById("newRecord"),
    health: document.getElementById("health"),
    sceneName: document.getElementById("sceneName"),
    checkLabel: document.getElementById("checkLabel"),
    banner: document.getElementById("banner"),
    pads: document.getElementById("pads"),
    slidePad: document.getElementById("slidePad"),
    jumpPad: document.getElementById("jumpPad"),
  };

  const STORAGE_KEY = "corredor-infinito-best";
  const CHECK_KEY = "corredor-infinito-check";
  const MAX_HP = 3;
  const CYCLE = 3600;

  const WORLD = {
    groundY: 0,
    gravity: 2350,
    jumpVel: -800,
    slideDuration: 0.48,
    baseSpeed: 400,
    maxSpeed: 900,
  };

  const PAL = {
    day: {
      sky0: [135, 196, 255],
      sky1: [255, 214, 170],
      sky2: [255, 176, 120],
      sun: [255, 220, 120],
      ground: [214, 168, 112],
      groundDark: [176, 122, 74],
      line: [255, 236, 190],
      build0: [232, 196, 150],
      build1: [210, 164, 122],
      build2: [186, 132, 96],
      haze: [255, 200, 140],
    },
    night: {
      sky0: [12, 8, 28],
      sky1: [28, 16, 56],
      sky2: [18, 10, 28],
      sun: [255, 232, 196],
      ground: [28, 16, 22],
      groundDark: [16, 8, 12],
      line: [255, 110, 48],
      build0: [22, 16, 44],
      build1: [30, 20, 56],
      build2: [40, 24, 68],
      haze: [255, 90, 40],
    },
  };

  const state = {
    mode: "menu",
    w: 800,
    h: 450,
    dpr: 1,
    t: 0,
    distance: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    best: Number(localStorage.getItem(STORAGE_KEY) || 0),
    speed: WORLD.baseSpeed,
    boost: 0,
    shake: 0,
    density: 0,
    objects: [],
    particles: [],
    floating: [],
    planes: [],
    lavaDrops: [],
    bgStars: [],
    buildings: [],
    mountains: [],
    player: null,
    pointer: { down: false, startY: 0, startX: 0, id: null, role: null },
    pointers: new Map(),
    slideHeld: false,
    keySlide: false,
    touch: false,
    padH: 0,
    hintTimer: 0,
    deathT: 0,
    hp: MAX_HP,
    invuln: 0,
    night: 0,
    sceneId: "day",
    bannerT: 0,
    lastPhase: "",
    checkpoint: null,
    nextSpecialAt: 900,
    spawnCursor: 0,
    comboPulse: 0,
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerp3(a, b, t) {
    return [
      (a[0] + (b[0] - a[0]) * t) | 0,
      (a[1] + (b[1] - a[1]) * t) | 0,
      (a[2] + (b[2] - a[2]) * t) | 0,
    ];
  }
  function rgb(c, a) {
    return a == null ? "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"
      : "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function refreshMenuContinue() {
    if (!el.menuContinueBtn) return;
    if (state.checkpoint) {
      el.menuContinueBtn.classList.remove("hidden");
      el.menuContinueBtn.textContent = "Continuar desde " + Math.floor(state.checkpoint.distance);
    } else {
      el.menuContinueBtn.classList.add("hidden");
    }
  }

  function loadBest() {
    el.best.textContent = String(state.best);
    el.menuBest.textContent = String(state.best);
    refreshMenuContinue();
  }

  function saveBest(score) {
    if (score > state.best) {
      state.best = score;
      localStorage.setItem(STORAGE_KEY, String(score));
      loadBest();
      return true;
    }
    return false;
  }

  function persistCheckpoint(cp) {
    try { localStorage.setItem(CHECK_KEY, JSON.stringify(cp)); } catch (_) {}
  }

  function readSavedCheckpoint() {
    try {
      const raw = localStorage.getItem(CHECK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function sceneFromDistance(dist) {
    const u = ((dist % CYCLE) + CYCLE) % CYCLE / CYCLE;
    let night, phase;
    if (u < 0.32) { night = 0; phase = "day"; }
    else if (u < 0.48) { night = (u - 0.32) / 0.16; phase = "dusk"; }
    else if (u < 0.82) { night = 1; phase = "night"; }
    else { night = 1 - (u - 0.82) / 0.18; phase = "dawn"; }
    return { u, night: clamp(night, 0, 1), phase };
  }

  function isTouchDevice() {
    return window.matchMedia("(pointer: coarse)").matches
      || "ontouchstart" in window
      || (navigator.maxTouchPoints || 0) > 0;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vv = window.visualViewport;
    state.dpr = dpr;
    state.touch = isTouchDevice() || window.innerWidth <= 900;
    state.w = Math.max(1, (vv && vv.width) || window.innerWidth);
    state.h = Math.max(1, (vv && vv.height) || window.innerHeight);
    canvas.width = (state.w * dpr) | 0;
    canvas.height = (state.h * dpr) | 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.padH = state.touch ? Math.round(Math.min(128, Math.max(96, state.h * 0.16))) : 18;
    WORLD.groundY = Math.max(180, (state.h - state.padH - 8) | 0);
    if (state.w < 520) {
      WORLD.baseSpeed = 360;
      WORLD.maxSpeed = 820;
      WORLD.jumpVel = -840;
    } else {
      WORLD.baseSpeed = 400;
      WORLD.maxSpeed = 900;
      WORLD.jumpVel = -800;
    }
    seedDecor();
    if (state.player && state.player.onGround) {
      const h = state.player.sliding ? state.player.slideH : state.player.runH;
      state.player.y = WORLD.groundY - h;
      state.player.x = Math.min(140, Math.max(56, state.w * 0.16));
    }
  }

  function seedDecor() {
    state.bgStars = Array.from({ length: 56 }, () => ({
      x: Math.random() * state.w,
      y: Math.random() * WORLD.groundY * 0.72,
      r: rand(0.6, 2),
      a: rand(0.2, 0.8),
    }));
    state.buildings = Array.from({ length: 14 }, (_, i) => ({
      x: i * 180 + rand(-16, 30),
      w: rand(56, 120),
      d: rand(18, 36),
      h: rand(70, 210),
      layer: i % 3,
    }));
    state.mountains = Array.from({ length: 8 }, (_, i) => ({
      x: i * 240 + rand(-20, 40),
      w: rand(160, 280),
      h: rand(70, 150),
    }));
  }

  function makePlayer() {
    return {
      x: Math.min(140, Math.max(56, state.w * 0.16)),
      y: 0,
      w: 42,
      runH: 62,
      slideH: 28,
      vy: 0,
      onGround: true,
      sliding: false,
      slideT: 0,
      squash: 1,
      stretch: 1,
      runPhase: 0,
      trail: [],
      hitFlash: 0,
      facingTilt: 0,
    };
  }

  function clearWorld() {
    state.objects.length = 0;
    state.particles.length = 0;
    state.floating.length = 0;
    state.planes.length = 0;
    state.lavaDrops.length = 0;
    state.spawnCursor = state.w + 280;
  }

  function resetFull() {
    state.distance = 0;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.speed = WORLD.baseSpeed;
    state.boost = 0;
    state.shake = 0;
    state.density = 0;
    state.hp = MAX_HP;
    state.invuln = 0;
    state.checkpoint = null;
    state.nextSpecialAt = 800;
    state.lastPhase = "";
    state.bannerT = 0;
    state.player = makePlayer();
    state.player.y = WORLD.groundY - state.player.runH;
    state.slideHeld = false;
    state.hintTimer = 6;
    state.deathT = 0;
    clearWorld();
    spawnWarmup();
    updateHud();
  }

  function applyCheckpoint(cp) {
    state.distance = cp.distance;
    state.score = cp.score;
    state.combo = 0;
    state.maxCombo = cp.maxCombo || 0;
    state.speed = Math.max(WORLD.baseSpeed, cp.speed || WORLD.baseSpeed);
    state.boost = 0;
    state.shake = 0;
    state.hp = MAX_HP;
    state.invuln = 1.1;
    state.checkpoint = { ...cp };
    state.nextSpecialAt = state.distance + 900;
    state.lastPhase = "";
    state.bannerT = 0;
    state.player = makePlayer();
    state.player.y = WORLD.groundY - state.player.runH;
    state.slideHeld = false;
    state.hintTimer = 3;
    state.deathT = 0;
    clearWorld();
    spawnWarmup();
    showBanner("PUNTO DE CONTROL");
    updateHud();
  }

  function spawnWarmup() {
    const base = state.w + 240;
    pushObj({ type: "low", x: base, w: 36, h: 36 });
    pushObj({ type: "high", x: base + 420, w: 50, h: 76 });
    pushObj({ type: "drink", x: base + 700, w: 22, h: 34 });
    pushObj({ type: "ramp", x: base + 980, w: 86, h: 12 });
    state.spawnCursor = base + 1300;
  }

  function startPlay(fromCheck) {
    if (fromCheck && state.checkpoint) applyCheckpoint(state.checkpoint);
    else resetFull();
    state.mode = "play";
    state.pointers.clear();
    state.slideHeld = false;
    el.menu.classList.add("hidden");
    el.gameover.classList.add("hidden");
    el.hud.classList.remove("hidden");
    el.hint.classList.remove("hidden");
    if (el.pads) el.pads.classList.remove("hidden");
  }

  function endGame() {
    if (state.mode !== "play") return;
    state.mode = "dead";
    state.deathT = 0;
    const p = state.player;
    p.vy = -260;
    p.hitFlash = 1;
    p.sliding = false;
    state.shake = 14;
    burst(p.x + 20, p.y + 20, 22, "#ff4d8d");
    const isRecord = saveBest(Math.floor(state.score));
    el.finalScore.textContent = String(Math.floor(state.score));
    el.finalCombo.textContent = "x" + state.maxCombo;
    el.finalBest.textContent = String(state.best);
    el.newRecord.classList.toggle("hidden", !isRecord);
    el.continueBtn.disabled = !state.checkpoint;
    el.continueBtn.textContent = state.checkpoint
      ? "Continuar desde el punto"
      : "Sin punto de control";
    setTimeout(() => {
      if (state.mode === "dead") {
        el.gameover.classList.remove("hidden");
        el.hint.classList.add("hidden");
        if (el.pads) el.pads.classList.add("hidden");
      }
    }, 480);
  }

  function hurt(amount) {
    if (state.mode !== "play" || state.invuln > 0) return;
    state.hp -= amount || 1;
    state.invuln = 1.05;
    state.shake = 10;
    state.combo = 0;
    const p = state.player;
    p.hitFlash = 1;
    puff(p.x + 16, p.y + 20, 8, "#ff4d8d");
    tone(160, 0.08, "sawtooth");
    if (state.hp <= 0) {
      state.hp = 0;
      endGame();
    }
    updateHud();
  }

  function heal(n) {
    const before = state.hp;
    state.hp = clamp(state.hp + n, 0, MAX_HP);
    if (state.hp > before) {
      floatText(state.player.x + 8, state.player.y - 12, "+VIDA");
      tone(660, 0.08, "triangle");
    } else {
      state.score += 80;
      floatText(state.player.x + 8, state.player.y - 12, "+80");
      tone(520, 0.06, "triangle");
    }
    updateHud();
  }

  function saveCheckpointNow() {
    const cp = {
      distance: Math.floor(state.distance),
      score: Math.floor(state.score),
      speed: state.speed,
      maxCombo: state.maxCombo,
    };
    state.checkpoint = cp;
    persistCheckpoint(cp);
    refreshMenuContinue();
    showBanner("PUNTO GUARDADO");
    floatText(state.player.x + 6, state.player.y - 18, "CHECK");
    tone(480, 0.09, "square");
    updateHud();
  }

  function showBanner(text) {
    el.banner.textContent = text;
    el.banner.classList.remove("hidden");
    state.bannerT = 2.2;
  }

  function updateHud() {
    el.score.textContent = String(Math.floor(state.score));
    el.best.textContent = String(state.best);
    el.health.textContent = "♥".repeat(state.hp) + "♡".repeat(MAX_HP - state.hp);
    const names = { day: "Día", dusk: "Atardecer", night: "Noche de lava", dawn: "Amanecer" };
    el.sceneName.textContent = names[state.sceneId] || "Día";
    el.checkLabel.textContent = state.checkpoint
      ? "Punto " + Math.floor(state.checkpoint.distance)
      : "Sin punto de control";
    if (state.combo >= 2) {
      el.comboWrap.classList.remove("hidden");
      el.combo.textContent = "x" + state.combo;
    } else {
      el.comboWrap.classList.add("hidden");
    }
  }

  function playerBox(p) {
    const h = p.sliding ? p.slideH : p.runH;
    const y = p.sliding ? WORLD.groundY - h : p.y;
    return { x: p.x + 12, y: y + 8, w: p.w - 24, h: h - 12 };
  }

  function jump() {
    const p = state.player;
    if (!p || state.mode !== "play") return;
    if (p.sliding) endSlide(p);
    if (!p.onGround) return;
    p.onGround = false;
    p.sliding = false;
    p.slideT = 0;
    p.vy = WORLD.jumpVel;
    p.squash = 0.74;
    p.stretch = 1.26;
    puff(p.x + 20, WORLD.groundY, 6, "#9affe0");
    tone(520, 0.06, "triangle");
  }

  function startSlide() {
    const p = state.player;
    if (!p || state.mode !== "play" || !p.onGround) return;
    if (p.sliding) {
      p.slideT = WORLD.slideDuration;
      return;
    }
    p.sliding = true;
    p.slideT = WORLD.slideDuration;
    p.vy = 0;
    p.y = WORLD.groundY - p.slideH;
    p.squash = 1.22;
    p.stretch = 0.78;
    puff(p.x + 20, WORLD.groundY, 4, "#7d9bff");
    tone(190, 0.05, "sine");
  }

  function endSlide(p) {
    if (!p.sliding) return;
    p.sliding = false;
    p.slideT = 0;
    if (p.onGround) {
      p.vy = 0;
      p.y = WORLD.groundY - p.runH;
    }
    p.squash = 0.9;
    p.stretch = 1.1;
  }

  function pushObj(o) {
    o.scored = false;
    o.used = false;
    o.dist = Math.floor(state.distance);
    o.phase = rand(0, Math.PI * 2);
    o.hue = o.hue == null ? pickHue(o.type) : o.hue;
    if (o.type === "low") {
      o.y = WORLD.groundY - o.h;
      o.hurt = true;
    } else if (o.type === "high") {
      o.y = WORLD.groundY - 118;
      o.h = 86;
      o.hurt = true;
    } else if (o.type === "ramp") {
      o.y = WORLD.groundY - o.h;
    } else if (o.type === "drink") {
      o.y = WORLD.groundY - 78;
    } else if (o.type === "check") {
      o.y = WORLD.groundY - 96;
      o.w = 28;
      o.h = 96;
    } else if (o.type === "lava") {
      o.y = WORLD.groundY - 8;
      o.h = 18;
      o.hurt = true;
    }
    state.objects.push(o);
  }

  function pickHue(type) {
    if (type === "low") return [332, 18, 48, 8][Math.random() * 4 | 0];
    if (type === "high") return [222, 195, 268, 250][Math.random() * 4 | 0];
    if (type === "ramp") return 46;
    if (type === "drink") return 162;
    if (type === "check") return 48;
    if (type === "lava") return 18;
    return 200;
  }

  function hsl(h, s, l, a) {
    return a == null
      ? "hsl(" + h + "," + s + "%," + l + "%)"
      : "hsla(" + h + "," + s + "%," + l + "%," + a + ")";
  }

  function pickPattern() {
    const d = state.density;
    const r = Math.random();
    if (d < 0.2) return r < 0.55 ? ["low"] : ["high"];
    if (r < 0.34) return ["low"];
    if (r < 0.62) return ["high"];
    if (r < 0.82) return ["low", "high"];
    return ["high", "low"];
  }

  function maybeSpawn() {
    if (state.spawnCursor > state.w + 920) return;
    state.density = clamp(state.distance / 6400, 0, 1);
    const night = state.night;
    const minGap = lerp(460, 280, state.density);
    const maxGap = lerp(720, 430, state.density);
    const gap = rand(minGap, maxGap);
    const x = state.spawnCursor + gap;

    if (state.distance > state.nextSpecialAt) {
      state.nextSpecialAt = state.distance + rand(800, 1300);
      const roll = Math.random();
      if (roll < 0.45) pushObj({ type: "check", x, w: 28, h: 96 });
      else pushObj({ type: "drink", x, w: 24, h: 36 });
      if (Math.random() < 0.45) spawnPattern(x + rand(300, 420));
      state.spawnCursor = x + 480;
      return;
    }

    if (night > 0.55 && Math.random() < 0.2 + night * 0.1) {
      pushObj({ type: "lava", x, w: rand(64, 96), h: 18 });
      state.spawnCursor = x + 340;
      return;
    }

    if (Math.random() < 0.14) {
      pushObj({ type: "ramp", x, w: 90, h: 14 });
      state.spawnCursor = x + 300;
      return;
    }

    if (Math.random() < 0.12) {
      pushObj({ type: "drink", x, w: 24, h: 36 });
      state.spawnCursor = x + 280;
      return;
    }

    spawnPattern(x);
    state.spawnCursor = x + 300;
  }

  function spawnPattern(x) {
    const kinds = pickPattern();
    kinds.forEach((kind, i) => {
      const ox = x + i * 170;
      if (kind === "low") pushObj({ type: "low", x: ox, w: 44, h: 42 });
      else pushObj({ type: "high", x: ox, w: 56, h: 76 });
    });
  }

  function spawnPlanes(kind) {
    if (state.planes.length > 4) return;
    const dir = kind === "dawn" ? 1 : -1;
    const y = rand(state.h * 0.1, state.h * 0.32);
    state.planes.push({
      x: dir < 0 ? state.w + 40 : -80,
      y,
      vx: dir * rand(140, 220),
      scale: rand(0.8, 1.25),
      z: rand(0.7, 1.2),
    });
  }

  function addCombo(pointsBase) {
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    const bonus = (pointsBase || 20) * state.combo;
    state.score += bonus;
    floatText(state.player.x + 16, state.player.y - 8, "+" + bonus);
    if (state.combo >= 2) {
      el.comboWrap.classList.remove("hidden");
      el.combo.textContent = "x" + state.combo;
    }
    tone(360 + Math.min(state.combo, 10) * 36, 0.045, "square");
  }

  function puff(x, y, n, color) {
    const room = 70 - state.particles.length;
    const count = Math.min(n, Math.max(0, room));
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x, y,
        vx: rand(-80, 80),
        vy: rand(-200, -20),
        life: rand(0.22, 0.5),
        max: 0.5,
        r: rand(2, 4.5),
        color,
      });
    }
  }

  function burst(x, y, n, color) {
    const room = 80 - state.particles.length;
    const count = Math.min(n, Math.max(0, room));
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(70, 360);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.7),
        max: 0.7,
        r: rand(2, 5),
        color,
      });
    }
  }

  function floatText(x, y, text) {
    if (state.floating.length > 8) state.floating.shift();
    state.floating.push({ x, y, text, life: 0.75, vy: -64 });
  }

  let actx;
  function tone(freq, dur, type) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.value = 0.035;
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (_) {}
  }

  function update(dt) {
    dt = dt > 0.033 ? 0.033 : dt < 0 ? 0 : dt;
    state.t += dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 40);
    if (state.bannerT > 0) {
      state.bannerT -= dt;
      if (state.bannerT <= 0) el.banner.classList.add("hidden");
    }

    const sc = sceneFromDistance(state.mode === "menu" ? state.t * 90 : state.distance);
    state.night = sc.night;
    state.sceneId = sc.phase;
    if (sc.phase !== state.lastPhase) {
      if (state.mode === "play") {
        if (sc.phase === "dusk") showBanner("ATARDECER");
        if (sc.phase === "night") showBanner("NOCHE DE LAVA");
        if (sc.phase === "dawn") showBanner("AMANECER");
        if (sc.phase === "day") showBanner("DÍA");
      }
      state.lastPhase = sc.phase;
    }
    if ((sc.phase === "dusk" || sc.phase === "dawn") && Math.random() < dt * 1.6) {
      spawnPlanes(sc.phase);
    }

    if (state.mode === "menu") {
      draw();
      return;
    }

    const p = state.player;
    const playing = state.mode === "play";

    if (playing) {
      state.boost = Math.max(0, state.boost - dt);
      const target = WORLD.baseSpeed + state.distance * 0.028 + state.boost * 220;
      state.speed += (clamp(target, WORLD.baseSpeed, WORLD.maxSpeed) - state.speed) * Math.min(1, dt * 1.8);
      const dx = state.speed * dt;
      state.distance += dx;
      state.score += (state.speed * 0.032 + state.combo) * dt;
      state.spawnCursor -= dx;
      state.invuln = Math.max(0, state.invuln - dt);
      maybeSpawn();
      if (state.hintTimer > 0) {
        state.hintTimer -= dt;
        if (state.hintTimer <= 0) el.hint.classList.add("hidden");
      }
    }

    if (!p.onGround || state.mode === "dead") {
      p.vy += WORLD.gravity * dt;
      p.y += p.vy * dt;
    }

    const standH = p.sliding ? p.slideH : p.runH;
    const ground = WORLD.groundY - standH;
    if (p.y >= ground && state.mode !== "dead") {
      const wasAir = !p.onGround;
      p.y = ground;
      p.vy = 0;
      p.onGround = true;
      if (wasAir) {
        p.squash = 1.2;
        p.stretch = 0.8;
        puff(p.x + 18, WORLD.groundY, 7, "rgba(255,255,255,0.65)");
        tone(130, 0.03, "sine");
        if (state.slideHeld) startSlide();
      }
    }

    if (state.mode === "dead") {
      state.deathT += dt;
      p.facingTilt = Math.min(0.9, state.deathT * 1.8);
      if (p.y > WORLD.groundY + 90) p.y = WORLD.groundY + 90;
    }

    if (p.sliding && playing) {
      if (state.slideHeld) p.slideT = 0.16;
      p.slideT -= dt;
      if (p.slideT <= 0) endSlide(p);
      else p.y = WORLD.groundY - p.slideH;
    }

    p.squash += (1 - p.squash) * Math.min(1, dt * 10);
    p.stretch += (1 - p.stretch) * Math.min(1, dt * 10);
    p.hitFlash = Math.max(0, p.hitFlash - dt * 3);
    p.runPhase += dt * (state.speed / 44);
    if (playing) {
      p.trail.push({ x: p.x, y: p.sliding ? WORLD.groundY - p.slideH : p.y, h: standH });
      if (p.trail.length > 6) p.trail.shift();
    }

    const hit = playerBox(p);
    for (let i = 0; i < state.objects.length; i++) {
      const o = state.objects[i];
      if (playing) o.x -= state.speed * dt;

      if (playing && !o.scored && o.x + o.w < p.x) {
        o.scored = true;
        if (o.hurt) addCombo(o.type === "lava" ? 30 : 22);
      }

      if (!playing || o.used) continue;
      if (!aabb(hit, o)) continue;

      if (o.type === "ramp") {
        o.used = true;
        o.scored = true;
        state.boost = 1;
        state.speed = Math.min(WORLD.maxSpeed, state.speed + 140);
        puff(o.x + 40, o.y, 10, "#ffd166");
        floatText(p.x + 8, p.y - 16, "BOOST");
        tone(640, 0.08, "sawtooth");
      } else if (o.type === "drink") {
        o.used = true;
        o.scored = true;
        heal(1);
        puff(o.x + 8, o.y + 8, 10, "#7dffd2");
      } else if (o.type === "check") {
        o.used = true;
        o.scored = true;
        saveCheckpointNow();
        puff(o.x + 8, o.y + 20, 12, "#ffd166");
      } else if (o.hurt) {
        o.used = true;
        hurt(1);
      }
    }

    if (state.objects.length > 40) {
      state.objects = state.objects.filter((o) => o.x + o.w > -90);
    } else {
      for (let i = state.objects.length - 1; i >= 0; i--) {
        if (state.objects[i].x + state.objects[i].w < -90) state.objects.splice(i, 1);
      }
    }

    for (const q of state.particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 500 * dt;
    }
    if (state.t % 0.2 < dt) state.particles = state.particles.filter((q) => q.life > 0);
    else if (state.particles.length > 80) state.particles.splice(0, state.particles.length - 60);

    for (const f of state.floating) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    if (state.floating.length) state.floating = state.floating.filter((f) => f.life > 0);

    for (const pl of state.planes) {
      pl.x += pl.vx * dt;
    }
    if (state.planes.length) {
      state.planes = state.planes.filter((pl) => pl.x > -140 && pl.x < state.w + 140);
    }

    if (state.night > 0.35 && playing && Math.random() < dt * 8) {
      state.lavaDrops.push({
        x: rand(0, state.w),
        y: WORLD.groundY + rand(8, 40),
        r: rand(2, 5),
        life: rand(0.3, 0.7),
      });
    }
    for (const d of state.lavaDrops) d.life -= dt;
    if (state.lavaDrops.length > 24) state.lavaDrops.splice(0, state.lavaDrops.length - 16);

    if ((state.t * 8 | 0) !== ((state.t - dt) * 8 | 0)) updateHud();
    draw();
  }

  function palette() {
    const t = state.night;
    const A = PAL.day, B = PAL.night;
    return {
      sky0: lerp3(A.sky0, B.sky0, t),
      sky1: lerp3(A.sky1, B.sky1, t),
      sky2: lerp3(A.sky2, B.sky2, t),
      sun: lerp3(A.sun, B.sun, t),
      ground: lerp3(A.ground, B.ground, t),
      groundDark: lerp3(A.groundDark, B.groundDark, t),
      line: lerp3(A.line, B.line, t),
      build0: lerp3(A.build0, B.build0, t),
      build1: lerp3(A.build1, B.build1, t),
      build2: lerp3(A.build2, B.build2, t),
      haze: lerp3(A.haze, B.haze, t),
    };
  }

  function draw() {
    const w = state.w, h = state.h, gy = WORLD.groundY;
    const pal = palette();
    const scroll = state.mode === "menu" ? state.t * 70 : state.distance;

    ctx.save();
    if (state.shake > 0.4) {
      ctx.translate(((Math.random() - 0.5) * state.shake) | 0, ((Math.random() - 0.5) * state.shake) | 0);
    }

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, rgb(pal.sky0));
    sky.addColorStop(0.55, rgb(pal.sky1));
    sky.addColorStop(1, rgb(pal.sky2));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    drawCelestial(w, h, pal);
    drawStars(w, scroll);
    drawMountains(gy, pal, scroll);
    drawCity(gy, pal, scroll);
    drawPlanes();
    drawGround(w, h, gy, pal, scroll);
    for (const o of state.objects) drawObject(o);
    drawParticles();
    if (state.player) drawPlayer(state.player, gy);
    drawFloats();

    ctx.restore();
  }

  function drawCelestial(w, h, pal) {
    const daySun = 1 - state.night;
    const sx = w * (0.78 - state.night * 0.08);
    const sy = h * (0.16 + (1 - daySun) * 0.04);
    if (daySun > 0.05) {
      ctx.fillStyle = rgb(pal.sun, 0.18 * daySun);
      ctx.beginPath(); ctx.arc(sx, sy, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb([255, 230, 140], daySun);
      ctx.beginPath(); ctx.arc(sx, sy, 28, 0, Math.PI * 2); ctx.fill();
    }
    if (state.night > 0.15) {
      ctx.fillStyle = rgb([255, 236, 210], state.night);
      ctx.beginPath(); ctx.arc(w * 0.18, h * 0.14, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(pal.sky0, state.night);
      ctx.beginPath(); ctx.arc(w * 0.18 + 8, h * 0.12, 18, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawStars(w, scroll) {
    if (state.night < 0.12) return;
    ctx.fillStyle = "#fff";
    for (const s of state.bgStars) {
      const x = ((s.x - scroll * 0.05) % (w + 20) + (w + 20)) % (w + 20) - 10;
      ctx.globalAlpha = s.a * state.night;
      ctx.fillRect(x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawMountains(gy, pal, scroll) {
    ctx.fillStyle = rgb(lerp3(pal.sky2, pal.build2, 0.45));
    for (const m of state.mountains) {
      const x = ((m.x - scroll * 0.12) % (8 * 240) + 8 * 240) % (8 * 240) - 80;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + m.w * 0.5, gy - m.h);
      ctx.lineTo(x + m.w, gy);
      ctx.fill();
      ctx.fillStyle = rgb(pal.haze, 0.12 + state.night * 0.12);
      ctx.beginPath();
      ctx.moveTo(x + m.w * 0.5, gy - m.h);
      ctx.lineTo(x + m.w * 0.62, gy - m.h * 0.72);
      ctx.lineTo(x + m.w, gy);
      ctx.fill();
      ctx.fillStyle = rgb(lerp3(pal.sky2, pal.build2, 0.45));
    }
  }

  function drawCity(gy, pal, scroll) {
    const cols = [pal.build0, pal.build1, pal.build2];
    for (const b of state.buildings) {
      const par = 0.2 + b.layer * 0.07;
      const x = ((b.x - scroll * par) % (14 * 180) + 14 * 180) % (14 * 180) - 50;
      drawIsoBuilding(x, gy - 6, b.w, b.h, b.d, cols[b.layer], b.layer);
    }
  }

  function drawIsoBuilding(x, base, w, h, d, col, layer) {
    const top = [Math.min(255, col[0] + 28), Math.min(255, col[1] + 24), Math.min(255, col[2] + 20)];
    const side = [Math.max(0, col[0] - 24), Math.max(0, col[1] - 22), Math.max(0, col[2] - 18)];
    ctx.fillStyle = rgb(side);
    ctx.beginPath();
    ctx.moveTo(x + w, base - h);
    ctx.lineTo(x + w + d, base - h - d * 0.45);
    ctx.lineTo(x + w + d, base - d * 0.45);
    ctx.lineTo(x + w, base);
    ctx.fill();
    ctx.fillStyle = rgb(col);
    ctx.fillRect(x, base - h, w, h);
    ctx.fillStyle = rgb(top);
    ctx.beginPath();
    ctx.moveTo(x, base - h);
    ctx.lineTo(x + d, base - h - d * 0.45);
    ctx.lineTo(x + w + d, base - h - d * 0.45);
    ctx.lineTo(x + w, base - h);
    ctx.fill();
    if (state.night > 0.35) {
      ctx.fillStyle = rgb([255, 210, 110], 0.18 + layer * 0.08);
      for (let wy = 14; wy < h - 10; wy += 18) {
        for (let wx = 8; wx < w - 8; wx += 14) {
          if (((wx + wy + x) | 0) % 3 === 0) ctx.fillRect(x + wx, base - h + wy, 5, 7);
        }
      }
    }
  }

  function drawPlanes() {
    for (const pl of state.planes) drawPlane(pl);
  }

  function drawPlane(pl) {
    const s = pl.scale;
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.scale(pl.vx < 0 ? -s : s, s);
    ctx.fillStyle = rgb([230, 232, 240], 0.95);
    ctx.beginPath();
    ctx.moveTo(-28, 0);
    ctx.lineTo(26, -5);
    ctx.lineTo(30, 0);
    ctx.lineTo(26, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgb([180, 196, 220]);
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(-10, -16);
    ctx.lineTo(8, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(-8, 14);
    ctx.lineTo(8, 0);
    ctx.fill();
    ctx.fillStyle = rgb([255, 90, 70]);
    ctx.fillRect(-28, -3, 6, 6);
    ctx.fillStyle = rgb([80, 120, 180]);
    ctx.fillRect(8, -3, 10, 4);
    ctx.restore();
  }

  function drawGround(w, h, gy, pal, scroll) {
    const lava = state.night;
    ctx.fillStyle = rgb(pal.groundDark);
    ctx.fillRect(0, gy, w, h - gy);

    if (lava > 0.2) {
      const glow = ctx.createLinearGradient(0, gy - 26, 0, gy + 50);
      glow.addColorStop(0, rgb([255, 80, 20], 0));
      glow.addColorStop(1, rgb([255, 70, 20], 0.18 * lava));
      ctx.fillStyle = glow;
      ctx.fillRect(0, gy - 26, w, 76);
    }

    ctx.fillStyle = rgb(pal.line);
    ctx.fillRect(0, gy, w, 3);

    const span = 70;
    const off = scroll % (span * 2);
    ctx.fillStyle = lava > 0.5 ? rgb([255, 140, 40], 0.55) : rgb([255, 255, 255], 0.12);
    for (let x = -off; x < w + 40; x += span * 2) ctx.fillRect(x, gy + 16, 36, 4);

    if (lava > 0.25) {
      ctx.fillStyle = rgb([255, 90, 24], 0.55 * lava);
      for (let i = 0; i < 9; i++) {
        const x = ((i * 140 - scroll * 0.9) % (w + 160) + (w + 160)) % (w + 160) - 40;
        ctx.beginPath();
        ctx.moveTo(x, gy + 8);
        ctx.quadraticCurveTo(x + 30, gy + 28 + Math.sin(state.t * 3 + i) * 6, x + 70, gy + 10);
        ctx.quadraticCurveTo(x + 30, gy + 18, x, gy + 8);
        ctx.fill();
      }
    }

    for (const d of state.lavaDrops) {
      if (d.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.fillStyle = "#ff6a20";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawObject(o) {
    if (o.used && (o.type === "drink" || o.type === "check")) return;
    if (o.type === "low") drawCrate3D(o);
    else if (o.type === "high") drawBeam3D(o);
    else if (o.type === "ramp") drawRamp3D(o);
    else if (o.type === "drink") drawDrink(o);
    else if (o.type === "check") drawFlag(o);
    else if (o.type === "lava") drawLavaPit(o);
  }

  function drawDistLabel(x, y, w, text, color) {
    ctx.save();
    ctx.font = "800 11px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color || "rgba(255,255,255,0.95)";
    ctx.fillText(text, x + w * 0.5, y);
    ctx.restore();
  }

  function distText(o) {
    return String(o.dist | 0);
  }

  function drawIsoBox(x, y, w, h, hue, spin) {
    const pulse = 0.5 + 0.5 * Math.sin(state.t * 4 + spin);
    const d = 11 + Math.sin(state.t * 3.2 + spin) * 4;
    const lift = Math.sin(state.t * 2.4 + spin) * 2;
    const yy = y + lift;
    const side = hsl(hue, 70, 28);
    const face = hsl(hue, 78, 48 + pulse * 8);
    const top = hsl(hue, 85, 68);
    const glow = hsl(hue, 90, 60, 0.22 + pulse * 0.12);

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, WORLD.groundY + 6, w * 0.55, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(x + w, yy);
    ctx.lineTo(x + w + d, yy - d * 0.55);
    ctx.lineTo(x + w + d, yy + h - d * 0.55);
    ctx.lineTo(x + w, yy + h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = face;
    ctx.fillRect(x, yy, w, h);

    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + d, yy - d * 0.55);
    ctx.lineTo(x + w + d, yy - d * 0.55);
    ctx.lineTo(x + w, yy);
    ctx.closePath();
    ctx.fill();

    const sweep = (Math.sin(state.t * 3 + spin) * 0.5 + 0.5) * (w - 12);
    ctx.fillStyle = hsl(hue, 90, 85, 0.28);
    ctx.fillRect(x + 6 + sweep * 0.15, yy + 6, 5, h - 12);

    ctx.strokeStyle = hsl(hue, 40, 18, 0.35);
    ctx.strokeRect(x + 0.5, yy + 0.5, w - 1, h - 1);
    return yy;
  }

  function drawCrate3D(o) {
    const hue = o.hue + Math.sin(state.t * 1.5 + o.phase) * 10;
    const yy = drawIsoBox(o.x, o.y, o.w, o.h, hue, o.phase);
    ctx.fillStyle = hsl(hue, 30, 12, 0.45);
    ctx.fillRect(o.x + 7, yy + 10, o.w - 14, o.h - 18);
    drawDistLabel(o.x, yy + o.h * 0.58, o.w, distText(o), "#fff");
  }

  function drawBeam3D(o) {
    const hue = o.hue + Math.sin(state.t * 1.8 + o.phase) * 12;
    const sway = Math.sin(state.t * 2.6 + o.phase) * 2;
    ctx.fillStyle = hsl(hue, 70, 55, 0.28);
    ctx.fillRect(o.x + o.w * 0.42 + sway, o.y - 40, 8, 40);
    ctx.fillStyle = hsl(hue, 50, 30);
    ctx.beginPath();
    ctx.arc(o.x + o.w * 0.42 + 4 + sway, o.y - 40, 7, 0, Math.PI * 2);
    ctx.fill();
    const yy = drawIsoBox(o.x, o.y, o.w, o.h, hue, o.phase);
    ctx.fillStyle = hsl(hue, 90, 78, 0.7);
    ctx.fillRect(o.x + 8, yy + 10, o.w - 16, 8);
    drawDistLabel(o.x, yy + o.h * 0.62, o.w, distText(o), "#fff");
  }

  function drawRamp3D(o) {
    const hue = o.used ? 40 : 46;
    const pulse = 0.5 + 0.5 * Math.sin(state.t * 8);
    const lift = Math.sin(state.t * 5) * 2;
    ctx.fillStyle = hsl(hue, 90, 42);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y + o.h);
    ctx.lineTo(o.x + 18, o.y - 18 + lift);
    ctx.lineTo(o.x + o.w - 8, o.y - 18 + lift);
    ctx.lineTo(o.x + o.w + 10, o.y + o.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hsl(hue, 95, o.used ? 62 : 58 + pulse * 10);
    ctx.beginPath();
    ctx.moveTo(o.x + 6, o.y + o.h - 2);
    ctx.lineTo(o.x + 22, o.y - 12 + lift);
    ctx.lineTo(o.x + o.w - 14, o.y - 12 + lift);
    ctx.lineTo(o.x + o.w - 4, o.y + o.h - 2);
    ctx.closePath();
    ctx.fill();
    drawDistLabel(o.x, o.y - 2 + lift, o.w, distText(o) + " »", "#4a3208");
  }

  function drawDrink(o) {
    const bob = Math.sin(state.t * 5 + o.phase) * 5;
    const hue = o.hue + Math.sin(state.t * 3 + o.phase) * 14;
    ctx.fillStyle = hsl(hue, 80, 55, 0.2);
    ctx.beginPath(); ctx.arc(o.x + 12, o.y + 16 + bob, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hsl(hue, 20, 94);
    ctx.fillRect(o.x + 7, o.y + bob, 10, 6);
    ctx.fillStyle = hsl(hue, 40, 78);
    ctx.beginPath();
    ctx.moveTo(o.x + 5, o.y + 5 + bob);
    ctx.lineTo(o.x + 19, o.y + 3 + bob);
    ctx.lineTo(o.x + 19, o.y + 7 + bob);
    ctx.lineTo(o.x + 5, o.y + 7 + bob);
    ctx.fill();
    ctx.fillStyle = hsl(hue, 85, 48);
    ctx.beginPath();
    ctx.moveTo(o.x + 4, o.y + 7 + bob);
    ctx.lineTo(o.x + 20, o.y + 7 + bob);
    ctx.lineTo(o.x + 17, o.y + 32 + bob);
    ctx.lineTo(o.x + 7, o.y + 32 + bob);
    ctx.fill();
    ctx.fillStyle = hsl(hue, 90, 78, 0.55);
    ctx.fillRect(o.x + 8, o.y + 11 + bob, 3, 14);
    drawDistLabel(o.x - 4, o.y - 8 + bob, o.w + 8, distText(o), hsl(hue, 40, 92));
  }

  function drawFlag(o) {
    const wave = Math.sin(state.t * 6 + o.phase);
    ctx.fillStyle = hsl(38, 35, 62);
    ctx.fillRect(o.x + 4, o.y, 5, o.h);
    ctx.fillStyle = hsl(30, 20, 30);
    ctx.fillRect(o.x + 3, o.y + o.h - 8, 14, 8);
    ctx.fillStyle = hsl(48, 95, 58 + wave * 6);
    ctx.beginPath();
    ctx.moveTo(o.x + 9, o.y + 4);
    ctx.lineTo(o.x + 38 + wave * 4, o.y + 16);
    ctx.lineTo(o.x + 9, o.y + 30);
    ctx.closePath();
    ctx.fill();
    drawDistLabel(o.x + 8, o.y + 16, 24, distText(o), "#3b2a08");
  }

  function drawLavaPit(o) {
    const pulse = 0.55 + Math.sin(state.t * 6 + o.phase) * 0.22;
    const hue = 16 + Math.sin(state.t * 4 + o.phase) * 8;
    ctx.fillStyle = hsl(hue, 95, 42, pulse);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y + 8);
    ctx.quadraticCurveTo(o.x + o.w * 0.5, o.y - 6 - pulse * 6, o.x + o.w, o.y + 8);
    ctx.lineTo(o.x + o.w, o.y + o.h + 10);
    ctx.lineTo(o.x, o.y + o.h + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hsl(48, 100, 62);
    ctx.fillRect(o.x + 10, o.y + 4, o.w - 20, 4);
    drawDistLabel(o.x, o.y - 10, o.w, distText(o), hsl(40, 100, 80));
  }

  function drawParticles() {
    for (const q of state.particles) {
      if (q.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, q.r, q.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    ctx.font = "800 15px Outfit, sans-serif";
    for (const f of state.floating) {
      ctx.globalAlpha = Math.max(0, f.life / 0.75);
      ctx.fillStyle = "#ffd166";
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(p, gy) {
    const sliding = p.sliding;
    const bodyH = sliding ? p.slideH : p.runH;
    const y = sliding ? gy - bodyH : p.y;
    const blink = state.invuln > 0 && ((state.t * 16) | 0) % 2 === 0;

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(p.x + 21, gy + 7, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!blink) {
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i];
        ctx.globalAlpha = (i / p.trail.length) * 0.16;
        ctx.fillStyle = "#7dffd2";
        ctx.fillRect(t.x + 12, t.y + 8, 14, t.h - 14);
      }
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(p.x + p.w / 2, y + bodyH / 2);
    ctx.rotate(p.facingTilt);
    ctx.scale(p.stretch, p.squash);
    if (!sliding && state.mode !== "dead") {
      const swing = Math.sin(p.runPhase * 2.1) * 8;
      ctx.fillStyle = "#1c1630";
      ctx.fillRect(-12, bodyH * 0.16, 7, 16 + swing * 0.15);
      ctx.fillRect(4, bodyH * 0.16, 7, 16 - swing * 0.15);
    }
    ctx.fillStyle = p.hitFlash > 0 ? "#ffffff" : "#7dffd2";
    roundRect(-p.w * 0.36, -bodyH * 0.46, p.w * 0.72, bodyH * 0.88, sliding ? 9 : 11);
    ctx.fillStyle = "#12081f";
    ctx.fillRect(-8, -bodyH * 0.26, 20, sliding ? 7 : 9);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(5, -bodyH * 0.22, 5, 4);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.fill();
  }

  function pointFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0]
      : (e.touches && e.touches[0] ? e.touches[0] : e);
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  function syncSlide() {
    let held = state.keySlide;
    state.pointers.forEach((role) => { if (role === "slide") held = true; });
    state.slideHeld = held;
    if (held) startSlide();
    else if (state.player && state.player.sliding && state.player.slideT > 0.16) {
      state.player.slideT = 0.12;
    }
    if (el.slidePad) el.slidePad.classList.toggle("active", held);
  }

  function bindPointer(id, role) {
    state.pointers.set(id, role);
    if (role === "slide") syncSlide();
    if (role === "jump") jump();
  }

  function unbindPointer(id) {
    state.pointers.delete(id);
    syncSlide();
  }

  function onPointerDown(e) {
    if (state.mode !== "play") return;
    const pt = pointFromEvent(e);
    state.pointer.down = true;
    state.pointer.startY = pt.y;
    state.pointer.startX = pt.x;
    state.pointer.id = e.pointerId;
    const leftZone = pt.x < state.w * 0.42;
    const role = leftZone ? "slide" : "jump";
    state.pointer.role = role;
    bindPointer(e.pointerId, role);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onPointerMove(e) {
    if (state.mode !== "play") return;
    if (!state.pointers.has(e.pointerId) && !state.pointer.down) return;
    const pt = pointFromEvent(e);
    const dy = pt.y - state.pointer.startY;
    if (dy > 36 && state.pointers.get(e.pointerId) !== "slide") {
      state.pointers.set(e.pointerId, "slide");
      syncSlide();
    } else if (dy < -42 && state.pointers.get(e.pointerId) === "slide") {
      state.pointers.set(e.pointerId, "jump");
      syncSlide();
      jump();
    }
  }

  function onPointerUp(e) {
    state.pointer.down = false;
    unbindPointer(e.pointerId);
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === "ArrowDown" || e.code === "KeyS") {
      state.keySlide = true;
      syncSlide();
      e.preventDefault();
    }
    if (e.code === "ArrowUp" || e.code === "KeyW") {
      jump();
      e.preventDefault();
    }
    if (e.code === "Space") {
      if (state.mode === "menu" || state.mode === "dead") startPlay(false);
      else jump();
      e.preventDefault();
    }
    if (e.code === "Enter" && state.mode !== "play") startPlay(!!state.checkpoint && state.mode === "dead");
  }

  function onKeyUp(e) {
    if (e.code === "ArrowDown" || e.code === "KeyS") {
      state.keySlide = false;
      syncSlide();
    }
  }

  function bindPad(node, role) {
    if (!node) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.mode !== "play") return;
      bindPointer("pad-" + role + "-" + (e.pointerId || "0"), role);
      node.classList.add("active");
    };
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      unbindPointer("pad-" + role + "-" + (e.pointerId || "0"));
      if (role === "slide") node.classList.remove("active");
      else setTimeout(() => node.classList.remove("active"), 90);
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    node.addEventListener("pointerleave", (e) => {
      if (role === "slide") up(e);
    });
    node.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  bindPad(el.slidePad, "slide");
  bindPad(el.jumpPad, "jump");

  document.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("contextmenu", (e) => {
    if (state.mode === "play") e.preventDefault();
  });

  el.startBtn.addEventListener("click", () => startPlay(false));
  el.restartBtn.addEventListener("click", () => startPlay(false));
  el.continueBtn.addEventListener("click", () => {
    if (state.checkpoint) startPlay(true);
  });
  if (el.menuContinueBtn) {
    el.menuContinueBtn.addEventListener("click", () => {
      if (state.checkpoint) startPlay(true);
    });
  }
  el.menuBtn.addEventListener("click", () => {
    state.mode = "menu";
    el.gameover.classList.add("hidden");
    el.menu.classList.remove("hidden");
    el.hud.classList.add("hidden");
    if (el.pads) el.pads.classList.add("hidden");
    loadBest();
  });

  window.addEventListener("resize", resize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
  resize();
  loadBest();
  const saved = readSavedCheckpoint();
  if (saved && typeof saved.distance === "number") state.checkpoint = saved;
  state.player = makePlayer();
  state.player.y = WORLD.groundY - state.player.runH;

  let last = performance.now();
  function loop(now) {
    update((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
