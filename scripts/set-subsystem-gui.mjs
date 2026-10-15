import fs from "node:fs";

const exe = process.argv[2] || "juicy-booster.exe";
const buf = fs.readFileSync(exe);

const PE_OFFSET = buf.readUInt32LE(0x3c);
const OPTIONAL_HEADER_OFFSET = PE_OFFSET + 24;
const MAGIC_OFFSET = OPTIONAL_HEADER_OFFSET;
const magic = buf.readUInt16LE(MAGIC_OFFSET);

const SUBSYSTEM_OFFSET = MAGIC_OFFSET + (magic === 0x20b ? 68 : 64);
const CONSOLE = 3;
const WINDOWS_GUI = 2;

const current = buf.readUInt16LE(SUBSYSTEM_OFFSET);
if (current === WINDOWS_GUI) {
  console.log("Subsystem sudah WINDOWS_GUI, skip.");
  process.exit(0);
}

const out = Buffer.from(buf);
out.writeUInt16LE(WINDOWS_GUI, SUBSYSTEM_OFFSET);
fs.writeFileSync(exe, out);
console.log("Subsystem diubah dari CONSOLE (3) ke WINDOWS_GUI (2).");
