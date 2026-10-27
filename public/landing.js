(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const root = document.documentElement;

  // Lagos, July 2025. Station readings in mm, null where the gauge reported nothing.
  const STATION = [0, null, null, null, null, 0, 0, 0, null, null, null, null, 0, null, null, null, null, null, null, null, 0, 0, 6.1, 0, null, null, null, null, 0, null, null];
  const SATELLITE = [0.72, 0.06, 30.38, 38.2, 13.37, 2.66, 1.83, 14.34, 9.32, 7.32, 0.35, 3.38, 0, 0.11, 0, 0.38, 0.13, 0, 0.15, 0.11, 0.77, 1.18, 0, 0.09, 0.78, 0.82, 0.51, 0.93, 0.4, 0.3, 3.06];
  const fmt = v => v === null ? '—' : v.toFixed(v < 10 ? 2 : 1);

  // legal dialog
  const dialog = $('#legal-dialog');
  $$('[data-legal]').forEach(button => button.addEventListener('click', () => {
    const [title, ...paragraphs] = window.PLUVIA_LEGAL[button.dataset.legal];
    $('#legal-title').textContent = title;
    $('#legal-content').replaceChildren(...paragraphs.map(text => Object.assign(document.createElement('p'), { textContent: text })));
    dialog.showModal();
  }));
  $('#close-legal').addEventListener('click', () => dialog.close());

  // day strips in the checks scene
  const maxSat = Math.max(...SATELLITE);
  $('[data-days=station]').append(...STATION.map(v => {
    const day = document.createElement('i');
    if (v !== null) day.className = v > 0 ? 'on rain' : 'on';
    return day;
  }));
  $('[data-days=satellite]').append(...SATELLITE.map(v => {
    const day = document.createElement('i');
    day.style.height = `${Math.max(4, (v / maxSat) * 100)}%`;
    return day;
  }));

  if (!root.classList.contains('motion') || !window.gsap || !window.ScrollTrigger || !window.Lenis) {
    root.classList.remove('motion');
    return;
  }

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  if (!location.hash) {
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }
  const lenis = new window.Lenis({ lerp: 0.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  $$('a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    const target = $(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    lenis.scrollTo(target, { offset: 0 });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }));

  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  // points where an image is opaque, with the colour at each point, normalised to -0.5..0.5
  async function samplePoints(src, count, threshold = 110) {
    const img = await loadImage(src);
    const size = 220;
    const scale = size / Math.max(img.width, img.height);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const hits = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > threshold) hits.push({ x: x / w - 0.5, y: y / h - 0.5, aspect: h / w, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
    const out = [];
    for (let i = 0; i < count; i++) out.push(hits[Math.floor(Math.random() * hits.length)] || { x: 0, y: 0, aspect: 1, c: '#F2EDE3' });
    return out;
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

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;

  // 0. loader: the month's readings gather into a storm cloud, then the camera drops to the field
  const descent = $('.arrive .descent');
  const letters = $$('.arrive-wordmark span');
  const copy = $('.arrive-copy');
  gsap.set(letters, { yPercent: 110, opacity: 0 });
  gsap.set(copy, { y: 24, opacity: 0 });

  function arrive() {
    const tl = gsap.timeline();
    tl.fromTo(descent, { scale: 1.35 }, { scale: 1.02, duration: 1.6, ease: 'power2.out' }, 0)
      .to(descent, { opacity: 0, duration: 0.9, ease: 'power1.inOut' }, 1.1)
      .to(letters, { yPercent: 0, opacity: 1, duration: 1, stagger: 0.06, ease: 'power3.out' }, 1.3)
      .to(copy, { y: 0, opacity: 1, duration: 0.8, ease: 'power2.out' }, 1.7);
    return tl;
  }

  async function runLoader() {
    const loader = $('#loader');
    loader.hidden = false;
    lenis.stop();
    const { ctx, width, height } = fitCanvas(loader.querySelector('canvas'));
    const tokens = [];
    const values = [...SATELLITE, ...STATION].map(fmt);
    let targets;
    try {
      targets = await samplePoints('/images/scenes/s01b-960.webp', 240);
    } catch {
      targets = Array.from({ length: 240 }, () => ({ x: Math.random() - 0.5, y: Math.random() - 0.5, aspect: 0.55, c: '#F2EDE3' }));
    }
    const span = Math.min(width * 0.8, 900);
    targets.forEach((t, i) => tokens.push({
      text: values[i % values.length],
      sx: Math.random() * width, sy: Math.random() * height,
      tx: width / 2 + t.x * span, ty: height * 0.48 + t.y * span * t.aspect,
      c: t.c, delay: Math.random() * 0.35,
    }));
    ctx.font = `500 11px ${getComputedStyle(root).getPropertyValue('--font-mono')}`;
    ctx.textAlign = 'center';
    const state = { p: 0, fade: 1 };
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = state.fade;
      for (const t of tokens) {
        const k = ease(Math.min(1, Math.max(0, (state.p - t.delay) / (1 - t.delay))));
        ctx.fillStyle = k > 0.85 ? t.c : '#F2EDE3';
        ctx.globalAlpha = state.fade * (0.35 + 0.65 * k);
        ctx.fillText(t.text, lerp(t.sx, t.tx, k), lerp(t.sy, t.ty, k));
      }
    };
    gsap.timeline({ onUpdate: draw })
      .to(state, { p: 1, duration: 1.6, ease: 'none' })
      .add(arrive(), 1.5)
      .to(loader, { opacity: 0, duration: 0.6, ease: 'power1.in' }, 1.7)
      .to(state, { fade: 0, duration: 0.6 }, 1.7)
      .call(() => { loader.remove(); lenis.start(); }, null, 2.3);
  }
  runLoader();

  // 1. arrival: the name drifts apart as the reader leaves the field
  gsap.timeline({ scrollTrigger: { trigger: '#arrive', start: 'top top', end: 'bottom top', scrub: true } })
    .to(letters, { x: i => (i - 2.5) * window.innerWidth * 0.06, yPercent: -40, opacity: 0, ease: 'none' }, 0)
    .to('.arrive .plate:not(.descent)', { scale: 1.1, ease: 'none' }, 0)
    .to(copy, { y: -60, opacity: 0, ease: 'none' }, 0);

  // 2. the window: the statement fills word by word, then the storm hits
  const statement = $('[data-fill]');
  const words = statement.textContent.trim().split(/\s+/);
  statement.setAttribute('aria-label', statement.textContent.trim());
  statement.replaceChildren(...words.flatMap((word, i) => {
    const span = Object.assign(document.createElement('span'), { className: 'w', textContent: word });
    span.setAttribute('aria-hidden', 'true');
    return i < words.length - 1 ? [span, ' '] : [span];
  }));
  gsap.set('.statement .w', { opacity: 0.2 });
  gsap.timeline({ scrollTrigger: { trigger: '.window-stage', start: 'top top', end: '+=180%', scrub: true, pin: true } })
    .to('.statement .w', { opacity: 1, stagger: 0.04, ease: 'none', duration: 0.1 }, 0)
    .to('.window-stage .storm', { opacity: 1, duration: 0.6, ease: 'none' }, '>-0.2')
    .to('.window-stage .plate', { scale: 1.05, duration: 1.2, ease: 'none' }, 0);

  // 3. two sources: raindrops gather into the gauge, then into the satellite
  const sourcesCanvas = $('.sources canvas');
  const readingColumn = (selector, values) => {
    const column = $(selector);
    column.replaceChildren(...values.map((v, i) => {
      const row = document.createElement('span');
      row.innerHTML = `${String(i + 1).padStart(2, '0')} <b>${fmt(v)}</b>`;
      return row;
    }));
  };
  readingColumn('[data-readings=station]', STATION);
  readingColumn('[data-readings=satellite]', SATELLITE);
  gsap.to('.readings.left', { yPercent: -12, ease: 'none', scrollTrigger: { trigger: '.sources', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.to('.readings.right', { yPercent: 12, ease: 'none', scrollTrigger: { trigger: '.sources', start: 'top bottom', end: 'bottom top', scrub: true } });

  const sourcesProgress = { p: 0 };
  let drawSources = () => {};
  gsap.to(sourcesProgress, { p: 1, ease: 'none', onUpdate: () => drawSources(), scrollTrigger: { trigger: '.sources-stage', start: 'top top', end: '+=220%', scrub: true, pin: true } });
  Promise.all([samplePoints('/images/scenes/s05a-600.webp', 2400), samplePoints('/images/scenes/s05b-600.webp', 2400)]).then(([gauge, satellite]) => {
    let view = fitCanvas(sourcesCanvas);
    const scatter = gauge.map(() => ({ x: Math.random(), y: Math.random() }));
    const progress = sourcesProgress;
    const draw = () => {
      const { ctx, width, height } = view;
      const span = Math.min(width * 0.42, height * 0.62);
      const cx = width / 2, cy = height * 0.68;
      const a = ease(Math.min(1, Math.max(0, (progress.p - 0.05) / 0.35)));
      const b = ease(Math.min(1, Math.max(0, (progress.p - 0.55) / 0.3)));
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < gauge.length; i++) {
        const g = gauge[i], s = satellite[i], r = scatter[i];
        const gx = cx + g.x * span, gy = cy + g.y * span * g.aspect;
        const sx = cx + s.x * span * 1.25, sy = cy + s.y * span * 1.25 * s.aspect;
        const x = lerp(lerp(r.x * width, gx, a), sx, b);
        const y = lerp(lerp(r.y * height, gy, a), sy, b);
        ctx.fillStyle = b > 0.5 ? s.c : a > 0.5 ? g.c : '#9CC0E0';
        ctx.globalAlpha = 0.6 + 0.4 * Math.max(a, b);
        ctx.fillRect(x, y, 2.6, a > 0.2 ? 2.6 : 6);
      }
    };
    drawSources = draw;
    window.addEventListener('resize', () => { view = fitCanvas(sourcesCanvas); draw(); });
    draw();
  }).catch(() => root.classList.remove('motion'));

  // 4. eight checks: the claim file lies stacked, then fans out; the three that caught Lagos light up
  const layers = $$('.layer');
  const caught = layers.filter(layer => layer.classList.contains('caught'));
  gsap.matchMedia().add('(min-width: 1024px)', () => {
    caught.forEach(layer => layer.classList.remove('caught'));
    const stack = $('.stack');
    const middle = stack.offsetHeight / 2;
    gsap.set(layers, { x: (i, el) => (stack.offsetWidth - el.offsetWidth) / 2 - el.offsetLeft, y: (i, el) => middle - el.offsetTop - el.offsetHeight / 2 + (i - layers.length / 2) * 8, rotateX: 52, transformPerspective: 1600, transformOrigin: '50% 50%' });
    gsap.timeline({
      scrollTrigger: {
        trigger: '.checks-stage', start: 'top top', end: '+=160%', scrub: true, pin: true,
        onUpdate: self => caught.forEach((layer, i) => layer.classList.toggle('caught', self.progress > 0.55 + i * 0.12)),
      },
    }).to(layers, { x: 0, y: 0, rotateX: 0, ease: 'power1.inOut', stagger: 0.03 });
    return () => caught.forEach(layer => layer.classList.add('caught'));
  });

  // 5. outcomes: scattered cards settle into a row
  gsap.matchMedia().add('(min-width: 721px)', () => {
    gsap.from('.card', {
      x: i => [-80, 40, -30, 90][i], y: i => [120, 40, 160, 70][i], rotate: i => [-6, 4, -3, 7][i], opacity: 0.4,
      ease: 'none', scrollTrigger: { trigger: '.cards', start: 'top 95%', end: 'top 35%', scrub: true },
    });
  });

  // 6. memory: clouds drift past
  gsap.to('.memory .cloud.a', { xPercent: -12, yPercent: -10, ease: 'none', scrollTrigger: { trigger: '.memory', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.to('.memory .cloud.b', { xPercent: 10, ease: 'none', scrollTrigger: { trigger: '.memory', start: 'top bottom', end: 'bottom top', scrub: true } });

  // 7. the rain sweeps in from the storm side and the field turns green
  const rainCanvas = $('.rain-stage canvas');
  let rainView = fitCanvas(rainCanvas);
  const drops = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), l: 10 + Math.random() * 26, v: 0.6 + Math.random() * 0.8 }));
  const rain = { p: 0, t: 0 };
  const drawRain = () => {
    const { ctx, width, height } = rainView;
    const density = Math.sin(Math.min(1, rain.p / 0.85) * Math.PI);
    ctx.clearRect(0, 0, width, height);
    if (density <= 0.01) return;
    ctx.strokeStyle = '#DCE6F0';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 * density;
    ctx.beginPath();
    const count = Math.floor(drops.length * density);
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      const x = ((d.x - rain.t * 0.04) % 1 + 1) % 1 * width;
      const y = ((d.y + rain.t * d.v) % 1) * height;
      ctx.moveTo(x, y);
      ctx.lineTo(x - d.l * 0.18, y + d.l);
    }
    ctx.stroke();
  };
  gsap.ticker.add(() => { if (rain.p > 0 && rain.p < 1) { rain.t += 0.012; drawRain(); } });
  window.addEventListener('resize', () => { rainView = fitCanvas(rainCanvas); });
  const rainLines = $$('.rain-copy p');
  gsap.set(rainLines, { opacity: 0, y: 30 });
  gsap.timeline({ scrollTrigger: { trigger: '.rain-stage', start: 'top top', end: '+=200%', scrub: true, pin: true }, onUpdate() { rain.p = this.progress(); drawRain(); } })
    .fromTo('.rain-stage .after', { maskPosition: '20% 0', webkitMaskPosition: '20% 0' }, { maskPosition: '80% 0', webkitMaskPosition: '80% 0', duration: 1, ease: 'power1.inOut' }, 0.1)
    .to(rainLines[0], { opacity: 1, y: 0, duration: 0.25 }, 0.35)
    .to(rainLines[1], { opacity: 1, y: 0, duration: 0.25 }, 0.75)
    .to({}, { duration: 0.2 });

  // 8. close: the line runs across the clouds
  gsap.fromTo('.marquee', { xPercent: 5 }, { xPercent: -45, ease: 'none', scrollTrigger: { trigger: '.close', start: 'top bottom', end: 'bottom top', scrub: true } });

  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
