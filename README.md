# Accelerometer Learning Course

This repository hosts the public website for the Accelerometer Learning Course.

**Live site:** https://uiuclapasssta.github.io/accelerometer-learning-course/

## Course modules

1. Accelerometer Introduction
2. Accelerometer Programming and Downloading
3. Organizing and Converting
4. Setting Up R and GGIR
5. Checking Data Quality
6. Cleaning and Standardizing
7. Setting Up Final Dataset in Stata
8. Knowledge Checking

## Repository layout

- `quarto/` — editable Quarto course source.
- `quarto/captions/` — reviewed English WebVTT tracks for all course videos.
- `quarto/downloads/course-toolkit/` — reusable templates, synthetic data,
  validation scripts, and the capstone.
- `quarto/migration.html` and `quarto/assets/migration-*` — the no-index,
  browser-only receiver used to copy saved course state from the former Pages
  address after a learner explicitly requests it.
- `docs/` — rendered static website published by GitHub Pages.
- `supabase/` — database migrations, Edge Functions, security tests, and the
  course-data operations guide. It is deployed separately from GitHub
  Pages; no server credential is published in `docs/`.
- `source/` — archived Bookdown/R Markdown source retained for reference; it
  links to current published videos instead of duplicating large media files.

## Updating the website

The published site is rendered with **Quarto 1.9.38**. Keeping the local
version aligned prevents generated HTML and asset hashes from changing
unexpectedly.

1. Edit the relevant file in `quarto/`.
2. Render the project:

   ```bash
   quarto render quarto
   ```

3. Run the dependency-free site checks:

   ```bash
   node quarto/scripts/check-site.mjs quarto/_site
   ```

4. From the repository root, replace the generated site in `docs/`:

   ```bash
   rsync -a --delete quarto/_site/ docs/
   ```

5. Run the checker against `docs/`, review the change, then commit and push:

   ```bash
   node quarto/scripts/check-site.mjs docs
   ```

Before publishing changes, verify study-specific settings, references, participant privacy, captions, and video permissions.

`docs/` is generated output. Do not edit it by hand or copy `supabase/`, local
environment files, SQL, secrets, or backend operations documents into it.

If a toolkit file changes, rebuild its downloadable archive before rendering:

```bash
cd quarto/downloads
zip -rq accelerometer-course-toolkit.zip course-toolkit
```

## Accessibility and quality requirements

- Every instructional video must include an English captions `<track>` and a
  nearby readable summary or transcript.
- Published video masters should remain 1920 × 1080, stay below GitHub's
  per-file limit, and retain the course's documented visual and audio
  corrections.
- Images need meaningful alternative text unless they are purely decorative.
- Internal links and fragment targets must resolve.
- Each rendered page must include a language, description, canonical URL, one
  visible course-page heading, and social-sharing metadata.
- Tables that overflow on a small screen are made keyboard-focusable by the
  progressive-enhancement script.
- The learner-facing course does not require GitHub sign-in. Its entry form is
  hosted separately by University of Illinois Forms, and the course stores only
  an external-form completion marker plus progress, quiz, feedback, and local
  certificate state in the learner's browser. The optional GitHub Issue link
  never copies saved feedback; a learner must type and submit any public GitHub
  message separately.
- The optional address-migration bridge transfers only explicitly allowlisted
  course records between the former and current site windows. It does not put
  saved values in a URL, enumerate unrelated browser storage, or delete the
  former-site copy.

Before publishing, render the site, run the checker against both `quarto/_site`
and `docs`, and confirm that the two generated directories match.

## Legacy course data service

The former protected data service is intentionally independent of GitHub Pages. Its
database, API, permissions, server grading, retention job, certificate
verification, and administrator reporting are defined in [`supabase/`](supabase/README.md).
The request/response and metric definitions are in
[`supabase/BACKEND-CONTRACT.md`](supabase/BACKEND-CONTRACT.md).

The learner-facing Quarto pages no longer load the backend configuration,
authentication client, or consent widget, so they cannot create new synchronized
learner events. The standalone administrator and certificate-verification pages
retain their explicit legacy assets so authorized staff can manage previously
collected records. A publishable key is expected to be public; a service-role
key, database password, OAuth client secret, or certificate signing secret must
never appear in browser files or the rendered site.

## Course stewardship and rights

The course is maintained by LA PASSSTA Lab at the University of Illinois
Urbana-Champaign. Use the repository issue tracker for corrections and
accessibility reports, without including participant or other sensitive data.
No explicit open-source license is currently attached; copyright therefore
remains with the relevant rights holders unless a file states otherwise.
