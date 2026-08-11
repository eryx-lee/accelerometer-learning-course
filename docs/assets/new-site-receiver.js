(function initializeALCMigrationReceiver(root) {
  "use strict";

  const schema = root.ALCMigrationSchema;
  if (!schema) throw new Error("ALCMigrationSchema must load before new-site-receiver.js.");
  const safeAnchorPattern = /^#[A-Za-z][A-Za-z0-9_:.-]{0,127}$/;

  const exactTimestamp = (record, fields) => {
    for (const field of fields) {
      const candidate = record?.[field];
      if (schema.isIsoTimestamp(candidate)) return new Date(candidate).valueOf();
    }
    return 0;
  };

  const newerRecord = (existing, incoming, timestampFields) =>
    exactTimestamp(existing, timestampFields) >= exactTimestamp(incoming, timestampFields) ? existing : incoming;

  const mergeParsedValues = (key, existing, incoming) => {
    if (key === "accelerometer-course-progress-v1") {
      const completed = new Set([...existing.completed, ...incoming.completed]);
      const ordered = schema.MODULE_FILES.filter((file) => completed.has(file));
      const existingHasActivity = existing.completed.length > 0 || existing.lastModule !== null;
      return {
        completed: ordered,
        lastModule: existingHasActivity ? existing.lastModule : incoming.lastModule
      };
    }

    if (key === "accelerometer-course-feedback-v1") {
      const merged = {};
      for (const file of schema.MODULE_FILES) {
        if (existing[file] && incoming[file]) merged[file] = newerRecord(existing[file], incoming[file], ["savedAt"]);
        else if (existing[file]) merged[file] = existing[file];
        else if (incoming[file]) merged[file] = incoming[file];
      }
      return merged;
    }

    if (key === "accelerometer-course-caption-mode-v1") return existing;
    if (key === "accelerometer-course-intake-v1") return newerRecord(existing, incoming, ["completedAt"]);
    if (key === "accelerometer-course-final-feedback-v1") return newerRecord(existing, incoming, ["completedAt"]);
    if (key === "accelerometer-final-quiz-v2") return newerRecord(existing, incoming, ["completedAt"]);
    if (key === "accelerometer-course-certificate-v1") return newerRecord(existing, incoming, ["completedAt"]);
    if (key.startsWith("accelerometer-quiz-v2:")) {
      return newerRecord(existing, incoming, ["checkedAt", "completedAt"]);
    }
    throw new Error("Attempted to merge an unknown migration key.");
  };

  const mergeRawValues = (key, existingRaw, incomingRaw) => {
    const incoming = schema.normalizeStoredValue(key, incomingRaw);
    if (!incoming.ok) throw new Error(`Invalid incoming value for ${key}.`);
    if (existingRaw === null || existingRaw === undefined) return incoming.value;
    const existing = schema.normalizeStoredValue(key, existingRaw);
    if (!existing.ok) return incoming.value;
    const merged = mergeParsedValues(key, existing.parsed, incoming.parsed);
    const normalized = schema.normalizeStoredValue(
      key,
      typeof merged === "string" ? merged : JSON.stringify(merged)
    );
    if (!normalized.ok) throw new Error(`Merged value failed validation for ${key}.`);
    return normalized.value;
  };

  const readStorageValue = (storage, key) => {
    try {
      return storage.getItem(key);
    } catch (_error) {
      return null;
    }
  };

  const prepareMergedEntries = (incomingEntries, storageProviders) => incomingEntries.map((entry) => {
    let existingValue = null;
    for (const storage of storageProviders) {
      const existingRaw = readStorageValue(storage, entry.key);
      if (existingRaw === null) continue;
      const existing = schema.normalizeStoredValue(entry.key, existingRaw);
      if (!existing.ok) continue;
      existingValue = existingValue === null
        ? existing.value
        : mergeRawValues(entry.key, existingValue, existing.value);
    }
    const mergedValue = existingValue === null
      ? mergeRawValues(entry.key, null, entry.value)
      : mergeRawValues(entry.key, existingValue, entry.value);
    return { key: entry.key, value: mergedValue };
  });

  const storageMatches = (storage, expectedEntries) => {
    try {
      return expectedEntries.every(([key, expected]) => storage.getItem(key) === expected);
    } catch (_error) {
      return false;
    }
  };

  const restoreSnapshot = (storage, snapshot) => {
    let restored = true;
    for (const [key, previous] of snapshot) {
      try {
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
      } catch (_error) {
        restored = false;
      }
    }
    return restored && storageMatches(storage, [...snapshot.entries()]);
  };

  const writeTransaction = (storage, entries) => {
    const snapshot = new Map();
    let writesStarted = false;
    try {
      for (const entry of entries) snapshot.set(entry.key, storage.getItem(entry.key));
      writesStarted = true;
      for (const entry of entries) storage.setItem(entry.key, entry.value);
      const verified = storageMatches(storage, entries.map((entry) => [entry.key, entry.value]));
      if (!verified) throw new Error("Storage read-back verification failed.");
      return { ok: true, verified: true, rollbackOk: true };
    } catch (_error) {
      const rollbackOk = writesStarted ? restoreSnapshot(storage, snapshot) : true;
      return { ok: false, verified: false, rollbackOk };
    }
  };

  const importEntries = (incomingEntries, storageProviders) => {
    const mergedEntries = prepareMergedEntries(incomingEntries, storageProviders);
    const results = storageProviders.map((storage) => writeTransaction(storage, mergedEntries));
    if (results.some((result) => !result.ok && !result.rollbackOk)) {
      throw new Error("Browser storage failed the migration and could not be rolled back cleanly.");
    }
    const successfulTargets = results.filter((result) => result.ok && result.verified).length;
    if (!successfulTargets) throw new Error("Browser storage rejected the migration.");
    return { importedCount: mergedEntries.length, storageTargets: successfulTargets };
  };

  const parseLaunchFragment = (hash) => {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (params.getAll("nonce").length !== 1 || params.getAll("returnTo").length !== 1) return null;
    if ([...params.keys()].some((key) => !new Set(["nonce", "returnTo", "anchor"]).has(key))) return null;
    const anchors = params.getAll("anchor");
    if (anchors.length > 1 || (anchors.length === 1 && !safeAnchorPattern.test(anchors[0]))) return null;
    const nonce = params.get("nonce");
    const requestedReturn = params.get("returnTo");
    if (!schema.isValidNonce(nonce)) return null;
    const returnTo = schema.sanitizeReturnPath(requestedReturn);
    if (returnTo !== requestedReturn) return null;
    return { nonce, returnTo, anchor: anchors[0] || "" };
  };

  const destinationForReturnPath = (returnTo, anchor = "") => {
    const safe = schema.sanitizeReturnPath(returnTo);
    if (anchor && !safeAnchorPattern.test(anchor)) throw new Error("Invalid migration anchor.");
    const destination = new URL(safe === "index.html" ? "./" : safe, schema.NEW_BASE_URL);
    if (anchor) destination.hash = anchor;
    return destination.toString();
  };

  const isTransferEvent = (event, opener, nonce, now = Date.now()) => {
    if (event.origin !== schema.OLD_ORIGIN || event.source !== opener) {
      return { ok: false, ignored: true, error: "Unexpected sender." };
    }
    return schema.validatePayload(event.data, nonce, now);
  };

  const getStorageProviders = () => {
    const providers = [];
    for (const name of ["localStorage", "sessionStorage"]) {
      try {
        const storage = root[name];
        storage.getItem("__alc_migration_storage_probe__");
        providers.push(storage);
      } catch (_error) {
        // Continue with any available first-party storage mechanism.
      }
    }
    return providers;
  };

  const postToOpener = (opener, message) => opener.postMessage(message, schema.OLD_ORIGIN);

  const start = ({ navigateDelayMs = 1200 } = {}) => {
    const status = document.querySelector("[data-migration-receiver-status]");
    const fallback = document.querySelector("[data-migration-receiver-fallback]");
    const setStatus = (message) => {
      if (!status) return;
      status.textContent = message;
      status.focus?.({ preventScroll: false });
    };

    if (root.location.origin !== schema.NEW_ORIGIN) {
      setStatus("Preview mode: the receiver activates only at the new course address.");
      return { ok: false, code: "WRONG_ORIGIN" };
    }
    const launch = parseLaunchFragment(root.location.hash);
    if (!launch) {
      setStatus("This migration link is invalid or incomplete. Open the new course directly.");
      if (fallback) fallback.href = schema.NEW_BASE_URL;
      return { ok: false, code: "INVALID_LAUNCH" };
    }
    if (!root.opener || root.opener.closed) {
      setStatus("The former course page is no longer connected. Return to it and start the transfer again.");
      if (fallback) fallback.href = destinationForReturnPath(launch.returnTo, launch.anchor);
      return { ok: false, code: "MISSING_OPENER" };
    }

    const opener = root.opener;
    const destination = destinationForReturnPath(launch.returnTo, launch.anchor);
    if (fallback) fallback.href = destination;
    let handled = false;

    const sendError = (code) => {
      postToOpener(opener, {
        protocol: schema.PROTOCOL,
        version: schema.VERSION,
        type: "ERROR",
        nonce: launch.nonce,
        code
      });
    };

    root.addEventListener("message", (event) => {
      if (handled) return;
      const validated = isTransferEvent(event, opener, launch.nonce);
      if (validated.ignored) return;
      handled = true;
      if (!validated.ok) {
        setStatus("The saved data did not pass validation. Nothing was imported.");
        sendError("INVALID_PAYLOAD");
        return;
      }

      const storageProviders = getStorageProviders();
      if (!storageProviders.length) {
        setStatus("This browser blocked course storage. Nothing was imported.");
        sendError("STORAGE_UNAVAILABLE");
        return;
      }

      let result;
      try {
        result = importEntries(validated.entries, storageProviders);
      } catch (_error) {
        setStatus("The browser could not save the transferred data. Nothing was removed from the former site.");
        sendError("STORAGE_WRITE_FAILED");
        return;
      }

      try {
        root.history.replaceState(null, "", root.location.pathname);
      } catch (_error) {
        // Navigation below still removes the one-time fragment.
      }
      postToOpener(opener, {
        protocol: schema.PROTOCOL,
        version: schema.VERSION,
        type: "COMPLETE",
        nonce: launch.nonce,
        importedCount: result.importedCount,
        destination
      });
      setStatus(`Transfer complete. ${result.importedCount} saved record${result.importedCount === 1 ? "" : "s"} copied; opening the course…`);
      root.setTimeout(() => root.location.replace(destination), navigateDelayMs);
    });

    postToOpener(opener, {
      protocol: schema.PROTOCOL,
      version: schema.VERSION,
      type: "READY",
      nonce: launch.nonce
    });
    setStatus("Secure connection established. Waiting for saved course data from the former site…");
    return { ok: true, nonce: launch.nonce, destination };
  };

  root.ALCMigrationReceiver = Object.freeze({
    mergeParsedValues,
    mergeRawValues,
    prepareMergedEntries,
    writeTransaction,
    importEntries,
    parseLaunchFragment,
    destinationForReturnPath,
    isTransferEvent,
    getStorageProviders,
    start
  });

  if (typeof document !== "undefined" && document.documentElement.dataset.alcMigrationReceiver === "true") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start(), { once: true });
    else start();
  }
})(typeof window !== "undefined" ? window : globalThis);
