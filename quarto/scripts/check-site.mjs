#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(process.argv[2] || "quarto/_site");
const expectedSiteBase = process.env.COURSE_SITE_URL || "https://uiuclapasssta.github.io/accelerometer-learning-course/";
const expectedRepository = process.env.COURSE_REPOSITORY_URL || "https://github.com/uiuclapasssta/accelerometer-learning-course";
const expectedCourseVersion = "1.3.0";
const expectedConsentVersion = "2026-08-11-v1";
const expectedEntryFormUrl = "https://forms.illinois.edu/sec/457778289";
const retiredOwnerSlug = ["la", "passsta", "lab"].join("-");
const retiredOwnerOrigin = `https://${retiredOwnerSlug}.github.io`;
const errors = [];
const warnings = [];

if (!fs.existsSync(siteRoot) || !fs.statSync(siteRoot).isDirectory()) {
  console.error(`Site directory does not exist: ${siteRoot}`);
  process.exit(2);
}

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });

const relative = (file) => path.relative(siteRoot, file).split(path.sep).join("/");
const allHtmlFiles = walk(siteRoot).filter((file) => file.endsWith(".html"));
const migrationPageName = "migration.html";
const migrationFile = path.join(siteRoot, migrationPageName);
const standalonePageNames = new Set([migrationPageName, "admin.html", "verify.html"]);
const htmlFiles = allHtmlFiles.filter((file) => !standalonePageNames.has(relative(file)));
const record = (collection, file, message) => collection.push(`${relative(file)}: ${message}`);

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
};

const stripTags = (value) => value
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const findTarget = (sourceFile, reference) => {
  const withoutQuery = reference.split("?")[0];
  const [rawPath, rawFragment] = withoutQuery.split("#", 2);
  let target;

  if (!rawPath) {
    target = sourceFile;
  } else {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch (_error) {
      return { error: `contains invalid URL encoding: ${reference}` };
    }

    if (decodedPath.startsWith("/accelerometer-learning-course/")) {
      decodedPath = decodedPath.slice("/accelerometer-learning-course/".length);
      target = path.resolve(siteRoot, decodedPath);
    } else if (decodedPath.startsWith("/")) {
      target = path.resolve(siteRoot, decodedPath.slice(1));
    } else {
      target = path.resolve(path.dirname(sourceFile), decodedPath);
    }
  }

  if (!target.startsWith(`${siteRoot}${path.sep}`) && target !== siteRoot) {
    return { error: `resolves outside the site: ${reference}` };
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, "index.html");
  }
  return { target, fragment: rawFragment };
};

const checkReference = (sourceFile, reference) => {
  if (
    !reference ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference) ||
    reference.startsWith("data:")
  ) return;

  const resolved = findTarget(sourceFile, reference);
  if (resolved.error) {
    record(errors, sourceFile, resolved.error);
    return;
  }
  if (!fs.existsSync(resolved.target)) {
    record(errors, sourceFile, `missing internal target "${reference}"`);
    return;
  }

  if (resolved.fragment && resolved.target.endsWith(".html")) {
    let fragment;
    try {
      fragment = decodeURIComponent(resolved.fragment);
    } catch (_error) {
      record(errors, sourceFile, `contains an invalid fragment "${reference}"`);
      return;
    }
    const targetHtml = fs.readFileSync(resolved.target, "utf8");
    const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?:id|name)=(["'])${escaped}\\1`, "i").test(targetHtml)) {
      record(errors, sourceFile, `missing fragment target "${reference}"`);
    }
  }
};

const metaTag = (head, name) => head.match(
  new RegExp(`<meta\\b(?=[^>]*name=(["'])${name}\\1)[^>]*>`, "i")
)?.[0] || "";

const contentSecurityPolicy = (head) => {
  const tag = head.match(/<meta\b(?=[^>]*http-equiv=(["'])Content-Security-Policy\1)[^>]*>/i)?.[0] || "";
  return attribute(tag, "content") || "";
};

const scriptSources = (html) => Array.from(
  html.matchAll(/<script\b[^>]*src=(["'])(.*?)\1[^>]*><\/script>/gi),
  (match) => match[2]
);

const stylesheetSources = (html) => Array.from(
  html.matchAll(/<link\b(?=[^>]*rel=(["'])stylesheet\1)[^>]*>/gi),
  (match) => attribute(match[0], "href")
);

const sameOrderedValues = (actual, expected) =>
  actual.length === expected.length && actual.every((value, index) => value === expected[index]);

const validateStandalonePage = ({
  pageName,
  expectedScripts,
  expectedStyles,
  requiredCspDirectives
}) => {
  const file = path.join(siteRoot, pageName);
  if (!fs.existsSync(file)) {
    errors.push(`${pageName} is missing.`);
    return;
  }

  const html = fs.readFileSync(file, "utf8");
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || "";
  if (!/\slang=(["'])en(?:-[A-Za-z]+)?\1/i.test(htmlTag)) {
    record(errors, file, "missing an English lang attribute on <html>");
  }
  if (!/<meta\b[^>]*name=(["'])description\1[^>]*content=(["'])[^"']+\2/i.test(head)) {
    record(errors, file, "missing a non-empty meta description");
  }

  const canonicalTag = head.match(/<link\b[^>]*rel=(["'])canonical\1[^>]*>/i)?.[0] || "";
  const expectedCanonical = new URL(pageName, expectedSiteBase).href;
  if (attribute(canonicalTag, "href") !== expectedCanonical) {
    record(errors, file, `canonical URL must be "${expectedCanonical}"`);
  }

  const robots = (attribute(metaTag(head, "robots"), "content") || "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const directive of ["noindex", "nofollow"]) {
    if (!robots.includes(directive)) {
      record(errors, file, `robots metadata must include "${directive}"`);
    }
  }

  if ((attribute(metaTag(head, "referrer"), "content") || "").toLowerCase() !== "no-referrer") {
    record(errors, file, 'referrer policy must be "no-referrer"');
  }

  const csp = contentSecurityPolicy(head);
  requiredCspDirectives
    .filter((directive) => !csp.includes(directive))
    .forEach((directive) => record(errors, file, `Content Security Policy is missing "${directive}"`));
  if (
    !csp.includes("connect-src https://*.supabase.co") &&
    !/connect-src https:\/\/[a-z0-9-]+[.]supabase[.]co(?:;|\s|$)/i.test(csp)
  ) {
    record(errors, file, "Content Security Policy must allow only a Supabase HTTPS connection origin");
  }

  const scripts = scriptSources(html);
  if (!sameOrderedValues(scripts, expectedScripts)) {
    record(errors, file, `must load only these local scripts in order: ${expectedScripts.join(", ")}`);
  }
  const styles = stylesheetSources(html);
  if (!sameOrderedValues(styles, expectedStyles)) {
    record(errors, file, `must load only these local stylesheets in order: ${expectedStyles.join(", ")}`);
  }

  const inlineExecutableScripts = Array.from(
    html.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)
  ).filter((match) => !/\btype=(["'])application\/ld\+json\1/i.test(match[1]) && match[2].trim());
  if (inlineExecutableScripts.length) {
    record(errors, file, "must not contain inline executable scripts");
  }

  if (!/<main\b[^>]*>/i.test(html)) {
    record(errors, file, "missing the main content landmark");
  }
  const headings = html.match(/<h1\b[^>]*>/gi) || [];
  if (headings.length !== 1) {
    record(errors, file, `must contain exactly one H1; found ${headings.length}`);
  }

  for (const match of html.matchAll(/<(?:img|script|source|track)\b[^>]*>/gi)) {
    const reference = attribute(match[0], "src");
    if (!reference) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) {
      record(errors, file, `resource must use a local path: ${reference}`);
    }
    checkReference(file, reference);
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attribute(tag, "rel") || "").toLowerCase();
    if (!/(?:^|\s)(?:stylesheet|icon|preload)(?:\s|$)/.test(rel)) continue;
    const reference = attribute(tag, "href");
    if (reference && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) {
      record(errors, file, `resource must use a local path: ${reference}`);
    }
    checkReference(file, reference);
  }
};

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || "";
  const titleBlockRemoved = html.replace(
    /<header\b[^>]*id=(["'])title-block-header\1[^>]*>[\s\S]*?<\/header>/i,
    ""
  );

  if (!/\slang=(["'])en(?:-[A-Za-z]+)?\1/i.test(htmlTag)) {
    record(errors, file, "missing an English lang attribute on <html>");
  }
  if (!/<meta\b[^>]*name=(["'])description\1[^>]*content=(["'])[^"']+\2/i.test(head)) {
    record(errors, file, "missing a non-empty meta description");
  }
  if ((attribute(metaTag(head, "referrer"), "content") || "").toLowerCase() !== "no-referrer") {
    record(errors, file, 'referrer policy must be "no-referrer"');
  }
  const courseCsp = contentSecurityPolicy(head);
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'"
  ]) {
    if (!courseCsp.includes(directive)) {
      record(errors, file, `Content Security Policy is missing "${directive}"`);
    }
  }
  const learnerConnectSources = courseCsp.match(/(?:^|;\s*)connect-src\s+([^;]+)/i)?.[1]?.trim();
  if (learnerConnectSources !== "'self'") {
    record(errors, file, "learner-page Content Security Policy connect-src must allow only self");
  }
  const canonicalTag = head.match(/<link\b[^>]*rel=(["'])canonical\1[^>]*>/i)?.[0] || "";
  const canonical = attribute(canonicalTag, "href");
  const expectedCanonical = relative(file) === "index.html"
    ? expectedSiteBase
    : new URL(relative(file), expectedSiteBase).href;
  if (!canonical) {
    record(errors, file, "missing an absolute canonical URL");
  } else if (canonical !== expectedCanonical) {
    record(errors, file, `canonical URL is "${canonical}"; expected "${expectedCanonical}"`);
  }
  if (!/<meta\b[^>]*property=(["'])og:title\1/i.test(head)) {
    record(errors, file, "missing Open Graph title metadata");
  }
  if (!/<meta\b[^>]*property=(["'])og:description\1/i.test(head)) {
    record(errors, file, "missing Open Graph description metadata");
  }
  if (!/<meta\b[^>]*name=(["'])twitter:card\1/i.test(head)) {
    record(errors, file, "missing Twitter card metadata");
  }
  const expectedSocialImage = new URL("images/course-social-card.jpg", expectedSiteBase).href;
  const openGraphImageTag = head.match(/<meta\b(?=[^>]*property=(["'])og:image\1)[^>]*>/i)?.[0] || "";
  const twitterImageTag = head.match(/<meta\b(?=[^>]*name=(["'])twitter:image\1)[^>]*>/i)?.[0] || "";
  if (attribute(openGraphImageTag, "content") !== expectedSocialImage) {
    record(errors, file, `Open Graph image must be "${expectedSocialImage}"`);
  }
  if (attribute(twitterImageTag, "content") !== expectedSocialImage) {
    record(errors, file, `Twitter image must be "${expectedSocialImage}"`);
  }
  const courseJsonLd = Array.from(
    head.matchAll(/<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[2]
  ).map((source) => {
    try {
      return JSON.parse(source);
    } catch (_error) {
      return null;
    }
  }).find((entry) => entry?.["@type"] === "Course");
  if (!courseJsonLd) {
    record(errors, file, "missing valid Course JSON-LD metadata");
  } else {
    if (courseJsonLd.url !== expectedSiteBase) {
      record(errors, file, `Course JSON-LD url is "${courseJsonLd.url}"; expected "${expectedSiteBase}"`);
    }
    if (courseJsonLd.image !== expectedSocialImage) {
      record(errors, file, `Course JSON-LD image is "${courseJsonLd.image}"; expected "${expectedSocialImage}"`);
    }
    if (courseJsonLd.sameAs !== expectedRepository) {
      record(errors, file, `Course JSON-LD sameAs is "${courseJsonLd.sameAs}"; expected "${expectedRepository}"`);
    }
    if (courseJsonLd.version !== expectedCourseVersion) {
      record(errors, file, `Course JSON-LD version is "${courseJsonLd.version}"; expected "${expectedCourseVersion}"`);
    }
  }
  if (/assets\/course-data(?:-config|-client)?[.]js|assets\/course-data[.]css|\bdata-course-data-(?:widget|dialog|github)\b/i.test(html)) {
    record(errors, file, "learner pages must not load or render the legacy course-data login and consent controls");
  }
  if (/https:\/\/[a-z0-9-]+[.]supabase[.]co/i.test(head)) {
    record(errors, file, "learner-page CSP must not authorize the legacy Supabase origin");
  }

  const requiredCourseScripts = [
    "assets/course-enhancements.js",
    "assets/course-quiz.js"
  ];
  const pageScripts = scriptSources(html);
  const requiredPositions = requiredCourseScripts.map((source) => pageScripts.indexOf(source));
  if (
    requiredPositions.some((position) => position < 0) ||
    requiredPositions.some((position, index) => index > 0 && position <= requiredPositions[index - 1]) ||
    requiredCourseScripts.some((source) => pageScripts.filter((candidate) => candidate === source).length !== 1)
  ) {
    record(
      errors,
      file,
      `must load each learner script once and in this order: ${requiredCourseScripts.join(" → ")}`
    );
  }
  if (!/<a\b[^>]*class=(["'])[^"']*\bskip-link\b[^"']*\1[^>]*href=(["'])#quarto-document-content\2/i.test(html)) {
    record(errors, file, "missing the skip-to-content link");
  }
  if (!html.includes(`${expectedRepository}/issues/new`)) {
    record(errors, file, `missing the expected repository issue link "${expectedRepository}/issues/new"`);
  }
  if (!/<main\b[^>]*id=(["'])quarto-document-content\1/i.test(html)) {
    record(errors, file, "missing the main content landmark");
  }

  const contentH1 = titleBlockRemoved.match(/<h1\b[^>]*>/gi) || [];
  if (contentH1.length !== 1) {
    record(errors, file, `expected one course-content H1 outside the hidden title block; found ${contentH1.length}`);
  }

  const ids = Array.from(html.matchAll(/\sid=(["'])(.*?)\1/gi), (match) => match[2]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  duplicateIds.forEach((id) => record(errors, file, `duplicate id "${id}"`));

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (attribute(tag, "alt") === null) {
      record(errors, file, `image is missing alt text: ${tag.slice(0, 120)}`);
    }
  }

  for (const match of html.matchAll(/<iframe\b[^>]*>/gi)) {
    if (!stripTags(attribute(match[0], "title") || "")) {
      record(errors, file, "iframe is missing a descriptive title");
    }
  }

  for (const match of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    const openingTag = `<video${match[1]}>`;
    const body = match[2];
    if (!/\scontrols(?:\s|=|>)/i.test(openingTag)) {
      record(errors, file, "instructional video is missing controls");
    }
    if (!/<track\b[^>]*kind=(["'])captions\1[^>]*srclang=(["'])en\2/i.test(body)) {
      record(errors, file, "instructional video is missing an English captions track");
    }
  }

  for (const match of html.matchAll(/<(?:a|img|script|source|track|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const reference = attribute(tag, tag.startsWith("<a") || tag.startsWith("<link") ? "href" : "src");
    checkReference(file, reference);
  }

  for (const match of html.matchAll(/<a\b[^>]*target=(["'])_blank\1[^>]*>/gi)) {
    const rel = attribute(match[0], "rel") || "";
    if (!/\bnoopener\b/i.test(rel)) {
      record(errors, file, 'target="_blank" link is missing rel="noopener"');
    }
    record(warnings, file, 'contains a link that forces a new window; confirm that this is necessary and announced');
  }
}

const authenticatedStandaloneCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'"
];

validateStandalonePage({
  pageName: "admin.html",
  expectedScripts: [
    "assets/frame-guard.js",
    "assets/course-data-config.js",
    "assets/course-data-client.js",
    "assets/admin-dashboard.js"
  ],
  expectedStyles: ["assets/admin-dashboard.css"],
  requiredCspDirectives: authenticatedStandaloneCsp
});

validateStandalonePage({
  pageName: "verify.html",
  expectedScripts: [
    "assets/frame-guard.js",
    "assets/course-data-config.js",
    "assets/certificate-verify.js"
  ],
  expectedStyles: ["assets/certificate-verify.css"],
  requiredCspDirectives: authenticatedStandaloneCsp
});

if (!fs.existsSync(migrationFile)) {
  errors.push(`${migrationPageName} is missing.`);
} else {
  const html = fs.readFileSync(migrationFile, "utf8");
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || "";
  if (!/\slang=(["'])en\1/i.test(htmlTag)) {
    record(errors, migrationFile, "missing an English lang attribute on <html>");
  }
  if (!/\sdata-alc-migration-receiver=(["'])true\1/i.test(htmlTag)) {
    record(errors, migrationFile, "missing the receiver activation marker");
  }
  if (!/<meta\b[^>]*name=(["'])description\1[^>]*content=(["'])[^"']+\2/i.test(head)) {
    record(errors, migrationFile, "missing a non-empty meta description");
  }
  const canonicalTag = head.match(/<link\b[^>]*rel=(["'])canonical\1[^>]*>/i)?.[0] || "";
  const expectedCanonical = new URL(migrationPageName, expectedSiteBase).href;
  if (attribute(canonicalTag, "href") !== expectedCanonical) {
    record(errors, migrationFile, `canonical URL must be "${expectedCanonical}"`);
  }
  const robotsTag = head.match(/<meta\b(?=[^>]*name=(["'])robots\1)[^>]*>/i)?.[0] || "";
  if ((attribute(robotsTag, "content") || "").replace(/\s+/g, "").toLowerCase() !== "noindex,nofollow") {
    record(errors, migrationFile, 'robots metadata must be "noindex,nofollow"');
  }
  const referrerTag = head.match(/<meta\b(?=[^>]*name=(["'])referrer\1)[^>]*>/i)?.[0] || "";
  if ((attribute(referrerTag, "content") || "").toLowerCase() !== "no-referrer") {
    record(errors, migrationFile, 'referrer policy must be "no-referrer"');
  }
  const cspTag = head.match(/<meta\b(?=[^>]*http-equiv=(["'])Content-Security-Policy\1)[^>]*>/i)?.[0] || "";
  const csp = attribute(cspTag, "content") || "";
  ["default-src 'self'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]
    .filter((directive) => !csp.includes(directive))
    .forEach((directive) => record(errors, migrationFile, `Content Security Policy is missing "${directive}"`));
  if (!/<main\b[^>]*>/i.test(html) || (html.match(/<h1\b[^>]*>/gi) || []).length !== 1) {
    record(errors, migrationFile, "must contain one main landmark and exactly one H1");
  }
  if (!/data-migration-receiver-status\b/i.test(html)) {
    record(errors, migrationFile, "missing the migration status region");
  }
  const fallbackTag = html.match(/<a\b(?=[^>]*data-migration-receiver-fallback)[^>]*>/i)?.[0] || "";
  if (attribute(fallbackTag, "href") !== expectedSiteBase) {
    record(errors, migrationFile, `fallback link must be "${expectedSiteBase}"`);
  }
  const expectedScripts = ["assets/migration-schema.js", "assets/new-site-receiver.js"];
  const scripts = scriptSources(html);
  if (!sameOrderedValues(scripts, expectedScripts)) {
    record(errors, migrationFile, `must load only ${expectedScripts.join(" and ")} in that order`);
  }
  const styles = stylesheetSources(html);
  if (styles.length !== 1 || styles[0] !== "assets/migration.css") {
    record(errors, migrationFile, "must load only assets/migration.css as a stylesheet");
  }
  const inlineExecutableScripts = Array.from(
    html.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)
  ).filter((match) => !/\btype=(["'])application\/ld\+json\1/i.test(match[1]) && match[2].trim());
  if (inlineExecutableScripts.length) {
    record(errors, migrationFile, "must not contain inline executable scripts");
  }
  if (/<(?:form|iframe|img)\b/i.test(html)) {
    record(errors, migrationFile, "must not contain forms, frames, or images");
  }
  for (const match of html.matchAll(/<(?:a|script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    checkReference(migrationFile, attribute(tag, tag.startsWith("<script") ? "src" : "href"));
  }
}

const publishedFiles = walk(siteRoot);
for (const file of publishedFiles) {
  const publishedPath = relative(file);
  const basename = path.basename(file);
  if (
    publishedPath === "supabase" ||
    publishedPath.startsWith("supabase/") ||
    basename === "BACKEND-CONTRACT.md" ||
    basename === "config.toml" ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    path.extname(file).toLowerCase() === ".sql"
  ) {
    record(errors, file, "backend source, configuration, or environment files must not be published");
  }
}

const textualExtensions = new Set([".css", ".csv", ".do", ".html", ".js", ".json", ".md", ".r", ".txt", ".vtt", ".xml"]);
for (const file of publishedFiles.filter((entry) => textualExtensions.has(path.extname(entry).toLowerCase()))) {
  const text = fs.readFileSync(file, "utf8");
  if (text.toLowerCase().includes(retiredOwnerOrigin)) {
    const matches = text.toLowerCase().match(new RegExp(retiredOwnerOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [];
    const isRequiredMigrationOrigin = relative(file) === "assets/migration-schema.js" &&
      matches.length === 1 &&
      text.includes(`const OLD_ORIGIN = "${retiredOwnerOrigin}";`);
    if (!isRequiredMigrationOrigin) {
      record(errors, file, `contains retired GitHub Pages origin "${retiredOwnerOrigin}"`);
    }
  }
  if (/\bsb_secret_[A-Za-z0-9._-]+\b/.test(text)) {
    record(errors, file, "contains a Supabase server secret");
  }
  for (const token of text.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g) || []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") {
        record(errors, file, "contains a Supabase service-role JWT");
      }
    } catch (_error) {
      // Ignore unrelated JWT-shaped strings whose payload is not valid JSON.
    }
  }
}

const robotsFile = path.join(siteRoot, "robots.txt");
const expectedSitemapUrl = new URL("sitemap.xml", expectedSiteBase).href;
if (!fs.existsSync(robotsFile)) {
  errors.push("robots.txt is missing.");
} else if (!fs.readFileSync(robotsFile, "utf8").includes(`Sitemap: ${expectedSitemapUrl}`)) {
  errors.push(`robots.txt does not advertise ${expectedSitemapUrl}`);
}

const sitemapFile = path.join(siteRoot, "sitemap.xml");
if (!fs.existsSync(sitemapFile)) {
  errors.push("sitemap.xml is missing.");
} else {
  const sitemap = fs.readFileSync(sitemapFile, "utf8");
  const locations = Array.from(sitemap.matchAll(/<loc>(.*?)<\/loc>/g), (match) => match[1]);
  if (locations.length !== htmlFiles.length) {
    errors.push(`sitemap.xml has ${locations.length} URLs; expected ${htmlFiles.length} indexed course pages.`);
  }
  if (new Set(locations).size !== locations.length) {
    errors.push("sitemap.xml contains duplicate URLs.");
  }
  const expectedLocations = htmlFiles.map((file) => new URL(relative(file), expectedSiteBase).href);
  locations.filter((location) => !expectedLocations.includes(location))
    .forEach((location) => errors.push(`sitemap.xml contains an unexpected URL: ${location}`));
  expectedLocations.filter((location) => !locations.includes(location))
    .forEach((location) => errors.push(`sitemap.xml is missing ${location}`));
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const questionBankFile = path.resolve(
  scriptDirectory,
  "../../supabase/functions/_shared/question-bank.ts"
);
if (!fs.existsSync(questionBankFile)) {
  errors.push("supabase/functions/_shared/question-bank.ts is missing.");
} else {
  const bankSource = fs.readFileSync(questionBankFile, "utf8");
  const answerKeyVersion = bankSource.match(/\bANSWER_KEY_VERSION\s*=\s*(["'])(.*?)\1/)?.[2] || "";
  if (!answerKeyVersion.startsWith(`${expectedCourseVersion}-`)) {
    record(errors, questionBankFile, `ANSWER_KEY_VERSION must begin with "${expectedCourseVersion}-"`);
  }

  const bank = new Map();
  for (const match of bankSource.matchAll(
    /^\s{2}"([^"]+)":\s*\{\s*moduleNumber:\s*(\d+),\s*passScore:\s*(\d+),\s*answers:\s*\{([^}]*)\},\s*\},/gm
  )) {
    const answers = new Map(
      Array.from(match[4].matchAll(/"([^"]+)"\s*:\s*"([a-d])"/g), (answer) => [answer[1], answer[2]])
    );
    bank.set(match[1], { moduleNumber: Number(match[2]), passScore: Number(match[3]), answers });
  }

  const published = new Map();
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    for (const formMatch of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const formTag = `<form${formMatch[1]}>`;
      if (!/\bscored-quiz\b/.test(attribute(formTag, "class") || "")) continue;
      const quizId = attribute(formTag, "data-quiz-id") || "";
      const passScoreAttribute = attribute(formTag, "data-pass-score");
      if (!quizId) {
        record(errors, file, "scored quiz is missing data-quiz-id");
        continue;
      }
      if (published.has(quizId)) {
        record(errors, file, `duplicates published quiz id "${quizId}"`);
        continue;
      }

      const answers = new Map();
      for (const fieldsetMatch of formMatch[2].matchAll(/<fieldset\b([^>]*)>([\s\S]*?)<\/fieldset>/gi)) {
        const fieldsetTag = `<fieldset${fieldsetMatch[1]}>`;
        const correctAnswer = attribute(fieldsetTag, "data-answer") || "";
        const radioNames = new Set(
          Array.from(fieldsetMatch[2].matchAll(/<input\b[^>]*>/gi), (input) => input[0])
            .filter((input) => (attribute(input, "type") || "").toLowerCase() === "radio")
            .map((input) => attribute(input, "name"))
            .filter(Boolean)
        );
        if (radioNames.size !== 1 || !/^[a-d]$/.test(correctAnswer)) {
          record(errors, file, `quiz "${quizId}" contains a question with invalid identity or answer metadata`);
          continue;
        }
        const [questionId] = radioNames;
        if (answers.has(questionId)) {
          record(errors, file, `quiz "${quizId}" duplicates question id "${questionId}"`);
        }
        answers.set(questionId, correctAnswer);
      }
      const passScore = passScoreAttribute === null ? answers.size : Number(passScoreAttribute);
      published.set(quizId, { passScore, answers, file });
    }
  }

  const publishedQuestionCount = Array.from(published.values())
    .reduce((sum, quiz) => sum + quiz.answers.size, 0);
  const bankQuestionCount = Array.from(bank.values())
    .reduce((sum, quiz) => sum + quiz.answers.size, 0);
  if (published.size !== 22 || publishedQuestionCount !== 57) {
    errors.push(`Published course contains ${published.size} scored quizzes and ${publishedQuestionCount} questions; expected 22 and 57.`);
  }
  if (bank.size !== 22 || bankQuestionCount !== 57) {
    record(errors, questionBankFile, `contains ${bank.size} scored quizzes and ${bankQuestionCount} questions; expected 22 and 57`);
  }

  for (const [quizId, definition] of bank) {
    const rendered = published.get(quizId);
    if (!rendered) {
      record(errors, questionBankFile, `quiz "${quizId}" is not present in the rendered course`);
      continue;
    }
    if (rendered.passScore !== definition.passScore) {
      record(errors, rendered.file, `quiz "${quizId}" pass score differs from the server question bank`);
    }
    for (const [questionId, correctAnswer] of definition.answers) {
      if (rendered.answers.get(questionId) !== correctAnswer) {
        record(errors, rendered.file, `quiz "${quizId}" question "${questionId}" differs from the server question bank`);
      }
    }
    for (const questionId of rendered.answers.keys()) {
      if (!definition.answers.has(questionId)) {
        record(errors, rendered.file, `quiz "${quizId}" contains question "${questionId}" missing from the server question bank`);
      }
    }
  }
  for (const [quizId, rendered] of published) {
    if (!bank.has(quizId)) {
      record(errors, rendered.file, `quiz "${quizId}" is missing from the server question bank`);
    }
  }
}

const enhancementScript = path.join(siteRoot, "assets", "course-enhancements.js");
if (!fs.existsSync(enhancementScript)) {
  errors.push("assets/course-enhancements.js is missing.");
} else {
  const source = fs.readFileSync(enhancementScript, "utf8");
  if (!source.includes(`${expectedRepository}/issues/new`)) {
    errors.push(`assets/course-enhancements.js does not target ${expectedRepository}/issues/new`);
  }
  if (!source.includes('parameters.get("surveyComplete") === "1"') ||
      !source.includes("externalSurveyCompleted: true")) {
    errors.push("assets/course-enhancements.js must persist the Illinois Form return marker from surveyComplete=1");
  }
  if (!/externalSurveyCompleted === true[\s\S]*?intake[.]role[\s\S]*?intake[.]discovery/.test(source)) {
    errors.push("assets/course-enhancements.js must accept both the external Form marker and legacy five-field intake records");
  }
}

const dataConfigScript = path.join(siteRoot, "assets", "course-data-config.js");
if (!fs.existsSync(dataConfigScript)) {
  errors.push("assets/course-data-config.js is missing.");
} else {
  const source = fs.readFileSync(dataConfigScript, "utf8");
  const configuredBoolean = (name) => {
    const value = source.match(new RegExp(`\\b${name}\\s*:\\s*(true|false)\\b`))?.[1];
    return value === undefined ? undefined : value === "true";
  };
  const configuredString = (name) => source.match(
    new RegExp(`\\b${name}\\s*:\\s*(["'])(.*?)\\1`)
  )?.[2];

  const enabled = configuredBoolean("enabled");
  const supabaseUrl = configuredString("supabaseUrl");
  const publishableKey = configuredString("publishableKey");
  const courseVersion = configuredString("courseVersion");
  const consentVersion = configuredString("consentVersion");
  const noticePath = configuredString("noticePath");
  const githubOauthEnabled = configuredBoolean("githubOauthEnabled");
  const emailOtpEnabled = configuredBoolean("emailOtpEnabled");

  const secretAssignment = /\b(?:service[_-]?role(?:[_-]?key)?|serviceRoleKey|supabaseServiceRoleKey|secretKey|jwtSecret)\b\s*[:=]\s*(["'`])[^"'`]+\1/i;
  if (/\bsb_secret_[A-Za-z0-9._-]+\b/.test(source) || secretAssignment.test(source)) {
    record(errors, dataConfigScript, "contains a service or server secret; browser configuration may contain only a publishable key");
  }
  for (const token of source.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g) || []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") {
        record(errors, dataConfigScript, "contains a Supabase service-role JWT");
      }
    } catch (_error) {
      // An unrelated JWT-shaped string is handled by the normal configuration validation below.
    }
  }

  if (enabled === undefined || supabaseUrl === undefined || publishableKey === undefined) {
    record(errors, dataConfigScript, "must define enabled, supabaseUrl, and publishableKey in the public defaults");
  } else if (!enabled) {
    if (supabaseUrl || publishableKey) {
      record(errors, dataConfigScript, "disabled configuration must leave supabaseUrl and publishableKey empty");
    }
  } else {
    let validSupabaseUrl = false;
    let parsedSupabaseUrl = null;
    try {
      parsedSupabaseUrl = new URL(supabaseUrl);
      validSupabaseUrl = parsedSupabaseUrl.protocol === "https:" &&
        /^[a-z0-9-]+[.]supabase[.]co$/i.test(parsedSupabaseUrl.hostname);
    } catch (_error) {
      // Reported by the complete-enabled-configuration error below.
    }
    if (!validSupabaseUrl || publishableKey.length < 20) {
      record(errors, dataConfigScript, "enabled configuration must contain a complete HTTPS Supabase URL and publishable key");
    } else {
      for (const pageName of ["admin.html", "verify.html"]) {
        const htmlFile = path.join(siteRoot, pageName);
        if (!fs.existsSync(htmlFile)) continue;
        const html = fs.readFileSync(htmlFile, "utf8");
        const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
        const csp = contentSecurityPolicy(head);
        if (csp.includes("https://*.supabase.co") || !csp.includes(parsedSupabaseUrl.origin)) {
          record(
            errors,
            htmlFile,
            `enabled production CSP must use the exact backend origin "${parsedSupabaseUrl.origin}" instead of a Supabase wildcard`
          );
        }
      }
    }
  }
  if (courseVersion !== expectedCourseVersion) {
    record(errors, dataConfigScript, `courseVersion must be "${expectedCourseVersion}"`);
  }
  if (consentVersion !== expectedConsentVersion) {
    record(errors, dataConfigScript, `consentVersion must be "${expectedConsentVersion}"`);
  }
  if (noticePath !== "/accelerometer-learning-course/data-privacy.html") {
    record(errors, dataConfigScript, "noticePath must target the published learning-data privacy notice");
  }
  if (githubOauthEnabled !== true) {
    record(errors, dataConfigScript, "GitHub OAuth must remain the enabled primary sign-in method");
  }
  if (emailOtpEnabled !== false) {
    record(errors, dataConfigScript, "email OTP must remain disabled until custom SMTP is deliberately configured");
  }
  if (enabled === false) {
    record(warnings, dataConfigScript, "course data collection is disabled; this is expected before backend go-live but must be reviewed before publishing the production release");
  }
}

const expectedScriptOrigin = new URL(expectedSiteBase).origin;
for (const file of allHtmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const source = attribute(tag, "src");
    if (!source) continue;
    let sourceUrl;
    try {
      sourceUrl = new URL(source, expectedSiteBase);
    } catch (_error) {
      record(errors, file, `has an invalid script source: ${source}`);
      continue;
    }
    if (sourceUrl.origin !== expectedScriptOrigin) {
      record(errors, file, `loads non-course JavaScript from ${sourceUrl.origin || sourceUrl.protocol}`);
    }
  }
}

const privacyFile = path.join(siteRoot, "data-privacy.html");
if (!fs.existsSync(privacyFile)) {
  errors.push("data-privacy.html is missing.");
} else {
  const privacyHtml = fs.readFileSync(privacyFile, "utf8");
  const privacyText = stripTags(privacyHtml);
  if (!privacyHtml.includes(expectedEntryFormUrl)) {
    record(errors, privacyFile, `must link to the Illinois course entry form "${expectedEntryFormUrl}"`);
  }
  if (!/does not require GitHub sign-in/i.test(privacyText) || !/browser-local/i.test(privacyText)) {
    record(errors, privacyFile, "must explain that learner sign-in is removed and course progress is browser-local");
  }
  if (!/not uploaded to the former course database/i.test(privacyText) || !/previously created a synchronized course record/i.test(privacyText)) {
    record(errors, privacyFile, "must distinguish current browser-local records from records collected by the legacy backend");
  }
  if (!/not (?:used for|an?)\s+UIUC (?:grades|official)/i.test(privacyText) &&
      !/not an official UIUC record/i.test(privacyText)) {
    record(errors, privacyFile, "must state that learning records are not official UIUC grades or records");
  }
}

const intakeFile = path.join(siteRoot, "intake.html");
if (!fs.existsSync(intakeFile)) {
  errors.push("intake.html is missing.");
} else {
  const intakeHtml = fs.readFileSync(intakeFile, "utf8");
  const entryLink = Array.from(intakeHtml.matchAll(/<a\b[^>]*>/gi))
    .map((match) => match[0])
    .find((tag) => attribute(tag, "id") === "course-intake-form-link") || "";
  if (!entryLink || attribute(entryLink, "href") !== expectedEntryFormUrl) {
    record(errors, intakeFile, `must provide the Illinois course entry form link "${expectedEntryFormUrl}"`);
  }
  if (/id=(["'])course-intake-form\1|id=(["'])intake-name\2/i.test(intakeHtml)) {
    record(errors, intakeFile, "must not contain the retired learner intake form or name input");
  }
  const intakeText = stripTags(intakeHtml);
  if (!/No GitHub account required/i.test(intakeText) || !/browser-local marker/i.test(intakeText)) {
    record(errors, intakeFile, "must explain that no GitHub account is required and only a browser-local completion marker is stored");
  }
  if (!/<a\b[^>]*href=(["'])(?:[.][\/])?data-privacy\.html\1/i.test(intakeHtml)) {
    record(errors, intakeFile, "must link the course and form privacy information");
  }
}

if (!htmlFiles.length) {
  errors.push("No rendered HTML files were found.");
}

if (warnings.length) {
  console.warn(`\nWarnings (${warnings.length}):`);
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

if (errors.length) {
  console.error(`\nSite quality checks failed (${errors.length}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Checked ${htmlFiles.length} indexed course pages plus 3 no-index service pages: links, ownership URLs, metadata, learner-script isolation, legacy configuration, server question-bank parity, headings, images, landmarks, sitemap, and captions passed.`);
