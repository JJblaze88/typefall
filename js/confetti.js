/* Typefall confetti: a small canvas particle burst in the palette colours. */
window.Confetti = (() => {
  const COLORS = ['#2274A5', '#F75C03', '#F1C40F', '#D90368', '#00CC66'];
  let cv, ctx, parts = [], raf = null, last = 0, dpr = 1;
  function setup() {
    cv = cv || document.getElementById('confetti');
    ctx = ctx || cv.getContext('2d');
    dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function add(x, y, angle, spread, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread, v = speed * (0.45 + Math.random() * 0.75);
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 6 + Math.random() * 6, h: 9 + Math.random() * 9, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
        tilt: Math.random() * 6.28, vt: 0.06 + Math.random() * 0.12, c: COLORS[i % COLORS.length], round: Math.random() < 0.28,
      });
    }
  }
  function burst() {
    setup();
    const W = innerWidth, H = innerHeight, s = Math.min(1.25, Math.max(0.7, W / 1200));
    add(0, H * 0.85, -Math.PI / 3.2, 0.8, 110, 24 * s);
    add(W, H * 0.85, -Math.PI + Math.PI / 3.2, 0.8, 110, 24 * s);
    add(W / 2, H * 0.32, -Math.PI / 2, Math.PI * 2, 90, 13 * s);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function tick(now) {
    const k = Math.min(3, (now - last) / 16.67); last = now;
    const H = innerHeight;
    ctx.clearRect(0, 0, innerWidth, H);
    parts = parts.filter(p => p.y < H + 40);
    for (const p of parts) {
      p.vy += 0.38 * k; p.vx *= Math.pow(0.986, k); p.vy *= Math.pow(0.986, k);
      p.x += p.vx * k; p.y += p.vy * k; p.r += p.vr * k; p.tilt += p.vt * k;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.283); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(tick);
    else { raf = null; ctx.clearRect(0, 0, innerWidth, H); }
  }
  function stop() { parts = []; if (raf) cancelAnimationFrame(raf); raf = null; if (ctx) ctx.clearRect(0, 0, innerWidth, innerHeight); }
  return { burst, stop };
})();
