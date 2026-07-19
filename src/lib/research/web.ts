import { existsSync } from "node:fs";

// Free, key-less web research. Nothing here uses a paid API or an API key:
//  - webSearch  → scrapes DuckDuckGo's HTML endpoint
//  - fetchReadable → plain fetch + HTML→text + on-page link extraction
//  - browsePage → headless Chromium (playwright-core) for JS-rendered sites
//
// Speed is deliberately not a priority; correctness and reach are.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MAX_TEXT_CHARS = 12_000;
const MAX_LINKS = 50;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  links: { text: string; url: string }[];
  truncated: boolean;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Resolve DuckDuckGo redirect links (…/l/?uddg=<encoded target>) to the target. */
function resolveDdgHref(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      /* fall through */
    }
  }
  if (href.startsWith("//")) return `https:${href}`;
  return href;
}

/** Parse DuckDuckGo HTML result markup into structured results. */
export function parseDuckDuckGoResults(html: string, limit = 8): SearchResult[] {
  const results: SearchResult[] = [];
  // Each result: <a ... class="result__a" href="…">title</a> … snippet
  const blockRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html))) snippets.push(stripTags(sm[1]));

  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = blockRe.exec(html)) && results.length < limit) {
    const url = resolveDdgHref(m[1]);
    const title = stripTags(m[2]);
    if (!title || !/^https?:/i.test(url)) continue;
    results.push({ title, url, snippet: snippets[i] ?? "" });
    i++;
  }
  return results;
}

/** Search the web via DuckDuckGo's HTML endpoint (no API key). */
export async function webSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  return parseDuckDuckGoResults(await res.text(), limit);
}

/** Extract readable text and links from raw HTML. */
function extractReadable(url: string, html: string): PageContent {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : url;

  const links: { text: string; url: string }[] = [];
  const linkRe = /<a[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let lm: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((lm = linkRe.exec(html)) && links.length < MAX_LINKS) {
    let href = lm[1];
    if (href.startsWith("/")) {
      try {
        href = new URL(href, url).toString();
      } catch {
        continue;
      }
    }
    if (!/^https?:/i.test(href) || seen.has(href)) continue;
    const text = stripTags(lm[2]);
    if (!text) continue;
    seen.add(href);
    links.push({ text: text.slice(0, 120), url: href });
  }

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ");
  const text = stripTags(body);
  const truncated = text.length > MAX_TEXT_CHARS;

  return { url, title, text: text.slice(0, MAX_TEXT_CHARS), links, truncated };
}

/** Fetch a URL and return cleaned text + on-page links (no browser). */
export async function fetchReadable(url: string): Promise<PageContent> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(25_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (HTTP ${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!contentType.includes("html")) {
    const text = raw.replace(/\s+/g, " ").trim();
    return { url, title: url, text: text.slice(0, MAX_TEXT_CHARS), links: [], truncated: text.length > MAX_TEXT_CHARS };
  }
  return extractReadable(url, raw);
}

/** Locate a Chromium/Chrome binary for playwright-core, or null if none. */
export function findChromium(): string | null {
  const explicit = process.env.LOOMAI_CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/homebrew/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  // Playwright's own download location (PLAYWRIGHT_BROWSERS_PATH), if present.
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base) {
    for (const sub of ["chromium-1194/chrome-linux/chrome", "chromium/chrome-linux/chrome"]) {
      const p = `${base}/${sub}`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function browserAvailable(): boolean {
  return findChromium() !== null;
}

/**
 * Load a URL in a real headless browser (renders JavaScript), returning the
 * visible text and links so an agent can navigate multi-step, JS-heavy sites.
 */
export async function browsePage(url: string): Promise<PageContent> {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      "No Chromium browser is available for full navigation. Install Chromium (or set LOOMAI_CHROMIUM_PATH) — meanwhile use web_open, which fetches pages without a browser."
    );
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1200); // let late JS settle; speed is not a concern
    const title = await page.title();
    const text = (await page.evaluate(() => document.body?.innerText ?? "")).replace(/\s+\n/g, "\n").trim();
    const links = (await page.evaluate((max) => {
      const out: { text: string; url: string }[] = [];
      const seen = new Set<string>();
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = (a as HTMLAnchorElement).href;
        const t = (a.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!href || !/^https?:/i.test(href) || seen.has(href) || !t) continue;
        seen.add(href);
        out.push({ text: t.slice(0, 120), url: href });
        if (out.length >= max) break;
      }
      return out;
    }, MAX_LINKS)) as { text: string; url: string }[];
    const truncated = text.length > MAX_TEXT_CHARS;
    return { url, title, text: text.slice(0, MAX_TEXT_CHARS), links, truncated };
  } finally {
    await browser.close();
  }
}
