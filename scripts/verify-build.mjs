import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const productionUrl = "https://cad2pdf.itea.fit/";
const expectedTitle = "<title>在线 CAD 转 PDF｜DXF 预览与单页 PDF 导出</title>";
const expectedCanonical = `<link rel="canonical" href="${productionUrl}" />`;

async function readDistFile(relativePath) {
  const filePath = path.join(distDir, relativePath);

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Missing required build output: dist/${relativePath}`, {
      cause: error
    });
  }
}

function assertContains(content, expected, fileName) {
  if (!content.includes(expected)) {
    throw new Error(`dist/${fileName} is missing expected content: ${expected}`);
  }
}

function assertNotHtml(content, fileName) {
  if (/<!doctype html|<html[\s>]/i.test(content)) {
    throw new Error(`dist/${fileName} contains the SPA HTML shell instead of its static file content.`);
  }
}

async function main() {
  const [indexHtml, robotsTxt, sitemapXml, ogImage] = await Promise.all([
    readDistFile("index.html"),
    readDistFile("robots.txt"),
    readDistFile("sitemap.xml"),
    readDistFile("og-image.svg")
  ]);

  assertContains(indexHtml, expectedTitle, "index.html");
  assertContains(indexHtml, expectedCanonical, "index.html");
  assertContains(indexHtml, "name=\"description\"", "index.html");

  assertNotHtml(robotsTxt, "robots.txt");
  assertContains(robotsTxt, "User-agent: *", "robots.txt");
  assertContains(robotsTxt, `Sitemap: ${productionUrl}sitemap.xml`, "robots.txt");

  assertNotHtml(sitemapXml, "sitemap.xml");
  assertContains(sitemapXml, "<urlset", "sitemap.xml");
  assertContains(sitemapXml, `<loc>${productionUrl}</loc>`, "sitemap.xml");

  assertContains(ogImage, "<svg", "og-image.svg");

  console.log("Build verification passed: SEO HTML and static crawler files are present in dist/.");
}

main().catch((error) => {
  console.error(`Build verification failed: ${error.message}`);
  process.exitCode = 1;
});
