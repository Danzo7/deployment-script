import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { DbCompareScreen } from './index.js';
import { usePageParams } from '../../../app/navigation/use-navigation.js';
import { PageId } from '../../../app/navigation/types.js';
import { DatabaseRepo } from '../../../db/repos.js';

export function DbCompareAdapter(): React.ReactElement {
  const { dbName } = usePageParams<PageId.DbCompare>();
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate database exists on mount
  useEffect(() => {
    const load = async () => {
      try {
        await DatabaseRepo.findByName(dbName);
        setValidated(true);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    };
    load();
  }, [dbName]);

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (!validated) {
    return <></>;
  }

  return <DbCompareScreen dbName={dbName} />;
}
