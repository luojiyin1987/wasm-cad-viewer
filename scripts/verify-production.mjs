const productionUrl = new URL(
  process.env.PRODUCTION_URL ?? "https://cad2pdf.itea.fit/"
);
const expectedTitle = "<title>在线 CAD 转 PDF｜DXF 预览与单页 PDF 导出</title>";
const expectedCanonical = `<link rel="canonical" href="${productionUrl.href}" />`;

async function fetchText(pathname) {
  const url = new URL(pathname, productionUrl);
  url.searchParams.set("verify", Date.now().toString());

  const response = await fetch(url, {
    headers: {
      "cache-control": "no-cache"
    },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  }

  return {
    body,
    contentType: response.headers.get("content-type") ?? ""
  };
}

function assertContains(content, expected, pathname) {
  if (!content.includes(expected)) {
    throw new Error(`${pathname} is missing expected content: ${expected}`);
  }
}

function assertStaticFile({ body, contentType }, pathname) {
  if (/<!doctype html|<html[\s>]/i.test(body) || contentType.includes("text/html")) {
    throw new Error(`${pathname} still resolves to the SPA HTML shell.`);
  }
}

async function main() {
  const [home, robots, sitemap] = await Promise.all([
    fetchText("/"),
    fetchText("/robots.txt"),
    fetchText("/sitemap.xml")
  ]);

  assertContains(home.body, expectedTitle, "/");
  assertContains(home.body, expectedCanonical, "/");

  assertStaticFile(robots, "/robots.txt");
  assertContains(robots.body, "User-agent: *", "/robots.txt");
  assertContains(
    robots.body,
    `Sitemap: ${productionUrl.href}sitemap.xml`,
    "/robots.txt"
  );

  assertStaticFile(sitemap, "/sitemap.xml");
  assertContains(sitemap.body, "<urlset", "/sitemap.xml");
  assertContains(
    sitemap.body,
    `<loc>${productionUrl.href}</loc>`,
    "/sitemap.xml"
  );

  console.log(`Production verification passed: ${productionUrl.href}`);
}

main().catch((error) => {
  console.error(`Production verification failed: ${error.message}`);
  process.exitCode = 1;
});
