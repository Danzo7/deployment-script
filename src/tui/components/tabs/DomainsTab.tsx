import React from 'react';
import { Box, Text } from 'ink';
import type { AppDetail, DomainInfo } from '../../../utils/dashboard-data.js';
import { DETAIL_W, fmtDate, truncate } from '../shared.js';

interface DomainsTabProps {
  detail: AppDetail | null;
  maxVisible: number;
}

function certColor(cert: DomainInfo['cert']): string {
  if (cert.mode === 'none' || cert.isExpired || cert.error) return 'red';
  if (cert.daysRemaining !== undefined) {
    if (cert.daysRemaining < 7) return 'red';
    if (cert.daysRemaining < 30) return 'yellow';
    return 'green';
  }
  return cert.mode === 'none' ? 'red' : 'green';
}

function certLabel(cert: DomainInfo['cert']): string {
  if (cert.mode === 'none') return '[no cert]';
  if (cert.error) return '[cert error]';
  if (cert.isExpired) return '[expired]';
  if (cert.daysRemaining !== undefined) return `[cert ${cert.daysRemaining}d]`;
  if (cert.mode === 'letsencrypt') return "[let's encrypt]";
  return '[cert]';
}

export function DomainsTab({ detail, maxVisible }: DomainsTabProps): React.ReactElement {
  if (detail === null) {
    return <Box width={DETAIL_W}><Text dimColor>loading…</Text></Box>;
  }

  const { domains } = detail;

  if (domains.length === 0) {
    return <Box width={DETAIL_W}><Text dimColor>No domains configured for this app.</Text></Box>;
  }

  return (
    <Box flexDirection="column" width={DETAIL_W} height={maxVisible} overflow="hidden">
      {domains.map((domain, idx) => (
        <Box key={domain.name} flexDirection="column" width={DETAIL_W} marginTop={idx === 0 ? 0 : 1}>
          <Box flexDirection="row" gap={1} width={DETAIL_W}>
            <Text bold>{truncate(domain.name, DETAIL_W - 20)}</Text>
            <Text color={certColor(domain.cert)}>{certLabel(domain.cert)}</Text>
            {domain.isStale && <Text color="yellow">[config stale]</Text>}
          </Box>
          {domain.cert.issuer && (
            <Box marginLeft={2}><Text dimColor>issuer: {truncate(domain.cert.issuer, DETAIL_W - 12)}</Text></Box>
          )}
          <Box marginLeft={2}>
            <Text dimColor>pushed: {fmtDate(domain.lastPushedAt)}</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            {domain.routes.length === 0
              ? <Text dimColor>no routes</Text>
              : domain.routes.map((r, ri) => (
                  <Box key={ri} flexDirection="row">
                    <Text dimColor>  {r.path}</Text>
                    <Text dimColor> → </Text>
                    <Text>{r.appName}</Text>
                  </Box>
                ))}
          </Box>
          {idx < domains.length - 1 && <Text dimColor>{'─'.repeat(Math.min(DETAIL_W, 40))}</Text>}
        </Box>
      ))}
    </Box>
  );
}
