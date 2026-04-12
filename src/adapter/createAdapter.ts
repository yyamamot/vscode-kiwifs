import { KiwiAdapter } from "./types";
import { MockFileAdapter } from "./mockFileAdapter";
import { RealKiwiAdapter } from "./realKiwiAdapter";

export function createAdapter(baseUrl: string): KiwiAdapter {
  if (baseUrl.startsWith("mock://")) {
    const statePath = process.env.KIWI_MOCK_STATE_PATH;
    if (!statePath) {
      throw new Error("KIWI_MOCK_STATE_PATH is required for mock:// baseUrl.");
    }

    return new MockFileAdapter(statePath);
  }

  return new RealKiwiAdapter();
}
