import fs from "node:fs";
import path from "node:path";

const publicDir = path.resolve("public");
const assets = {};
if (fs.existsSync(publicDir)) {
  for (const f of fs.readdirSync(publicDir)) {
    assets["public/" + f] = path.join(publicDir, f);
  }
}

const config = {
  main: "dist/bundle.cjs",
  output: "juicy-sea-prep.blob",
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};

fs.writeFileSync("sea-config.json", JSON.stringify(config, null, 2), "utf8");
console.log("sea-config.json generated with " + Object.keys(assets).length + " assets");
