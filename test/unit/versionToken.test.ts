import { describe, expect, it } from "vitest";
import { deriveVersionToken } from "../../src/domain/versionToken";

describe("deriveVersionToken", () => {
  it("prefers history_id", () => {
    expect(
      deriveVersionToken([
        {
          historyId: 42,
          historyDate: "2026-04-05T00:00:00.000Z"
        }
      ])
    ).toBe("history_id:42");
  });

  it("falls back to history_date", () => {
    expect(
      deriveVersionToken([
        {
          historyDate: "2026-04-05T00:00:00.000Z"
        }
      ])
    ).toBe("history_date:2026-04-05T00:00:00.000Z");
  });
});
