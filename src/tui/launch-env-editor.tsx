import React from 'react';
import { render } from 'ink';
import { EnvEditor, EditorRow } from './EnvEditor.js';
import { parseEnvFile, writeEnvFile } from '../utils/env-file-parser.js';
import { setEnv } from '../utils/env-heper.js';
import { AppRepo } from '../db/repos.js';
import { ensureDirectories } from '../utils/file-utils.js';
import { Logger } from '../utils/logger.js';
import { pauseRepl, resumeRepl } from '../utils/repl-context.js';

async function applyChanges(envDir: string, rows: EditorRow[]): Promise<void> {
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
}

export async function launchEnvEditor(appName: string): Promise<void> {
  pauseRepl();
  Logger.isMuted = true;

  const app = await AppRepo.findByName(appName);
  const { envDir } = ensureDirectories(app.appDir);
  const initial = parseEnvFile(envDir);

  Logger.isMuted = false;

  let savedCount = 0;

  const { waitUntilExit } = render(
    <EnvEditor
      appName={appName}
      initial={initial}
      onSave={async (rows, count) => {
        await applyChanges(envDir, rows);
        savedCount = count;
      }}
    />
  );

  await waitUntilExit();
  resumeRepl();

  if (savedCount > 0) {
    Logger.success(`Saved ${savedCount} change${savedCount === 1 ? '' : 's'} to ${appName}.`);
    Logger.advice(`Run ${Logger.highlight(`dm deploy ${appName}`)} to apply the changes.`);
  }
}
