(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const root = document.documentElement;

  // Lagos, July 2025: the satellite's daily rainfall and the gauge's, null where the gauge was silent
  const SATELLITE = [0.72, 0.06, 30.38, 38.2, 13.37, 2.66, 1.83, 14.34, 9.32, 7.32, 0.35, 3.38, 0, 0.11, 0, 0.38, 0.13, 0, 0.15, 0.11, 0.77, 1.18, 0, 0.09, 0.78, 0.82, 0.51, 0.93, 0.4, 0.3, 3.06];
  const STATION = [0, null, null, null, null, 0, 0, 0, null, null, null, null, 0, null, null, null, null, null, null, null, 0, 0, 6.1, 0, null, null, null, null, 0, null, null];
  const fmt = v => v === null ? '—' : v.toFixed(v < 10 ? 2 : 1);

  const dialog = $('#legal-dialog');
  $$('[data-legal]').forEach(button => button.addEventListener('click', () => {
    const [title, ...paragraphs] = window.PLUVIA_LEGAL[button.dataset.legal];
    $('#legal-title').textContent = title;
    $('#legal-content').replaceChildren(...paragraphs.map(text => Object.assign(document.createElement('p'), { textContent: text })));
    dialog.showModal();
  }));
  $('#close-legal').addEventListener('click', () => dialog.close());

  if (!root.classList.contains('motion') || !window.gsap || !window.ScrollTrigger || !window.Lenis) {
    root.classList.remove('motion');
    return;
  }

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  const lenis = new window.Lenis({ lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = t => Math.min(1, Math.max(0, t));

  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  // opaque points of an image with their colour, normalised to -0.5..0.5; outline points are oversampled so the shape reads
  async function samplePoints(src, count, edgeShare = 0) {
    const img = await loadImage(src);
    const scale = 360 / Math.max(img.width, img.height);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const alpha = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3];
    const luma = (x, y) => { const i = (y * w + x) * 4; return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; };
    const fill = [], edges = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= 110) continue;
      const point = { x: x / w - 0.5, y: y / h - 0.5, aspect: h / w, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` };
      const outline = alpha(x - 1, y) <= 110 || alpha(x + 1, y) <= 110 || alpha(x, y - 1) <= 110 || alpha(x, y + 1) <= 110;
      const crease = !outline && (Math.abs(luma(x, y) - luma(x + 1, y)) > 38 || Math.abs(luma(x, y) - luma(x, y + 1)) > 38);
      (outline || crease ? edges : fill).push(point);
    }
    const fallback = { x: 0, y: 0, aspect: 1, c: '#F2EDE3' };
    const pick = list => list[Math.floor(Math.random() * list.length)] || fallback;
    return Array.from({ length: count }, (_, i) => i < count * edgeShare && edges.length ? pick(edges) : pick(fill.length ? fill : edges));
  }

  function fitCanvas(canvas) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }

  // 0. the month's readings gather into a storm cloud, which opens onto the sky
  const letters = $$('.giant span');
  gsap.set(letters, { yPercent: 110, autoAlpha: 0 });
  gsap.set('.w1', { autoAlpha: 0, y: 24 });

  const intro = () => gsap.timeline()
    .fromTo('.f1 .scene', { scale: 1.25 }, { scale: 1, duration: 2, ease: 'power2.out' }, 0)
    .to(letters, { yPercent: 0, autoAlpha: 1, duration: 1.2, stagger: 0.07, ease: 'power3.out' }, 0.2)
    .to('.w1', { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 0.7);

  (async () => {
    const loader = $('#loader');
    loader.hidden = false;
    lenis.stop();
    const { ctx, width, height } = fitCanvas(loader.querySelector('canvas'));
    const values = [...SATELLITE, ...STATION].map(fmt);
    let targets;
    try { targets = await samplePoints('/images/scenes/s01b-960.webp', 240); }
    catch { targets = Array.from({ length: 240 }, () => ({ x: Math.random() - 0.5, y: Math.random() - 0.5, aspect: 0.55, c: '#F2EDE3' })); }
    const span = Math.min(width * 0.8, 900);
    const tokens = targets.map((t, i) => ({
      text: values[i % values.length], sx: Math.random() * width, sy: Math.random() * height,
      tx: width / 2 + t.x * span, ty: height * 0.48 + t.y * span * t.aspect, c: t.c, delay: Math.random() * 0.35,
    }));
    ctx.font = `500 11px ${getComputedStyle(root).getPropertyValue('--font-mono')}`;
    ctx.textAlign = 'center';
    const state = { p: 0 };
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const t of tokens) {
        const k = ease(clamp01((state.p - t.delay) / (1 - t.delay)));
        ctx.fillStyle = k > 0.85 ? t.c : '#F2EDE3';
        ctx.globalAlpha = 0.35 + 0.65 * k;
        ctx.fillText(t.text, lerp(t.sx, t.tx, k), lerp(t.sy, t.ty, k));
      }
    };
    gsap.timeline({ onUpdate: draw })
      .to(state, { p: 1, duration: 1.6, ease: 'none' })
      .to(loader, { scale: 1.6, autoAlpha: 0, duration: 0.7, ease: 'power2.in' }, 1.6)
      .add(intro(), 1.7)
      .call(() => { loader.remove(); lenis.start(); }, null, 2.3);
  })();

  // the journey: one timeline over 100 units, scrubbed by the whole page's scroll
  const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '.journey', start: 'top top', end: 'bottom bottom', scrub: true } });
  tl.to({}, { duration: 100 }, 0);
  const show = (sel, at, d = 0.4) => tl.fromTo(sel, { autoAlpha: 0 }, { autoAlpha: 1, duration: d, immediateRender: false }, at);
  const hide = (sel, at, d = 0.4) => tl.fromTo(sel, { autoAlpha: 1 }, { autoAlpha: 0, duration: d, immediateRender: false }, at);
  const say = (sel, inAt, outAt) => {
    tl.fromTo(sel, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 1, ease: 'power2.out', immediateRender: false }, inAt);
    tl.fromTo(sel, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -30, duration: 1, ease: 'power2.in', immediateRender: false }, outAt);
  };
  // cloud plates rush past the camera, covering the cut at the midpoint
  const flyThrough = (sel, at, d = 5) => {
    tl.fromTo(sel, { scale: 0.6, autoAlpha: 0 }, { scale: 1.5, autoAlpha: 1, duration: d / 2, ease: 'power1.in', immediateRender: false }, at);
    tl.fromTo(sel, { scale: 1.5, autoAlpha: 1 }, { scale: 3.4, autoAlpha: 0, duration: d / 2, ease: 'power1.out', immediateRender: false }, at + d / 2);
  };

  // 1. above the clouds: a slow glide toward the sun, then the camera tilts down and drops between the clouds
  tl.fromTo('.w1', { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -40, duration: 2.5, immediateRender: false }, 1.5)
    .fromTo('.f1 .scene', { scale: 1, yPercent: 0, rotateX: 0 }, { scale: 1.06, duration: 5, immediateRender: false }, 0)
    .to('.f1 .scene', { scale: 3.2, rotateX: 6, transformPerspective: 1200, duration: 7, ease: 'power2.in' }, 5)
    .fromTo('.giant', { yPercent: 0, autoAlpha: 1 }, { yPercent: -90, autoAlpha: 0, duration: 4, ease: 'power1.in', immediateRender: false }, 5.5)
    .fromTo('.puff-l', { x: 0, scale: 1, autoAlpha: 0 }, { x: () => -window.innerWidth * 0.5, scale: 2.4, autoAlpha: 1, duration: 4.5, ease: 'power2.in', immediateRender: false }, 7.5)
    .fromTo('.puff-r', { x: 0, scale: 1, autoAlpha: 0 }, { x: () => window.innerWidth * 0.5, scale: 2.4, autoAlpha: 1, duration: 4.5, ease: 'power2.in', immediateRender: false }, 7.5);
  const part = (sel, dir, at) => {
    tl.fromTo(sel, { x: 0, scale: 0.9, autoAlpha: 0 }, { x: () => dir * window.innerWidth * 0.12, scale: 1.6, autoAlpha: 1, duration: 2.2, ease: 'power1.in', immediateRender: false }, at);
    tl.fromTo(sel, { x: () => dir * window.innerWidth * 0.12, scale: 1.6, autoAlpha: 1 }, { x: () => dir * window.innerWidth * 0.75, scale: 3, autoAlpha: 0, duration: 3.5, ease: 'power2.out', immediateRender: false }, at + 2.2);
  };
  part('.fly-a', -1, 9.2);
  part('.fly-c', 1, 9.6);
  tl.fromTo('.mist', { autoAlpha: 0, '--hole': '0%' }, { autoAlpha: 1, duration: 2, ease: 'power1.in', immediateRender: false }, 9.8)
    .fromTo('.mist', { '--hole': '0%' }, { '--hole': '120%', duration: 4.5, ease: 'power2.out', immediateRender: false }, 11.8);
  hide('.mist', 15.8, 0.5);
  show('.f2', 11.6, 0.2);
  hide('.f1', 11.9, 0.2);

  // 2. the drone keeps descending over the farmland and turns toward the station
  tl.fromTo('.f2 .plate', { scale: 2, rotate: 3, yPercent: 4 }, { scale: 1, rotate: 0, yPercent: 0, duration: 5.6, ease: 'power2.out', immediateRender: false }, 11.6);
  say('.w2', 13.2, 15.8);
  // the field markings draw themselves onto the land
  tl.fromTo('.marks .mk', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, stagger: 0.5, immediateRender: false }, 13.4)
    .fromTo('.marks .mk-ring, .marks .mk-lead', { strokeDashoffset: 1, strokeDasharray: '1 1' }, { strokeDashoffset: 0, duration: 1.4, stagger: 0.12, ease: 'power2.out', immediateRender: false }, 13.4)
    .fromTo('.marks .mk-link', { autoAlpha: 0 }, { autoAlpha: 0.7, duration: 0.8, immediateRender: false }, 14.6);
  tl.fromTo('.f2 .plate', { scale: 1, autoAlpha: 1 }, { scale: 0.9, autoAlpha: 0, duration: 2, immediateRender: false }, 17.2);
  show('.f3', 16.8, 1.8);
  hide('.f2', 18.8, 0.3);
  tl.fromTo('.f3 .plate', { scale: 1.25 }, { scale: 1, duration: 2.5, ease: 'power2.out' }, 16.8);

  // 3. walking toward the lit window until its glow fills the screen
  say('.w3', 18.5, 22);
  tl.fromTo('.f3 .plate', { scale: 1 }, { scale: 5.5, duration: 6.5, ease: 'power2.in', immediateRender: false }, 20);
  tl.fromTo('.f3 .glow', { autoAlpha: 0 }, { autoAlpha: 1, duration: 2.5, immediateRender: false }, 23.8);
  show('.f4', 26, 0.6);
  hide('.f3', 26.6, 0.2);
  tl.fromTo('.f4 .plate', { scale: 1.35 }, { scale: 1, duration: 2.5, ease: 'power2.out' }, 26);

  // 4. the officer, then the storm hits and the camera follows the gust outside
  say('.w4', 28.5, 33);
  tl.fromTo('.f4 .storm', { autoAlpha: 0 }, { autoAlpha: 1, duration: 2, immediateRender: false }, 29.5);
  tl.fromTo('.f4 .plate', { scale: 1 }, { scale: 2.8, duration: 3.5, ease: 'power2.in', immediateRender: false }, 33);
  flyThrough('.fly-c', 34, 4.5);
  show('.f5', 35.8, 0.8);
  hide('.f4', 36.6, 0.3);
  tl.fromTo('.f5 .plate', { scale: 1.5 }, { scale: 1, duration: 3, ease: 'power2.out' }, 35.8);

  // 5. inside the storm: raindrops gather into the gauge, then into the satellite
  const sources = { p: 0 };
  let drawSources = () => {};
  tl.fromTo(sources, { p: 0 }, { p: 1, duration: 8.5, onUpdate: () => drawSources() }, 38);
  say('.w5', 38, 45.5);
  // the month in two numbers: the gauge first, the satellite once it forms
  tl.fromTo('.readout', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'power2.out', immediateRender: false }, 40.2);
  tl.fromTo('.ro-sat', { autoAlpha: 0.3 }, { autoAlpha: 1, duration: 1, immediateRender: false }, 43.6);
  tl.fromTo('.ro-gauge', { autoAlpha: 1 }, { autoAlpha: 0.55, duration: 1, immediateRender: false }, 43.6);
  hide('.readout', 46.4, 0.8);
  tl.fromTo('.f5 .plate', { scale: 1 }, { scale: 1.9, duration: 3, ease: 'power1.in', immediateRender: false }, 46.5);
  show('.f6', 47.2, 1.6);
  hide('.f5', 48.4, 1);
  tl.fromTo('.f5 .plate', { yPercent: 0 }, { yPercent: 10, duration: 3, ease: 'power1.inOut', immediateRender: false }, 41.8);
  const sourcesCanvas = $('.f5 canvas');
  const DOTS = window.innerWidth < 720 ? 6000 : 9000;
  Promise.all([samplePoints('/images/scenes/s05a-600.webp', DOTS, 0.45), samplePoints('/images/scenes/s05b-600.webp', DOTS, 0.45)]).then(([gauge, satellite]) => {
    let view = fitCanvas(sourcesCanvas);
    const scatter = gauge.map(() => ({ x: Math.random(), y: Math.random() * 1.4 - 0.6, d: Math.random() * 0.25, bx: Math.random() - 0.5, by: Math.random() - 0.5 }));
    drawSources = () => {
      const { ctx, width, height } = view;
      const span = Math.min(height * (width >= 900 ? 0.62 : 0.5), width * 0.88);
      const wide = width >= 900;
      const cx = width * (wide ? 0.44 : 0.5);
      const gy = height * (wide ? 0.6 : 0.5), sy = height * (wide ? 0.5 : 0.42);
      ctx.clearRect(0, 0, width, height);
      // a dark pocket in the cloud behind the shape so the dots read
      const hold = Math.max(ease(clamp01(sources.p / 0.32)), 0);
      const shade = ctx.createRadialGradient(cx, (gy + sy) / 2, 0, cx, (gy + sy) / 2, span * 0.75);
      shade.addColorStop(0, '#0d1220'); shade.addColorStop(1, '#0d122000');
      ctx.globalAlpha = 0.75 * hold;
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, width, height);
      const size = width < 720 ? 1.5 : 1.9;
      for (let i = 0; i < DOTS; i++) {
        const g = gauge[i], s = satellite[i], r = scatter[i];
        // gather: 0 to 0.32, hold gauge to 0.46, re-form: to 0.74, hold satellite to the end
        const a = ease(clamp01((sources.p - r.d * 0.6) / (0.32 - r.d * 0.6)));
        const b = ease(clamp01((sources.p - 0.46) / 0.28));
        const burst = Math.sin(b * Math.PI) * span * 0.5;
        const fallX = r.x * width, fallY = r.y * height + sources.p * height * 0.9;
        const x = lerp(lerp(fallX, cx + g.x * span, a), cx + s.x * span, b) + r.bx * burst;
        const y = lerp(lerp(fallY, gy + g.y * span * g.aspect, a), sy + s.y * span * s.aspect, b) + r.by * burst;
        ctx.fillStyle = b > 0.5 ? s.c : a > 0.6 ? g.c : '#BFD6EA';
        ctx.globalAlpha = a < 0.3 && b === 0 ? 0.55 : 0.95;
        ctx.fillRect(x, y, size, a < 0.3 && b === 0 ? size * 5 : size);
      }
    };
    window.addEventListener('resize', () => { view = fitCanvas(sourcesCanvas); drawSources(); });
    drawSources();
  }).catch(() => {});

  // 6. the field splits into its layers and closes again
  say('.w6', 50, 57);
  tl.fromTo('.f6 .bands', { rotateX: 0 }, { rotateX: 9, duration: 4.5, ease: 'power2.out' }, 49.5)
    .fromTo('.f6 .bands', { scale: 1 }, { scale: 1.12, duration: 4.5, ease: 'power2.out' }, 49.5)
    .fromTo('.band.sky', { z: 0, yPercent: 0, scale: 1 }, { z: -520, yPercent: -7, scale: 1.45, duration: 4.5, ease: 'power2.out' }, 49.5)
    .fromTo('.band.crop', { z: 0, yPercent: 0 }, { z: 240, yPercent: 9, duration: 4.5, ease: 'power2.out' }, 49.5)
    .fromTo('.band.ground', { z: 0, scale: 1 }, { z: -120, scale: 1.1, duration: 4.5, ease: 'power2.out' }, 49.5)
    .to('.f6 .bands', { rotateX: 0, duration: 3, ease: 'power2.inOut' }, 56)
    .to('.band', { z: 0, yPercent: 0, scale: 1, duration: 3, ease: 'power2.inOut' }, 56)
    .to('.f6 .bands', { scale: 1, duration: 3, ease: 'power2.inOut' }, 56)
    .fromTo('.f6 .bands', { scale: 1, yPercent: 0 }, { scale: 1.2, yPercent: 14, duration: 2.5, ease: 'power1.in', immediateRender: false }, 59);
  show('.f7', 59, 1.5);
  hide('.f6', 60, 1);

  // 7. the outcomes: four panels turn open like blinds, each widens in turn, then they turn shut
  tl.fromTo('.f7 .plate', { scale: 1.35, yPercent: 10 }, { scale: 1.05, yPercent: 0, duration: 15 }, 59);
  say('.w7', 60.5, 72);
  const outcomes = $$('.outcome');
  const notes = $$('.card-body');
  tl.fromTo(outcomes, { rotateY: 90, autoAlpha: 0 }, { rotateY: 0, autoAlpha: 1, duration: 1.4, stagger: 0.35, ease: 'power2.out', immediateRender: false }, 61);
  outcomes.forEach((_, i) => {
    const at = 63.4 + i * 2.2;
    tl.to(outcomes, { flexGrow: j => j === i ? 5 : 1, duration: 1.2, ease: 'power2.inOut' }, at);
    tl.to(notes, { autoAlpha: j => j === i ? 1 : 0, duration: 0.7 }, at + 0.4);
  });
  tl.to(notes, { autoAlpha: 0, duration: 0.5 }, 72);
  tl.to(outcomes, { rotateY: -90, autoAlpha: 0, duration: 1.2, stagger: 0.25, ease: 'power2.in' }, 72.3);
  flyThrough('.fly-a', 73, 4.5);
  hide('.f7', 75.2);
  show('.f8', 75);

  // 8. back on the dry field: the rain sweeps in and the maize turns green
  tl.fromTo('.f8 .plate', { scale: 1.2 }, { scale: 1, duration: 3, ease: 'power2.out' }, 75);
  tl.fromTo('.f8 .after', { maskPosition: '20% 0', webkitMaskPosition: '20% 0' }, { maskPosition: '80% 0', webkitMaskPosition: '80% 0', duration: 7, ease: 'power1.inOut' }, 77);
  say('.w8', 79, 86.5);
  const rainCanvas = $('.f8 canvas');
  let rainView = fitCanvas(rainCanvas);
  const drops = Array.from({ length: 280 }, () => ({ x: Math.random(), y: Math.random(), l: 10 + Math.random() * 28, v: 0.6 + Math.random() * 0.8 }));
  const rain = { p: 0, t: 0 };
  const drawRain = () => {
    const { ctx, width, height } = rainView;
    const density = Math.sin(clamp01(rain.p) * Math.PI);
    ctx.clearRect(0, 0, width, height);
    if (density <= 0.01) return;
    ctx.strokeStyle = '#DCE6F0';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 * density;
    ctx.beginPath();
    for (let i = 0, n = Math.floor(drops.length * density); i < n; i++) {
      const d = drops[i];
      const x = ((d.x - rain.t * 0.04) % 1 + 1) % 1 * width;
      const y = ((d.y + rain.t * d.v) % 1) * height;
      ctx.moveTo(x, y);
      ctx.lineTo(x - d.l * 0.18, y + d.l);
    }
    ctx.stroke();
  };
  tl.fromTo(rain, { p: 0 }, { p: 1, duration: 10, onUpdate: drawRain }, 76);
  gsap.ticker.add(() => { if (rain.p > 0 && rain.p < 1) { rain.t += 0.012; drawRain(); } });
  window.addEventListener('resize', () => { rainView = fitCanvas(rainCanvas); });
  // 9. the camera lifts its gaze to the sky over the green field, and the last line arrives
  show('.f9', 88, 1);
  hide('.f8', 89);
  tl.fromTo('.f9 .plate', { scale: 1, yPercent: 0 }, { scale: 1.16, yPercent: 7, duration: 10, ease: 'power1.inOut', immediateRender: false }, 89);
  tl.fromTo('.finale', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 3, ease: 'power2.out', immediateRender: false }, 90.5);

  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
