import pg from 'pg';
import { DatabaseRepo } from '../db/repos.js';

export class Connector {
  private client: pg.Client | null = null;
  private dbName: string;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  async connect(): Promise<void> {
    const details = await DatabaseRepo.getConnectionDetails(this.dbName);
    
    // Build SSL configuration
    const sslConfig =
      details.sslMode === 'disable'
        ? false
        : details.sslMode === 'require'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true };

    this.client = new pg.Client({
      host: details.host,
      port: details.port,
      database: details.database,
      user: details.username,
      password: details.password,
      ssl: sslConfig,
    });

    await this.client.connect();

    // Optionally SET ROLE if ownerRole is present
    if (details.ownerRole) {
      await this.client.query(`SET ROLE ${details.ownerRole}`);
    }
  }

  async query(sql: string): Promise<pg.QueryResult> {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    return await this.client.query(sql);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}

export async function testConnection(
  dbName: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const connector = new Connector(dbName);
  try {
    await connector.connect();
    await connector.query('SELECT 1');
    await connector.close();
    return { ok: true };
  } catch (err: any) {
    try {
      await connector.close();
    } catch {}
    return { ok: false, error: err.message || String(err) };
  }
}
