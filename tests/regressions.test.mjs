import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { PassThrough, Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logger = {
  Logger: new Proxy(
    {},
    { get: (_, key) => (key === 'highlight' ? (value) => value : () => {}) }
  ),
};

// Load the actual TypeScript with explicit boundary mocks. Never bootstrap the CLI,
// connect to PM2/databases, or read the installation's deployment configuration.
function load(
  relative,
  mocks = {},
  transform = (value) => value,
  globals = {}
) {
  const file = path.join(root, relative);
  const source = transform(fs.readFileSync(file, 'utf8'))
    .replace(/^#![^\n]*\n/, '')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dependencies = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('.'))
      throw new Error(`Unmocked application dependency: ${id}`);
    return require(id);
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), js)(
    dependencies,
    module,
    module.exports,
    ...Object.values(globals)
  );
  return module.exports;
}

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-regression-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dm-regression-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

const managed = load('src/utils/managed-path.ts');

test('resource names and managed paths reject traversal, root deletion, and sibling prefixes', (t) => {
  const directory = temporary(t);
  for (const name of [
    '.',
    '..',
    '../victim',
    'a/b',
    'a\\b',
    'NUL',
    'con.txt',
    'name.',
    '.detect-staging',
  ]) {
    assert.throws(() => managed.validateResourceName(name));
  }
  managed.validateResourceName('app-v2.example_1');
  const base = path.join(directory, 'apps');
  managed.assertManagedPath(path.join(base, 'demo'), base);
  assert.throws(() => managed.assertManagedPath(base, base));
  assert.throws(() =>
    managed.assertManagedPath(path.join(directory, 'apps-other', 'demo'), base)
  );
  assert.throws(() =>
    managed.assertSeparatePaths(base, path.join(base, 'storages'))
  );
  managed.assertSeparatePaths(
    path.join(base, 'demo'),
    path.join(base, 'storages')
  );
});

test('managed paths reject directory junction escapes while storage links retain valid targets', (t) => {
  const directory = temporary(t);
  const base = path.join(directory, 'build');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(base);
  fs.mkdirSync(outside);
  fs.symlinkSync(
    outside,
    path.join(base, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(() =>
    managed.assertManagedPath(path.join(base, 'escape', 'victim'), base)
  );
  assert.throws(() => managed.storageLinkPath(base, 'escape/child'));
  assert.throws(() => managed.storageLinkPath(base, '../victim'));
  assert.equal(
    managed.storageLinkPath(base, 'escape'),
    path.join(base, 'escape')
  );
});

test('storage traversal is rejected before filesystem or database writes', async (t) => {
  const directory = temporary(t);
  let writes = 0;
  const storage = load('src/commands/storage.ts', {
    fs: {
      mkdirSync: () => {
        writes++;
      },
    },
    'fs-extra': {
      remove: () => {
        writes++;
      },
    },
    '../utils/date-helper.js': {},
    '../constants.js': { STORAGE_DIR: path.join(directory, 'storages') },
    '../db/repos.js': {
      StorageRepo: {
        findByName: () => {
          writes++;
        },
      },
    },
    '../utils/logger.js': logger,
    '../utils/os-helper.js': {},
    '../utils/user-context.js': {},
    '../utils/managed-path.js': managed,
  });
  await assert.rejects(storage.storageNew('../victim'));
  await assert.rejects(storage.storageNew('valid', '../victim'));
  await assert.rejects(storage.storageRm('..'));
  assert.equal(writes, 0);
});

test('application deletion rejects an unsafe existing record before touching PM2', async (t) => {
  const directory = temporary(t);
  let stopped = false;
  const deletion = load('src/commands/delete.ts', {
    'fs-extra/esm': { removeSync: () => assert.fail('unsafe deletion') },
    '../db/repos.js': {
      AppRepo: {
        findByName: async () => ({
          name: 'demo',
          appDir: directory,
          projectType: 'nextjs',
        }),
      },
    },
    '../utils/logger.js': logger,
    '../utils/pm2-helper.js': {
      getAppStatus: () => {
        stopped = true;
      },
    },
    '../utils/managed-path.js': managed,
    '../app-types/index.js': {
      getHandler: () => ({ getAppsDir: () => path.join(directory, 'apps') }),
    },
    '../constants.js': { STORAGE_DIR: path.join(directory, 'storages') },
  });
  await assert.rejects(deletion.Delete({ name: 'demo' }));
  assert.equal(stopped, false);
});

test('locks use exclusive creation and do not release another owner or legacy lock', (t) => {
  const directory = temporary(t);
  const locks = load('src/utils/lock-utils.ts', {
    '../constants.js': { LOCK_DIR: directory },
    './logger.js': logger,
    './managed-path.js': managed,
  });
  locks.acquireLock('demo');
  assert.throws(() => locks.acquireLock('demo'), /already running/);
  const file = path.join(directory, 'demo.lock');
  assert.equal(parseInt(fs.readFileSync(file, 'utf8'), 10), process.pid);
  fs.writeFileSync(file, '999\nreplacement-owner');
  locks.releaseLock('demo');
  assert.equal(fs.readFileSync(file, 'utf8'), '999\nreplacement-owner');
  fs.writeFileSync(path.join(directory, 'legacy.lock'), '123');
  locks.releaseLock('legacy');
  assert.equal(
    fs.readFileSync(path.join(directory, 'legacy.lock'), 'utf8'),
    '123'
  );
  locks.acquireLock('normal');
  locks.releaseLock('normal');
  assert.equal(fs.existsSync(path.join(directory, 'normal.lock')), false);
  assert.throws(() => locks.acquireLock('../outside'));
});

test('resolved CLI commands enforce parent and leaf remote restrictions despite leading options', async (t) => {
  const previous = process.env.DM_REMOTE_USER;
  t.after(() => {
    if (previous === undefined) delete process.env.DM_REMOTE_USER;
    else process.env.DM_REMOTE_USER = previous;
  });
  process.env.DM_REMOTE_USER = 'regression-user';
  const calls = [];
  const leaf = (name, cliOnly = false) => ({
    kind: 'leaf',
    usage: name,
    describe: '',
    cliOnly,
    handler: async () => {
      calls.push(name);
    },
  });
  const registry = {
    COMMANDS: {
      remote: {
        kind: 'group',
        describe: '',
        cliOnly: true,
        subcommands: { 'key-list': leaf('key-list') },
      },
      db: {
        kind: 'group',
        describe: '',
        subcommands: { local: leaf('local', true), list: leaf('list') },
      },
    },
    isGroup: (node) => node.kind === 'group',
  };
  const guard = load('src/utils/remote-command-guard.ts', {
    '../command-registry.js': registry,
  });
  const cli = load(
    'src/cli.ts',
    {
      './utils/logger.js': logger,
      './utils/lock-utils.js': {},
      './commands/migrate-db.js': {},
      './app/root.js': {},
      './app/navigation/types.js': {},
      './command-registry.js': registry,
      './utils/remote-command-guard.js': guard,
    },
    (source) =>
      source.slice(0, source.indexOf('await ensureAppDirectories();')) +
      '\nexport { registerNode };',
    {
      process: {
        ...process,
        env: process.env,
        on: () => {},
        exit: (code) => {
          throw new Error(`CLI exit ${code}`);
        },
      },
    }
  );
  const yargs = require('yargs/yargs');
  async function execute(args) {
    let parser = yargs(args).exitProcess(false);
    for (const [key, node] of Object.entries(registry.COMMANDS))
      parser = cli.registerNode(parser, key, node);
    return parser
      .demandCommand(1)
      .strictCommands()
      .fail((message, error) => {
        throw error || new Error(message);
      })
      .parseAsync();
  }
  await assert.rejects(
    execute(['--unused=true', 'remote', 'key-list']),
    /CLI exit 1/
  );
  await assert.rejects(execute(['db', 'local']), /CLI exit 1/);
  await execute(['db', 'list']);
  assert.deepEqual(calls, ['list']);
  delete process.env.DM_REMOTE_USER;
  await execute(['remote', 'key-list']);
  assert.deepEqual(calls, ['list', 'key-list']);
});

test('NestJS edits and synchronizes .env while Next.js retains .env.local and literal dollar values', async (t) => {
  const directory = temporary(t);
  const envDirectory = path.join(directory, 'env');
  const release = path.join(directory, 'release');
  fs.mkdirSync(envDirectory);
  fs.mkdirSync(release);
  const helper = load('src/utils/env-heper.ts', {
    './file-utils.js': {
      calculateFileHash: (file) => fs.readFileSync(file, 'utf8'),
    },
    './logger.js': logger,
  });
  helper.setEnv(envDirectory, 'TOKEN', 'old', '.env');
  helper.setEnv(envDirectory, 'TOKEN', '$&-$1-$$', '.env');
  assert.equal(await helper.checkEnv(release, envDirectory, '.env'), true);
  assert.match(
    fs.readFileSync(path.join(release, '.env'), 'utf8'),
    /TOKEN=\$&-\$1-\$\$/
  );
  assert.equal(await helper.checkEnv(release, envDirectory, '.env'), false);
  helper.setEnv(envDirectory, 'NEXT_PUBLIC_API', 'next');
  assert.equal(
    await helper.checkEnv(release, envDirectory, '.env.local'),
    true
  );
  assert.match(
    fs.readFileSync(path.join(release, '.env.local'), 'utf8'),
    /NEXT_PUBLIC_API=next/
  );
  assert.throws(() => helper.setEnv(envDirectory, 'BAD.*', 'value'));
  const parser = load('src/utils/env-file-parser.ts');
  assert.equal(parser.parseEnvFile(envDirectory, '.env')[0].key, 'TOKEN');
  parser.writeEnvFile(
    envDirectory,
    [{ key: 'TOKEN', value: 'changed' }],
    '.env'
  );
  assert.equal(parser.parseEnvFile(envDirectory)[0].key, 'NEXT_PUBLIC_API');
});

test('static sites accept committed dist/build output and still reject missing output', async (t) => {
  const directory = temporary(t);
  const { staticHandler } = load('src/app-types/static.ts', {
    'fs-extra': require('fs-extra'),
    '../utils/logger.js': logger,
    '../utils/file-utils.js': { applyStorageSymlinks: () => {} },
    '../constants.js': {},
    './registry.js': { registerHandler: () => {} },
  });
  fs.writeFileSync(path.join(directory, 'package.json'), '{}');
  await assert.rejects(
    staticHandler.prepareRelease(directory, {}),
    /pre-built/
  );
  for (const folder of ['dist', 'build']) {
    const appDirectory = path.join(directory, folder + '-app');
    const release = path.join(appDirectory, 'release');
    fs.mkdirSync(path.join(release, folder), { recursive: true });
    if (folder === 'build') fs.mkdirSync(path.join(release, 'dist'));
    fs.writeFileSync(path.join(release, 'package.json'), '{}');
    fs.writeFileSync(
      path.join(release, folder, 'index.html'),
      '<h1>built</h1>'
    );
    await staticHandler.prepareRelease(release, {});
    const build = staticHandler.createBuildDir({ appDir: appDirectory });
    assert.equal(
      fs.readFileSync(path.join(build, 'index.html'), 'utf8'),
      '<h1>built</h1>'
    );
  }
  const html = path.join(directory, 'html');
  fs.mkdirSync(html);
  fs.writeFileSync(path.join(html, 'index.html'), '<h1>plain</h1>');
  await staticHandler.prepareRelease(html, {});
});

const executor = load('src/db-migration/sql-executor.ts');
const plan = (steps) => ({
  steps: steps.map((step, index) => ({ index, transactional: true, ...step })),
  stats: { totalSteps: steps.length },
});

test('transaction rollback never reports undone steps as successful and skips subsequent groups', async () => {
  const states = new Map();
  const queries = [];
  const result = await executor.executePlan(
    {
      query: async (sql) => {
        queries.push(sql);
        if (sql === 'FAIL') throw new Error('query failure');
      },
    },
    plan([
      { sql: 'INSERT' },
      { sql: 'FAIL' },
      { sql: 'LATER', transactional: false },
    ]),
    async (index, status, error) => {
      states.set(index, { status, error });
    }
  );
  assert.deepEqual(result, { succeededSteps: [], failedStep: 1 });
  assert.deepEqual(queries, [
    'BEGIN',
    'SET standard_conforming_strings = on',
    'INSERT',
    'SET standard_conforming_strings = on',
    'FAIL',
    'ROLLBACK',
  ]);
  assert.equal(states.get(0).status, 'skipped');
  assert.match(states.get(0).error, /rolled back/);
  assert.equal(states.get(1).status, 'failed');
  assert.equal(states.get(2).status, 'skipped');
});

test('success is published after commit and earlier committed groups survive a later commit failure', async () => {
  const events = [];
  let commits = 0;
  const result = await executor.executePlan(
    {
      query: async (sql) => {
        events.push(sql);
        if (sql === 'COMMIT' && ++commits === 2)
          throw new Error('commit failure');
      },
    },
    plan([
      { sql: 'FIRST' },
      { sql: 'CONCURRENT', transactional: false },
      { sql: 'SECOND' },
    ]),
    async (index, status) => {
      events.push(`${index}:${status}`);
    }
  );
  assert.deepEqual(result, { succeededSteps: [0, 1], failedStep: 2 });
  assert.ok(events.indexOf('0:succeeded') > events.indexOf('COMMIT'));
  assert.equal(events.includes('2:succeeded'), false);
});

test('PM2 receives caller log paths while retaining the existing delete/start sequence', async () => {
  const events = [];
  const config = { name: 'demo', script: 'demo.js', env: { PORT: '3000' } };
  const helper = load('src/utils/pm2-helper.ts', {
    pm2: {
      connect: (callback) => callback(),
      disconnect: () => {},
      delete: (name, callback) => {
        events.push(['delete', name]);
        callback();
      },
      start: (options, callback) => {
        events.push(['start', options]);
        callback();
      },
    },
    './logger.js': logger,
    '../app-types/index.js': {
      getHandler: () => ({
        buildPm2Config: () => config,
        getExecMode: () => 'fork',
      }),
    },
  });
  await helper.runApp('/build', {
    name: 'demo',
    projectType: 'static',
    status: 'online',
    port: 3000,
    config: {},
    output: 'out.log',
    error: 'err.log',
  });
  assert.deepEqual(events[0], ['delete', 'demo']);
  assert.deepEqual(events[1], [
    'start',
    { ...config, output: 'out.log', error: 'err.log', exec_mode: 'fork' },
  ]);
});

test('SSH enforces both session caps on preaccepted connections and isolates same-IP cleanup', async () => {
  let server;
  const children = [];
  class Server extends EventEmitter {
    constructor(_, handler) {
      super();
      server = this;
      this.acceptClient = handler;
    }
    listen(_port, _address, callback) {
      callback();
    }
    address() {
      return { port: 2022 };
    }
  }
  class Ipc extends EventEmitter {
    updateStatus() {}
    async start() {}
    broadcastEvent() {}
  }
  const helper = load(
    'src/utils/ssh-server.ts',
    {
      ssh2: { Server },
      module: {
        createRequire: () => () => ({
          spawn: () => {
            const child = {
              kills: 0,
              onData() {},
              onExit(callback) {
                this.exitCallback = callback;
              },
              kill() {
                this.kills++;
                this.exitCallback?.({ exitCode: 0 });
              },
            };
            children.push(child);
            return child;
          },
        }),
      },
      './logger.js': logger,
      './ssh-host-key.js': {
        loadOrCreateHostKey: () => 'test',
        fingerprintHostKey: () => 'test',
      },
      './remote-auth.js': {
        isLockedOut: () => 0,
        auditLog: () => {},
        clearAttempts() {},
        findAuthorizedKeyByPublicSSH: (key) => ({
          comment: key.toString(),
          fingerprint: key.toString(),
          parsed: { verify: () => true },
        }),
      },
      './remote-command-guard.js': { isCommandBlockedForRemote: () => false },
      './remote-ipc-server.js': { RemoteIpcServer: Ipc },
      '../constants.js': {},
    },
    (value) => value,
    {
      process: {
        env: { REMOTE_MAX_SESSIONS: '2', REMOTE_MAX_SESSIONS_PER_KEY: '1' },
        execPath: 'node',
        on() {},
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout() {},
    }
  );
  // startRemoteServer intentionally remains pending while the fake server runs.
  void helper.startRemoteServer(2022);
  await new Promise((resolve) => setImmediate(resolve));
  const closed = [];
  helper.serverEvents.on('session-close', (id) => closed.push(id));
  function connect(identity) {
    const client = new EventEmitter();
    server.acceptClient(client, { ip: '192.0.2.1' });
    client.emit('authentication', {
      method: 'publickey',
      key: { data: Buffer.from(identity) },
      signature: Buffer.from('test'),
      blob: Buffer.from('test'),
      accept() {},
      reject() {
        assert.fail('test key rejected');
      },
    });
    client.emit('ready');
    return client;
  }
  function openSession(client, kind) {
    const session = new EventEmitter();
    client.emit('session', () => session);
    const channel = Object.assign(new EventEmitter(), {
      write() {},
      end() {},
      exit(code) {
        this.exitCode = code;
      },
      stderr: { write() {} },
    });
    session.emit(
      kind,
      () => channel,
      () => {},
      { command: 'list' }
    );
    return channel;
  }
  const first = connect('first-key');
  const second = connect('second-key');
  const waiting = connect('waiting-key');
  openSession(first, 'shell');
  assert.equal(
    openSession(first, 'exec').exitCode,
    1,
    'per-key cap applies before the global cap is full'
  );
  openSession(second, 'exec');
  assert.equal(helper.getActiveSessions().length, 2);
  assert.equal(openSession(waiting, 'shell').exitCode, 1);
  assert.equal(openSession(waiting, 'exec').exitCode, 1);
  assert.equal(children.length, 2, 'rejected sessions must not spawn a PTY');
  first.emit('error', new Error('network failure'));
  assert.equal(children[0].kills, 1);
  assert.equal(children[1].kills, 0);
  assert.equal(helper.getActiveSessions().length, 1);
  assert.equal(
    closed.length,
    1,
    'PTY exit must not unregister the same session twice'
  );
  assert.equal(openSession(waiting, 'shell').exitCode, undefined);
  assert.equal(children.length, 3, 'a released slot can be reused');
  second.emit('close');
  assert.equal(children[1].kills, 1);
  waiting.emit('close');
  assert.equal(helper.getActiveSessions().length, 0);
  assert.equal(closed.length, 3);
});

const sqlStatements = load('src/db-migration/sql-statements.ts');
const manualPlan = load('src/db-migration/manual-plan.ts', {
  './sql-statements.js': sqlStatements,
});
const dataPlan = load('src/db-migration/data-plan.ts', {
  './sql-statements.js': sqlStatements,
});

test('SQL splitting respects strings, escaped quotes, quoted identifiers, comments and dollar bodies', () => {
  const source = String.raw`
    -- a comment with ;
    INSERT INTO "semi;colon" VALUES ('a;b', 'it''s;fine', E'escaped\';value');
    /* outer ; /* nested ; */ still a comment */
    CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN PERFORM ';'; PERFORM $$nested;string$$; END;
    $fn$;
    INSERT INTO t VALUES ($$last;value$$);
  `;
  const plan = manualPlan.buildManualPlan(source);
  assert.equal(plan.steps.length, 3);
  assert.match(plan.steps[0].sql, /a;b/);
  assert.ok(plan.steps[1].sql.includes("PERFORM ';'"));
  assert.match(plan.steps[2].sql, /last;value/);
  assert.equal(
    manualPlan.buildManualPlan('-- only; comment\n/* nested /* ; */ comment */')
      .steps.length,
    0
  );
  assert.equal(
    manualPlan.buildManualPlan('SELECT $1, name$tag$ FROM t; SELECT 2').steps
      .length,
    2
  );
  for (const broken of [
    "SELECT 'unterminated",
    'SELECT "unterminated',
    'SELECT $tag$unterminated',
    '/* unclosed',
    'SELECT (1',
  ]) {
    assert.throws(() => manualPlan.buildManualPlan(broken), /Unterminated/);
  }
});

test('SQL BEGIN ATOMIC routine bodies and rule action groups remain single statements', () => {
  const plan = manualPlan.buildManualPlan(`
    CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC
      SELECT CASE WHEN true THEN 1 ELSE 2 END;
      SELECT 3;
    END;
    SELECT 4;
  `);
  assert.equal(plan.steps.length, 2);
  assert.equal(
    manualPlan.buildManualPlan(
      'CREATE RULE r AS ON INSERT TO t DO (INSERT INTO a VALUES(1); INSERT INTO b VALUES(2)); SELECT 3;'
    ).steps.length,
    2
  );
});

test('data restrictions reject obscured DDL, administrative wrappers, procedural code and SELECT INTO', () => {
  for (const sql of [
    'DROP\nTABLE customers;',
    '/* leading */ ALTER /* split */ TABLE t ADD COLUMN n int;',
    'CREATE\tUNLOGGED TABLE t (n int);',
    'CREATE\nTEMP TABLE t(n int);',
    "DO $$ BEGIN EXECUTE 'DROP TABLE t'; END $$;",
    'CALL change_schema();',
    'EXPLAIN ANALYZE CREATE TABLE t(n int);',
    'PREPARE x AS SELECT 1;',
    'SET ROLE admin;',
    'SELECT * INTO new_table FROM t;',
    'WITH merge AS (SELECT 1) SELECT * INTO new_table FROM merge;',
    'INSERT INTO t VALUES(1); DROP/* split */TABLE t;',
  ])
    assert.throws(() => dataPlan.buildDataPlan(sql), /Only data statements/);

  for (const sql of [
    "INSERT INTO t VALUES ('DROP TABLE t; CREATE DATABASE x');",
    '/* CREATE TABLE ignored */ UPDATE t SET n=1 WHERE id=2;',
    'WITH merge(n) AS NOT MATERIALIZED (SELECT 1) INSERT INTO t SELECT n FROM merge;',
    'WITH x AS (DELETE FROM t WHERE id=1 RETURNING *) INSERT INTO archive SELECT * FROM x;',
  ])
    assert.equal(dataPlan.buildDataPlan(sql).steps.length, 1);

  assert.equal(
    dataPlan.buildDataPlan("UPDATE t SET note='WHERE';").steps[0].hazardLevel,
    'destructive'
  );
  assert.equal(
    dataPlan.buildDataPlan('UPDATE t SET n=(SELECT n FROM x WHERE id=1);')
      .steps[0].hazardLevel,
    'destructive'
  );
  assert.equal(
    dataPlan.buildDataPlan('DELETE FROM t /* WHERE id=1 */;').steps[0]
      .hazardLevel,
    'destructive'
  );
  assert.throws(
    () => manualPlan.buildManualPlan('DROP /* comment */ DATABASE prod;'),
    /Database-level/
  );
  assert.throws(
    () => manualPlan.buildManualPlan('COMMIT;'),
    /transactions are managed/
  );
  assert.equal(
    manualPlan.buildManualPlan('DROP INDEX /* comment */ CONCURRENTLY idx;')
      .steps[0].transactional,
    false
  );
});

const nginxValidation = load('src/utils/nginx-validation.ts');
const headerMerge = load('src/utils/header-merge.ts', {
  './nginx-validation.js': nginxValidation,
});

test('Nginx header validation and quoting contain directive syntax without damaging normal CSP values', () => {
  const { quoteNginxArgument } = nginxValidation;
  const csp = "default-src 'self'; img-src https: data:;";
  assert.equal(quoteNginxArgument(csp), '"' + csp + '"');
  assert.equal(
    quoteNginxArgument('a"; return 200 "b'),
    '"a\\"; return 200 \\"b"'
  );
  assert.equal(
    quoteNginxArgument('C:\\certs\\key.pem'),
    '"C:\\\\certs\\\\key.pem"'
  );
  for (const value of [
    'value\nreturn 200;',
    'value\r\nX-Evil: yes',
    'value\0',
  ]) {
    assert.throws(() => headerMerge.validateHeaderValue(value));
  }
  for (const key of [
    'X-Test;',
    'X-Test"',
    'X-Test\\',
    'X-Test{',
    'X-Test:',
    'X Test',
  ]) {
    assert.throws(() => headerMerge.validateHeaderKey(key));
  }
  headerMerge.validateHeaderKey('Content-Security-Policy');
  headerMerge.validateHeaderValue(csp);
});

test('Nginx compiler validates existing DB records and quotes certificate paths and header arguments', () => {
  const compiler = load('src/utils/nginx-compiler.ts', {
    'node:fs': { existsSync: () => true },
    '../constants.js': { PROXY_TARGET_HOST: 'localhost' },
    './header-merge.js': headerMerge,
    './route-validation.js': load('src/utils/route-validation.ts'),
    './nginx-validation.js': nginxValidation,
    '../db/repos.js': {},
    '../app-types/index.js': {
      getHandler: () => ({ getNginxLocationDirectives: () => [] }),
    },
  });
  const domain = {
    name: 'example.com',
    ssl: {
      mode: 'custom',
      certPath: '/certs/my cert.pem',
      keyPath: '/certs/my key.pem',
    },
    headers: { 'X-Test': 'a"; return 200 "b' },
  };
  const route = {
    path: 'api/v1',
    headers: {},
    app: { port: 3000, projectType: 'static' },
  };
  const config = compiler.compileDomainConfig(domain, [route], []);
  assert.ok(config.includes('ssl_certificate "/certs/my cert.pem";'));
  assert.ok(
    config.includes('add_header "X-Test" "a\\"; return 200 \\"b" always;')
  );
  assert.throws(() =>
    compiler.compileDomainConfig(
      { ...domain, headers: { 'X-Test;': 'bad' } },
      [route],
      []
    )
  );
  assert.throws(() =>
    compiler.compileDomainConfig(
      { ...domain, headers: { 'X-Test': 'bad\nvalue' } },
      [route],
      []
    )
  );
  assert.throws(() =>
    compiler.compileDomainConfig(
      domain,
      [{ ...route, path: 'api/ { return 200; } #' }],
      []
    )
  );
  assert.throws(() =>
    compiler.compileDomainConfig(
      { ...domain, name: 'example.com;return' },
      [route],
      []
    )
  );
});

test('REPL output continues past repeated caps using the actual Ink renderer', async (t) => {
  const React = await import('react');
  const { render, Static, Text } = await import('ink');
  const { useStaticOutput } = load('src/app/output/use-static-output.ts');
  let api;
  let text = '';
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      text += chunk.toString();
      done();
    },
  });
  Object.assign(stdout, { columns: 80, rows: 24, isTTY: true });
  const stdin = new PassThrough();
  Object.assign(stdin, { isTTY: true, setRawMode() {} });
  function Harness() {
    api = useStaticOutput(3);
    return React.createElement(
      Static,
      { key: api.staticKey, items: api.entries },
      (entry) => React.createElement(Text, { key: entry.id }, entry.text)
    );
  }
  const instance = render(React.createElement(Harness), {
    stdout,
    stderr: stdout,
    stdin,
    patchConsole: false,
    exitOnCtrlC: false,
    interactive: true,
    maxFps: 1000,
  });
  t.after(() => {
    instance.unmount();
    stdin.destroy();
  });
  async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await instance.waitUntilRenderFlush();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await flush();
  for (let batch = 0; batch < 8; batch++) {
    for (let n = 0; n < 5; n++) api.appendEntry(`[entry_${batch * 5 + n}]`);
    await flush();
  }
  for (let n = 0; n < 40; n++)
    assert.equal(
      text.split(`[entry_${n}]`).length - 1,
      1,
      `entry ${n} must print exactly once`
    );
  assert.ok(api.entries.length < 3);
  api.clearOutput();
  await flush();
  api.appendEntry('[after_clear]');
  await flush();
  assert.equal(text.split('[after_clear]').length - 1, 1);
});

test('certificate rewriting never rewrites directive-looking text inside a header value', () => {
  const { NginxPusher } = load('src/utils/nginx-pusher.ts', {
    '../db/repos.js': {},
    '../constants.js': { DOMAINS_DIR: '/unused-test-domain-directory' },
    './nginx-compiler.js': {},
    './nginx-validation.js': nginxValidation,
  });
  const pusher = new NginxPusher({}, 'example.com');
  const header =
    '    add_header "X-Test" "ssl_certificate /fake/path; ssl_certificate_key /fake/key;" always;';
  pusher.compiledConfig = [
    '    ssl_certificate "/old/path;with-semicolon.pem";',
    '    ssl_certificate_key "/old/key.pem";',
    header,
  ].join('\n');
  pusher.rewriteCertPaths('/new/cert file.pem', '/new/key file.pem');
  assert.deepEqual(pusher.compiledConfig.split('\n'), [
    '    ssl_certificate "/new/cert file.pem";',
    '    ssl_certificate_key "/new/key file.pem";',
    header,
  ]);
});

test('REPL retirement preserves arrivals since the printed frame and ignores stale retirement', () => {
  const { retirePrintedOutput } = load('src/app/output/use-static-output.ts');
  const first = { id: '0', text: 'printed' };
  const later = { id: '1', text: 'arrived later' };
  const printed = { entries: [first], generation: 0 };
  const current = { entries: [first, later], generation: 0 };
  const retired = retirePrintedOutput(current, printed);
  assert.deepEqual(retired, { entries: [later], generation: 1 });
  assert.equal(retirePrintedOutput(retired, printed), retired);
  assert.equal(
    retirePrintedOutput({ entries: [], generation: 2 }, printed).generation,
    2
  );
});
