/* ============================================================
   Propello marketing interactions
   Smooth scroll, reference-style reveals, nav state, mobile menu,
   lightweight parallax, counters, and reduced-motion fallback.
   ============================================================ */

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let lenis = null;

function closeMenu() {
  document.body.classList.remove("menu-open");
  const toggle = document.querySelector("[data-menu-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

async function initSmoothScroll() {
  if (prefersReducedMotion) return;

  try {
    const { default: Lenis } = await import(
      "https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.mjs"
    );

    lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
  } catch (error) {
    console.warn("Smooth scroll unavailable; using native scrolling.", error);
  }
}

function scrollToTarget(target) {
  const offset = -88;
  if (lenis) {
    lenis.scrollTo(target, { offset });
    return;
  }

  const top = target.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" });
}

function initAnchorLinks() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id.length < 2) return;

      const target = document.querySelector(id);
      if (!target) return;

      event.preventDefault();
      closeMenu();
      scrollToTarget(target);
    });
  });
}

function initMenu() {
  const toggle = document.querySelector("[data-menu-toggle]");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  document.querySelectorAll("[data-mobile-menu] a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

function initNavState() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  let ticking = false;
  const update = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 28);
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );

  update();
}

function initReveals() {
  const items = Array.from(document.querySelectorAll("[data-reveal]"));

  items.forEach((item) => {
    item.style.setProperty("--reveal-delay", `${item.dataset.revealDelay || 0}ms`);
  });

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
  );

  items.forEach((item) => observer.observe(item));
}

function animateCount(element) {
  const target = Number.parseFloat(element.dataset.count || "0");
  const decimals = (element.dataset.count || "").split(".")[1]?.length || 0;
  const prefix = element.dataset.prefix || "";
  const suffix = element.dataset.suffix || "";
  const duration = 1500;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = `${prefix}${(target * eased).toFixed(decimals)}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }

    element.textContent = `${prefix}${target.toFixed(decimals)}${suffix}`;
  }

  requestAnimationFrame(tick);
}

function initCounters() {
  const counters = Array.from(document.querySelectorAll("[data-count]"));
  if (!counters.length) return;

  const setFinal = (element) => {
    element.textContent = `${element.dataset.prefix || ""}${element.dataset.count || "0"}${element.dataset.suffix || ""}`;
  };

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    counters.forEach(setFinal);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCount(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.55 }
  );

  counters.forEach((counter) => observer.observe(counter));
}

function initPointerParallax() {
  if (prefersReducedMotion || window.matchMedia("(max-width: 900px)").matches) return;

  const targets = Array.from(document.querySelectorAll(".hero-visual, .proposal-stack--small, .price-hero-card"));
  if (!targets.length) return;

  window.addEventListener(
    "pointermove",
    (event) => {
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;

      targets.forEach((target, index) => {
        const depth = 10 + index * 4;
        target.style.setProperty("--px", `${x * depth}px`);
        target.style.setProperty("--py", `${y * depth}px`);
        target.style.translate = `var(--px) var(--py)`;
      });
    },
    { passive: true }
  );
}

function boot() {
  initMenu();
  initNavState();
  initReveals();
  initCounters();
  initAnchorLinks();
  initPointerParallax();
  initSmoothScroll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
