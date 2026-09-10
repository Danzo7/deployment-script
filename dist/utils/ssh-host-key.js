import fs from "fs";
import { createHash } from "crypto";
import ssh2 from "ssh2";
const { utils: sshUtils } = ssh2;
import { REMOTE_HOST_KEY_PATH } from "../constants.js";
import { ensureRemoteDir } from "./remote-auth.js";
function loadOrCreateHostKey() {
  ensureRemoteDir();
  if (!fs.existsSync(REMOTE_HOST_KEY_PATH)) {
    const { private: privateKey } = sshUtils.generateKeyPairSync("ed25519");
    fs.writeFileSync(REMOTE_HOST_KEY_PATH, privateKey, { mode: 384 });
  }
  return fs.readFileSync(REMOTE_HOST_KEY_PATH);
}
function fingerprintHostKey(pem) {
  const parsed = sshUtils.parseKey(pem);
  if (parsed instanceof Error) throw parsed;
  const pub = Array.isArray(parsed) ? parsed[0].getPublicSSH() : parsed.getPublicSSH();
  return "SHA256:" + createHash("sha256").update(pub).digest("base64").replace(/=+$/, "");
}
export {
  fingerprintHostKey,
  loadOrCreateHostKey
};
