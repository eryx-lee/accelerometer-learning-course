#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const siteRoot = path.resolve(process.argv[2] || "quarto/_site");
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

const htmlFiles = walk(siteRoot).filter((file) => file.endsWith(".html"));
const relative = (file) => path.relative(siteRoot, file).split(path.sep).join("/");
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
  if (!/<link\b[^>]*rel=(["'])canonical\1[^>]*href=(["'])https?:\/\/[^"']+\2/i.test(head)) {
    record(errors, file, "missing an absolute canonical URL");
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
  if (!/<a\b[^>]*class=(["'])[^"']*\bskip-link\b[^"']*\1[^>]*href=(["'])#quarto-document-content\2/i.test(html)) {
    record(errors, file, "missing the skip-to-content link");
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

console.log(`Checked ${htmlFiles.length} HTML pages: links, metadata, headings, images, landmarks, and captions passed.`);
