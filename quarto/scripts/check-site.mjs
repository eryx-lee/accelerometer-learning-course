#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const siteRoot = path.resolve(process.argv[2] || "quarto/_site");
const expectedSiteBase = process.env.COURSE_SITE_URL || "https://uiuclapasssta.github.io/accelerometer-learning-course/";
const expectedRepository = process.env.COURSE_REPOSITORY_URL || "https://github.com/uiuclapasssta/accelerometer-learning-course";
const retiredOwnerSlug = ["la", "passsta", "lab"].join("-");
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
const htmlFiles = allHtmlFiles.filter((file) => relative(file) !== migrationPageName);
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
  const scripts = Array.from(html.matchAll(/<script\b[^>]*src=(["'])(.*?)\1[^>]*><\/script>/gi), (match) => match[2]);
  if (scripts.length !== expectedScripts.length || !expectedScripts.every((script) => scripts.includes(script))) {
    record(errors, migrationFile, `must load only ${expectedScripts.join(" and ")}`);
  }
  const styles = Array.from(html.matchAll(/<link\b(?=[^>]*rel=(["'])stylesheet\1)[^>]*>/gi), (match) => attribute(match[0], "href"));
  if (styles.length !== 1 || styles[0] !== "assets/migration.css") {
    record(errors, migrationFile, "must load only assets/migration.css as a stylesheet");
  }
  if (/<(?:form|iframe|img)\b/i.test(html)) {
    record(errors, migrationFile, "must not contain forms, frames, or images");
  }
  for (const match of html.matchAll(/<(?:a|script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    checkReference(migrationFile, attribute(tag, tag.startsWith("<script") ? "src" : "href"));
  }
}

const textualExtensions = new Set([".css", ".csv", ".do", ".html", ".js", ".json", ".md", ".r", ".txt", ".vtt", ".xml"]);
for (const file of walk(siteRoot).filter((entry) => textualExtensions.has(path.extname(entry).toLowerCase()))) {
  const text = fs.readFileSync(file, "utf8");
  if (text.toLowerCase().includes(retiredOwnerSlug)) {
    const matches = text.toLowerCase().match(new RegExp(retiredOwnerSlug, "g")) || [];
    const isRequiredMigrationOrigin = relative(file) === "assets/migration-schema.js" &&
      matches.length === 1 &&
      text.includes(`const OLD_ORIGIN = "https://${retiredOwnerSlug}.github.io";`);
    if (!isRequiredMigrationOrigin) {
      record(errors, file, `contains retired GitHub owner or Pages host "${retiredOwnerSlug}"`);
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

const enhancementScript = path.join(siteRoot, "assets", "course-enhancements.js");
if (!fs.existsSync(enhancementScript)) {
  errors.push("assets/course-enhancements.js is missing.");
} else if (!fs.readFileSync(enhancementScript, "utf8").includes(`${expectedRepository}/issues/new`)) {
  errors.push(`assets/course-enhancements.js does not target ${expectedRepository}/issues/new`);
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

console.log(`Checked ${htmlFiles.length} indexed course pages plus the no-index migration receiver: links, ownership URLs, metadata, headings, images, landmarks, sitemap, and captions passed.`);
