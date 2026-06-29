const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));

function setupReveals() {
  if (!revealItems.length) return;

  revealItems.forEach((item, index) => {
    item.style.setProperty("--reveal-delay", `${Math.min(index % 4, 3) * 90}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.16 });

  revealItems.forEach((item) => observer.observe(item));
}

function supportsWebGL() {
  const probe = document.createElement("canvas");
  return Boolean(probe.getContext("webgl") || probe.getContext("experimental-webgl"));
}

setupReveals();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion) {
  document.body.classList.add("scene-reduced");
} else if (!supportsWebGL()) {
  document.body.classList.add("scene-no-webgl");
} else {
  try {
    const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js");
    setupScene(THREE);
  } catch (error) {
    console.warn("Propello scene disabled:", error);
    document.body.classList.add("scene-no-webgl");
  }
}

function setupScene(THREE) {
  const canvas = document.getElementById("propelloScene");
  if (!canvas) return;

  const isCompact = () => window.innerWidth < 760;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (edge0, edge1, value) => {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  };
  const pulse = (value, start, end) => {
    return smoothstep(start, start + 0.12, value) * (1 - smoothstep(end - 0.12, end, value));
  };

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    precision: "highp",
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const colors = {
    ink: 0x14161a,
    muted: 0x5b636f,
    blue: 0x1a56b0,
    navy: 0x0f2d6b,
    sky: 0x3b82f6,
    light: 0x60a5fa,
    tint: 0xeff6ff,
    border: 0xbfdbfe,
    white: 0xffffff
  };

  const root = new THREE.Group();
  scene.add(root);

  const configureTexture = (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  };

  function createPaperTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 768;
    textureCanvas.height = 1024;
    const context = textureCanvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 768, 1024);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.48, "#f8fbff");
    gradient.addColorStop(1, "#eef5ff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

    for (let index = 0; index < 3600; index += 1) {
      const alpha = 0.025 + Math.random() * 0.045;
      const shade = Math.random() > 0.55 ? "15, 45, 107" : "255, 255, 255";
      context.fillStyle = `rgba(${shade}, ${alpha})`;
      context.fillRect(Math.random() * 768, Math.random() * 1024, Math.random() * 1.8 + 0.4, Math.random() * 1.8 + 0.4);
    }

    context.strokeStyle = "rgba(15, 45, 107, 0.045)";
    context.lineWidth = 1;
    for (let y = 130; y < 900; y += 52) {
      context.beginPath();
      context.moveTo(82, y + Math.sin(y) * 1.8);
      context.lineTo(686, y + Math.cos(y) * 1.8);
      context.stroke();
    }

    return configureTexture(new THREE.CanvasTexture(textureCanvas));
  }

  function createAccentTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 512;
    textureCanvas.height = 256;
    const context = textureCanvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 512, 256);
    gradient.addColorStop(0, "#0F2D6B");
    gradient.addColorStop(0.5, "#1A56B0");
    gradient.addColorStop(1, "#60A5FA");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 256);
    context.fillStyle = "rgba(255, 255, 255, 0.22)";
    context.fillRect(0, 0, 512, 46);
    context.fillStyle = "rgba(255, 255, 255, 0.1)";
    context.beginPath();
    context.arc(388, 58, 150, 0, Math.PI * 2);
    context.fill();

    return configureTexture(new THREE.CanvasTexture(textureCanvas));
  }

  const paperTexture = createPaperTexture();
  const accentTexture = createAccentTexture();

  const makeMaterial = (color, opacity = 1, options = {}) => new THREE.MeshPhysicalMaterial({
    color,
    metalness: options.metalness ?? 0.04,
    roughness: options.roughness ?? 0.48,
    clearcoat: options.clearcoat ?? 0.2,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.28,
    map: options.map ?? null,
    bumpMap: options.bumpMap ?? null,
    bumpScale: options.bumpScale ?? 0,
    envMapIntensity: options.envMapIntensity ?? 0.85,
    transparent: true,
    opacity,
    side: THREE.DoubleSide
  });

  const materials = {
    page: makeMaterial(colors.white, 0.98, { map: paperTexture, bumpMap: paperTexture, bumpScale: 0.018, roughness: 0.38, clearcoat: 0.36 }),
    pageBack: makeMaterial(colors.tint, 0.82, { map: paperTexture, bumpMap: paperTexture, bumpScale: 0.012, roughness: 0.42 }),
    blue: makeMaterial(colors.blue, 0.96, { map: accentTexture, roughness: 0.31, clearcoat: 0.68, clearcoatRoughness: 0.18 }),
    navy: makeMaterial(colors.navy, 0.94, { map: accentTexture, roughness: 0.4, clearcoat: 0.48 }),
    sky: makeMaterial(colors.sky, 0.9, { roughness: 0.34, clearcoat: 0.62 }),
    light: makeMaterial(colors.light, 0.88, { roughness: 0.36, clearcoat: 0.56 }),
    muted: makeMaterial(colors.muted, 0.36, { metalness: 0, roughness: 0.58 }),
    rule: makeMaterial(colors.ink, 0.22, { metalness: 0, roughness: 0.7 }),
    borderLine: makeMaterial(colors.border, 0.66, { metalness: 0, roughness: 0.54 }),
    corner: makeMaterial(colors.tint, 0.92, { map: paperTexture, roughness: 0.44, clearcoat: 0.18 }),
    wire: makeMaterial(colors.border, 0.34, { metalness: 0, roughness: 0.7 })
  };

  const ambient = new THREE.AmbientLight(0xffffff, 0.82);
  const hemisphere = new THREE.HemisphereLight(0xffffff, colors.tint, 0.9);
  const key = new THREE.DirectionalLight(0xffffff, 4.2);
  key.position.set(3.6, 5.8, 5.2);
  key.castShadow = true;
  key.shadow.mapSize.set(isCompact() ? 1024 : 2048, isCompact() ? 1024 : 2048);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 16;
  key.shadow.bias = -0.00018;
  const fill = new THREE.DirectionalLight(0xbfd7ff, 1.2);
  fill.position.set(-3.2, -1.5, 3.5);
  const rim = new THREE.PointLight(colors.sky, 20, 16);
  rim.position.set(-4, 1.5, 2.5);
  scene.add(ambient, hemisphere, key, fill, rim);

  const docGroup = new THREE.Group();
  const scopeGroup = new THREE.Group();
  const pricingGroup = new THREE.Group();
  const trustGroup = new THREE.Group();
  const particleGroup = new THREE.Group();
  root.add(particleGroup, docGroup, scopeGroup, pricingGroup, trustGroup);

  function cloneMaterial(template) {
    const material = template.clone();
    material.userData.baseOpacity = template.opacity ?? 1;
    return material;
  }

  function prepareMesh(mesh, options = {}) {
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((material) => {
      material.userData.baseOpacity = material.opacity ?? 1;
    });
    return mesh;
  }

  function roundedRectShape(width, height, radius) {
    const x = -width / 2;
    const y = -height / 2;
    const shape = new THREE.Shape();
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius);
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    return shape;
  }

  function roundedBoxGeometry(width, height, depth, radius = 0.06, segments = 8) {
    const geometry = new THREE.ExtrudeGeometry(roundedRectShape(width, height, radius), {
      depth,
      bevelEnabled: true,
      bevelSegments: 4,
      bevelSize: Math.min(radius * 0.22, depth * 0.42),
      bevelThickness: Math.min(radius * 0.18, depth * 0.36),
      curveSegments: segments
    });
    geometry.center();
    return geometry;
  }

  function addBar(parent, width, height, x, y, z, material) {
    const bar = prepareMesh(new THREE.Mesh(roundedBoxGeometry(width, height, 0.045, Math.min(height / 2, 0.045), 6), cloneMaterial(material)));
    bar.position.set(x, y, z);
    parent.add(bar);
    return bar;
  }

  function createDocument(offsetX, offsetY, offsetZ, scale, material) {
    const group = new THREE.Group();
    const shadowMaterial = new THREE.ShadowMaterial({ color: 0x0f2d6b, opacity: 0.16, transparent: true });
    shadowMaterial.userData.baseOpacity = 0.16;
    const shadow = prepareMesh(new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.7), shadowMaterial), { castShadow: false, receiveShadow: true });
    shadow.position.set(0.04, -0.08, -0.08);
    group.add(shadow);

    const page = prepareMesh(new THREE.Mesh(roundedBoxGeometry(2.35, 3.25, 0.09, 0.095, 14), cloneMaterial(material)), { receiveShadow: true });
    page.position.z = 0;
    group.add(page);

    addBar(group, 2.03, 0.028, 0, 1.38, 0.08, materials.borderLine);
    addBar(group, 2.03, 0.028, 0, -1.38, 0.08, materials.borderLine);
    addBar(group, 0.028, 2.72, -1.03, 0, 0.08, materials.borderLine);
    addBar(group, 0.028, 2.72, 1.03, 0, 0.08, materials.borderLine);

    addBar(group, 1.52, 0.13, -0.18, 0.95, 0.12, materials.blue);
    addBar(group, 1.78, 0.07, -0.02, 0.5, 0.13, materials.rule);
    addBar(group, 1.38, 0.06, -0.22, 0.27, 0.13, materials.muted);
    addBar(group, 1.68, 0.06, -0.08, 0.04, 0.13, materials.muted);
    addBar(group, 1.05, 0.045, -0.38, -0.2, 0.13, materials.rule);
    addBar(group, 1.58, 0.045, -0.12, -0.38, 0.13, materials.rule);
    addBar(group, 0.92, 0.045, -0.45, -0.56, 0.13, materials.rule);

    for (let index = 0; index < 3; index += 1) {
      const tile = prepareMesh(new THREE.Mesh(roundedBoxGeometry(0.52, 0.62, 0.055, 0.06, 8), cloneMaterial(index === 1 ? materials.sky : materials.pageBack)), { receiveShadow: true });
      tile.position.set(-0.62 + index * 0.62, -0.82, 0.07);
      group.add(tile);
      addBar(group, 0.34, 0.028, -0.62 + index * 0.62, -0.74, 0.125, index === 1 ? materials.light : materials.borderLine);
      addBar(group, 0.24, 0.024, -0.62 + index * 0.62 - 0.04, -0.92, 0.125, materials.rule);
    }

    const cornerShape = new THREE.Shape();
    cornerShape.moveTo(0, 0);
    cornerShape.lineTo(0.32, 0);
    cornerShape.lineTo(0.32, -0.32);
    cornerShape.lineTo(0, 0);
    const cornerGeometry = new THREE.ExtrudeGeometry(cornerShape, {
      depth: 0.028,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.01,
      bevelThickness: 0.01
    });
    cornerGeometry.center();
    const corner = prepareMesh(new THREE.Mesh(cornerGeometry, cloneMaterial(materials.corner)));
    corner.position.set(0.88, 1.2, 0.14);
    corner.rotation.z = -0.02;
    group.add(corner);

    group.position.set(offsetX, offsetY, offsetZ);
    group.scale.setScalar(scale);
    return group;
  }

  const backDoc = createDocument(-0.35, -0.1, -0.42, 0.92, materials.pageBack);
  backDoc.rotation.set(0.18, -0.4, 0.1);
  const mainDoc = createDocument(0.18, 0.08, 0.18, 1, materials.page);
  mainDoc.rotation.set(0.08, -0.18, -0.07);
  docGroup.add(backDoc, mainDoc);

  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.2, -0.48);
  arrowShape.lineTo(0.2, -0.48);
  arrowShape.lineTo(0.2, 0.18);
  arrowShape.lineTo(0.48, 0.18);
  arrowShape.lineTo(0, 0.62);
  arrowShape.lineTo(-0.48, 0.18);
  arrowShape.lineTo(-0.2, 0.18);
  arrowShape.lineTo(-0.2, -0.48);
  const arrowGeometry = new THREE.ExtrudeGeometry(arrowShape, {
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    depth: 0.16
  });
  arrowGeometry.center();
  const arrow = prepareMesh(new THREE.Mesh(arrowGeometry, cloneMaterial(materials.light)));
  arrow.position.set(0.94, -1.08, 0.42);
  arrow.rotation.set(0.3, -0.24, -0.1);
  arrow.scale.setScalar(0.82);
  docGroup.add(arrow);

  for (let index = 0; index < 4; index += 1) {
    const block = prepareMesh(new THREE.Mesh(roundedBoxGeometry(1.35, 0.44, 0.18, 0.08, 10), cloneMaterial(index % 2 ? materials.sky : materials.blue)), { receiveShadow: true });
    block.position.set(-0.25 + (index % 2) * 0.6, 0.78 - index * 0.55, 0);
    block.rotation.set(0.04 * index, -0.2 + index * 0.08, -0.08);
    scopeGroup.add(block);
  }

  for (let index = 0; index < 5; index += 1) {
    const chip = prepareMesh(new THREE.Mesh(roundedBoxGeometry(1.05, 0.32, 0.16, 0.08, 10), cloneMaterial(index % 2 ? materials.light : materials.navy)), { receiveShadow: true });
    chip.position.set(-1.55 + index * 0.78, Math.sin(index) * 0.26, 0);
    chip.rotation.set(0.2, -0.28 + index * 0.08, 0.06 * index);
    pricingGroup.add(chip);
  }
  const totalRing = prepareMesh(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.035, 18, 128), cloneMaterial(materials.sky)));
  totalRing.position.set(0, -0.15, -0.2);
  totalRing.rotation.set(0.8, 0.1, 0.2);
  pricingGroup.add(totalRing);

  const trustFrameMaterial = new THREE.LineBasicMaterial({
    color: colors.border,
    transparent: true,
    opacity: 0.44
  });
  trustFrameMaterial.userData.baseOpacity = 0.44;
  const trustFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.2, 2.2, 2.2)), trustFrameMaterial);
  trustFrame.rotation.set(0.3, 0.7, 0.1);
  trustGroup.add(trustFrame);
  const trustCore = prepareMesh(new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 4), cloneMaterial(materials.blue)), { receiveShadow: true });
  trustCore.position.set(0, 0.02, 0.05);
  trustGroup.add(trustCore);
  for (let index = 0; index < 6; index += 1) {
    const dot = prepareMesh(new THREE.Mesh(new THREE.SphereGeometry(0.08, 28, 28), cloneMaterial(materials.light)));
    const angle = index * Math.PI / 3;
    dot.position.set(Math.cos(angle) * 1.45, Math.sin(angle) * 0.82, Math.sin(angle) * 0.55);
    trustGroup.add(dot);
  }

  const particleCount = isCompact() ? 220 : 520;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const radius = 3 + Math.random() * 4.5;
    const angle = Math.random() * Math.PI * 2;
    particlePositions[index * 3] = Math.cos(angle) * radius;
    particlePositions[index * 3 + 1] = -2.7 + Math.random() * 5.3;
    particlePositions[index * 3 + 2] = Math.sin(angle) * radius - 2.5;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color: colors.blue,
    size: 0.018,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particleGroup.add(particles);

  const grid = new THREE.GridHelper(12, 24, colors.border, colors.border);
  grid.position.y = -2.4;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.16;
  });
  root.add(grid);

  const pointer = { x: 0, y: 0 };
  const pointerTarget = { x: 0, y: 0 };
  let scrollProgress = 0;
  let targetScroll = 0;
  let rafId = 0;
  let running = true;
  let baseX = 1.45;

  function setGroupOpacity(group, opacity) {
    group.traverse((object) => {
      if (!object.material) return;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      mats.forEach((material) => {
        material.transparent = true;
        material.opacity = (material.userData.baseOpacity ?? material.opacity ?? 1) * opacity;
      });
    });
  }

  function updateScrollTarget() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    targetScroll = maxScroll > 0 ? clamp(window.scrollY / maxScroll, 0, 1) : 0;
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, isCompact() ? 1.5 : 2.25);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    baseX = isCompact() ? 0.2 : 1.55;
    root.scale.setScalar(isCompact() ? 0.72 : 1);
    updateScrollTarget();
  }

  function animate() {
    if (!running) return;
    rafId = window.requestAnimationFrame(animate);

    const elapsed = performance.now() * 0.001;
    scrollProgress += (targetScroll - scrollProgress) * 0.065;
    pointer.x += (pointerTarget.x - pointer.x) * 0.055;
    pointer.y += (pointerTarget.y - pointer.y) * 0.055;

    const p = scrollProgress;
    const scopeOpacity = pulse(p, 0.12, 0.56);
    const pricingOpacity = pulse(p, 0.34, 0.78);
    const trustOpacity = smoothstep(0.56, 0.76, p);
    const docOpacity = 1 - smoothstep(0.82, 0.98, p) * 0.28;

    setGroupOpacity(docGroup, docOpacity);
    setGroupOpacity(scopeGroup, scopeOpacity);
    setGroupOpacity(pricingGroup, pricingOpacity);
    setGroupOpacity(trustGroup, trustOpacity);

    root.position.x = THREE.MathUtils.lerp(baseX, isCompact() ? 0 : 0.35, smoothstep(0.66, 0.96, p));
    root.position.y = THREE.MathUtils.lerp(0, 0.42, smoothstep(0.78, 1, p));
    root.rotation.x = pointer.y * 0.1 - 0.1 + Math.sin(elapsed * 0.6) * 0.025;
    root.rotation.y = -0.2 + pointer.x * 0.18 + p * 0.95;

    docGroup.position.set(Math.sin(p * Math.PI) * -0.25, 0.1 - p * 0.35, 0);
    docGroup.rotation.y = -0.22 + p * 0.7;
    docGroup.rotation.z = Math.sin(elapsed * 0.5) * 0.025;

    scopeGroup.position.set(-1.45 + p * 1.8, -0.18 + Math.sin(elapsed * 0.85) * 0.05, 0.72);
    scopeGroup.rotation.y = -0.35 + p * 0.45;

    pricingGroup.position.set(0.08, -0.58 + Math.sin(elapsed * 0.7) * 0.06, 0.95);
    pricingGroup.rotation.y = 0.25 + p * 0.6;
    pricingGroup.rotation.z = -0.08;

    trustGroup.position.set(0.05, 0.04, 0.7);
    trustGroup.rotation.x += 0.002;
    trustGroup.rotation.y += 0.004;

    particles.rotation.y = elapsed * 0.025 + p * 0.45;
    particles.rotation.x = p * 0.08;
    particleMaterial.opacity = isCompact() ? 0.22 : 0.32 + Math.sin(elapsed * 0.5) * 0.04;

    grid.position.z = THREE.MathUtils.lerp(-1.3, 1.4, p);
    gridMaterials.forEach((material) => {
      material.opacity = 0.1 + smoothstep(0.2, 0.7, p) * 0.1;
    });

    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("scroll", updateScrollTarget, { passive: true });
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    pointerTarget.x = (event.clientX / window.innerWidth - 0.5) * 2;
    pointerTarget.y = (event.clientY / window.innerHeight - 0.5) * -2;
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      animate();
    } else {
      window.cancelAnimationFrame(rafId);
    }
  });

  resize();
  updateScrollTarget();
  setGroupOpacity(scopeGroup, 0);
  setGroupOpacity(pricingGroup, 0);
  setGroupOpacity(trustGroup, 0);
  document.body.classList.add("scene-ready");
  animate();
}
