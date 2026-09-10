import { normalizeDomainName } from "../utils/route-validation.js";
import { validateHeaderKey } from "../utils/header-merge.js";
import { DomainRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import { getCurrentUser } from "../utils/user-context.js";
async function domainSetHeader(name, key, value) {
  const normalized = normalizeDomainName(name);
  const domain = await DomainRepo.findByName(normalized);
  validateHeaderKey(key);
  const headers = domain.headers ?? {};
  headers[key] = value;
  await DomainRepo.update(normalized, {
    headers,
    updatedAt: /* @__PURE__ */ new Date()
  }, getCurrentUser());
  Logger.success(`Header "${key}" set on domain "${normalized}".`);
}
export {
  domainSetHeader
};
