import React from 'react';
import { render } from 'ink';
import { EnvEditor, EditorRow } from './EnvEditor.js';
import { parseEnvFile, writeEnvFile } from '../utils/env-file-parser.js';
import { setEnv } from '../utils/env-heper.js';
import { getAppStatus, runApp } from '../utils/pm2-helper.js';
import { AppRepo } from '../db/repos.js';
import { ensureDirectories } from '../utils/file-utils.js';

/**
 * Applies the diff from in-memory editor state to disk using the existing
 * setEnv() mechanism for adds/modifications, and removes deleted keys by
 * rewriting the env file without them.
 */
async function applyChanges(envDir: string, rows: EditorRow[]): Promise<void> {
  // Split into adds/modifies vs deletes
  const toUpsert = rows.filter(r => r.state === 'new' || r.state === 'modified');
  const toDelete = rows.filter(r => r.state === 'deleted');

  if (toDelete.length > 0) {
    // For deletions, we need to rewrite the file without those keys.
    // Read existing, filter, write back — then apply upserts on top.
    const existing = parseEnvFile(envDir);
    const deleteKeys = new Set(toDelete.map(r => r.key));
    const kept = existing.filter(e => !deleteKeys.has(e.key));
    writeEnvFile(envDir, kept);
  }

  // Apply upserts via existing setEnv (regex-based upsert)
  for (const row of toUpsert) {
    setEnv(envDir, row.key, row.value);
  }
}

export async function launchEnvEditor(appName: string): Promise<void> {
  // 1. Resolve app
  const app = await AppRepo.findByName(appName);
  const { envDir } = ensureDirectories(app.appDir);

  // 2. Load current env vars
  const initial = parseEnvFile(envDir);

  // 3. Check PM2 status
  let isRunning = false;
  try {
    const status = await getAppStatus(appName);
    isRunning = status === 'online' || status === 'launching';
  } catch {
    // PM2 not available or app not found — treat as not running
  }

  // 4. Render TUI
  const { waitUntilExit } = render(
    <EnvEditor
      appName={appName}
      initial={initial}
      isRunning={isRunning}
      onSave={async (rows) => {
        await applyChanges(envDir, rows);
      }}
    />
  );

  await waitUntilExit();

  // 5. If save+restart was confirmed, restart via PM2
  if (process.env['_DM_RESTART_AFTER_SAVE'] === '1') {
    delete process.env['_DM_RESTART_AFTER_SAVE'];
    const status = await getAppStatus(appName);
    await runApp(app.activeBuild ?? app.appDir, {
      name: appName,
      port: app.port,
      status,
      projectType: app.projectType,
      instances: app.instances ?? 1,
    });
  }
}
