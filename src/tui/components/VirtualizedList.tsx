import React, { useState, ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';

export interface VirtualizedListProps<T> {
  items: readonly T[];
  maxVisible: number;
  /** Number of items visible in viewport */
  itemsPerPage?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number, isVisible: boolean) => ReactNode;
  /** Optional render for "more above" indicator */
  renderMoreAbove?: (count: number) => ReactNode;
  /** Optional render for "more below" indicator */
  renderMoreBelow?: (count: number) => ReactNode;
  /** Disable built-in scroll handling (for parent-controlled scroll) */
  disableScrollHandling?: boolean;
  /** External scroll offset (for parent-controlled scroll) */
  externalScrollOffset?: number;
  /** Callback when scroll changes (for parent-controlled scroll) */
  onScrollChange?: (offset: number) => void;
}

export function VirtualizedList<T>({
  items,
  maxVisible,
  itemsPerPage,
  renderItem,
  renderMoreAbove,
  renderMoreBelow,
  disableScrollHandling = false,
  externalScrollOffset,
  onScrollChange,
}: VirtualizedListProps<T>): React.ReactElement {
  const [internalScrollOffset, setInternalScrollOffset] = useState(0);
  
  const scrollOffset = externalScrollOffset ?? internalScrollOffset;
  const visibleCount = itemsPerPage ?? maxVisible;
  
  const visibleItems = items.slice(scrollOffset, scrollOffset + visibleCount);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + visibleCount < items.length;

  useInput((input, key) => {
    if (disableScrollHandling) return;

    let newOffset = scrollOffset;

    if (key.upArrow && scrollOffset > 0) {
      newOffset = scrollOffset - 1;
    } else if (key.downArrow && hasMoreBelow) {
      newOffset = scrollOffset + 1;
    } else if (key.pageUp) {
      newOffset = Math.max(0, scrollOffset - visibleCount);
    } else if (key.pageDown) {
      newOffset = Math.min(items.length - visibleCount, scrollOffset + visibleCount);
    }

    if (newOffset !== scrollOffset) {
      if (onScrollChange) {
        onScrollChange(newOffset);
      } else {
        setInternalScrollOffset(newOffset);
      }
    }
  });

  const defaultMoreAbove = (count: number) => (
    <Box justifyContent="center">
      <Text dimColor>↑ {count} more above</Text>
    </Box>
  );

  const defaultMoreBelow = (count: number) => (
    <Box justifyContent="center">
      <Text dimColor>↓ {count} more below</Text>
    </Box>
  );

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (renderMoreAbove || defaultMoreAbove)(scrollOffset)}
      {visibleItems.map((item, visIdx) => {
        const actualIndex = visIdx + scrollOffset;
        return (
          <React.Fragment key={actualIndex}>
            {renderItem(item, actualIndex, true)}
          </React.Fragment>
        );
      })}
      {hasMoreBelow && (renderMoreBelow || defaultMoreBelow)(items.length - (scrollOffset + visibleCount))}
    </Box>
  );
}
