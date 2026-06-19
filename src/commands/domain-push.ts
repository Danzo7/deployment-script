import { NGINX_REMOTE_HOST, NGINX_REMOTE_KEY, NGINX_REMOTE_PASSWORD, NGINX_SUDO_PASSWORD } from '../constants.js';
import { LocalPusher } from '../utils/local-pusher.js';
import { RemotePusher } from '../utils/remote-pusher.js';
import { Logger } from '../utils/logger.js';
import { normalizeDomainName } from '../utils/route-validation.js';

export async function domainPush(domainName: string): Promise<void> {
  // Normalize domain name
  const normalized = normalizeDomainName(domainName);
  
  // Determine target host
  const remoteHost = NGINX_REMOTE_HOST;
  
  // Instantiate appropriate pusher
  let pusher;
  if (remoteHost) {
    pusher = new RemotePusher(normalized, remoteHost, NGINX_REMOTE_KEY, NGINX_REMOTE_PASSWORD, NGINX_SUDO_PASSWORD);
  } else {
    pusher = new LocalPusher(normalized);
  }
  
  // Execute push
  await pusher.push();
  
  Logger.success(`Domain "${normalized}" pushed successfully`);
}
