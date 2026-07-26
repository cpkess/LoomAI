// Being a well-behaved client. Research runs unattended and can fan out across
// many pages, so it honours robots.txt and paces itself per host. Both pieces
// here are pure and cheap; the network side lives in navigate.ts.

export interface RobotsRule {
  path: string;
  allow: boolean;
}

export interface RobotsPolicy {
  /** Rules for the most specific matching user-agent group. */
  rules: RobotsRule[];
  /** Crawl-delay in seconds, if the group declared one. */
  crawlDelay: number | null;
}

/** An empty policy allows everything — the default when robots.txt is absent. */
export const ALLOW_ALL: RobotsPolicy = { rules: [], crawlDelay: null };

/**
 * Parse robots.txt, keeping the group that applies to us. A named group for our
 * agent wins over `*`; if neither appears, nothing is restricted.
 *
 * Deliberately minimal: Disallow, Allow, and Crawl-delay. That is the part of
 * the spec that governs whether we may fetch a page.
 */
export function parseRobots(body: string, userAgent: string): RobotsPolicy {
  const ua = userAgent.toLowerCase();
  // agent name → its directives, in file order
  const groups = new Map<string, { rules: RobotsRule[]; crawlDelay: number | null }>();
  let active: string[] = [];
  let lastLineWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of directives.
      if (!lastLineWasAgent) active = [];
      active.push(value.toLowerCase());
      for (const name of active) if (!groups.has(name)) groups.set(name, { rules: [], crawlDelay: null });
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (active.length === 0) continue;

    for (const name of active) {
      const group = groups.get(name)!;
      if (field === "disallow") {
        // "Disallow:" with an empty value means "allow everything".
        if (value) group.rules.push({ path: value, allow: false });
      } else if (field === "allow") {
        if (value) group.rules.push({ path: value, allow: true });
      } else if (field === "crawl-delay") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) group.crawlDelay = n;
      }
    }
  }

  // Most specific match wins: an exact/substring agent match, else "*".
  let chosen: { rules: RobotsRule[]; crawlDelay: number | null } | undefined;
  for (const [name, group] of groups) {
    if (name !== "*" && ua.includes(name)) {
      chosen = group;
      break;
    }
  }
  chosen ??= groups.get("*");
  return chosen ? { rules: chosen.rules, crawlDelay: chosen.crawlDelay } : ALLOW_ALL;
}

/** Expand robots wildcards (`*` and end-anchor `$`) into a regex. */
function ruleToRegex(pattern: string): RegExp {
  let source = "";
  for (const ch of pattern) {
    if (ch === "*") source += ".*";
    else if (ch === "$") source += "$";
    else source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}`);
}

/**
 * Whether a path may be fetched. Longest matching rule wins, and Allow beats
 * Disallow at equal length — the standard precedence.
 */
export function isAllowed(policy: RobotsPolicy, pathname: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const rule of policy.rules) {
    if (!ruleToRegex(rule.path).test(pathname)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

/**
 * A per-host pacer. Research can queue many pages at once; this keeps us to one
 * request per host per interval so we never hammer a site we're citing.
 */
export class HostPacer {
  private readonly nextFreeAt = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  /** Reserve the next slot for a host and return how long to wait for it. */
  reserve(host: string, overrideMs?: number): number {
    const interval = Math.max(this.minIntervalMs, overrideMs ?? 0);
    const now = Date.now();
    const earliest = this.nextFreeAt.get(host) ?? 0;
    const start = Math.max(now, earliest);
    this.nextFreeAt.set(host, start + interval);
    return start - now;
  }

  async wait(host: string, overrideMs?: number): Promise<void> {
    const delay = this.reserve(host, overrideMs);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
