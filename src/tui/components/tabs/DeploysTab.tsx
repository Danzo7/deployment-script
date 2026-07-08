import React from 'react';
import { Box, Text } from 'ink';
import type { AppSummary } from '../../../utils/dashboard-data.js';
import { DETAIL_W, fmtDate, truncate } from '../shared.js';
import type { DashboardAction } from '../../Dashboard.js';

interface DeploysTabProps {
  summary: AppSummary;
  deployCursor: number;
  onAction: (action: DashboardAction) => void;
  scrollOffset: number;
  maxVisible: number;
}

export function DeploysTab({ summary, deployCursor, scrollOffset, maxVisible }: DeploysTabProps): React.ReactElement {
  const { app } = summary;
  const builds = app.builds ?? [];

  if (builds.length === 0) {
    return <Box width={DETAIL_W}><Text dimColor>No builds found.</Text></Box>;
  }

  const activeBuildIndex = app.activeBuild ? builds.findIndex((b) => b === app.activeBuild) : -1;
  const activeCommit = app.lastDeployedCommit;
  const activeDeployDate = app.lastDeploy;
  const visibleBuilds = builds.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Box flexDirection="column" width={DETAIL_W} height={maxVisible}>
      {visibleBuilds.map((buildPath, visIdx) => {
        const idx = visIdx + scrollOffset;
        const isActive = idx === activeBuildIndex;
        const isCursor = idx === deployCursor;

        let shortHash: string, commitMsg: string, ageStr: string;
        if (isActive && activeCommit) {
          shortHash = activeCommit.hash.slice(0, 7);
          commitMsg = activeCommit.message;
          ageStr = fmtDate(activeDeployDate);
        } else {
          const base = buildPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? buildPath;
          shortHash = base.slice(0, 7);
          commitMsg = base;
          ageStr = '—';
        }

        const msgMaxLen = Math.max(10, DETAIL_W - (isCursor ? 2 : 0) - 30);

        return (
          <Box key={idx} flexDirection="row" width={DETAIL_W}>
            {isCursor ? <Text bold color="yellow">▌▌</Text> : <Text>{'  '}</Text>}
            {isActive ? <Text bold color="yellow">● </Text> : <Text dimColor>○ </Text>}
            <Text bold color="yellow">{shortHash}</Text>
            <Text> </Text>
            {isCursor
              ? <Text bold color="yellow">{truncate(commitMsg, msgMaxLen)}</Text>
              : isActive
                ? <Text>{truncate(commitMsg, msgMaxLen)}</Text>
                : <Text dimColor>{truncate(commitMsg, msgMaxLen)}</Text>}
            {isActive && <Text dimColor> [active]</Text>}
            <Text dimColor>  {ageStr}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
