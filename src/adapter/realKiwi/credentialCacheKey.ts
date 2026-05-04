import { createHash } from "node:crypto";
import { KiwiConfig } from "../../types";

export function createCredentialCacheKey(config: Pick<KiwiConfig, "baseUrl" | "username" | "password">): string {
  const digest = createHash("sha256")
    .update(lengthPrefixed(config.baseUrl))
    .update(lengthPrefixed(config.username))
    .update(lengthPrefixed(config.password))
    .digest("hex");
  return `${config.baseUrl}\n${config.username}\nsha256:${digest}`;
}

function lengthPrefixed(value: string): string {
  return `${value.length}:${value};`;
}
