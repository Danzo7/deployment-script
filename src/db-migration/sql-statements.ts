export interface SqlToken {
  value: string;
  kind: 'word' | 'quoted' | 'literal' | 'symbol';
  depth: number;
}

export interface SqlStatement {
  sql: string;
  tokens: SqlToken[];
}

/** PostgreSQL lexical boundaries; ordinary strings use standard_conforming_strings=on. */
export function parseSqlStatements(sql: string): SqlStatement[] {
  if (sql.includes('\0')) throw new Error('SQL cannot contain a null byte');
  const statements: SqlStatement[] = [];
  let tokens: SqlToken[] = [];
  let start = 0;
  let i = 0;
  let depth = 0;
  const atomicBlocks: string[] = [];
  const push = (value: string, kind: SqlToken['kind']) =>
    tokens.push({ value, kind, depth });
  const finish = (end: number) => {
    if (tokens.length)
      statements.push({ sql: sql.slice(start, end).trim(), tokens });
    tokens = [];
    start = end + 1;
  };

  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      let nesting = 1;
      i += 2;
      while (i < sql.length && nesting) {
        if (sql.startsWith('/*', i)) {
          nesting++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          nesting--;
          i += 2;
        } else i++;
      }
      if (nesting) throw new Error('Unterminated SQL block comment');
      continue;
    }
    const escapeString = (ch === 'E' || ch === 'e') && sql[i + 1] === "'";
    if (ch === "'" || ch === '"' || escapeString) {
      if (escapeString) i++;
      const quote = sql[i++];
      let closed = false;
      while (i < sql.length) {
        if (escapeString && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed)
        throw new Error('Unterminated SQL string or quoted identifier');
      push('', quote === '"' ? 'quoted' : 'literal');
      continue;
    }
    if (ch === '$') {
      const delimiter = sql
        .slice(i)
        .match(
          /^\$(?:[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff]*)?\$/
        )?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end === -1)
          throw new Error(`Unterminated SQL dollar quote ${delimiter}`);
        i = end + delimiter.length;
        push('', 'literal');
        continue;
      }
    }
    if (/[a-zA-Z_\u0080-\uffff]/.test(ch)) {
      const from = i++;
      while (i < sql.length && /[a-zA-Z0-9_$\u0080-\uffff]/.test(sql[i])) i++;
      const word = sql.slice(from, i).toUpperCase();
      const previous = tokens[tokens.length - 1];
      if (
        word === 'ATOMIC' &&
        previous?.kind === 'word' &&
        previous.value === 'BEGIN'
      )
        atomicBlocks.push('BEGIN');
      else if (word === 'CASE' && atomicBlocks.length)
        atomicBlocks.push('CASE');
      else if (word === 'END' && atomicBlocks.length) atomicBlocks.pop();
      push(word, 'word');
      continue;
    }
    if (ch === '(') {
      push(ch, 'symbol');
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      if (--depth < 0) throw new Error('Unbalanced SQL parentheses');
      push(ch, 'symbol');
      i++;
      continue;
    }
    if (ch === ';' && depth === 0 && atomicBlocks.length === 0) {
      finish(i++);
      continue;
    }
    push(ch, 'symbol');
    i++;
  }
  if (depth || atomicBlocks.length)
    throw new Error('Unterminated SQL parentheses or BEGIN ATOMIC body');
  finish(sql.length);
  return statements;
}

const dataCommands = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'TRUNCATE',
  'SELECT',
  'VALUES',
  'TABLE',
]);

function commandIndex(tokens: SqlToken[]): number {
  if (tokens[0]?.kind !== 'word' || tokens[0].value !== 'WITH') return 0;
  let i = 1;
  if (tokens[i]?.value === 'RECURSIVE') i++;
  const skipGroup = () => {
    const opening = tokens[i];
    if (opening?.kind !== 'symbol' || opening.value !== '(') return false;
    i++;
    while (
      i < tokens.length &&
      !(
        tokens[i].kind === 'symbol' &&
        tokens[i].value === ')' &&
        tokens[i].depth === opening.depth
      )
    )
      i++;
    return ++i <= tokens.length;
  };
  while (i < tokens.length) {
    if (!['word', 'quoted'].includes(tokens[i].kind)) return -1;
    i++; // CTE name, which may itself be an unreserved command word.
    if (tokens[i]?.value === '(' && !skipGroup()) return -1;
    if (tokens[i]?.kind !== 'word' || tokens[i++].value !== 'AS') return -1;
    if (tokens[i]?.value === 'NOT') {
      i++;
      if (tokens[i]?.value !== 'MATERIALIZED') return -1;
      i++;
    } else if (tokens[i]?.value === 'MATERIALIZED') i++;
    if (!skipGroup()) return -1;
    if (tokens[i]?.value !== ',') return i;
    i++;
  }
  return -1;
}

export function statementCommand(statement: SqlStatement): string {
  const command = statement.tokens[commandIndex(statement.tokens)];
  return command?.kind === 'word' ? command.value : '';
}

export function assertDataStatement(statement: SqlStatement): void {
  const command = statementCommand(statement);
  const topLevel = statement.tokens.filter(
    (token) => token.depth === 0 && token.kind === 'word'
  );
  if (
    !dataCommands.has(command) ||
    ((command === 'SELECT' || command === 'TABLE') &&
      topLevel.some((token) => token.value === 'INTO'))
  ) {
    throw new Error(
      'Only data statements are allowed in data migrations. Use manual or generated migrations for schema changes, procedural blocks, or administrative commands.'
    );
  }
}

export function assertManualStatement(statement: SqlStatement): void {
  const words = statement.tokens
    .filter((token) => token.depth === 0 && token.kind === 'word')
    .map((token) => token.value);
  if (
    ['CREATE', 'DROP', 'ALTER'].includes(words[0]) &&
    words[1] === 'DATABASE'
  ) {
    throw new Error(
      'Database-level operations are not allowed in manual migrations'
    );
  }
  if (
    [
      'BEGIN',
      'START',
      'END',
      'COMMIT',
      'ROLLBACK',
      'ABORT',
      'SAVEPOINT',
      'RELEASE',
      'PREPARE',
    ].includes(words[0])
  ) {
    throw new Error(
      'Migration transactions are managed by dm; remove explicit transaction control'
    );
  }
}

export function statementHazard(
  statement: SqlStatement
): 'none' | 'warning' | 'destructive' {
  const command = statementCommand(statement);
  if (command === 'DROP' || command === 'TRUNCATE') return 'destructive';
  if (command === 'ALTER') {
    return statement.tokens.some(
      (token) => token.kind === 'word' && token.value === 'DROP'
    )
      ? 'destructive'
      : 'warning';
  }
  let mutation = false;
  for (let i = 0; i < statement.tokens.length; i++) {
    const token = statement.tokens[i];
    if (
      token.kind !== 'word' ||
      !['UPDATE', 'DELETE', 'MERGE'].includes(token.value)
    )
      continue;
    mutation = true;
    let hasWhere = false;
    for (let j = i + 1; j < statement.tokens.length; j++) {
      const next = statement.tokens[j];
      if (next.depth < token.depth) break;
      if (
        next.depth === token.depth &&
        next.kind === 'word' &&
        next.value === 'WHERE'
      )
        hasWhere = true;
    }
    if (!hasWhere) return 'destructive';
  }
  if (mutation || ['CREATE', 'DO', 'CALL', 'SELECT'].includes(command))
    return 'warning';
  return 'none';
}

export function isTransactional(statement: SqlStatement): boolean {
  const command = statementCommand(statement);
  return (
    !(
      ['CREATE', 'DROP', 'REINDEX'].includes(command) &&
      statement.tokens.some(
        (token) =>
          token.depth === 0 &&
          token.kind === 'word' &&
          token.value === 'CONCURRENTLY'
      )
    ) && command !== 'VACUUM'
  );
}
