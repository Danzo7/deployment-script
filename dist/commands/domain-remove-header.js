import { normalizeDomainName } from "../utils/route-validation.js";
import { DomainRepo } from "../db/repos.js";
import { Logger } from "../utils/logger.js";
import { getCurrentUser } from "../utils/user-context.js";
async function domainRemoveHeader(name, key) {
  const normalized = normalizeDomainName(name);
  const domain = await DomainRepo.findByName(normalized);
  if (!domain.headers || !(key in domain.headers)) {
    throw new Error(`Header "${key}" is not set on domain "${normalized}"`);
  }
  const headers = { ...domain.headers };
  delete headers[key];
  await DomainRepo.update(normalized, {
    headers,
    updatedAt: /* @__PURE__ */ new Date()
  }, getCurrentUser());
  Logger.success(`Header "${key}" removed from domain "${normalized}".`);
}
export {
  domainRemoveHeader
};
