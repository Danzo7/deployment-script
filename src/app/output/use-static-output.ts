import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutputEntry } from './static-output-list.js';

export interface StaticOutputState {
  entries: OutputEntry[];
  generation: number;
}

/** Retire only items from an already committed render, preserving later arrivals. */
export function retirePrintedOutput(
  state: StaticOutputState,
  printed: StaticOutputState
): StaticOutputState {
  if (state.generation !== printed.generation) return state;
  return {
    entries: state.entries.slice(printed.entries.length),
    generation: state.generation + 1,
  };
}

export function useStaticOutput(maxEntries: number) {
  const [output, setOutput] = useState<StaticOutputState>({
    entries: [],
    generation: 0,
  });
  const nextId = useRef(0);
  const appendEntry = useCallback((text: string) => {
    const entry = { id: String(nextId.current++), text };
    setOutput((previous) => ({
      ...previous,
      entries: [...previous.entries, entry],
    }));
  }, []);
  const clearOutput = useCallback(() => {
    setOutput((previous) => ({
      entries: [],
      generation: previous.generation + 1,
    }));
  }, []);

  // Ink Static indexes an append-only array. After it has printed a batch,
  // remount an empty/new batch instead of sliding the array under that index.
  useEffect(() => {
    if (output.entries.length >= maxEntries) {
      setOutput((previous) => retirePrintedOutput(previous, output));
    }
  }, [output, maxEntries]);

  return {
    entries: output.entries,
    staticKey: output.generation,
    appendEntry,
    clearOutput,
  };
}
