# Deploying to GitHub Pages (5 minutes)

The workflow files are in a **hidden folder**, `.github/workflows/` (folders starting with a dot are hidden by
Windows/macOS file managers). Copies are also provided next to the zip as `pages.yml` and `validate-data.yml`.

1. Create an empty repository on GitHub (for example `afribiobank-prototype`).
2. Copy the contents of this folder into it, **including the hidden `.github` folder**, then:
   ```bash
   git init -b main
   git add -A            # -A includes dot-folders
   git commit -m "AfriBiobank prototype"
   git remote add origin https://github.com/<you>/afribiobank-prototype.git
   git push -u origin main
   ```
   (Using the GitHub web uploader? Drag the folder itself, or create `.github/workflows/pages.yml` by hand
   with "Add file → Create new file" and paste the YAML.)
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. Open the **Actions** tab. "Deploy to GitHub Pages" runs on the push; when green, the site is at
   `https://<you>.github.io/afribiobank-prototype/`.

## No workflow at all?
Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`. The site is plain static files.

## Troubleshooting
* *Nothing in the Actions tab*: the `.github` folder was not pushed. Run `git ls-files .github`.
* *"Get Pages site failed" / HttpError 404*: step 3 was skipped; set Source to GitHub Actions and re-run.
* *Blank page with "Could not start"*: opening `index.html` from disk. Serve it (`python3 -m http.server`) or use Pages.
