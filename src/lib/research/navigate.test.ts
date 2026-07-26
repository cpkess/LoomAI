import { describe, expect, it } from "vitest";

import { classifyBlock, describeBlock, type PageSignals } from "./navigate";
import { ALLOW_ALL, HostPacer, isAllowed, parseRobots } from "./robots";

function signals(over: Partial<PageSignals> = {}): PageSignals {
  return { status: 200, title: "An article", text: "x".repeat(2000), markers: [], ...over };
}

// The rule this encodes: a challenge is detected and reported, never solved.
// These tests exist so that stays true.
describe("access gates are detected, not defeated", () => {
  it("flags every CAPTCHA vendor as a captcha block", () => {
    for (const marker of ["recaptcha", "hcaptcha", "turnstile", "datadome", "perimeterx", "arkose"]) {
      const verdict = classifyBlock(signals({ markers: [marker] }));
      expect(verdict.reason).toBe("captcha");
      expect(verdict.detail).toContain(marker);
    }
  });

  it("flags a CAPTCHA even when the page also renders plenty of text", () => {
    // A challenge overlaid on cached content is still a challenge.
    expect(classifyBlock(signals({ markers: ["recaptcha"], text: "y".repeat(9000) })).reason).toBe("captcha");
  });

  it("flags bot-protection interstitials", () => {
    expect(classifyBlock(signals({ markers: ["cloudflare"] })).reason).toBe("bot_wall");
    expect(classifyBlock(signals({ markers: ["incapsula"] })).reason).toBe("bot_wall");
    expect(classifyBlock(signals({ status: 403 })).reason).toBe("bot_wall");
  });

  it("reads the human-check wording sites actually use", () => {
    for (const phrase of [
      "Please verify you are human before continuing",
      "Checking your browser before accessing the site",
      "We detected unusual traffic from your computer network",
      "Enable JavaScript and cookies to continue",
    ]) {
      expect(classifyBlock(signals({ text: phrase })).reason).toBe("bot_wall");
    }
  });

  it("treats rate limiting as back-off, not as something to push through", () => {
    const verdict = classifyBlock(signals({ status: 429 }));
    expect(verdict.reason).toBe("rate_limited");
    expect(describeBlock("rate_limited")).toContain("backed off");
  });

  it("says plainly that a CAPTCHA was skipped rather than solved", () => {
    expect(describeBlock("captcha")).toContain("not solved");
  });
});

describe("gates vs. ordinary page furniture", () => {
  it("does not call a readable article blocked just because it has a login form", () => {
    expect(classifyBlock(signals({ markers: ["login"], text: "z".repeat(4000) })).reason).toBeNull();
  });

  it("does not call a readable article blocked just because it has an upsell", () => {
    expect(classifyBlock(signals({ markers: ["paywall"], text: "z".repeat(4000) })).reason).toBeNull();
  });

  it("does flag a gate when there is no content behind it", () => {
    expect(classifyBlock(signals({ markers: ["paywall"], text: "Subscribe to continue reading" })).reason).toBe("paywall");
    expect(classifyBlock(signals({ markers: ["login"], text: "Sign in to continue" })).reason).toBe("login_required");
  });

  it("passes an ordinary page through untouched", () => {
    expect(classifyBlock(signals()).reason).toBeNull();
  });
});

describe("robots.txt", () => {
  const body = `
    User-agent: *
    Disallow: /private
    Disallow: /tmp
    Allow: /private/public-notice

    User-agent: LoomAI-Research
    Disallow: /no-agents
    Crawl-delay: 5
  `;

  it("prefers the group naming our agent over the wildcard", () => {
    const policy = parseRobots(body, "LoomAI-Research/1.0");
    expect(isAllowed(policy, "/no-agents/x")).toBe(false);
    expect(isAllowed(policy, "/private")).toBe(true); // wildcard rules don't apply to us
    expect(policy.crawlDelay).toBe(5);
  });

  it("falls back to the wildcard group for an unnamed agent", () => {
    const policy = parseRobots(body, "SomeOtherBot/2.0");
    expect(isAllowed(policy, "/private/secret")).toBe(false);
    expect(isAllowed(policy, "/public")).toBe(true);
  });

  it("lets a longer Allow override a shorter Disallow", () => {
    const policy = parseRobots(body, "SomeOtherBot/2.0");
    expect(isAllowed(policy, "/private/public-notice")).toBe(true);
  });

  it("honours wildcards and end-anchors", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/b", "bot");
    expect(isAllowed(policy, "/reports/q3.pdf")).toBe(false);
    expect(isAllowed(policy, "/reports/q3.pdf.html")).toBe(true);
    expect(isAllowed(policy, "/a/anything/b")).toBe(false);
  });

  it("treats an empty Disallow as permission and a missing file as no restriction", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:", "bot"), "/anything")).toBe(true);
    expect(isAllowed(ALLOW_ALL, "/anything")).toBe(true);
  });

  it("ignores comments and blank lines", () => {
    const policy = parseRobots("# a comment\nUser-agent: *\nDisallow: /x # trailing\n", "bot");
    expect(isAllowed(policy, "/x")).toBe(false);
  });
});

describe("host pacing", () => {
  it("spaces successive requests to one host", () => {
    const pacer = new HostPacer(1000);
    expect(pacer.reserve("example.com")).toBe(0);
    expect(pacer.reserve("example.com")).toBeGreaterThanOrEqual(900);
  });

  it("does not make one slow host hold up another", () => {
    const pacer = new HostPacer(1000);
    pacer.reserve("a.example");
    expect(pacer.reserve("b.example")).toBe(0);
  });

  it("respects a longer crawl-delay when the site asks for one", () => {
    const pacer = new HostPacer(500);
    pacer.reserve("slow.example", 5000);
    expect(pacer.reserve("slow.example", 5000)).toBeGreaterThanOrEqual(4500);
  });
});
