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
  const intakeStorageKey = "accelerometer-course-intake-v1";
  const feedbackStorageKey = "accelerometer-course-feedback-v1";
  const finalFeedbackStorageKey = "accelerometer-course-final-feedback-v1";
  const finalQuizStorageKey = "accelerometer-final-quiz-v2";
  const certificateStorageKey = "accelerometer-course-certificate-v1";
  const captionPreferenceKey = "accelerometer-course-caption-mode-v1";
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const currentFile = window.location.pathname.endsWith("/")
    ? "index.html"
    : pathParts.pop() || "index.html";
  const currentIndex = modules.findIndex((module) => module.file === currentFile);

  const loadStoredJson = (key, fallback = null) => {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        const raw = storage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch (_error) {
        // Try the next storage mechanism.
      }
    }
    return fallback;
  };

  const saveStoredJson = (key, value) => {
    let saved = false;
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        storage.setItem(key, JSON.stringify(value));
        saved = true;
      } catch (_error) {
        // The course stays readable if browser storage is blocked.
      }
    }
    return saved;
  };

  const createElement = (tag, className, textContent) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
  };

  const normalizeLearnerName = (value) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

  const isValidLearnerName = (value) => {
    const normalized = normalizeLearnerName(value);
    return normalized.length >= 1 && normalized.length <= 100 && !/[\u0000-\u001F\u007F]/.test(normalized);
  };

  const getSafeReturnFile = () => {
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    const allowed = new Set([...modules.map((module) => module.file), "completion.html"]);
    return allowed.has(requested) ? requested : modules[0].file;
  };

  const hasCompletedIntake = () => {
    const intake = loadStoredJson(intakeStorageKey);
    const hasNameField = Boolean(intake && Object.prototype.hasOwnProperty.call(intake, "name"));
    const hasAgeField = Boolean(intake && Object.prototype.hasOwnProperty.call(intake, "age"));
    const learnerName = normalizeLearnerName(intake?.name);
    const hasCurrentIdentity = hasNameField && !hasAgeField && isValidLearnerName(learnerName);
    const hasLegacyIdentity = hasAgeField && !hasNameField &&
      Number.isInteger(intake.age) && intake.age >= 13 && intake.age <= 120;
    return Boolean(
      intake &&
      (hasCurrentIdentity || hasLegacyIdentity) &&
      intake.role &&
      typeof intake.affiliation === "string" &&
      intake.affiliation.trim().length >= 2 &&
      intake.intendedUse &&
      intake.discovery &&
      intake.completedAt
    );
  };

  const enforceIntakeGate = () => {
    const protectedFiles = new Set([...modules.map((module) => module.file), "completion.html"]);
    if (!protectedFiles.has(currentFile) || hasCompletedIntake()) return true;

    const target = `intake.html?returnTo=${encodeURIComponent(currentFile)}`;
    window.location.replace(target);
    return false;
  };

  const initializeIntake = () => {
    const form = document.querySelector("#course-intake-form");
    if (!form) return;

    const prior = loadStoredJson(intakeStorageKey);
    if (prior) {
      ["name", "role", "affiliation", "intendedUse", "discovery"].forEach((name) => {
        const field = form.elements.namedItem(name);
        if (field && prior[name] != null) field.value = prior[name];
      });
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status");
      const nameField = form.elements.namedItem("name");
      const affiliationField = form.elements.namedItem("affiliation");
      if (nameField) {
        nameField.setCustomValidity("");
        nameField.value = normalizeLearnerName(nameField.value);
        if (!isValidLearnerName(nameField.value)) {
          nameField.setCustomValidity("Enter a name between 1 and 100 characters without control characters.");
        }
      }
      if (affiliationField) affiliationField.value = affiliationField.value.trim();
      if (!form.checkValidity()) {
        form.reportValidity();
        if (status) {
          status.hidden = false;
          status.textContent = "Complete all five questions before entering the course.";
        }
        return;
      }

      const response = {
        name: nameField.value,
        role: form.elements.namedItem("role").value,
        affiliation: affiliationField.value,
        intendedUse: form.elements.namedItem("intendedUse").value,
        discovery: form.elements.namedItem("discovery").value,
        completedAt: new Date().toISOString()
      };

      if (!saveStoredJson(intakeStorageKey, response)) {
        if (status) {
          status.hidden = false;
          status.textContent = "Your browser blocked course storage. Allow site storage, then try again.";
          status.focus({ preventScroll: false });
        }
        return;
      }

      if (status) {
        status.hidden = false;
        status.textContent = "Questionnaire complete. Opening the course…";
      }
      window.location.assign(getSafeReturnFile());
    });
  };

  const loadProgress = () => {
    const empty = { completed: [], lastModule: null };
    try {
      const stored = loadStoredJson(storageKey);
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
    saveStoredJson(storageKey, progress);
  };

  const progress = loadProgress();

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

    navbar.querySelectorAll(".dropdown-toggle").forEach((dropdownToggle) => {
      const normalizeDropdownToggle = () => {
        dropdownToggle.setAttribute("role", "button");
        dropdownToggle.setAttribute("aria-haspopup", "true");
      };
      normalizeDropdownToggle();
      window.addEventListener("load", () => {
        window.setTimeout(normalizeDropdownToggle, 0);
      }, { once: true });
      dropdownToggle.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          event.preventDefault();
          dropdownToggle.click();
        }
      });
    });

    const modulesToggle = navbar.querySelector("#nav-menu-modules");

    const dropdown = navbar.querySelector('[aria-labelledby="nav-menu-modules"]');
    if (dropdown) dropdown.setAttribute("aria-label", "Course modules");

    const mobileNavigation = navbar.querySelector(".navbar-collapse");
    let mobileNavigationScrollY = 0;
    if (toggler && mobileNavigation) {
      toggler.addEventListener("click", () => {
        mobileNavigationScrollY = window.scrollY;
      });
      ["shown.bs.collapse", "hidden.bs.collapse"].forEach((eventName) => {
        mobileNavigation.addEventListener(eventName, () => {
          window.scrollTo({ left: 0, top: mobileNavigationScrollY, behavior: "auto" });
        });
      });
    }

    navbar.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const openMobileNavigation = navbar.querySelector(".navbar-collapse.show");
      if (!openMobileNavigation || openMobileNavigation.querySelector(".dropdown-menu.show")) return;
      toggler?.click();
      toggler?.focus({ preventScroll: true });
    });

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
      window.dispatchEvent(new CustomEvent("course-state-changed"));
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

  const initializeCaptionRails = () => {
    const videos = Array.from(document.querySelectorAll("video.course-video"));
    if (!videos.length) return;

    let preferredMode = "below";
    try {
      const stored = window.localStorage.getItem(captionPreferenceKey);
      if (["below", "overlay", "off"].includes(stored)) preferredMode = stored;
    } catch (_error) {
      // The default remains usable when browser storage is unavailable.
    }

    const videoControllers = videos.map((video, index) => {
      const trackElement = video.querySelector('track[kind="captions"]');
      const textTrack = trackElement?.track || video.textTracks?.[0];
      if (!textTrack) return null;

      trackElement?.removeAttribute("default");
      const rail = createElement("div", "caption-rail");
      rail.id = `caption-rail-${index + 1}`;
      rail.setAttribute("aria-label", "Video captions");
      rail.setAttribute("aria-live", "off");

      const railText = createElement(
        "p",
        "caption-rail__text",
        "Captions appear here while the video plays."
      );
      rail.append(railText);

      const controls = createElement("div", "caption-display-controls");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Caption display");
      controls.append(createElement("span", "caption-display-controls__label", "Captions:"));

      const buttons = [
        ["below", "Below video"],
        ["overlay", "On video"],
        ["off", "Off"]
      ].map(([mode, label]) => {
        const button = createElement("button", "caption-display-controls__button", label);
        button.type = "button";
        button.dataset.captionMode = mode;
        button.setAttribute("aria-controls", rail.id);
        controls.append(button);
        return button;
      });

      video.after(rail, controls);

      const updateRail = () => {
        if (preferredMode !== "below") return;
        const text = Array.from(textTrack.activeCues || [])
          .map((cue) => cue.text?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" ");
        railText.textContent = text || "Captions appear here while the video plays.";
      };

      const applyMode = () => {
        if (preferredMode === "below") {
          textTrack.mode = "hidden";
          rail.hidden = false;
          controls.classList.remove("caption-mode-overlay", "caption-mode-off");
          updateRail();
        } else if (preferredMode === "overlay") {
          textTrack.mode = "showing";
          rail.hidden = true;
          controls.classList.add("caption-mode-overlay");
          controls.classList.remove("caption-mode-off");
        } else {
          textTrack.mode = "disabled";
          rail.hidden = true;
          controls.classList.add("caption-mode-off");
          controls.classList.remove("caption-mode-overlay");
        }

        buttons.forEach((button) => {
          const selected = button.dataset.captionMode === preferredMode;
          button.setAttribute("aria-pressed", String(selected));
          button.classList.toggle("is-selected", selected);
        });
      };

      textTrack.addEventListener?.("cuechange", updateRail);
      video.addEventListener("loadedmetadata", applyMode, { once: true });
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          preferredMode = button.dataset.captionMode;
          try {
            window.localStorage.setItem(captionPreferenceKey, preferredMode);
          } catch (_error) {
            // Keep the preference for this page when storage is unavailable.
          }
          videoControllers.forEach((controller) => controller?.applyMode());
        });
      });

      applyMode();
      return { applyMode };
    });
  };

  const buildIssueLink = (title, lines) => {
    const url = new URL("https://github.com/uiuclapasssta/accelerometer-learning-course/issues/new");
    url.searchParams.set("title", title);
    url.searchParams.set("body", lines.join("\n"));
    return url.toString();
  };

  const initializeModuleFeedback = () => {
    if (currentIndex < 0 || document.querySelector("#module-feedback")) return;
    const lessonMain = document.querySelector(".lesson-main");
    if (!lessonMain) return;

    const module = modules[currentIndex];
    const section = createElement("section", "course-feedback course-feedback--optional");
    section.id = "module-feedback";
    const kicker = createElement("p", "section-kicker", "Optional");
    const heading = createElement("h2", "", `Module ${module.number} feedback`);
    heading.id = "module-feedback-heading";
    section.setAttribute("aria-labelledby", heading.id);
    const intro = createElement(
      "p",
      "",
      "Tell us what helped or where this module could be clearer. You may leave either field blank. The response is saved only in this browser. If you open the optional prefilled GitHub Issue page, that feedback copy is sent to GitHub and becomes public only if you submit the issue. Do not include sensitive information."
    );

    const form = createElement("form", "feedback-form");
    form.noValidate = true;
    const ratingField = createElement("div", "form-field");
    const ratingLabel = createElement("label", "", "Usefulness rating (optional)");
    ratingLabel.htmlFor = `module-feedback-rating-${module.number}`;
    const rating = document.createElement("select");
    rating.id = `module-feedback-rating-${module.number}`;
    rating.name = "rating";
    [
      ["", "No rating"],
      ["1", "1 — Not useful"],
      ["2", "2"],
      ["3", "3"],
      ["4", "4"],
      ["5", "5 — Very useful"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      rating.append(option);
    });
    ratingField.append(ratingLabel, rating);

    const commentField = createElement("div", "form-field");
    const commentLabel = createElement("label", "", "Comments (optional)");
    commentLabel.htmlFor = `module-feedback-comments-${module.number}`;
    const comments = document.createElement("textarea");
    comments.id = `module-feedback-comments-${module.number}`;
    comments.name = "comments";
    comments.rows = 4;
    comments.maxLength = 1500;
    commentField.append(commentLabel, comments);

    const actions = createElement("div", "form-actions");
    const save = createElement("button", "button button-primary", "Save optional feedback");
    save.type = "submit";
    const share = createElement("a", "button button-secondary feedback-share-link", "Open prefilled GitHub Issue (optional)");
    share.hidden = true;
    actions.append(save, share);

    const status = createElement("p", "form-status");
    status.setAttribute("role", "status");
    status.tabIndex = -1;
    status.hidden = true;
    form.append(ratingField, commentField, actions, status);
    section.append(kicker, heading, intro, form);

    const anchor = lessonMain.querySelector(".next-module");
    if (anchor) anchor.before(section);
    else lessonMain.append(section);

    const feedbackState = loadStoredJson(feedbackStorageKey, {}) || {};
    const prior = feedbackState[module.file];
    if (prior) {
      rating.value = prior.rating || "";
      comments.value = prior.comments || "";
      status.hidden = false;
      status.textContent = "Optional feedback restored from this browser.";
    }

    const updateShareLink = () => {
      if (!rating.value && !comments.value.trim()) {
        share.hidden = true;
        return;
      }
      share.href = buildIssueLink(`Module ${module.number} feedback: ${module.title}`, [
        `**Module:** ${module.number} — ${module.title}`,
        `**Usefulness:** ${rating.value || "Not rated"}/5`,
        "",
        "**Comments:**",
        comments.value.trim() || "No written comment."
      ]);
      share.hidden = false;
    };
    updateShareLink();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = loadStoredJson(feedbackStorageKey, {}) || {};
      if (!rating.value && !comments.value.trim()) {
        delete state[module.file];
        const saved = saveStoredJson(feedbackStorageKey, state);
        status.textContent = saved
          ? "No optional feedback was entered."
          : "Your browser blocked course storage. Allow site storage, then try again.";
      } else {
        state[module.file] = {
          rating: rating.value,
          comments: comments.value.trim(),
          savedAt: new Date().toISOString()
        };
        const saved = saveStoredJson(feedbackStorageKey, state);
        status.textContent = saved
          ? "Optional feedback saved on this device."
          : "Your browser blocked course storage. Allow site storage, then try again.";
      }
      status.hidden = false;
      status.focus({ preventScroll: false });
      updateShareLink();
    });
  };

  const initializeFinalFeedback = () => {
    const form = document.querySelector("#final-feedback-form");
    if (!form) return;
    const status = form.querySelector(".form-status");
    const share = form.querySelector(".feedback-share-link");

    const populate = (record) => {
      if (!record) return;
      const rating = form.querySelector(`input[name="rating"][value="${record.rating}"]`);
      if (rating) rating.checked = true;
      ["route", "mostUseful", "improve"].forEach((name) => {
        const field = form.elements.namedItem(name);
        if (field && record[name] != null) field.value = record[name];
      });
    };

    const updateShareLink = () => {
      const record = loadStoredJson(finalFeedbackStorageKey);
      if (!record || !share) return;
      share.href = buildIssueLink("Final course feedback", [
        `**Overall usefulness:** ${record.rating}/5`,
        `**Route:** ${record.route}`,
        "",
        "**Most useful:**",
        record.mostUseful,
        "",
        "**Suggested improvement:**",
        record.improve
      ]);
      share.hidden = false;
    };

    const prior = loadStoredJson(finalFeedbackStorageKey);
    populate(prior);
    if (prior && status) {
      status.hidden = false;
      status.textContent = "Required final feedback is saved on this device.";
    }
    updateShareLink();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        if (status) {
          status.hidden = false;
          status.textContent = "Complete every required feedback field before continuing.";
          status.focus({ preventScroll: false });
        }
        return;
      }

      const checkedRating = form.querySelector('input[name="rating"]:checked');
      const record = {
        rating: checkedRating.value,
        route: form.elements.namedItem("route").value,
        mostUseful: form.elements.namedItem("mostUseful").value.trim(),
        improve: form.elements.namedItem("improve").value.trim(),
        completedAt: new Date().toISOString()
      };
      if (!saveStoredJson(finalFeedbackStorageKey, record)) {
        if (status) {
          status.hidden = false;
          status.textContent = "Your browser blocked course storage. Allow site storage, then try again.";
          status.focus({ preventScroll: false });
        }
        return;
      }
      if (status) {
        status.hidden = false;
        status.textContent = "Required final feedback saved. Your certificate status has been updated.";
        status.focus({ preventScroll: false });
      }
      updateShareLink();
      window.dispatchEvent(new CustomEvent("course-state-changed"));
    });
  };

  const createLocalRecordId = (name, completedAt) => {
    const source = `${name}|${completedAt}|accelerometer-course-1.2.0`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `ALC-1.2-${(hash >>> 0).toString(36).toUpperCase().padStart(7, "0")}`;
  };

  const initializeCertificate = () => {
    const workspace = document.querySelector(".certificate-workspace");
    if (!workspace) return;
    const requirements = new Map(
      Array.from(workspace.querySelectorAll("[data-requirement]"))
        .map((item) => [item.dataset.requirement, item])
    );
    const form = workspace.querySelector("#certificate-name-form");
    const nameInput = form?.elements.namedItem("learnerName");
    const submit = form?.querySelector('button[type="submit"]');
    const status = form?.querySelector(".form-status");
    const paper = workspace.querySelector(".course-certificate");
    const actions = workspace.querySelector(".certificate-actions");
    if (!form || !nameInput || !submit || !paper || !actions) return;

    const intakeName = normalizeLearnerName(loadStoredJson(intakeStorageKey)?.name);
    if (isValidLearnerName(intakeName)) nameInput.value = intakeName;

    const renderPaper = (record) => {
      if (!record) {
        paper.hidden = true;
        actions.hidden = true;
        return;
      }
      paper.querySelector("[data-certificate-name]").textContent = record.learnerName;
      paper.querySelector("[data-certificate-date]").textContent = new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(new Date(record.completedAt));
      paper.querySelector("[data-certificate-id]").textContent = record.recordId;
      paper.hidden = false;
      actions.hidden = false;
      nameInput.value = record.learnerName;
    };

    const renderEligibility = () => {
      const currentProgress = loadProgress();
      const quiz = loadStoredJson(finalQuizStorageKey);
      const checks = {
        intake: hasCompletedIntake(),
        modules: currentProgress.completed.length === modules.length,
        quiz: Boolean(quiz?.passed && quiz?.completedAt),
        feedback: Boolean(loadStoredJson(finalFeedbackStorageKey)?.completedAt)
      };
      requirements.forEach((item, key) => {
        const complete = Boolean(checks[key]);
        item.classList.toggle("is-complete", complete);
        item.setAttribute("data-status", complete ? "Complete" : "Not complete");
        if (key === "modules") {
          item.textContent = `${currentProgress.completed.length} of ${modules.length} modules marked complete`;
        }
      });

      const existing = loadStoredJson(certificateStorageKey);
      const eligible = Object.values(checks).every(Boolean);
      submit.disabled = !eligible && !existing;
      form.classList.toggle("is-locked", !eligible && !existing);
      if (!eligible && !existing && status) {
        status.hidden = false;
        status.textContent = "Finish the incomplete requirements above to unlock the certificate.";
      } else if (!existing && status) {
        status.hidden = false;
        status.textContent = "All requirements are complete. Confirm or edit your name to create the certificate.";
      }
      renderPaper(existing);
      return { eligible, existing };
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      nameInput.setCustomValidity("");
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const learnerName = normalizeLearnerName(nameInput.value);
      nameInput.value = learnerName;
      if (!isValidLearnerName(learnerName)) {
        nameInput.setCustomValidity("Enter a name between 1 and 100 characters without control characters.");
        form.reportValidity();
        nameInput.setCustomValidity("");
        return;
      }
      const state = renderEligibility();
      if (!state.eligible && !state.existing) return;
      const completedAt = state.existing?.completedAt || new Date().toISOString();
      const record = {
        learnerName,
        completedAt,
        recordId: state.existing?.recordId || createLocalRecordId(learnerName, completedAt),
        courseVersion: "1.2.0"
      };
      if (!saveStoredJson(certificateStorageKey, record)) {
        if (status) {
          status.hidden = false;
          status.textContent = "Your browser blocked course storage. Allow site storage, then try again.";
          status.focus({ preventScroll: false });
        }
        return;
      }
      renderPaper(record);
      if (status) {
        status.hidden = false;
        status.textContent = "Certificate created. Use Print or save as PDF to keep a copy.";
      }
      paper.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    workspace.querySelector("[data-certificate-edit]")?.addEventListener("click", () => {
      nameInput.focus({ preventScroll: false });
      if (status) {
        status.hidden = false;
        status.textContent = "Edit the name, then choose Create certificate to update the display.";
      }
    });

    workspace.querySelector("[data-certificate-print]")?.addEventListener("click", () => {
      document.body.classList.add("certificate-print-mode");
      window.print();
    });
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("certificate-print-mode");
    });
    window.addEventListener("course-state-changed", renderEligibility);
    window.addEventListener("storage", (event) => {
      if ([storageKey, finalQuizStorageKey, finalFeedbackStorageKey, intakeStorageKey].includes(event.key)) {
        renderEligibility();
      }
    });

    renderEligibility();
  };

  if (!enforceIntakeGate()) return;
  if (currentIndex >= 0) {
    progress.lastModule = modules[currentIndex].file;
    saveProgress(progress);
  }
  setMainLandmark();
  initializeIntake();
  enhanceNavbar();
  buildProgressPanel();
  enhanceLessonNavigation();
  updateHomeProgress();
  describeScrollableTables();
  describeNewWindows();
  addFaqStructuredData();
  initializeCaptionRails();
  initializeModuleFeedback();
  initializeFinalFeedback();
  initializeCertificate();
})();
