import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { DbMigrateScreen } from './index.js';
import { usePageParams } from '../../../app/navigation/use-navigation.js';
import { PageId } from '../../../app/navigation/types.js';
import { DatabaseRepo } from '../../../db/repos.js';

export function DbMigrateAdapter(): React.ReactElement {
  const params = usePageParams<PageId.DbMigrate>();
  const [dbName, setDbName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Validate database exists on mount
  useEffect(() => {
    const load = async () => {
      try {
        const db = await DatabaseRepo.findByName(params.name);
        setDbName(db.name);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    };
    load();
  }, [params.name]);

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (dbName === null) {
    return <></>;
  }

  return (
    <DbMigrateScreen
      dbName={dbName}
      migrationKey={params.key}
      migrationType={params.type}
      initialText={params.initialText}
    />
  );
}
