import 'dotenv/config';
import { getDb, closeDb } from './connection.js';
import { SCHEMA } from './schema.js';

function main(): void {
  const db = getDb();
  db.exec(SCHEMA);
  console.log('DB initialized at', process.env.DB_PATH || 'data/nexus.db');
  closeDb();
}

main();
