import { describe, expect, it } from "vitest";

import { formatBytes, initials, slugify } from "./utils";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });
  it("strips special characters", () => {
    expect(slugify("R&D / Labs!!")).toBe("rd-labs");
  });
  it("collapses repeats and trims hyphens", () => {
    expect(slugify("--Hello   World--")).toBe("hello-world");
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Atlas")).toBe("A");
  });
});

describe("formatBytes", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
