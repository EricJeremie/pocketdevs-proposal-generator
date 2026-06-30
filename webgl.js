/* ============================================================
   Propello landing page — WebGL background
   A fixed, full-screen Three.js scene that sits behind all
   content. Renders a floating 3D proposal document under studio
   lighting, then uses GSAP ScrollTrigger to scrub its rotation,
   scale, and position to the page's scroll progress.

   Loaded after three.min.js, gsap.min.js and ScrollTrigger.min.js.
   Fails quietly (page still works) if WebGL/those libs are missing.
   ============================================================ */
(function () {
  'use strict';

  const canvas = document.getElementById('bg-canvas');
  if (!canvas || !window.THREE || !window.gsap || !window.ScrollTrigger) return;

  const THREE = window.THREE;
  const gsap = window.gsap;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  gsap.registerPlugin(window.ScrollTrigger);

  /* ---------- Renderer ---------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    // No WebGL support — leave the page as-is.
    console.warn('WebGL unavailable; skipping 3D background.', err && err.message);
    return;
  }
  // Cap the backing-store resolution so the per-frame render cost stays bounded.
  // Ultrawide (and other very large) viewports otherwise push tens of millions
  // of pixels per frame, which starves the scroll/Lenis frame budget and makes
  // the scroll-scrubbed animation stutter. The background is a soft, decorative
  // object, so a slightly lower internal resolution is imperceptible.
  function targetPixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = window.innerWidth / window.innerHeight;
    // Ultrawide screens (≈21:9 and wider) get a tighter budget; normal screens
    // keep full DPR but still cap extreme cases (e.g. 5K retina desktops).
    const widthBudget = aspect >= 2.2 ? 2600 : 3600;
    const backingWidth = window.innerWidth * dpr;
    // Scale the ratio down to meet the budget, but never below 0.5 (half-res)
    // so the background never turns to mush on extreme super-ultrawide screens.
    if (backingWidth > widthBudget) return Math.max(0.5, widthBudget / window.innerWidth);
    return dpr;
  }

  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  /* ---------- Scene + camera ---------- */
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  // Pull the camera back on smaller screens so the object never feels cramped.
  function cameraDistance() {
    const w = window.innerWidth;
    if (w < 600) return 19;
    if (w < 1024) return 16;
    return 13.5;
  }
  camera.position.set(0, 0, cameraDistance());
  camera.lookAt(0, 0, 0);

  /* ---------- Studio lighting ---------- */
  scene.add(new THREE.AmbientLight(0x4866a8, 0.85));

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.0); // main studio key
  keyLight.position.set(6, 8, 7);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x90b4ff, 1.1); // cool fill
  fillLight.position.set(-7, 3, -4);
  scene.add(fillLight);

  const rimSky = new THREE.PointLight(0x3b82f6, 2.4, 60); // brand-blue rim
  rimSky.position.set(-8, -3, 6);
  scene.add(rimSky);

  const rimAccent = new THREE.PointLight(0x9ec5ff, 2.0, 60); // light-blue accent
  rimAccent.position.set(8, 4, -6);
  scene.add(rimAccent);

  /* ---------- The proposal document ----------
     A floating, slightly tilted proposal: a rounded page carrying a
     brand-blue title bar, body text lines, and a price block, backed
     by two offset pages so it reads as a proposal "stack".
     pivot = scroll-driven transforms · doc = gentle idle float. */
  const pivot = new THREE.Group();
  const doc = new THREE.Group();
  pivot.add(doc);
  scene.add(pivot);

  const PAGE_W = 4.3, PAGE_H = 5.9, PAGE_D = 0.16, CORNER = 0.28;
  const MARGIN = 0.55;
  const xLeft = -PAGE_W / 2 + MARGIN;        // left text margin
  const faceZ = PAGE_D / 2 + 0.06;           // content sits just above the page face

  function roundedRect(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function makePage(color) {
    const geo = new THREE.ExtrudeGeometry(roundedRect(PAGE_W, PAGE_H, CORNER), {
      depth: PAGE_D, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 18,
    });
    geo.center();
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.72, metalness: 0.0, emissive: 0x0a1a3a, emissiveIntensity: 0.06,
    });
    return new THREE.Mesh(geo, mat);
  }

  // Two pages peeking out behind the front page.
  const back1 = makePage(0xccd8ec); back1.position.set(-0.45, 0.42, -0.22); back1.rotation.z = 0.06; doc.add(back1);
  const back2 = makePage(0xdbe5f3); back2.position.set(0.42, -0.30, -0.42); back2.rotation.z = -0.05; doc.add(back2);

  // Front page (carries the content).
  doc.add(makePage(0xf3f7fd));

  // Content helpers.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb6c4db, roughness: 0.85, metalness: 0.0 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.42, metalness: 0.12, emissive: 0x123a78, emissiveIntensity: 0.28 });

  function addBar(width, height, y, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.05), mat || bodyMat);
    m.position.set(xLeft + width / 2, y, faceZ);
    doc.add(m);
  }

  addBar(2.0, 0.42, PAGE_H / 2 - 0.85, blueMat);   // title bar
  addBar(2.7, 0.16, PAGE_H / 2 - 1.45);            // subtitle
  // Paragraph 1
  addBar(3.0, 0.15, 1.05);
  addBar(2.6, 0.15, 0.72);
  addBar(2.9, 0.15, 0.39);
  // Paragraph 2
  addBar(2.8, 0.15, -0.25);
  addBar(3.0, 0.15, -0.58);
  addBar(2.2, 0.15, -0.91);
  // Price / signature block
  addBar(1.5, 0.5, -PAGE_H / 2 + 0.95, blueMat);

  // A pleasant resting 3/4 pose; idle float is layered on top of this.
  doc.rotation.set(-0.12, -0.42, 0.02);
  const baseRotZ = doc.rotation.z;

  /* ---------- Scroll-driven animation (GSAP ScrollTrigger) ---------- */
  // One timeline scrubbed across the whole document: as the page scrolls,
  // the proposal turns, breathes (scale), and drifts side to side.
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      scrub: reduceMotion ? true : 1, // smooth catch-up while scrolling
    },
  });

  // The timeline spans 0 → 1 (top → bottom of the page). Rotation runs
  // continuously across the whole scroll; position and scale weave through
  // four explicit segments placed at 0, 0.25, 0.5, 0.75 so they stay in sync.
  const S = 0.25;
  const E = 'power1.inOut';

  tl.to(pivot.rotation, { duration: 1, y: Math.PI * 4, x: 0.5, ease: 'none' }, 0);

  tl.to(pivot.position, { x: 3.2, y: -1.3, duration: S, ease: E }, 0)
    .to(pivot.position, { x: -3.4, y: 1.1, duration: S, ease: E }, S)
    .to(pivot.position, { x: 2.4, y: -0.6, duration: S, ease: E }, S * 2)
    .to(pivot.position, { x: 0, y: 0, duration: S, ease: E }, S * 3);

  tl.to(pivot.scale, { x: 1.25, y: 1.25, z: 1.25, duration: S, ease: E }, 0)
    .to(pivot.scale, { x: 0.85, y: 0.85, z: 0.85, duration: S, ease: E }, S)
    .to(pivot.scale, { x: 1.12, y: 1.12, z: 1.12, duration: S, ease: E }, S * 2)
    .to(pivot.scale, { x: 1, y: 1, z: 1, duration: S, ease: E }, S * 3);

  /* ---------- Subtle pointer parallax (desktop only) ---------- */
  let pointerX = 0, pointerY = 0;
  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      pointerX = (e.clientX / window.innerWidth - 0.5);
      pointerY = (e.clientY / window.innerHeight - 0.5);
    }, { passive: true });
  }

  /* ---------- Render loop ---------- */
  const clock = new THREE.Clock();
  function render() {
    const t = clock.getElapsedTime();
    // Gentle idle float so the proposal stays alive when not scrolling.
    if (!reduceMotion) {
      doc.position.y = Math.sin(t * 0.7) * 0.12;
      doc.rotation.z = baseRotZ + Math.sin(t * 0.5) * 0.025;
    }
    // Ease the camera toward the pointer for a soft parallax feel.
    const baseZ = camera.position.z;
    camera.position.x += (pointerX * 1.4 - camera.position.x) * 0.04;
    camera.position.y += (-pointerY * 1.0 - camera.position.y) * 0.04;
    camera.position.z = baseZ;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  /* ---------- Auto-resize ---------- */
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.position.z = cameraDistance();
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(targetPixelRatio());
      renderer.setSize(w, h, false);
      window.ScrollTrigger.refresh();
    });
  }, { passive: true });
})();
