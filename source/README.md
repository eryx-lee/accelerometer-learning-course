# Accelerometer Learning Course — archived Bookdown source

This folder preserves the earlier Bookdown source for reference. It is not the
published course and is no longer maintained. The current source is in
`../quarto/`, the rendered GitHub Pages site is in `../docs/`, and contribution,
build, caption, and quality-check instructions are in the repository `README.md`.

## Contents

- `index.Rmd` — course home page
- `01-accelerometry-basics.Rmd` — Module 1 content
- `_bookdown.yml` and `_output.yml` — Bookdown configuration
- `style.css` — light styling for video placeholders and review notes
- Published videos are referenced from the current GitHub Pages site rather
  than duplicated in this archive.

## Do not edit for current course changes

Make current course changes in `../quarto/`. Content, technical guidance,
captions, downloads, and navigation in this archived version may be outdated.

## Rebuild the website

With R, R Markdown, and Bookdown installed, run this from this folder:

```r
bookdown::render_book("index.Rmd", "bookdown::bs4_book")
```

The generated site is written to `_book/`. This rebuild is for historical
comparison only and is not deployed.
