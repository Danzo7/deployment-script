import {
  NGINX_REMOTE_HOST,
  NGINX_REMOTE_KEY,
  NGINX_REMOTE_PASSWORD,
  NGINX_SUDO_PASSWORD
} from "../constants.js";
import { LocalPusher } from "../utils/local-pusher.js";
import { RemotePusher } from "../utils/remote-pusher.js";
import { Logger } from "../utils/logger.js";
import { normalizeDomainName } from "../utils/route-validation.js";
async function domainPush(domainName) {
  const normalized = normalizeDomainName(domainName);
  const remoteHost = NGINX_REMOTE_HOST;
  let pusher;
  if (remoteHost) {
    pusher = await RemotePusher.create(
      normalized,
      remoteHost,
      NGINX_REMOTE_KEY,
      NGINX_REMOTE_PASSWORD,
      NGINX_SUDO_PASSWORD
    );
  } else {
    pusher = await LocalPusher.create(normalized);
  }
  await pusher.push();
  Logger.success(`Domain "${normalized}" pushed successfully`);
}
export {
  domainPush
};
