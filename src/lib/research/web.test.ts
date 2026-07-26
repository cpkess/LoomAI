import { describe, expect, it } from "vitest";

import { parseDuckDuckGoResults } from "./web";

// Representative slice of DuckDuckGo HTML result markup.
const FIXTURE = `
<div class="result results_links">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FAI&amp;rut=x">
    Artificial intelligence - Wikipedia
  </a>
  <a class="result__snippet" href="x">AI is intelligence demonstrated by machines.</a>
</div>
<div class="result results_links">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fai">
    Example AI page
  </a>
  <a class="result__snippet" href="x">An example resource about AI.</a>
</div>
`;

describe("parseDuckDuckGoResults", () => {
  it("extracts titles, decoded URLs, and snippets", () => {
    const results = parseDuckDuckGoResults(FIXTURE);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Artificial intelligence - Wikipedia");
    expect(results[0].url).toBe("https://en.wikipedia.org/wiki/AI");
    expect(results[0].snippet).toBe("AI is intelligence demonstrated by machines.");
    expect(results[1].url).toBe("https://example.com/ai");
  });

  it("respects the limit", () => {
    expect(parseDuckDuckGoResults(FIXTURE, 1)).toHaveLength(1);
  });

  it("returns empty for markup with no results", () => {
    expect(parseDuckDuckGoResults("<html><body>no results</body></html>")).toEqual([]);
  });
});
