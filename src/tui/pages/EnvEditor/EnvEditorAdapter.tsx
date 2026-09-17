import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { EnvEditor, type EditorRow } from './index.js';
import { parseEnvFile, writeEnvFile } from '../../../utils/env-file-parser.js';
import { setEnv } from '../../../utils/env-heper.js';
import { AppRepo } from '../../../db/repos.js';
import { ensureDirectories } from '../../../utils/file-utils.js';
import { usePageParams } from '../../../app/navigation/use-navigation.js';
import { PageId } from '../../../app/navigation/types.js';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';

export function EnvEditorAdapter(): React.ReactElement {
  const { appName } = usePageParams<PageId.EnvEditor>();
  const exit = usePageExit();
  const [initial, setInitial] = useState<Array<{ key: string; value: string }> | null>(null);
  const [envDir, setEnvDir] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Load data on mount (per plan: pages load their own data)
  useEffect(() => {
    const load = async () => {
      try {
        const app = await AppRepo.findByName(appName);
        const dirs = ensureDirectories(app.appDir);
        const entries = parseEnvFile(dirs.envDir);
        setEnvDir(dirs.envDir);
        setInitial(entries);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    };
    load();
  }, [appName]);

  const handleSave = async (rows: EditorRow[], count: number) => {
    // Apply changes to disk
    const toUpsert = rows.filter(r => r.state === 'new' || r.state === 'modified');
    const toDelete = rows.filter(r => r.state === 'deleted');

    if (toDelete.length > 0) {
      const existing = parseEnvFile(envDir);
      const deleteKeys = new Set(toDelete.map(r => r.key));
      const kept = existing.filter(e => !deleteKeys.has(e.key));
      writeEnvFile(envDir, kept);
    }

    for (const row of toUpsert) {
      setEnv(envDir, row.key, row.value);
    }

    return exit(count);
  };

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }


  if (initial === null) {
    return <></>;
  }

  return (
    <EnvEditor
      appName={appName}
      initial={initial}
      onSave={handleSave}
      onCancel={exit}
    />
  );
}
