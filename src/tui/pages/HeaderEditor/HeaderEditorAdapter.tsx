import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { HeaderEditor, type HeaderRow } from './index.js';
import { DomainRepo, RouteRepo } from '../../../db/repos.js';
import { usePageParams } from '../../../app/navigation/use-navigation.js';
import { PageId } from '../../../app/navigation/types.js';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';

export function HeaderEditorAdapter(): React.ReactElement {
  const params = usePageParams<PageId.HeaderEditor>();
  const exit = usePageExit();
  const [initial, setInitial] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load data on mount (per plan: pages load their own data)
  useEffect(() => {
    const load = async () => {
      try {
        if (params.target === 'domain') {
          const domain = await DomainRepo.findByName(params.domainName);
          setInitial(domain.headers ?? {});
        } else {
          const domain = await DomainRepo.findByName(params.domainName);
          const route = await RouteRepo.findByDomainAndPath(domain.id, params.location);
          if (!route) {
            throw new Error(
              `No route found for "/${params.location}" on domain "${params.domainName}"`
            );
          }
          setInitial(route.headers ?? {});
        }
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    };
    load();
  }, [params]);

  const handleSave = async (rows: HeaderRow[], count: number) => {
    // Import command functions dynamically to apply changes
    if (params.target === 'domain') {
      const { domainSetHeader } = await import('../../../commands/domain-set-header.js');
      const { domainRemoveHeader } = await import('../../../commands/domain-remove-header.js');

      for (const row of rows) {
        if (row.state === 'new' || row.state === 'modified') {
          await domainSetHeader(params.domainName, row.key, row.value);
        } else if (row.state === 'deleted') {
          await domainRemoveHeader(params.domainName, row.key);
        }
      }
    } else {
      const { routeSetHeader } = await import('../../../commands/route-set-header.js');
      const { routeRemoveHeader } = await import('../../../commands/route-remove-header.js');

      for (const row of rows) {
        if (row.state === 'new' || row.state === 'modified') {
          await routeSetHeader(params.domainName, params.location, row.key, row.value);
        } else if (row.state === 'deleted') {
          await routeRemoveHeader(params.domainName, params.location, row.key);
        }
      }
    }

    // Exit with result for onResult callback
    exit({ count, params });
  };

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (!initial) {
    return <></>;
  }

  // Build target display string
  const target = params.target === 'route'
    ? `${params.domainName} /${params.location}`
    : params.domainName;

  return (
    <HeaderEditor
      target={target}
      initial={initial}
      onSave={handleSave}
      onCancel={exit}
    />
  );
}
