import fs from "fs";
import path from "path";
function parseEnvFile(envDir) {
  const filePath = path.join(envDir, ".env.local");
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1);
    if (key) entries.push({ key, value });
  }
  return entries;
}
function writeEnvFile(envDir, entries) {
  const filePath = path.join(envDir, ".env.local");
  const content = entries.map(({ key, value }) => `${key}=${value}`).join("\n");
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
export {
  parseEnvFile,
  writeEnvFile
};
