import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ProgressScreenProps } from '../types.js';
import { DB_COLORS } from '../../../utils/colors.js';
import { MigrationRepo } from '../../../../db/repos.js';
import { Migration, MigrationStep } from '../../../../db/model.js';

const getStatusGlyph = (status: string) => {
  switch (status) {
    case 'succeeded':
      return { glyph: '✓', color: DB_COLORS.green };
    case 'running':
      return { glyph: '●', color: DB_COLORS.accent };
    case 'pending':
      return { glyph: '○', color: DB_COLORS.dim };
    case 'failed':
      return { glyph: '✗', color: DB_COLORS.red };
    case 'skipped':
      return { glyph: '⊘', color: DB_COLORS.dim };
    default:
      return { glyph: '?', color: DB_COLORS.dim };
  }
};

export const ProgressScreen: React.FC<ProgressScreenProps> = ({
  migrationId,
  onComplete,
}) => {
  const [migration, setMigration] = useState<Migration | null>(null);
  const [steps, setSteps] = useState<MigrationStep[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  // Handle exit keys
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c') || (key.ctrl && input === 'x')) {
      onComplete();
    }
  });

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const pollStatus = async () => {
      try {
        const migrationData = await MigrationRepo.findById(migrationId);
        setMigration(migrationData);
        setSteps(migrationData.steps || []);

        // Check if migration is complete (succeeded or failed)
        if (
          migrationData.status === 'succeeded' ||
          migrationData.status === 'failed'
        ) {
          if (!isComplete) {
            setIsComplete(true);
            clearInterval(intervalId);
            // Don't auto-exit - let user press Esc to exit
          }
        }
      } catch (err) {
        // Error fetching migration status
        console.error('Error polling migration status:', err);
      }
    };

    // Initial poll
    pollStatus();

    // Poll every 500ms
    intervalId = setInterval(pollStatus, 500);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [migrationId, isComplete]);

  if (!migration) {
    return (
      <Box flexDirection="column" height="100%" justifyContent="center" alignItems="center">
        <Text>Loading migration status...</Text>
      </Box>
    );
  }

  const isRunning = migration.status === 'running';
  const isFailed = migration.status === 'failed';
  const isSucceeded = migration.status === 'succeeded';

  return (
    <Box flexDirection="column" height="100%" paddingX={2}>
      {/* Title bar */}
      <Box>
        <Text bold color={DB_COLORS.accent}>
          Executing — {migration.migrationKey}
        </Text>
      </Box>

      {/* Steps progress */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={DB_COLORS.border}
        paddingX={1}
        paddingY={1}
        flexGrow={1}
      >
        {steps.map((step) => {
          const statusInfo = getStatusGlyph(step.status);
          const stepNum = `${step.stepIndex + 1}/${migration.totalSteps}`;

          return (
            <Box key={step.id} flexDirection="column" marginBottom={step.errorMessage ? 1 : 0}>
              <Box>
                <Text>{stepNum.padStart(7)}  </Text>
                <Text color={statusInfo.color}>{statusInfo.glyph} </Text>
                <Text>
                  {step.description.substring(0, 60)}
                  {step.description.length > 60 ? '...' : ''}
                </Text>
              </Box>
              {step.errorMessage && (
                <Box marginLeft={11}>
                  <Text color={DB_COLORS.red}>
                    error: {step.errorMessage}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Summary message */}
      {isFailed && (
        <Box flexDirection="column">
          <Text color={DB_COLORS.red}>
            Steps 1–{migration.completedSteps} committed. Remaining steps never ran.
          </Text>
          <Text>Inspect with:</Text>
          <Text dimColor>
            {'  '}dm db history {migration.migrationKey}
          </Text>
        </Box>
      )}

      {isSucceeded && (
        <Box flexDirection="column">
          <Text color={DB_COLORS.green}>
            All {migration.totalSteps} steps completed. Recorded in history as
          </Text>
          <Text color={DB_COLORS.green}>succeeded.</Text>
        </Box>
      )}

      {/* Footer status */}
      <Box borderStyle="single" borderTop>
        <Text dimColor>
          {isRunning && 'running…'}
          {isComplete && 'finished — press ^C or ^X to exit'}
        </Text>
      </Box>
    </Box>
  );
};
