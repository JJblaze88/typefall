/* Typefall gravity: clones letters into a fixed layer and drops them with matter-js.
   Falls back to a simple, rotation-free drop for prefers-reduced-motion (or if matter-js is missing). */
window.Gravity = (() => {
  const PALETTE = ['#2274A5', '#F75C03', '#F1C40F', '#D90368', '#00CC66'];
  const STEP = 1000 / 60;
  let engine = null, items = [], walls = null, raf = null, last = 0, acc = 0, idle = 0, t0 = 0;
  const layer = () => document.getElementById('fall-layer');

  function makeClones(sourceEls, clip) {
    const L = layer(), frag = document.createDocumentFragment(), out = [];
    for (const el of sourceEls) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < clip.top + 4 || r.top > clip.bottom - 4 || r.right < clip.left || r.left > clip.right) continue;
      if (!el.textContent.trim()) continue;
      const c = document.createElement('span');
      const cl = el.classList;
      c.className = 'fallen ' + (cl.contains('ok') ? 'is-ok' : (cl.contains('bad') || cl.contains('extra')) ? 'is-bad' : 'is-rest');
      if (!cl.contains('ok') && !cl.contains('bad') && !cl.contains('extra')) c.style.color = PALETTE[(Math.random() * PALETTE.length) | 0];
      c.textContent = el.textContent;
      // trim the line-box padding so the clone matches the physics body (glyph stays centred)
      const h = r.height * 0.8, top = r.top + (r.height - h) / 2;
      c.style.width = r.width + 'px';
      c.style.height = h + 'px';
      c.style.transform = `translate(${r.left}px, ${top}px)`;
      frag.appendChild(c);
      out.push({ el: c, x: r.left + r.width / 2, y: top + h / 2, w: r.width, h, released: false });
    }
    L.appendChild(frag);
    return out;
  }

  function buildWalls() {
    const { Bodies, Composite } = Matter;
    const W = innerWidth, H = innerHeight, opts = { isStatic: true, friction: 0.8, restitution: 0.2 };
    walls = {
      floor: Bodies.rectangle(W / 2, H + 50, W * 4, 100, opts),
      left: Bodies.rectangle(-50, H / 2 - 1500, 100, H + 3000, opts),
      right: Bodies.rectangle(W + 50, H / 2 - 1500, 100, H + 3000, opts),
    };
    Composite.add(engine.world, [walls.floor, walls.left, walls.right]);
  }

  function onResize() {
    if (!engine || !walls) return;
    const { Body } = Matter, W = innerWidth, H = innerHeight;
    Body.setPosition(walls.floor, { x: W / 2, y: H + 50 });
    Body.setPosition(walls.left, { x: -50, y: H / 2 - 1500 });
    Body.setPosition(walls.right, { x: W + 50, y: H / 2 - 1500 });
    items.forEach(it => it.body && Matter.Sleeping.set(it.body, false));
    kick();
  }
  addEventListener('resize', onResize);

  function release(it) {
    const { Body, Composite } = Matter;
    it.released = true;
    Composite.add(engine.world, it.body);
    Body.setVelocity(it.body, { x: (Math.random() - 0.5) * 3.2, y: -Math.random() * 3.5 });
    Body.setAngularVelocity(it.body, (Math.random() - 0.5) * 0.18);
  }

  function tick(now) {
    const dt = Math.min(48, now - last); last = now; acc += dt;
    const elapsed = now - t0;
    let moving = false;
    for (const it of items) if (!it.released) { if (elapsed >= it.delay) release(it); else moving = true; }
    let steps = 0;
    while (acc >= STEP && steps < 3) { Matter.Engine.update(engine, STEP); acc -= STEP; steps++; }
    if (steps === 3) acc = 0;
    for (const it of items) {
      if (!it.released) continue;
      const b = it.body;
      if (b.isSleeping && it.drawnSleeping) continue;
      it.drawnSleeping = b.isSleeping;
      if (!b.isSleeping) moving = true;
      it.el.style.transform = `translate(${(b.position.x - it.w / 2).toFixed(2)}px, ${(b.position.y - it.h / 2).toFixed(2)}px) rotate(${b.angle.toFixed(4)}rad)`;
    }
    idle = moving ? 0 : idle + 1;
    if (idle > 45) { raf = null; return; }
    raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf && engine) { last = performance.now(); idle = 0; raf = requestAnimationFrame(tick); } }

  function simpleDrop() {
    const W = innerWidth, H = innerHeight;
    const rowH = Math.max(...items.map(i => i.h)) * 0.95;
    let x = 8, row = 0;
    items.forEach((it, i) => {
      if (x + it.w > W - 8) { x = 8; row++; }
      const tx = x, ty = H - (row + 1) * rowH;
      x += it.w + 1;
      it.el.style.transitionDelay = Math.min(i * 1.5, 250) + 'ms';
      requestAnimationFrame(() => requestAnimationFrame(() => { it.el.style.transform = `translate(${tx}px, ${ty}px)`; }));
    });
  }

  /* sourceEls: letter elements; clip: DOMRect of the visible text box; origin: {x,y} where the collapse starts */
  function drop(sourceEls, clip, origin, reduced) {
    clear(true);
    if (sourceEls[0]) layer().style.fontSize = getComputedStyle(sourceEls[0]).fontSize;
    items = makeClones(sourceEls, clip);
    if (!items.length) return 0;
    if (reduced || !window.Matter) { simpleDrop(); return items.length; }
    const { Engine, Bodies } = Matter;
    engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1.15;
    engine.positionIterations = 8; engine.velocityIterations = 6;
    buildWalls();
    for (const it of items) {
      it.body = Bodies.rectangle(it.x, it.y, Math.max(4, it.w * 0.9), it.h, {
        restitution: 0.34, friction: 0.45, frictionAir: 0.012, density: 0.0018,
        chamfer: { radius: Math.min(3, it.w / 4) }, sleepThreshold: 45,
      });
      const d = Math.hypot(it.x - origin.x, it.y - origin.y);
      it.delay = d * 0.85 + Math.random() * 110;
    }
    t0 = performance.now();
    kick();
    return items.length;
  }

  /* Knock letters near a point into the air. */
  function poke(x, y) {
    if (!engine) return false;
    const { Body, Sleeping } = Matter, R = 150;
    let hit = false;
    for (const it of items) {
      if (!it.released) continue;
      const b = it.body, dx = b.position.x - x, dy = b.position.y - y, d = Math.hypot(dx, dy);
      if (d > R) continue;
      const f = 1 - d / R; hit = true;
      Sleeping.set(b, false);
      Body.setVelocity(b, { x: b.velocity.x + (dx / (d || 1)) * 10 * f, y: b.velocity.y - (6 + 12 * f) });
      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.5);
    }
    if (hit) kick();
    return hit;
  }

  function clear(instant) {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (engine) { Matter.Composite.clear(engine.world, false); Matter.Engine.clear(engine); engine = null; walls = null; }
    const old = items.map(i => i.el); items = [];
    if (instant) { old.forEach(e => e.remove()); return; }
    old.forEach(e => e.classList.add('gone'));
    setTimeout(() => old.forEach(e => e.remove()), 320);
  }

  return { drop, poke, clear, get count() { return items.length; } };
})();
