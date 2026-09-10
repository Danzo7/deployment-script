import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ROOT_DIR } from "../constants.js";
function ensureDefaultConfig() {
  const userEnvPath = path.join(ROOT_DIR, ".env");
  if (fs.existsSync(userEnvPath)) {
    return;
  }
  if (!fs.existsSync(ROOT_DIR)) {
    fs.mkdirSync(ROOT_DIR, { recursive: true });
  }
  const currentFile = fileURLToPath(import.meta.url);
  const installDir = path.resolve(path.dirname(currentFile), "../..");
  const examplePath = path.join(installDir, ".env.example");
  let envContent = "";
  if (fs.existsSync(examplePath)) {
    envContent = fs.readFileSync(examplePath, "utf-8");
  } else {
    envContent = `# dm configuration
# Generated on first run - customize as needed

# Database Configuration
DATABASE_TYPE=sqlite

# For PostgreSQL, uncomment and configure:
# DATABASE_URL=postgresql://user:password@localhost:5432/deployment_manager

# Secret key for delete operations
# SECRET_KEY=your_secret_key_here

# Remote SSH access port (default: 2022)
# REMOTE_PORT=2022

# Remote SSH server bind address (default: 127.0.0.1)
# REMOTE_BIND=127.0.0.1
`;
  }
  fs.writeFileSync(userEnvPath, envContent, "utf-8");
}
function isFirstRun() {
  return !fs.existsSync(ROOT_DIR);
}
function getActiveEnvPath() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(ROOT_DIR, ".env")
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}
export {
  ensureDefaultConfig,
  getActiveEnvPath,
  isFirstRun
};
