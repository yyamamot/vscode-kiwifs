import * as http from "node:http";
import * as https from "node:https";
import { KiwiConfig, KiwiCaseAttachmentContent } from "../../types";
import { KiwiError } from "../../domain/errors";

export async function readAttachmentContent(
  config: KiwiConfig,
  attachmentUrl: string
): Promise<KiwiCaseAttachmentContent> {
  const url = new URL(attachmentUrl);
  const isSecure = url.protocol === "https:";
  const requestFn = isSecure ? https.request : http.request;
  const response = await new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    const request = requestFn(
      url,
      {
        method: "GET",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")
        },
        rejectUnauthorized: isSecure ? !isLocalTlsHost(url.hostname) : undefined
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        incoming.on("end", () => {
          resolve({
            statusCode: incoming.statusCode ?? 500,
            headers: incoming.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    request.on("error", (error) => reject(new KiwiError("ConnectionFailed", error.message)));
    request.end();
  });

  if (response.statusCode === 401) {
    throw new KiwiError("AuthenticationFailed", "Attachment authentication failed.");
  }
  if (response.statusCode === 403) {
    throw new KiwiError("AuthorizationFailed", "Attachment authorization failed.");
  }
  if (response.statusCode === 404) {
    throw new KiwiError("NotFound", `Attachment ${attachmentUrl} was not found.`);
  }
  if (response.statusCode >= 400) {
    throw new KiwiError(
      "ConnectionFailed",
      `Attachment download failed with status ${response.statusCode}.`
    );
  }

  return {
    filename:
      parseContentDispositionFilename(response.headers["content-disposition"]) ??
      filenameFromUrl(attachmentUrl) ??
      "attachment",
    contentType:
      typeof response.headers["content-type"] === "string"
        ? response.headers["content-type"]
        : undefined,
    body: response.body
  };
}



export function filenameFromUrl(urlValue: string | undefined): string | undefined {
  if (!urlValue) {
    return undefined;
  }

  try {
    const url = new URL(urlValue);
    const raw = url.pathname.split("/").at(-1);
    return raw ? safeDecodeURIComponent(raw) : undefined;
  } catch {
    return undefined;
  }
}



export function parseContentDispositionFilename(
  contentDisposition: string | string[] | undefined
): string | undefined {
  const header =
    typeof contentDisposition === "string"
      ? contentDisposition
      : Array.isArray(contentDisposition)
        ? contentDisposition[0]
        : undefined;
  if (!header) {
    return undefined;
  }

  const encodedMatch = header.match(/filename\*\s*=\s*[^']*''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return safeDecodeURIComponent(encodedMatch[1].trim().replace(/^"(.*)"$/, "$1"));
  }

  const plainMatch = header.match(/filename\s*=\s*("?)([^";]+)\1/i);
  return plainMatch?.[2]?.trim();
}



function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}



function isLocalTlsHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}
