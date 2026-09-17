import { useState, useCallback, useEffect } from 'react';
import { Box } from 'ink';
import chalk from 'chalk';
import { Logger } from '../../../utils/logger.js';
import { StaticOutputList, type OutputEntry } from '../../../app/output/static-output-list.js';
import { ReplInput } from './repl-input.js';
import { CommandHistory } from './history.js';
import { dispatch, tokenise, auditCommand } from './dispatcher.js';
import { usePageExit } from '../../../app/navigation/use-page-exit.js';

let entryIdCounter = 0;

// Module-level singleton: persists across REPL component remounts
// Safe for remote sessions since each SSH connection is a separate process
const sharedHistory = new CommandHistory();

// Limit REPL scrollback to prevent memory exhaustion
const MAX_REPL_LINES = 10000;

export function ReplPage() {
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [staticKey, setStaticKey] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const exit = usePageExit();

  const appendEntry = useCallback((text: string) => {
    setEntries((prev) => {
      const next = [...prev, { id: String(entryIdCounter++), text }];
      return next.length > MAX_REPL_LINES ? next.slice(-MAX_REPL_LINES) : next;
    });
  }, []);

  // Setup Logger sink on mount and notify navigation when ready
  useEffect(() => {
    Logger.setSink((line: string) => {
      appendEntry(line.trimEnd());
    });

    // Show initial prompt after brief delay to avoid race with welcome message
    if (!initialized) {
      setInitialized(true);
    }

    // IMPORTANT: Signal that this page is ready to receive Logger output.
    // This triggers queued onResult callbacks from TUI pages that just popped.
    // Without this, onResult callbacks that use Logger would execute before
    // the sink is established, causing their output to be lost.
    import('../../../app/navigation/navigation-context.js').then(({ notifyPageReady }) => {
      notifyPageReady();
    });

    return () => {
      Logger.clearSink();
    };
  }, [appendEntry, initialized]);

  // Hook up clear and exit commands to dispatcher
  useEffect(() => {
    (dispatch as any)._clearCallback = () => {
      process.stdout.write('\x1b[2J\x1b[H');
      setEntries([]);
      setStaticKey((k) => k + 1);
    };

    (dispatch as any)._exitCallback = () => {
      Logger.print(chalk.gray('Goodbye.'));
      exit();
    };

    return () => {
      (dispatch as any)._clearCallback = null;
      (dispatch as any)._exitCallback = null;
    };
  }, [exit]);

  const handleSubmit = useCallback(async (line: string) => {
    // Echo the command line to scrollback (raw mode doesn't echo)
    appendEntry(`${chalk.cyan('dm>')} ${line}`);

    if (!line.trim()) {
      return;
    }

    auditCommand(line);
    const tokens = tokenise(line);
    
    try {
      await dispatch(tokens);
    } catch (err: any) {
      Logger.error(err?.message ?? String(err));
    }
  }, [appendEntry]);

  return (
    <Box flexDirection="column">
      <StaticOutputList entries={entries} staticKey={staticKey} />
      <ReplInput history={sharedHistory} onSubmit={handleSubmit} />
    </Box>
  );
}
