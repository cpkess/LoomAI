import { describe, expect, it } from "vitest";

import { ROLES, ROLE_DEFS, subagentForRole } from "./roles";

describe("ROLE_DEFS", () => {
  it("has a persona and label for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_DEFS[role].persona.length).toBeGreaterThan(20);
      expect(ROLE_DEFS[role].label.length).toBeGreaterThan(0);
    }
  });
});

describe("subagentForRole", () => {
  it("returns the role and its persona", () => {
    const s = subagentForRole("writer");
    expect(s.role).toBe("writer");
    expect(s.persona).toBe(ROLE_DEFS.writer.persona);
  });
});
