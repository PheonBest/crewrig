// digest.ts — SHA-256 of a file as lower-case hex (spec 0257), over node:crypto so no host
// `sha256sum` or `shasum` is needed.

import crypto from "node:crypto";
import fs from "node:fs";

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
