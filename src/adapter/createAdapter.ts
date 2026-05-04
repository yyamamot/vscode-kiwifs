import { KiwiAdapter } from "./types";
import { MockFileAdapter } from "./mockFileAdapter";
import { RealKiwiAdapter } from "./realKiwiAdapter";
import * as path from "node:path";

export function createAdapter(baseUrl: string): KiwiAdapter {
  if (baseUrl.startsWith("mock://")) {
    if (process.env.KIWI_RUNTIME_MODE !== "debug-f5") {
      throw new Error("mock:// adapter is available only in debug-f5 mode.");
    }

    const statePath = process.env.KIWI_MOCK_STATE_PATH;
    if (!statePath) {
      throw new Error("KIWI_MOCK_STATE_PATH is required for mock:// baseUrl.");
    }

    if (!path.isAbsolute(statePath)) {
      throw new Error("KIWI_MOCK_STATE_PATH must be an absolute path.");
    }

    return new MockFileAdapter(statePath);
  }

  return new RealKiwiAdapter();
}
