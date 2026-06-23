# GitHub Pages upload package

This folder is ready to publish the rendered Module 1 website with GitHub Pages.

## Publish it

1. Create a new GitHub repository named `accelerometer-learning-course`.
2. Upload this entire folder to the repository, keeping the `docs/` folder name unchanged.
3. On GitHub, open **Settings** → **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose branch `main` and folder `/docs`, then click **Save**.
6. GitHub will show the public site address after deployment completes.

`docs/index.html` is the site entry page. The `.nojekyll` file tells GitHub Pages to serve the Bookdown output unchanged.

## Before making the repository public

- Replace each video placeholder with a captioned, approved video.
- Verify all study-specific parameters and references.
- Remove any confidential, participant-identifiable, or unpublished material.
