# Production deployment

The canonical production site is:

```text
https://cad2pdf.itea.fit/
```

A deployment is only ready for Google indexing when all three production resources are current:

```text
/
/robots.txt
/sitemap.xml
```

## Deploy the current `main` branch

Update the local checkout first so an old `dist/` directory cannot be uploaded:

```bash
git switch main
git fetch origin
git pull --ff-only origin main
rm -rf dist
pnpm install --frozen-lockfile
pnpm run deploy:production
```

`deploy:production` performs a clean Vite build, verifies the generated SEO files, and deploys `dist/` to the Cloudflare Pages project as the `main` production branch.

## Verify production

After Cloudflare reports a successful production deployment, run:

```bash
pnpm run verify:production
```

The command fails when any of these regressions are present:

- the homepage still contains the old `WASM CAD Viewer` title
- the canonical link is missing
- `robots.txt` resolves to the SPA HTML shell
- `sitemap.xml` resolves to the SPA HTML shell
- the sitemap does not contain `https://cad2pdf.itea.fit/`

For manual inspection:

```bash
curl -s https://cad2pdf.itea.fit/ \
  | grep -iE '<title>|canonical|description'

curl -i https://cad2pdf.itea.fit/robots.txt
curl -i https://cad2pdf.itea.fit/sitemap.xml
```

Do not request Google indexing until this production verification passes.
