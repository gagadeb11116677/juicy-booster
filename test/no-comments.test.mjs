import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIRS = ["lib", "public", "index.js"];

function isCommentLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("/*")) return true;
  if (trimmed.startsWith("*")) return true;
  if (trimmed.startsWith("<!--")) return true;
  return false;
}

test("tidak ada komentar di file kode", async () => {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    const full = path.resolve(dir);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(full)) {
        if (/\.(js|mjs|cjs|css|html)$/.test(f)) files.push(path.join(full, f));
      }
    } else if (/\.(js|mjs|cjs)$/.test(dir)) {
      files.push(full);
    }
  }
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      if (line.startsWith("#!")) return;
      const urlMatch = line.match(/["']https?:\/\//);
      if (urlMatch) return;
      assert.ok(!isCommentLine(line), `${file}:${i + 1} punya komentar: ${line.trim()}`);
    });
  }
});
