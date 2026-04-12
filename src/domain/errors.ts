export type KiwiErrorCode =
  | "AuthenticationFailed"
  | "AuthorizationFailed"
  | "ConnectionFailed"
  | "NotFound"
  | "ValidationFailed"
  | "ConflictDetected"
  | "ApiUnsupported";

export class KiwiError extends Error {
  readonly code: KiwiErrorCode;

  constructor(code: KiwiErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "KiwiError";
  }
}
