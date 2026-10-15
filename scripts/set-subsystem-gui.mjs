import fs from "node:fs";

const exe = process.argv[2] || "juicy-booster.exe";

if (!fs.existsSync(exe)) {
  console.error("ERROR: " + exe + " tidak ditemukan. Pastikan postject inject sudah jalan.");
  process.exit(1);
}

const buf = fs.readFileSync(exe);

if (buf.length < 0x40) {
  console.error("ERROR: file terlalu kecil, bukan PE valid.");
  process.exit(1);
}

const PE_OFFSET = buf.readUInt32LE(0x3c);

if (PE_OFFSET <= 0 || PE_OFFSET >= buf.length) {
  console.error("ERROR: PE offset tidak valid: " + PE_OFFSET);
  process.exit(1);
}

const OPTIONAL_HEADER_OFFSET = PE_OFFSET + 24;
const MAGIC_OFFSET = OPTIONAL_HEADER_OFFSET;
const magic = buf.readUInt16LE(MAGIC_OFFSET);

if (magic !== 0x10b && magic !== 0x20b) {
  console.error("ERROR: PE magic tidak dikenal: 0x" + magic.toString(16));
  process.exit(1);
}

const SUBSYSTEM_OFFSET = MAGIC_OFFSET + (magic === 0x20b ? 68 : 64);
const CONSOLE = 3;
const WINDOWS_GUI = 2;

const current = buf.readUInt16LE(SUBSYSTEM_OFFSET);

if (current === WINDOWS_GUI) {
  console.log("Subsystem sudah WINDOWS_GUI, skip.");
  process.exit(0);
}

if (current !== CONSOLE) {
  console.log("Subsystem saat ini: " + current + " (bukan CONSOLE). Tetap ubah ke WINDOWS_GUI.");
}

const out = Buffer.from(buf);
out.writeUInt16LE(WINDOWS_GUI, SUBSYSTEM_OFFSET);
fs.writeFileSync(exe, out);

const verify = fs.readFileSync(exe);
const after = verify.readUInt16LE(SUBSYSTEM_OFFSET);
if (after !== WINDOWS_GUI) {
  console.error("ERROR: verifikasi gagal, subsystem = " + after);
  process.exit(1);
}

console.log("Subsystem diubah dari " + current + " ke WINDOWS_GUI (2). Verifikasi OK.");
