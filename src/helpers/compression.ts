import { compress, decompress } from "brotli";

export function compressString(str: string): string {
  const input = Buffer.from(str, "utf8");
  const compressed = compress(input);
  return Buffer.from(compressed).toString("base64");
}

export function decompressString(compressed: string): string {
  const buffer = Buffer.from(compressed, "base64");
  const decompressed = decompress(buffer);
  return Buffer.from(decompressed).toString("utf8");
}
