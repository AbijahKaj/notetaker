import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function verifyFileSha256(path: string, expectedHex: string): Promise<void> {
  const actual = await sha256File(path);
  if (actual.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: expected ${expectedHex}, got ${actual}`);
  }
}
