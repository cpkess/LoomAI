import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { describeBlock, navigate } from "./navigate";
import { browsePage, browserAvailable, fetchReadable, webSearch } from "./web";

/**
 * Web-research tools, free and key-less. They let a subagent search, open
 * pages, follow links, and fully render JS-heavy sites — i.e. manually navigate
 * the web. Enabled per call (e.g. for the researcher role); returns an empty
 * tool set when disabled.
 */
export function buildResearchTools(enabled: boolean): ToolSet {
  if (!enabled) return {};

  const tools: ToolSet = {};

  tools.web_search = tool({
    description:
      "Search the web (DuckDuckGo, no API key). Returns a list of results with title, URL, and snippet. Use this to find pages, then open the most promising URLs to read them.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The search query"),
    }),
    execute: async ({ query }) => {
      try {
        const results = await webSearch(query);
        if (results.length === 0) return { results: [], note: "No results found. Try a different query." };
        return { results };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  tools.web_open = tool({
    description:
      "Open a web page by URL and read its text content, plus the links found on the page. Follow links by calling this again with a link's URL — this is how you navigate the web step by step. Fast and works for most sites.",
    inputSchema: z.object({
      url: z.string().url().describe("The absolute URL to open"),
    }),
    execute: async ({ url }) => {
      try {
        const page = await fetchReadable(url);
        return {
          title: page.title,
          text: page.text,
          links: page.links,
          truncated: page.truncated,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  tools.web_browse = tool({
    description:
      "Open a URL in a REAL headless browser that runs JavaScript, for sites that don't work with web_open (single-page apps, JS-rendered content, sites needing full rendering). Returns the fully rendered visible text and links. Slower but the most capable way to navigate the web.",
    inputSchema: z.object({
      url: z.string().url().describe("The absolute URL to open in the browser"),
    }),
    execute: async ({ url }) => {
      try {
        const page = await browsePage(url);
        return {
          title: page.title,
          text: page.text,
          links: page.links,
          truncated: page.truncated,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  tools.web_navigate = tool({
    description:
      "Open a URL in a real browser and clear the usual obstacles: cookie/consent banners, newsletter modals and other pop-up overlays are dismissed automatically, and lazily-loaded content is given a chance to appear. Use this when web_open returns little or no text, or when a page is known to show a consent wall. " +
      "If the page turns out to be an access gate rather than content — a CAPTCHA, bot protection, a login, or a paywall — this returns blocked:{reason} and no text. That is final: the source is off-limits, so move on to a different one. Do not retry it, do not look for another way in, and never write up a page you could not read.",
    inputSchema: z.object({
      url: z.string().url().describe("The absolute URL to open"),
    }),
    execute: async ({ url }) => {
      try {
        const page = await navigate(url);
        if (page.blocked) {
          return {
            blocked: page.blocked.reason,
            detail: page.blocked.detail,
            note: `This source is ${describeBlock(page.blocked.reason)}. Find a different source for this point.`,
          };
        }
        return {
          title: page.title,
          text: page.text,
          links: page.links,
          truncated: page.truncated,
          dismissed: page.dismissed.length,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  return tools;
}

/** System-prompt guidance for the web-research capability, when enabled. */
export function describeResearch(enabled: boolean): string | null {
  if (!enabled) return null;
  const browser = browserAvailable();
  return [
    "You can research the web using your tools — do real research, do not guess:",
    "- web_search: find pages for a query.",
    "- web_open: read a page's text and its links; call it again on a link's URL to follow it. Navigate step by step through multiple pages to gather thorough, well-sourced information.",
    browser
      ? "- web_browse: open a URL in a real browser that runs JavaScript, for sites web_open can't read."
      : "- web_browse: (a browser is not currently installed on this deployment; rely on web_open).",
    browser
      ? "- web_navigate: like web_browse, but it also dismisses cookie/consent banners and pop-up overlays, so use it when a page comes back empty or hidden behind a consent wall."
      : null,
    "Prefer primary sources, corroborate across multiple pages, and cite the URLs you used in your answer.",
    "Some pages are gated rather than merely awkward — a CAPTCHA, bot protection, a login, or a paywall. When a tool reports one, treat that source as unavailable and go find another. Do not attempt to solve or bypass a challenge, and never present a page you could not actually read as if you had read it; say the source was unreachable instead.",
  ]
    .filter(Boolean)
    .join("\n");
}
