import { describe, expect, it } from "vitest";

import { ROLES, ROLE_DEFS, matchRole } from "./roles";

describe("matchRole", () => {
  it("matches hired agents whose title fits a role", () => {
    expect(matchRole("Content Writer (AI)", "writer")).toBe(true);
    expect(matchRole("Research Analyst", "researcher")).toBe(true);
    expect(matchRole("Managing Editor", "editor")).toBe(true);
  });
  it("does not match unrelated titles", () => {
    expect(matchRole("Principal Engineer", "writer")).toBe(false);
    expect(matchRole("Sales Lead", "critic")).toBe(false);
  });
});

describe("ROLE_DEFS", () => {
  it("has a persona and match keywords for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_DEFS[role].persona.length).toBeGreaterThan(20);
      expect(ROLE_DEFS[role].match.length).toBeGreaterThan(0);
    }
  });
});
