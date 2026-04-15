import { describe, expect, it } from "vitest";

import {
  recordAutoCaseFreshnessCheck,
  shouldSkipAutoCaseFreshnessCheck,
  type AutoCaseFreshnessState
} from "../../src/extension/autoCaseFreshnessTracker";

function uri(value: string) {
  return {
    toString: () => value
  } as { toString(): string };
}

describe("autoCaseFreshnessTracker", () => {
  it("skips duplicate auto-checks for the same uri and version token", () => {
    const state: AutoCaseFreshnessState = {};

    recordAutoCaseFreshnessCheck(
      state,
      uri("kiwi:/plans/100 - Regression/cases/501 - Login works.md") as never,
      "history_id:11"
    );

    expect(
      shouldSkipAutoCaseFreshnessCheck(
        state,
        uri("kiwi:/plans/100 - Regression/cases/501 - Login works.md") as never,
        "history_id:11"
      )
    ).toBe(true);
  });

  it("does not skip when the version token changed", () => {
    const state: AutoCaseFreshnessState = {};

    recordAutoCaseFreshnessCheck(
      state,
      uri("kiwi:/plans/100 - Regression/cases/501 - Login works.md") as never,
      "history_id:11"
    );

    expect(
      shouldSkipAutoCaseFreshnessCheck(
        state,
        uri("kiwi:/plans/100 - Regression/cases/501 - Login works.md") as never,
        "history_id:12"
      )
    ).toBe(false);
  });

  it("does not skip when the uri changed", () => {
    const state: AutoCaseFreshnessState = {};

    recordAutoCaseFreshnessCheck(
      state,
      uri("kiwi:/plans/100 - Regression/cases/501 - Login works.md") as never,
      "history_id:11"
    );

    expect(
      shouldSkipAutoCaseFreshnessCheck(
        state,
        uri("kiwi:/plans/100 - Regression/cases/502 - Password reset works.md") as never,
        "history_id:11"
      )
    ).toBe(false);
  });
});
