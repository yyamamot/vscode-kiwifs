import xmlrpc = require("xmlrpc");
import { KiwiConfig } from "../../types";
import { KiwiError, KiwiErrorCode } from "../../domain/errors";

export interface RpcSession {
  call(method: string, params: unknown[]): Promise<unknown>;
}

export type RpcSessionFactory = (config: KiwiConfig) => RpcSession;

export function createRpcSession(config: KiwiConfig): RpcSession {
  const endpoint = new URL("/xml-rpc/", `${config.baseUrl}/`);
  const options: {
    url: string;
    cookies: boolean;
    rejectUnauthorized?: boolean;
  } = {
    url: endpoint.toString(),
    cookies: true
  };

  if (isLocalTlsHost(endpoint.hostname)) {
    options.rejectUnauthorized = false;
  }

  const client = endpoint.protocol === "https:"
    ? xmlrpc.createSecureClient(options)
    : xmlrpc.createClient(options);

  let loginPromise: Promise<void> | undefined;

  return {
    async call(method: string, params: unknown[]): Promise<unknown> {
      if (method !== "Auth.login") {
        await ensureLogin();
      }

      return methodCall(client, method, params);
    }
  };

  async function ensureLogin(): Promise<void> {
    if (!loginPromise) {
      loginPromise = methodCall(client, "Auth.login", [config.username, config.password]).then(
        () => undefined
      );
    }

    return loginPromise;
  }
}



export function toKiwiError(error: unknown): KiwiError {
  if (error instanceof KiwiError) {
    return error;
  }

  if (isRpcFault(error)) {
    const message = error.faultString;
    return new KiwiError(mapFaultToCode(message), message);
  }

  if (isNetworkError(error)) {
    return new KiwiError("ConnectionFailed", error.message);
  }

  if (error instanceof Error) {
    return new KiwiError("ConnectionFailed", error.message);
  }

  return new KiwiError("ConnectionFailed", String(error));
}



export function shouldInvalidateSession(error: KiwiError): boolean {
  return (
    error.code === "AuthenticationFailed" ||
    error.code === "AuthorizationFailed" ||
    error.code === "ConnectionFailed"
  );
}



async function methodCall(
  client: ReturnType<typeof xmlrpc.createClient>,
  method: string,
  params: unknown[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (error: object, value: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    });
  });
}



function isLocalTlsHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}



function isRpcFault(
  error: unknown
): error is {
  faultCode: number;
  faultString: string;
  message?: string;
} {
  return Boolean(
    error &&
      typeof error === "object" &&
      typeof (error as { faultCode?: unknown }).faultCode === "number" &&
      typeof (error as { faultString?: unknown }).faultString === "string"
  );
}

function isNetworkError(error: unknown): error is Error & { code?: string } {
  return Boolean(
    error &&
      error instanceof Error &&
      typeof (error as { code?: unknown }).code === "string"
  );
}

function mapFaultToCode(message: string): KiwiErrorCode {
  if (
    /authentication failed|wrong username or password|username and password is required/i.test(
      message
    )
  ) {
    return "AuthenticationFailed";
  }

  if (/permission denied|does not have permission|forbidden/i.test(message)) {
    return "AuthorizationFailed";
  }

  if (/doesnotexist|matching query does not exist|was not found|not found/i.test(message)) {
    return "NotFound";
  }

  if (/invalid|not valid|required|available/i.test(message)) {
    return "ValidationFailed";
  }

  return "ApiUnsupported";
}
