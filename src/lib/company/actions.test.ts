import { describe, expect, it } from "vitest";

import type { Organization } from "@/lib/db/schema";

import { DEFAULT_GOVERNANCE, getGovernance } from "./actions";

function org(settings: Record<string, unknown>): Organization {
  return { id: "o1", slug: "acme", name: "Acme", settings, createdAt: new Date() } as Organization;
}

describe("getGovernance", () => {
  it("returns safe defaults when unconfigured", () => {
    expect(getGovernance(org({}))).toEqual(DEFAULT_GOVERNANCE);
    expect(DEFAULT_GOVERNANCE.hire_employee).toBe("board");
    expect(DEFAULT_GOVERNANCE.offboard_employee).toBe("board");
  });

  it("applies partial overrides on top of defaults", () => {
    const governance = getGovernance(org({ governance: { hire_employee: "auto" } }));
    expect(governance.hire_employee).toBe("auto");
    expect(governance.create_department).toBe(DEFAULT_GOVERNANCE.create_department);
  });

  it("ignores unrelated settings keys", () => {
    const governance = getGovernance(org({ theme: "dark" }));
    expect(governance).toEqual(DEFAULT_GOVERNANCE);
  });
});
