(() => {
  "use strict";

  const AUTOPLAY_DELAY = 5800;
  const TRANSITION_DURATION = 720;
  const MODULE_COUNT = 8;

  const initializeHomeStory = () => {
    const story = document.querySelector("[data-home-story]");
    if (!story) return;

    const elements = {
      title: story.querySelector("[data-story-title]"),
      eyebrow: story.querySelector("[data-story-eyebrow]"),
      summary: story.querySelector("[data-story-summary]"),
      topic: story.querySelector("[data-story-topic]"),
      number: story.querySelector("[data-story-number]"),
      phase: story.querySelector("[data-story-phase]"),
      link: story.querySelector("[data-story-link]"),
      dots: story.querySelector("[data-story-dots]"),
      previous: story.querySelector("[data-story-prev]"),
      toggle: story.querySelector("[data-story-toggle]"),
      next: story.querySelector("[data-story-next]")
    };
    const mediaLayers = Array.from(
      story.querySelectorAll("[data-story-media] [data-story-layer]")
    ).slice(0, 2);

    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const readText = (element, fallback) => normalizeText(element?.textContent) || fallback;

    const overview = {
      title: readText(elements.title, "EVIDENCE"),
      fullTitle: readText(elements.title, "EVIDENCE"),
      eyebrow: readText(
        elements.eyebrow,
        "University research workflow · Self-paced"
      ),
      summary: readText(
        elements.summary,
        "Turn raw movement signals into reproducible evidence—across eight guided stages."
      ),
      topic: readText(elements.topic, "LA PASSSTA Lab · UIUC"),
      number: readText(elements.number, "00"),
      phase: readText(elements.phase, "Course overview"),
      phaseMarkup: elements.phase?.innerHTML || "Course overview",
      href: "intake.html",
      linkText: "Begin the course",
      image: "images/course-hero.webp",
      moduleNumber: 0
    };

    const moduleLinks = Array.from(document.querySelectorAll(".module-card a[href]")).slice(
      0,
      MODULE_COUNT
    );
    const moduleSlides = moduleLinks.map((link, index) => {
      const moduleNumber = index + 1;
      const metadata = readText(link.querySelector("span"), "");
      const metadataParts = metadata
        .split("·")
        .map((part) => normalizeText(part))
        .filter(Boolean);
      const phase = metadataParts[0] || `Stage ${moduleNumber}`;
      const hasModuleLabel = /^module\s+\d+/i.test(metadataParts[1] || "");
      const detailStart = hasModuleLabel ? 2 : 1;
      const topic = metadataParts.slice(detailStart).join(" · ") || `Stage ${moduleNumber}`;
      const title = readText(link.querySelector("strong"), `Module ${moduleNumber}`);
      const summary = readText(
        link.querySelector(".card-text, p"),
        `Explore ${title}.`
      );

      return {
        title: phase,
        fullTitle: title,
        eyebrow: `Module ${moduleNumber} of ${MODULE_COUNT} · ${title}`,
        summary,
        topic,
        number: String(moduleNumber).padStart(2, "0"),
        phase,
        href: link.getAttribute("href") || link.href,
        linkText: `Open module ${moduleNumber}`,
        image: `images/module-${moduleNumber}-hero.webp`,
        moduleNumber
      };
    });
    const slides = [overview, ...moduleSlides];
    if (slides.length < 2) return;

    const reducedMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let prefersReducedMotion = Boolean(reducedMotionQuery?.matches);
    let currentIndex = 0;
    let activeLayerIndex = Math.max(
      0,
      mediaLayers.findIndex((layer) => layer.classList.contains("is-active"))
    );
    let autoplayTimer = null;
    let transitionTimer = null;
    let announcementTimer = null;
    let mediaRequestId = 0;
    let userPaused = false;
    let pointerInside = false;
    let focusInside = false;
    let pageSuspended = false;
    const imageCache = new Map();

    const changingElements = [
      elements.title,
      elements.eyebrow,
      elements.summary,
      elements.topic,
      elements.number,
      elements.phase,
      elements.link
    ].filter(Boolean);

    let liveStatus = story.querySelector("[data-story-status]");
    if (!liveStatus) {
      liveStatus = document.createElement("p");
      liveStatus.className = "visually-hidden";
      liveStatus.setAttribute("data-story-status", "");
      liveStatus.setAttribute("role", "status");
      liveStatus.setAttribute("aria-live", "polite");
      liveStatus.setAttribute("aria-atomic", "true");
      story.append(liveStatus);
    }

    if (!story.hasAttribute("role")) story.setAttribute("role", "region");
    story.setAttribute("aria-roledescription", "carousel");
    if (!story.hasAttribute("tabindex")) story.setAttribute("tabindex", "0");
    if (elements.dots) elements.dots.setAttribute("role", "group");
    const controls = elements.previous?.closest(".home-story__controls");
    if (controls && !controls.hasAttribute("role")) controls.setAttribute("role", "group");

    const loadImage = (source) => {
      if (imageCache.has(source)) return imageCache.get(source);
      if (typeof window.Image !== "function") return Promise.resolve(true);

      const promise = new Promise((resolve) => {
        const image = new window.Image();
        let settled = false;

        const finish = (loaded) => {
          if (settled) return;
          settled = true;

          if (loaded && typeof image.decode === "function") {
            image
              .decode()
              .catch(() => undefined)
              .then(() => resolve(true));
          } else {
            resolve(loaded);
          }
        };

        image.decoding = "async";
        image.addEventListener("load", () => finish(true), { once: true });
        image.addEventListener("error", () => finish(false), { once: true });
        image.src = source;
        if (image.complete) finish(image.naturalWidth > 0);
      });

      imageCache.set(source, promise);
      return promise;
    };

    const setBackground = (layer, image) => {
      if (!layer) return;
      const imageValue = `url("${image}")`;
      layer.style.setProperty("--story-image", imageValue);
      layer.style.backgroundImage = imageValue;
      layer.setAttribute("aria-hidden", "true");
    };

    const applyMedia = (slide, immediate = false) => {
      if (!mediaLayers.length) return;

      if (immediate || mediaLayers.length === 1) {
        const activeLayer = mediaLayers[activeLayerIndex] || mediaLayers[0];
        setBackground(activeLayer, slide.image);
        mediaLayers.forEach((layer) => {
          layer.classList.toggle("is-active", layer === activeLayer);
        });
        return;
      }

      const nextLayerIndex = (activeLayerIndex + 1) % mediaLayers.length;
      const currentLayer = mediaLayers[activeLayerIndex];
      const nextLayer = mediaLayers[nextLayerIndex];

      // A rapid second navigation can catch this layer mid-fade. Reset it invisibly
      // before swapping its image so a partially visible old frame never flashes.
      nextLayer.style.transition = "none";
      nextLayer.style.opacity = "0";
      nextLayer.classList.remove("is-active");
      setBackground(nextLayer, slide.image);
      void nextLayer.offsetWidth;
      nextLayer.style.removeProperty("transition");
      nextLayer.style.removeProperty("opacity");
      void nextLayer.offsetWidth;

      currentLayer?.classList.remove("is-active");
      nextLayer.classList.add("is-active");
      activeLayerIndex = nextLayerIndex;
    };

    const updateMedia = (slide, { immediate = false, initial = false } = {}) => {
      const requestId = ++mediaRequestId;
      if (initial) {
        applyMedia(slide, true);
        return;
      }

      loadImage(slide.image).then((loaded) => {
        if (!loaded || requestId !== mediaRequestId) return;
        applyMedia(slide, immediate || prefersReducedMotion);
      });
    };

    const preloadAdjacentImages = () => {
      const previousIndex = (currentIndex - 1 + slides.length) % slides.length;
      const nextIndex = (currentIndex + 1) % slides.length;
      loadImage(slides[previousIndex].image);
      loadImage(slides[nextIndex].image);
    };

    const setElementText = (element, value) => {
      if (element) element.textContent = value;
    };

    const setChapterLink = (slide) => {
      const link = elements.link;
      if (!link) return;

      link.setAttribute("href", slide.href);
      link.setAttribute("aria-label", slide.linkText);

      const labelNode = Array.from(link.childNodes).find(
        (node) => node.nodeType === 3 && normalizeText(node.textContent)
      );
      if (labelNode) {
        labelNode.textContent = `${slide.linkText} `;
      } else {
        link.prepend(document.createTextNode(`${slide.linkText} `));
      }
    };

    const updateDots = () => {
      if (!elements.dots) return;
      Array.from(elements.dots.querySelectorAll("button")).forEach((dot, index) => {
        const isCurrent = index === currentIndex;
        dot.classList.toggle("is-active", isCurrent);
        dot.setAttribute("aria-current", isCurrent ? "true" : "false");
        dot.tabIndex = isCurrent ? 0 : -1;
      });
    };

    const announceSlide = (slide) => {
      if (!liveStatus) return;
      if (announcementTimer !== null) window.clearTimeout(announcementTimer);
      liveStatus.textContent = "";
      announcementTimer = window.setTimeout(() => {
        const announcedTitle = slide.moduleNumber
          ? `Module ${slide.moduleNumber}: ${slide.fullTitle}. ${slide.phase} stage.`
          : `${slide.fullTitle}.`;
        liveStatus.textContent = `Slide ${currentIndex + 1} of ${slides.length}: ${announcedTitle} ${slide.summary}`;
        announcementTimer = null;
      }, 80);
    };

    const clearTransition = () => {
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      transitionTimer = null;
      story.classList.remove("is-transitioning");
      changingElements.forEach((element) => element.classList.remove("is-changing"));
    };

    const updateToggle = () => {
      if (!elements.toggle) return;

      const effectivelyPaused = userPaused || prefersReducedMotion;
      elements.toggle.dataset.paused = effectivelyPaused ? "true" : "false";
      elements.toggle.removeAttribute("aria-pressed");
      elements.toggle.textContent = effectivelyPaused ? "Play" : "Pause";
      elements.toggle.disabled = prefersReducedMotion;
      elements.toggle.setAttribute(
        "aria-label",
        effectivelyPaused
          ? "Play automatic course story playback"
          : "Pause automatic course story playback"
      );
    };

    const clearAutoplay = () => {
      if (autoplayTimer !== null) window.clearTimeout(autoplayTimer);
      autoplayTimer = null;
    };

    const canAutoplay = () =>
      !prefersReducedMotion &&
      !userPaused &&
      !pointerInside &&
      !focusInside &&
      !pageSuspended &&
      !document.hidden;

    const scheduleAutoplay = () => {
      clearAutoplay();
      if (!canAutoplay()) return;

      autoplayTimer = window.setTimeout(() => {
        showSlide(currentIndex + 1, { source: "autoplay" });
      }, AUTOPLAY_DELAY);
    };

    const showSlide = (requestedIndex, options = {}) => {
      const source = options.source || "control";
      const initial = Boolean(options.initial);
      const nextIndex = ((requestedIndex % slides.length) + slides.length) % slides.length;

      if (!initial && nextIndex === currentIndex) {
        scheduleAutoplay();
        return;
      }

      currentIndex = nextIndex;
      const slide = slides[currentIndex];
      const immediate = initial || prefersReducedMotion;

      clearTransition();
      updateMedia(slide, { immediate, initial });

      setElementText(elements.title, slide.title);
      setElementText(elements.eyebrow, slide.eyebrow);
      setElementText(elements.summary, slide.summary);
      setElementText(elements.topic, slide.topic);
      setElementText(elements.number, slide.number);
      if (elements.phase) {
        if (slide.moduleNumber === 0 && slide.phaseMarkup) {
          elements.phase.innerHTML = slide.phaseMarkup;
        } else {
          elements.phase.textContent = slide.phase;
        }
      }
      setChapterLink(slide);
      updateDots();

      if (!immediate) {
        // Re-adding these hooks restarts the CSS text reveal on rapid navigation.
        void story.offsetWidth;
        story.classList.add("is-transitioning");
        changingElements.forEach((element) => element.classList.add("is-changing"));
        transitionTimer = window.setTimeout(clearTransition, TRANSITION_DURATION);
      }

      if (!initial && source !== "autoplay") announceSlide(slide);
      preloadAdjacentImages();
      scheduleAutoplay();
    };

    if (elements.dots) {
      while (elements.dots.firstChild) elements.dots.firstChild.remove();
      slides.forEach((slide, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "home-story__dot";
        dot.setAttribute(
          "aria-label",
          index === 0
            ? "Show course overview"
            : `Show module ${slide.moduleNumber}: ${slide.fullTitle}`
        );
        dot.textContent = String(index).padStart(2, "0");
        dot.addEventListener("click", () => showSlide(index, { source: "dot" }));
        elements.dots.append(dot);
      });
    }

    elements.previous?.addEventListener("click", (event) => {
      event.preventDefault();
      showSlide(currentIndex - 1, { source: "previous" });
    });

    elements.next?.addEventListener("click", (event) => {
      event.preventDefault();
      showSlide(currentIndex + 1, { source: "next" });
    });

    elements.toggle?.addEventListener("click", (event) => {
      event.preventDefault();
      if (prefersReducedMotion) return;
      userPaused = !userPaused;
      if (!userPaused) {
        // An explicit Play command overrides the temporary hover/focus hold until
        // the pointer or focus leaves and enters the carousel again.
        pointerInside = false;
        focusInside = false;
      }
      updateToggle();
      scheduleAutoplay();
    });

    story.addEventListener("keydown", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showSlide(currentIndex - 1, { source: "keyboard" });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showSlide(currentIndex + 1, { source: "keyboard" });
      } else {
        return;
      }

      if (
        target instanceof HTMLElement &&
        target.matches("[data-story-dots] button")
      ) {
        elements.dots
          ?.querySelector('button[aria-current="true"]')
          ?.focus({ preventScroll: true });
      }
    });

    story.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      pointerInside = true;
      scheduleAutoplay();
    });

    story.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      pointerInside = false;
      scheduleAutoplay();
    });

    story.addEventListener("focusin", () => {
      focusInside = true;
      scheduleAutoplay();
    });

    story.addEventListener("focusout", () => {
      window.setTimeout(() => {
        focusInside = story.contains(document.activeElement);
        scheduleAutoplay();
      }, 0);
    });

    document.addEventListener("visibilitychange", scheduleAutoplay);
    window.addEventListener("pagehide", () => {
      pageSuspended = true;
      clearAutoplay();
      clearTransition();
      if (announcementTimer !== null) window.clearTimeout(announcementTimer);
    });

    window.addEventListener("pageshow", () => {
      pageSuspended = false;
      scheduleAutoplay();
    });

    const handleReducedMotionChange = (event) => {
      prefersReducedMotion = event.matches;
      story.classList.toggle("is-reduced-motion", prefersReducedMotion);
      if (prefersReducedMotion) clearTransition();
      updateToggle();
      scheduleAutoplay();
    };

    if (reducedMotionQuery) {
      if (typeof reducedMotionQuery.addEventListener === "function") {
        reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
      } else if (typeof reducedMotionQuery.addListener === "function") {
        reducedMotionQuery.addListener(handleReducedMotionChange);
      }
    }

    story.classList.add("is-enhanced", "is-ready");
    story.classList.toggle("is-reduced-motion", prefersReducedMotion);
    updateToggle();
    showSlide(0, { initial: true, source: "initial" });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeHomeStory, { once: true });
  } else {
    initializeHomeStory();
  }
})();
