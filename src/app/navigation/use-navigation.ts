import { useNavigation } from './navigation-context.js';
import type { PageId, PageParamsMap } from './types.js';

export function usePush() {
  const nav = useNavigation();
  return nav.push.bind(nav);
}

export function usePageParams<P extends PageId>(): PageParamsMap[P] {
  const nav = useNavigation();
  return nav.current.params as PageParamsMap[P];
}

export function useCurrentPageId(): PageId {
  const nav = useNavigation();
  return nav.current.id;
}
