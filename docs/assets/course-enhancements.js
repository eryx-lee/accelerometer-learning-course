(() => {
  "use strict";

  const modules = [
    { number: 1, title: "Accelerometer Introduction", file: "accelerometer-introduction.html" },
    { number: 2, title: "Programming and Downloading", file: "accelerometer-programming-and-downloading.html" },
    { number: 3, title: "Organizing and Converting", file: "organizing-and-converting.html" },
    { number: 4, title: "Setting Up R and GGIR", file: "setting-up-r-and-ggir.html" },
    { number: 5, title: "Checking Data Quality", file: "checking-data-quality.html" },
    { number: 6, title: "Cleaning and Standardizing", file: "cleaning-and-standardizing.html" },
    { number: 7, title: "Final Dataset in Stata", file: "setting-up-final-dataset-in-stata.html" },
    { number: 8, title: "Knowledge Checking", file: "knowledge-checking.html" }
  ];
  const storageKey = "accelerometer-course-progress-v1";
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const currentFile = window.location.pathname.endsWith("/")
    ? "index.html"
    : pathParts.pop() || "index.html";
  const currentIndex = modules.findIndex((module) => module.file === currentFile);

  const createElement = (tag, className, textContent) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
  };

  const loadProgress = () => {
    const empty = { completed: [], lastModule: null };
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey));
      if (!stored || typeof stored !== "object") return empty;
      return {
        completed: Array.isArray(stored.completed)
          ? stored.completed.filter((file) => modules.some((module) => module.file === file))
          : [],
        lastModule: modules.some((module) => module.file === stored.lastModule)
          ? stored.lastModule
          : null
      };
    } catch (_error) {
      return empty;
    }
  };

  const saveProgress = (progress) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch (_error) {
      // Course content and navigation remain available when storage is blocked.
    }
  };

  const progress = loadProgress();
  if (currentIndex >= 0) {
    progress.lastModule = modules[currentIndex].file;
    saveProgress(progress);
  }

  const normalizeLinkFile = (link) => {
    try {
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return url.pathname.split("/").filter(Boolean).pop() || "index.html";
    } catch (_error) {
      return null;
    }
  };

  const setMainLandmark = () => {
    const main = document.querySelector("#quarto-document-content");
    const visibleTitle = document.querySelector(".site-hero h1, .lesson-hero h1");
    const generatedTitle = document.querySelector("#title-block-header");
    const skipLink = document.querySelector(".skip-link");

    if (skipLink && skipLink.parentElement !== document.body) {
      document.body.prepend(skipLink);
    }

    if (!main) return;

    if (!visibleTitle) {
      const generatedHeading = generatedTitle?.querySelector("h1");
      if (!generatedHeading) return;
      if (!generatedHeading.id) generatedHeading.id = "page-title";
      main.setAttribute("aria-labelledby", generatedHeading.id);
      main.setAttribute("tabindex", "-1");
      return;
    }

    if (generatedTitle) generatedTitle.setAttribute("aria-hidden", "true");

    if (!visibleTitle.id) visibleTitle.id = "page-title";
    main.setAttribute("aria-labelledby", visibleTitle.id);
    main.setAttribute("tabindex", "-1");

    if (skipLink) {
      skipLink.addEventListener("click", () => {
        window.setTimeout(() => main.focus({ preventScroll: true }), 0);
      });
    }
  };

  const enhanceNavbar = () => {
    const navbar = document.querySelector("#quarto-header nav");
    if (!navbar) return;

    navbar.setAttribute("aria-label", "Primary");
    const toggler = navbar.querySelector(".navbar-toggler");
    if (toggler) {
      toggler.removeAttribute("role");
      const updateTogglerLabel = () => {
        const expanded = toggler.getAttribute("aria-expanded") === "true";
        toggler.setAttribute("aria-label", expanded ? "Close site navigation" : "Open site navigation");
      };
      updateTogglerLabel();
      new MutationObserver(updateTogglerLabel).observe(toggler, {
        attributes: true,
        attributeFilter: ["aria-expanded"]
      });
    }

    const modulesToggle = navbar.querySelector("#nav-menu-modules");
    if (modulesToggle) {
      modulesToggle.setAttribute("role", "button");
      modulesToggle.setAttribute("aria-haspopup", "true");
      modulesToggle.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          event.preventDefault();
          modulesToggle.click();
        }
      });
    }

    const dropdown = navbar.querySelector('[aria-labelledby="nav-menu-modules"]');
    if (dropdown) dropdown.setAttribute("aria-label", "Course modules");

    navbar.querySelectorAll(".nav-link.active, .dropdown-item.active, [aria-current=\"page\"]").forEach((link) => {
      link.removeAttribute("aria-current");
      link.classList.remove("active");
    });

    const matches = Array.from(navbar.querySelectorAll("a[href]"))
      .filter((link) => normalizeLinkFile(link) === currentFile);
    const courseHomeLink = Array.from(navbar.querySelectorAll(".nav-link"))
      .find((link) => link.querySelector(".menu-text")?.textContent.trim() === "Course");
    const currentLink = currentFile === "index.html"
      ? courseHomeLink
      : matches.find((link) => link.classList.contains("dropdown-item")) || matches[0];
    if (currentLink) {
      currentLink.setAttribute("aria-current", "page");
      currentLink.classList.add("active");
      const parentDropdown = currentLink.closest(".dropdown");
      const parentToggle = parentDropdown?.querySelector(".dropdown-toggle");
      if (parentToggle) parentToggle.classList.add("active");
    }

    const fullTitle = "Accelerometer Learning Course";
    const navbarTitle = navbar.querySelector(".navbar-title");
    const compactQuery = window.matchMedia("(max-width: 640px)");
    const updateNavbarTitle = () => {
      if (!navbarTitle) return;
      navbarTitle.textContent = compactQuery.matches ? "Course" : fullTitle;
      navbarTitle.setAttribute("title", fullTitle);
    };
    updateNavbarTitle();
    compactQuery.addEventListener?.("change", updateNavbarTitle);

    const actionLink = navbar.querySelector(".navbar-nav.ms-auto .nav-link");
    if (!actionLink) return;
    const resumeModule = modules.find((module) => module.file === progress.lastModule);
    const actionText = actionLink.querySelector(".menu-text") || actionLink;
    if (currentIndex >= 0) {
      actionLink.href = "#course-progress";
      actionText.textContent = "Progress";
    } else if (resumeModule) {
      actionLink.href = resumeModule.file;
      actionText.textContent = `Resume Module ${resumeModule.number}`;
    }
  };

  const updateHomeProgress = () => {
    const home = document.querySelector(".course-home");
    if (!home) return;

    const resumeModule = modules.find((module) => module.file === progress.lastModule);
    const primaryAction = home.querySelector(".hero-actions .button-primary");
    if (primaryAction && resumeModule) {
      primaryAction.href = resumeModule.file;
      primaryAction.textContent = progress.completed.length === modules.length
        ? "Review the course"
        : `Continue Module ${resumeModule.number}`;
    }

    document.querySelectorAll(".module-card a[href]").forEach((link) => {
      const file = normalizeLinkFile(link);
      const module = modules.find((item) => item.file === file);
      if (!module) return;

      const card = link.closest(".module-card");
      const oldStatus = link.querySelector(".module-progress-status");
      if (oldStatus) oldStatus.remove();
      card?.classList.remove("module-card-complete", "module-card-current");

      let statusText = "";
      if (progress.completed.includes(file)) {
        card?.classList.add("module-card-complete");
        statusText = "✓ Completed";
      } else if (file === progress.lastModule) {
        card?.classList.add("module-card-current");
        statusText = "Continue here";
      }

      if (statusText) {
        link.append(createElement("span", "module-progress-status", statusText));
      }
    });
  };

  const buildProgressPanel = () => {
    if (currentIndex < 0) return;
    const lessonMain = document.querySelector(".lesson-main");
    if (!lessonMain || document.querySelector("#course-progress")) return;

    const currentModule = modules[currentIndex];
    const previousModule = modules[currentIndex - 1];
    const nextModule = modules[currentIndex + 1];
    const panel = createElement("nav", "course-progress");
    panel.id = "course-progress";
    panel.setAttribute("aria-label", "Course progress and module navigation");

    const heading = createElement("div", "course-progress__heading");
    const title = createElement("strong", "", `Module ${currentModule.number} of ${modules.length}`);
    const status = createElement("span", "course-progress__status");
    heading.append(title, status);

    const track = createElement("div", "course-progress__track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Course completion");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(modules.length));
    const fill = createElement("span", "course-progress__fill");
    track.append(fill);

    const actions = createElement("div", "course-progress__actions");
    const previous = createElement(
      "a",
      "course-progress__link course-progress__previous",
      previousModule ? `← Module ${previousModule.number}` : "← Course home"
    );
    previous.href = previousModule?.file || "index.html#course-modules";

    const completeButton = createElement("button", "course-progress__complete");
    completeButton.type = "button";

    const next = createElement(
      "a",
      "course-progress__link course-progress__next",
      nextModule ? `Module ${nextModule.number} →` : "Finish course →"
    );
    next.href = nextModule?.file || "completion.html";
    actions.append(previous, completeButton, next);
    panel.append(heading, track, actions);
    lessonMain.prepend(panel);

    const renderProgress = () => {
      const isComplete = progress.completed.includes(currentModule.file);
      const completedCount = progress.completed.length;
      status.textContent = `${completedCount} of ${modules.length} completed`;
      track.setAttribute("aria-valuenow", String(completedCount));
      track.setAttribute(
        "aria-valuetext",
        `${completedCount} of ${modules.length} modules completed`
      );
      fill.style.width = `${(completedCount / modules.length) * 100}%`;
      completeButton.setAttribute("aria-pressed", String(isComplete));
      completeButton.textContent = isComplete ? "✓ Completed" : "Mark module complete";
      completeButton.classList.toggle("is-complete", isComplete);
    };

    completeButton.addEventListener("click", () => {
      const completed = new Set(progress.completed);
      if (completed.has(currentModule.file)) {
        completed.delete(currentModule.file);
      } else {
        completed.add(currentModule.file);
      }
      progress.completed = modules
        .map((module) => module.file)
        .filter((file) => completed.has(file));
      saveProgress(progress);
      renderProgress();
      updateHomeProgress();
    });

    renderProgress();
  };

  const enhanceLessonNavigation = () => {
    const jumpNavigation = document.querySelector(".lesson-jump");
    if (jumpNavigation) {
      jumpNavigation.setAttribute("role", "navigation");
      jumpNavigation.setAttribute("aria-label", "On this page");
    }
  };

  const describeScrollableTables = () => {
    const wrappers = Array.from(document.querySelectorAll(".table-scroll"));
    if (!wrappers.length) return;

    const getHeading = (wrapper) => {
      const section = wrapper.closest(".lesson-section, .section-wrap");
      return section?.querySelector("h2, h3")?.textContent.trim() || "Data";
    };

    wrappers.forEach((wrapper, index) => {
      const hint = createElement(
        "p",
        "table-scroll__hint",
        "This table scrolls horizontally. Focus it, then use the arrow keys or swipe to view more columns."
      );
      hint.id = `table-scroll-hint-${index + 1}`;
      wrapper.before(hint);

      const sync = () => {
        const scrollable = wrapper.scrollWidth > wrapper.clientWidth + 2;
        hint.hidden = !scrollable;
        wrapper.classList.toggle("is-scrollable", scrollable);
        if (scrollable) {
          wrapper.setAttribute("tabindex", "0");
          wrapper.setAttribute("role", "region");
          wrapper.setAttribute("aria-label", `${getHeading(wrapper)}: horizontally scrollable table`);
          wrapper.setAttribute("aria-describedby", hint.id);
        } else {
          wrapper.removeAttribute("tabindex");
          wrapper.removeAttribute("role");
          wrapper.removeAttribute("aria-label");
          wrapper.removeAttribute("aria-describedby");
        }
      };

      sync();
      if ("ResizeObserver" in window) {
        new ResizeObserver(sync).observe(wrapper);
      } else {
        window.addEventListener("resize", sync, { passive: true });
      }
    });
  };

  const describeNewWindows = () => {
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      const rel = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      link.setAttribute("rel", Array.from(rel).join(" "));
      if (!link.querySelector(".opens-new-window")) {
        link.append(createElement("span", "visually-hidden opens-new-window", " (opens in a new tab)"));
      }
    });
  };

  const addFaqStructuredData = () => {
    const faqItems = Array.from(document.querySelectorAll(".faq-section details"));
    if (!faqItems.length || document.querySelector("#faq-structured-data")) return;

    const entities = faqItems.map((item) => {
      const question = item.querySelector("summary")?.textContent.trim();
      const answer = Array.from(item.querySelectorAll("p"))
        .map((paragraph) => paragraph.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (!question || !answer) return null;
      return {
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer
        }
      };
    }).filter(Boolean);

    if (!entities.length) return;
    const schema = document.createElement("script");
    schema.id = "faq-structured-data";
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: entities
    });
    document.head.append(schema);
  };

  setMainLandmark();
  enhanceNavbar();
  buildProgressPanel();
  enhanceLessonNavigation();
  updateHomeProgress();
  describeScrollableTables();
  describeNewWindows();
  addFaqStructuredData();
})();
