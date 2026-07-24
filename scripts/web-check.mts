#!/usr/bin/env tsx
// Web-path self-check.
//
// The web research path can only really be judged against the live internet:
// whether search still works, whether the consent-banner selectors still match
// what sites actually ship, and whether real bot walls get classified correctly.
// None of that is verifiable in a sandbox with no outbound access, so this
// exists to be run wherever there IS access — a laptop, a deployment — and to
// report exactly which parts work.
//
// It makes a handful of ordinary page requests, honours robots.txt, and paces
// itself per host, the same as research does. Nothing here tries to get past a
// gate: when it finds one, that counts as detection working and the page is
// left alone.
//
// Usage:  npm run web:check [-- --url https://… --url … --quiet]
import { CONSENT_SELECTORS, describeBlock, navigate } from "../src/lib/research/navigate";
import { isAllowed, parseRobots } from "../src/lib/research/robots";
import { browserAvailable, fetchReadable, findChromium, webSearch } from "../src/lib/research/web";

const QUIET = process.argv.includes("--quiet");

// Chosen to exercise the interesting cases: a trivially simple page, a
// standards page, and consent-heavy European news sites.
const DEFAULT_URLS = [
  "https://example.com/",
  "https://www.iana.org/help/example-domains",
  "https://www.theguardian.com/international",
  "https://www.bbc.com/news",
];

const urls: string[] = [];
process.argv.forEach((a, i) => {
  if (a === "--url" && process.argv[i + 1]) urls.push(process.argv[i + 1]);
});
const targets = urls.length ? urls : DEFAULT_URLS;

type Status = "pass" | "fail" | "gate" | "skip";
const results: { name: string; status: Status; detail: string }[] = [];

function record(name: string, status: Status, detail = "") {
  results.push({ name, status, detail });
  const icon = status === "pass" ? "✓" : status === "fail" ? "✗" : status === "gate" ? "⛔" : "–";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nLoomAI web-path self-check\n");

// 1. Browser
const chrome = findChromium();
record("browser available", browserAvailable() ? "pass" : "fail", chrome ?? "no Chromium found; set LOOMAI_CHROMIUM_PATH");

// 2. Search
try {
  const searchResults = await webSearch("EU SaaS market size 2025", 5);
  record(
    "web search (DuckDuckGo)",
    searchResults.length > 0 ? "pass" : "fail",
    searchResults.length
      ? `${searchResults.length} results, first: ${searchResults[0].url}`
      : "returned no results — the scraped HTML endpoint may have changed"
  );
} catch (err) {
  record("web search (DuckDuckGo)", "fail", err instanceof Error ? err.message : String(err));
}

// 3. Plain fetch
try {
  const page = await fetchReadable("https://example.com/");
  record("plain fetch (no browser)", page.text.length > 50 ? "pass" : "fail", `${page.text.length} chars from example.com`);
} catch (err) {
  record("plain fetch (no browser)", "fail", err instanceof Error ? err.message : String(err));
}

// 4. robots.txt
try {
  const res = await fetch("https://www.theguardian.com/robots.txt", { signal: AbortSignal.timeout(10_000) });
  if (res.ok) {
    const policy = parseRobots(await res.text(), "LoomAI-Research/1.0");
    record("robots.txt fetch + parse", "pass", `${policy.rules.length} rules; /international allowed: ${isAllowed(policy, "/international")}`);
  } else {
    record("robots.txt fetch + parse", "fail", `HTTP ${res.status}`);
  }
} catch (err) {
  record("robots.txt fetch + parse", "fail", err instanceof Error ? err.message : String(err));
}

// 5. Navigation, consent dismissal, gate detection
if (!browserAvailable()) {
  record("navigation", "skip", "no browser");
} else {
  for (const url of targets) {
    const host = new URL(url).host;
    try {
      const page = await navigate(url);
      if (page.blocked) {
        // Detection working is the success condition here, not a failure.
        record(`navigate ${host}`, "gate", `${page.blocked.reason} (${page.blocked.detail}) — ${describeBlock(page.blocked.reason)}`);
        continue;
      }
      const dismissed = page.dismissed.length ? `dismissed ${page.dismissed.join(", ")}` : "no overlay found";
      const healthy = page.text.length > 500;
      record(`navigate ${host}`, healthy ? "pass" : "fail", `${page.text.length} chars, ${page.links.length} links, ${dismissed}`);
      if (!QUIET && healthy) console.log(`    ${page.text.slice(0, 140).replace(/\s+/g, " ")}…`);
    } catch (err) {
      record(`navigate ${host}`, "fail", err instanceof Error ? err.message : String(err));
    }
  }
}

// Summary
const count = (s: Status) => results.filter((r) => r.status === s).length;
const dismissed = results.filter((r) => /dismissed (#|\.|\[|button:)/.test(r.detail)).length;
const noOverlay = results.filter((r) => r.detail.includes("no overlay found")).length;

console.log(`\n${count("pass")} passed, ${count("fail")} failed, ${count("gate")} gated (detected correctly), ${count("skip")} skipped`);
console.log(`Consent banners: ${dismissed} dismissed, ${noOverlay} page(s) had none to dismiss.`);
if (noOverlay > 0) {
  console.log(
    `If a page you know shows a cookie wall reported "no overlay found", its CMP selector is missing —\n` +
      `add it to CONSENT_SELECTORS in src/lib/research/navigate.ts (currently ${CONSENT_SELECTORS.length} selectors).`
  );
}
console.log("");

process.exitCode = count("fail") > 0 ? 1 : 0;
