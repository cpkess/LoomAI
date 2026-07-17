import { describe, expect, it } from "vitest";

import { extractJson } from "./json";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJson('Here you go:\n```json\n{"subtasks":[]}\n```\nDone.')).toEqual({ subtasks: [] });
  });

  it("parses JSON embedded in prose", () => {
    expect(extractJson('Sure! The plan is {"subtasks":[{"title":"x"}]} — let me know.')).toEqual({
      subtasks: [{ title: "x" }],
    });
  });

  it("parses arrays", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns null for garbage", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
});
