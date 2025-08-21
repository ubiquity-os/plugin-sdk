import { gzipSync, gunzipSync } from "zlib";

export function compressString(str: string): string {
  const compressed = gzipSync(str);
  return compressed.toString("base64");
}

export function decompressString(compressed: string): string {
  const buffer = Buffer.from(compressed, "base64");
  const decompressed = gunzipSync(buffer);
  return decompressed.toString();
}
