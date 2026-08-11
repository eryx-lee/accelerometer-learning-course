(() => {
  "use strict";

  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const normalizeCode = (value) => typeof value === "string" ? value.trim() : "";

  const isValidCode = (value) => {
    const code = normalizeCode(value);
    return /^ALC1_[A-Za-z0-9_-]{43}$/.test(code);
  };

  const codeFromLocation = (locationLike) => {
    try {
      const url = new URL(locationLike.href);
      const rawHash = url.hash.replace(/^#/, "");
      if (!rawHash) return "";
      let hashCode = "";
      if (rawHash.includes("=")) {
        const hashParams = new URLSearchParams(rawHash);
        const keys = Array.from(hashParams.keys());
        hashCode = keys.length === 1 && keys[0] === "code" && hashParams.getAll("code").length === 1
          ? hashParams.get("code") || ""
          : "";
      } else {
        hashCode = decodeURIComponent(rawHash);
      }
      return normalizeCode(hashCode);
    } catch (_error) {
      return "";
    }
  };

  const backendBaseUrl = (configLike) => {
    if (!isObject(configLike) || configLike.enabled !== true ||
        typeof configLike.publishableKey !== "string" || configLike.publishableKey.length < 20) return "";
    try {
      const url = new URL(configLike.supabaseUrl);
      return url.protocol === "https:" && !url.username && !url.password && !url.port &&
        /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ? url.origin : "";
    } catch (_error) {
      return "";
    }
  };

  const normalizedResult = (payload) => {
    const data = isObject(payload?.data) ? payload.data : {};
    const status = String(data.status || "").toLowerCase();
    if (status === "revoked" || data.valid === false) {
      return { kind: "revoked", status: "revoked", name: "", version: "", issuedAt: "" };
    }
    if (data.valid === true && ["active", "issued", "valid"].includes(status)) {
      return {
        kind: "active",
        status: "active",
        name: String(data.display_name || data.display_name_snapshot || "").trim(),
        version: String(data.course_version || "").trim(),
        issuedAt: String(data.issued_at || "").trim()
      };
    }
    return { kind: "unknown", status: "unknown", name: "", version: "", issuedAt: "" };
  };

  const utilities = { backendBaseUrl, codeFromLocation, isValidCode, normalizeCode, normalizedResult };
  if (typeof module !== "undefined" && module.exports) module.exports = utilities;
  if (typeof window !== "undefined") window.CertificateVerifyUtils = Object.freeze({ ...utilities });
  if (typeof document === "undefined") return;

  const config = window.ACCELEROMETER_BACKEND_CONFIG || {};
  const form = document.getElementById("verification-form");
  const input = document.getElementById("verification-code");
  const button = form.querySelector("button[type='submit']");
  const statusNode = document.getElementById("verification-status");
  const result = document.getElementById("verification-result");
  const notFound = document.getElementById("not-found-state");
  const resultTitle = document.getElementById("result-title");
  const resultSummary = document.getElementById("result-summary");
  const resultMark = document.getElementById("result-mark");
  const resultName = document.getElementById("result-name");
  const resultVersion = document.getElementById("result-version");
  const resultIssued = document.getElementById("result-issued");
  const resultStatus = document.getElementById("result-status");
  let verificationController = null;

  const configuredBaseUrl = () => backendBaseUrl(config);

  const setStatus = (message, kind = "loading") => {
    statusNode.textContent = message;
    statusNode.dataset.kind = kind;
    statusNode.hidden = !message;
  };

  const formatIssuedAt = (value) => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Not disclosed";
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
  };

  const hideResults = () => {
    result.hidden = true;
    notFound.hidden = true;
  };

  const showActive = (record) => {
    notFound.hidden = true;
    result.dataset.status = "active";
    resultTitle.textContent = "Certificate verified";
    resultSummary.textContent = "This certificate matches an active server-issued course record.";
    resultMark.textContent = "✓";
    resultName.textContent = record.name || "Not disclosed";
    resultVersion.textContent = record.version || "Not disclosed";
    resultIssued.textContent = formatIssuedAt(record.issuedAt);
    resultStatus.textContent = "Active";
    result.hidden = false;
    resultTitle.focus({ preventScroll: false });
  };

  const showRevoked = () => {
    notFound.hidden = true;
    result.dataset.status = "revoked";
    resultTitle.textContent = "Certificate revoked";
    resultSummary.textContent = "This code matches a certificate that is no longer valid. No learner details are disclosed for revoked records.";
    resultMark.textContent = "×";
    resultName.textContent = "Not disclosed";
    resultVersion.textContent = "Not disclosed";
    resultIssued.textContent = "Not disclosed";
    resultStatus.textContent = "Revoked";
    result.hidden = false;
    resultTitle.focus({ preventScroll: false });
  };

  const showNotFound = () => {
    result.hidden = true;
    notFound.hidden = false;
    notFound.focus({ preventScroll: false });
  };

  const verify = async (code) => {
    if (button.disabled) return;
    hideResults();
    setStatus("");
    if (!isValidCode(code)) {
      input.setCustomValidity("Enter the complete 48-character certificate code beginning ALC1_.");
      form.reportValidity();
      input.setCustomValidity("");
      return;
    }

    const baseUrl = configuredBaseUrl();
    if (!baseUrl) {
      setStatus("Certificate verification is not connected yet. Ask the course administrator to finish the backend deployment.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Checking…";
    setStatus("Checking the server-issued certificate record…");
    const controller = new AbortController();
    verificationController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${baseUrl}/functions/v1/verify-certificate`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: config.publishableKey
        },
        body: JSON.stringify({ code }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch (_error) { /* Gateway errors may not be JSON. */ }

      if (response.status === 404 || payload?.error?.code === "certificate_not_found") {
        setStatus("");
        showNotFound();
        return;
      }
      if (response.status === 400) {
        setStatus("");
        showNotFound();
        return;
      }
      if (!response.ok || !payload) throw new Error("verification_unavailable");

      const record = normalizedResult(payload);
      setStatus("");
      if (record.kind === "active") showActive(record);
      else if (record.kind === "revoked") showRevoked();
      else showNotFound();
    } catch (error) {
      setStatus(error?.name === "AbortError"
        ? "The verification request timed out. Check the connection and try again."
        : "The verification service is temporarily unavailable. Check the connection and try again.", "error");
    } finally {
      window.clearTimeout(timeout);
      if (verificationController === controller) verificationController = null;
      input.value = "";
      button.disabled = false;
      button.textContent = "Verify certificate";
    }
  };

  const setShareableFragment = (code) => {
    const url = new URL(window.location.href);
    url.hash = `code=${encodeURIComponent(code)}`;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const clearShareableFragment = () => {
    if (!window.location.hash) return;
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = normalizeCode(input.value);
    if (isValidCode(code)) setShareableFragment(code);
    else clearShareableFragment();
    verify(code);
  });

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has("code")) {
    currentUrl.searchParams.delete("code");
    window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }
  const initialCode = codeFromLocation(window.location);
  if (initialCode) {
    verify(initialCode);
  } else if (!configuredBaseUrl()) {
    setStatus("Certificate verification is not connected yet. Ask the course administrator to finish the backend deployment.", "error");
  }
})();
