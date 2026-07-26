import { describe, expect, it } from "vitest";

import { extractVariables, interpolatePrompt } from "./interpolate";

describe("extractVariables", () => {
  it("finds unique variables in order", () => {
    expect(extractVariables("Hi {{name}}, welcome to {{company}}. Bye {{name}}!")).toEqual(["name", "company"]);
  });

  it("allows whitespace inside braces", () => {
    expect(extractVariables("{{ name }} and {{  role  }}")).toEqual(["name", "role"]);
  });

  it("ignores malformed placeholders", () => {
    expect(extractVariables("{name} {{1abc}} {{}}")).toEqual([]);
  });

  it("returns empty for plain text", () => {
    expect(extractVariables("no variables here")).toEqual([]);
  });
});

describe("interpolatePrompt", () => {
  it("substitutes known variables", () => {
    expect(interpolatePrompt("Hi {{name}} from {{company}}", { name: "Atlas", company: "Acme" })).toBe(
      "Hi Atlas from Acme"
    );
  });

  it("leaves unknown variables intact", () => {
    expect(interpolatePrompt("Hi {{name}}, meet {{other}}", { name: "Atlas" })).toBe("Hi Atlas, meet {{other}}");
  });

  it("substitutes empty strings", () => {
    expect(interpolatePrompt("[{{x}}]", { x: "" })).toBe("[]");
  });
});
