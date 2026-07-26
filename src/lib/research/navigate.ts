import { findChromium } from "./web";
import { ALLOW_ALL, HostPacer, isAllowed, parseRobots, type RobotsPolicy } from "./robots";

// Real navigation, for pages a plain fetch can't read.
//
// Two kinds of obstacle sit between a researcher and a page, and they are not
// the same thing:
//
//   Nuisance overlays — cookie/consent banners, newsletter modals, "app is
//   better" interstitials. These sit on top of content you are entitled to
//   read. We dismiss them, which is what a person would do in one click.
//
//   Access controls — CAPTCHAs, bot walls, login gates, hard paywalls. These
//   are the site saying "not without verifying who you are". We DETECT these
//   and stop. We do not solve them, work around them, or retry to wear them
//   down. A blocked page is reported as blocked, so the research record can say
//   "this source was unreachable" instead of quietly producing nothing — which
//   is the honest outcome and the useful one.
//
// If you need content behind a wall, the answer is credentials or an API, not
// a defeat mechanism.

const USER_AGENT = "LoomAI-Research/1.0 (+local research agent; respects robots.txt)";
const NAV_TIMEOUT = Number(process.env.LOOMAI_NAV_TIMEOUT_MS ?? 30_000);
const HOST_MIN_INTERVAL = Number(process.env.LOOMAI_NAV_HOST_INTERVAL_MS ?? 1_500);
const MAX_TEXT_CHARS = 12_000;
const MAX_LINKS = 50;

const pacer = new HostPacer(HOST_MIN_INTERVAL);
const robotsCache = new Map<string, RobotsPolicy>();

// --- What we dismiss --------------------------------------------------------

/**
 * Consent-management platforms, by their documented accept-button selectors.
 * Clicking these is the same action a reader takes on arrival.
 */
export const CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler", // OneTrust
  ".onetrust-close-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", // Cookiebot
  "#CybotCookiebotDialogBodyButtonAccept",
  ".qc-cmp2-summary-buttons button[mode='primary']", // Quantcast
  "#truste-consent-button", // TrustArc
  ".osano-cm-accept-all", // Osano
  "#didomi-notice-agree-button", // Didomi
  ".fc-cta-consent", // Google Funding Choices
  "[data-testid='uc-accept-all-button']", // Usercentrics
  ".sp_choice_type_11", // Sourcepoint
  "#accept-choices",
  "[aria-label='Accept all']",
  "[data-cookiebanner='accept_button']",
];

/**
 * Banner/overlay containers. Removed after dismissal so their boilerplate never
 * lands in the extracted text — some platforms leave the node in the DOM, and
 * "We use cookies to improve your experience" is not evidence.
 */
export const OVERLAY_CONTAINERS = [
  "#onetrust-banner-sdk",
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  ".qc-cmp2-container",
  "#truste-consent-track",
  ".osano-cm-window",
  "#didomi-host",
  ".fc-consent-root",
  "#usercentrics-root",
  ".sp-message-container",
  "[id*='cookie-banner' i]",
  "[class*='cookie-banner' i]",
  "[class*='cookie-consent' i]",
  "[aria-label*='cookie' i][role='dialog']",
];

/** Generic dismissal, by the words a dismiss control actually uses. */
export const DISMISS_TEXT = [
  "accept all",
  "accept cookies",
  "allow all",
  "i agree",
  "agree and continue",
  "got it",
  "no thanks",
  "continue without",
  "dismiss",
  "close",
];

// --- Block detection (pure, testable) ---------------------------------------

export type BlockReason = "captcha" | "bot_wall" | "rate_limited" | "login_required" | "paywall";

export interface PageSignals {
  status: number;
  title: string;
  text: string;
  /** Names of known challenge/gate widgets found in the DOM. */
  markers: string[];
}

export interface BlockVerdict {
  reason: BlockReason | null;
  detail: string;
}

/** Widget selectors we look for in-page. Presence means a gate, not content. */
export const CHALLENGE_MARKERS: Record<string, string> = {
  recaptcha: "iframe[src*='recaptcha'], .g-recaptcha, #recaptcha",
  hcaptcha: "iframe[src*='hcaptcha'], .h-captcha",
  turnstile: ".cf-turnstile, iframe[src*='challenges.cloudflare.com']",
  cloudflare: "#challenge-running, #cf-challenge-running, #cf-please-wait",
  datadome: "#datadome-captcha, iframe[src*='captcha-delivery.com']",
  perimeterx: "#px-captcha, [id^='px-captcha']",
  incapsula: "iframe[src*='_Incapsula_Resource']",
  arkose: "iframe[src*='arkoselabs'], #arkose",
  login: "form[action*='login' i] input[type='password'], form[action*='signin' i] input[type='password']",
  paywall: "[class*='paywall' i], [id*='paywall' i], [data-paywall]",
};

const CAPTCHA_MARKERS = new Set(["recaptcha", "hcaptcha", "turnstile", "datadome", "perimeterx", "arkose"]);
const BOT_WALL_MARKERS = new Set(["cloudflare", "incapsula"]);

const HUMAN_CHECK_PHRASES = [
  "verify you are human",
  "verifying you are human",
  "are you a robot",
  "confirm you are not a robot",
  "complete the security check",
  "unusual traffic from your computer",
  "enable javascript and cookies to continue",
  "checking your browser before accessing",
  "ddos protection by",
  "access denied",
  "attention required",
];

const PAYWALL_PHRASES = [
  "subscribe to continue reading",
  "this article is for subscribers",
  "you have reached your article limit",
  "become a member to read",
];

const LOGIN_PHRASES = ["sign in to continue", "log in to continue", "please sign in to view", "members only"];

function hasPhrase(haystack: string, phrases: string[]): string | null {
  for (const phrase of phrases) if (haystack.includes(phrase)) return phrase;
  return null;
}

/**
 * Decide whether a page is content or a gate. Called after navigation with
 * signals collected from the live page; pure so the rules can be tested.
 *
 * A verdict other than null means we stop. It is never an instruction to try
 * harder — the caller reports it and moves on to another source.
 */
export function classifyBlock(signals: PageSignals): BlockVerdict {
  const { status, markers } = signals;
  const haystack = `${signals.title}\n${signals.text}`.toLowerCase().replace(/\s+/g, " ");

  const captcha = markers.find((m) => CAPTCHA_MARKERS.has(m));
  if (captcha) return { reason: "captcha", detail: `${captcha} challenge present` };

  if (status === 429) return { reason: "rate_limited", detail: "HTTP 429 — we are asking too often" };

  const wall = markers.find((m) => BOT_WALL_MARKERS.has(m));
  if (wall) return { reason: "bot_wall", detail: `${wall} interstitial` };

  const humanCheck = hasPhrase(haystack, HUMAN_CHECK_PHRASES);
  if (humanCheck) return { reason: "bot_wall", detail: `page says: "${humanCheck}"` };

  if (status === 401) return { reason: "login_required", detail: "HTTP 401" };
  if (status === 403) return { reason: "bot_wall", detail: "HTTP 403 — request refused" };

  // Gate widgets only count as a block when there's no real content behind
  // them; plenty of pages carry a login form or an upsell alongside the article.
  const thin = signals.text.trim().length < 500;
  if (thin) {
    const paywall = hasPhrase(haystack, PAYWALL_PHRASES) ?? (markers.includes("paywall") ? "paywall element" : null);
    if (paywall) return { reason: "paywall", detail: `${paywall}, no readable content` };
    const login = hasPhrase(haystack, LOGIN_PHRASES) ?? (markers.includes("login") ? "login form" : null);
    if (login) return { reason: "login_required", detail: `${login}, no readable content` };
  }

  return { reason: null, detail: "" };
}

/** How a blocked source is described to the user. */
export function describeBlock(reason: BlockReason): string {
  switch (reason) {
    case "captcha":
      return "behind a CAPTCHA — not solved, source skipped";
    case "bot_wall":
      return "blocked by bot protection";
    case "rate_limited":
      return "rate-limited — backed off";
    case "login_required":
      return "requires a login";
    case "paywall":
      return "behind a paywall";
  }
}

// --- Navigation -------------------------------------------------------------

export interface NavigationResult {
  url: string;
  title: string;
  text: string;
  links: { text: string; url: string }[];
  truncated: boolean;
  /** Non-null when the page was a gate rather than content. */
  blocked: { reason: BlockReason; detail: string } | null;
  /** Overlays dismissed on the way in, for transparency. */
  dismissed: string[];
}

async function robotsFor(origin: string): Promise<RobotsPolicy> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  let policy = ALLOW_ALL;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) policy = parseRobots(await res.text(), USER_AGENT);
  } catch {
    // No robots.txt, or it wouldn't load — nothing is restricted.
  }
  robotsCache.set(origin, policy);
  return policy;
}

/**
 * Load a URL in a real browser, clear nuisance overlays, and return readable
 * content — or a `blocked` verdict if the page turns out to be an access gate.
 *
 * Honours robots.txt and paces requests per host.
 */
export async function navigate(url: string): Promise<NavigationResult> {
  const target = new URL(url);

  const policy = await robotsFor(target.origin);
  if (!isAllowed(policy, target.pathname)) {
    throw new Error(`robots.txt disallows ${target.pathname} on ${target.host}`);
  }
  await pacer.wait(target.host, policy.crawlDelay ? policy.crawlDelay * 1000 : undefined);

  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      "No Chromium browser is available for navigation. Install Chromium (or set LOOMAI_CHROMIUM_PATH) — meanwhile use web_open, which fetches pages without a browser."
    );
  }

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    const status = response?.status() ?? 0;
    await page.waitForTimeout(1200); // let late JS settle

    const dismissed = await dismissOverlays(page);

    // Nudge lazy-loaded content into the DOM, then read.
    await page.evaluate(() => window.scrollTo(0, document.body?.scrollHeight ?? 0)).catch(() => {});
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    const title = await page.title();
    const text = (await page.evaluate(() => document.body?.innerText ?? "")).replace(/\s+\n/g, "\n").trim();
    const markers = (await page.evaluate((selectors: Record<string, string>) => {
      const found: string[] = [];
      for (const [name, selector] of Object.entries(selectors)) {
        try {
          if (document.querySelector(selector)) found.push(name);
        } catch {
          /* bad selector in this browser — ignore */
        }
      }
      return found;
    }, CHALLENGE_MARKERS)) as string[];

    const verdict = classifyBlock({ status, title, text, markers });
    if (verdict.reason) {
      // Stop here. No solving, no reloading, no alternate route in.
      return { url, title, text: "", links: [], truncated: false, blocked: { reason: verdict.reason, detail: verdict.detail }, dismissed };
    }

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

    return {
      url,
      title,
      text: text.slice(0, MAX_TEXT_CHARS),
      links,
      truncated: text.length > MAX_TEXT_CHARS,
      blocked: null,
      dismissed,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Clear consent banners and modal overlays. Best-effort and silent: anything
 * that doesn't match is simply left alone.
 */
async function dismissOverlays(page: import("playwright-core").Page): Promise<string[]> {
  const dismissed: string[] = [];

  for (const selector of CONSENT_SELECTORS) {
    try {
      const element = page.locator(selector).first();
      if ((await element.count()) === 0 || !(await element.isVisible())) continue;
      await element.click({ timeout: 2_000 });
      dismissed.push(selector);
      await page.waitForTimeout(400);
    } catch {
      /* not clickable — move on */
    }
  }

  // Generic dismissal by the words on the control.
  if (dismissed.length === 0) {
    for (const label of DISMISS_TEXT) {
      try {
        const button = page.getByRole("button", { name: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();
        if ((await button.count()) === 0 || !(await button.isVisible())) continue;
        await button.click({ timeout: 2_000 });
        dismissed.push(`button:${label}`);
        await page.waitForTimeout(400);
        break;
      } catch {
        /* move on */
      }
    }
  }

  // Escape closes many newsletter/interstitial modals.
  try {
    await page.keyboard.press("Escape");
  } catch {
    /* ignore */
  }

  // Tidy up after the banner: strip any container it left behind so its
  // boilerplate stays out of the extracted text, and clear the scroll lock
  // consent libraries leave on <body>, which hides content from innerText.
  await page
    .evaluate((containers: string[]) => {
      for (const selector of containers) {
        try {
          for (const el of Array.from(document.querySelectorAll(selector))) el.remove();
        } catch {
          /* bad selector in this browser — ignore */
        }
      }
      for (const el of [document.documentElement, document.body]) {
        el.style.overflow = "";
        el.style.position = "";
      }
    }, OVERLAY_CONTAINERS)
    .catch(() => {});

  return dismissed;
}
