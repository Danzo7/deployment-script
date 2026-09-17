import { normalizeDomainName } from '../utils/route-validation.js';
import { validateHeaderKey } from '../utils/header-merge.js';
import { DomainRepo } from '../db/repos.js';
import { Logger } from '../utils/logger.js';
import { getCurrentUser } from '../utils/user-context.js';

export async function domainSetHeader(
  name: string,
  key: string,
  value: string
): Promise<void> {
  // 1. Normalize domain name
  const normalized = normalizeDomainName(name);

  // 2. Look up domain — throws if not found
  const domain = await DomainRepo.findByName(normalized);

  // 3. Validate header key
  validateHeaderKey(key);

  // 4. Set/overwrite key in domain.headers (initialize to {} if undefined)
  const headers: Record<string, string> = domain.headers ?? {};
  headers[key] = value;

  // 5. Persist update
  await DomainRepo.update(normalized, {
    headers,
    updatedAt: new Date(),
  }, getCurrentUser());

  // 6. Log success
  Logger.success(`Header "${key}" set on domain "${normalized}".`);
}

export const launchDomainHeaderApp = async (name: string): Promise<void> => {
  const { PageId } = await import('../app/navigation/types.js');
  const { launchPage } = await import('../app/navigation/launcher.js');
  const normalized = normalizeDomainName(name);
  
  await launchPage({
    pageId: PageId.HeaderEditor,
    params: { target: 'domain', domainName: normalized },
    fullScreen: true,
    onResult: (result: any) => {
      if (result?.count > 0) {
        Logger.success(
          `Saved ${result.count} header change${result.count === 1 ? '' : 's'} to domain "${normalized}".`
        );
        Logger.advice(
          `Run ${Logger.highlight(`dm domain push ${normalized}`)} to apply the changes.`
        );
      }
    },
  });
};
