const workflowShareQueryParam = "share";
type WorkflowShareCodec = "plain" | "gzip";

export function workflowShareTokenFromUrl(url: string): string | null {
  try {
    return new URL(url, "http://localhost").searchParams.get(workflowShareQueryParam);
  } catch {
    return null;
  }
}

export function workflowShareUrl(origin: string, token: string): string {
  const url = new URL("/workflow", origin);
  url.searchParams.set(workflowShareQueryParam, token);
  return url.toString();
}

export async function encodeWorkflowSharePayload(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload);
  const jsonBytes = utf8Bytes(json);
  const compressedBytes = await compressBytes(jsonBytes);
  const codec: WorkflowShareCodec =
    compressedBytes && compressedBytes.byteLength + 24 < jsonBytes.byteLength ? "gzip" : "plain";
  const bytes = codec === "gzip" && compressedBytes ? compressedBytes : jsonBytes;
  return `${codec}.${bytesToBase64Url(bytes)}`;
}

export async function decodeWorkflowSharePayload<T>(token: string): Promise<T> {
  const separator = token.indexOf(".");
  if (separator === -1) {
    throw new Error("Workflow share link is invalid");
  }

  const codec = token.slice(0, separator);
  const encoded = token.slice(separator + 1);
  if (codec !== "plain" && codec !== "gzip") {
    throw new Error("Workflow share link uses an unknown encoding");
  }

  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(encoded);
  } catch {
    throw new Error("Workflow share link is invalid");
  }

  const decodedBytes = codec === "gzip" ? await decompressBytes(bytes) : bytes;
  try {
    return JSON.parse(utf8Text(decodedBytes)) as T;
  } catch {
    throw new Error("Workflow share link is invalid");
  }
}

async function compressBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  try {
    const stream = new Blob([blobPartFromBytes(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function decompressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open compressed workflow share links");
  }
  try {
    const stream = new Blob([blobPartFromBytes(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error("Workflow share link is invalid");
  }
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function blobPartFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4 || 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
