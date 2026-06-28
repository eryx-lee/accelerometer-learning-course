# Accelerometer Learning Course — Module 1

This is a clean Bookdown starter project containing the first course module, **Accelerometry basics**.

## Contents

- `index.Rmd` — course home page
- `01-accelerometry-basics.Rmd` — Module 1 content
- `_bookdown.yml` and `_output.yml` — Bookdown configuration
- `style.css` — light styling for video placeholders and review notes
- `_book/index.html` — rendered local preview

## Edit first

1. Replace the three video placeholders with approved, captioned video URLs.
2. Have a content expert verify all study-specific settings before publishing.
3. Replace the placeholder instructor/course contact information.

## Rebuild the website

With R, R Markdown, and Bookdown installed, run this from this folder:

```r
bookdown::render_book("index.Rmd", "bookdown::bs4_book")
```

The generated site is written to `_book/`. Open `_book/index.html` in a browser to preview it.

