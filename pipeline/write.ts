import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";

/** Read and validate a previous snapshot; null if missing or invalid. */
export function readPrevious<T>(dir: string, file: string, schema: ZodType<T>): T | null {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(fs.readFileSync(p, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Validate then write atomically (temp file + rename). Never leaves a half-written file. */
export function writeValidated<T>(dir: string, file: string, data: unknown, schema: ZodType<T>): { ok: true } | { ok: false; error: string } {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(parsed.data));
  fs.renameSync(tmp, p);
  return { ok: true };
}
