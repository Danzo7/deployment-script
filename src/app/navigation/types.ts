export enum PageId {
  Repl = 'repl',
  Dashboard = 'dashboard',
  EnvEditor = 'env-editor',
  HeaderEditor = 'header-editor',
  RemoteServe = 'remote-serve',
  DbCompare = 'db-compare',
  DbMigrate = 'db-migrate',
  StreamingOutput = 'streaming-output',
}

export interface StreamingRunner {
  start(emit: (line: string, stream?: 'stdout' | 'stderr') => void): () => void;
}

export interface PageParamsMap {
  [PageId.Repl]: Record<string, never>;
  [PageId.Dashboard]: Record<string, never>;
  [PageId.EnvEditor]: { appName: string };
  [PageId.HeaderEditor]:
    | { target: 'domain'; domainName: string }
    | { target: 'route'; domainName: string; location: string };
  [PageId.RemoteServe]: { port: number; legacyMode?: boolean };
  [PageId.DbCompare]: { dbName: string };
  [PageId.DbMigrate]: {
      name: string;
      key: string;
      type?: 'generated' | 'manual' | 'data';
      initialText: string;
    };
  [PageId.StreamingOutput]: { title: string; run: StreamingRunner };
}

export interface PageEntry<P extends PageId = PageId> {
  id: P;
  params: PageParamsMap[P];
  fullScreen: boolean;
  onResult?: (result: unknown) => void;
}
