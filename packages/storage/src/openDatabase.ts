import { existsSync } from "node:fs";
import Database from "better-sqlite3-multiple-ciphers";

export interface OpenDatabaseOptions {
  dbPath: string;
  /** 64-char hex key (32 bytes). When set, opens or creates an encrypted database. */
  encryptionKey?: string;
}

function applySqlCipherKey(db: Database.Database, key: string): void {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma("legacy = 4");
  db.pragma(`key = "x'${key.replace(/'/g, "''")}'"`);
}

function assertReadable(db: Database.Database): void {
  db.prepare("SELECT count(*) AS c FROM sqlite_master").get();
}

function configureDb(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

function openEncryptedDb(dbPath: string, key: string): Database.Database {
  const db = new Database(dbPath);
  applySqlCipherKey(db, key);
  assertReadable(db);
  configureDb(db);
  return db;
}

function openPlainDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  configureDb(db);
  return db;
}

function encryptPlainDbInPlace(dbPath: string, key: string): Database.Database {
  const db = new Database(dbPath);
  try {
    assertReadable(db);
  } catch (err) {
    db.close();
    throw err;
  }

  // SQLCipher rekey requires a rollback journal (not WAL).
  db.pragma("journal_mode = DELETE");
  db.pragma("cipher = 'sqlcipher'");
  db.pragma("legacy = 4");
  db.pragma(`rekey = "x'${key.replace(/'/g, "''")}'"`);
  db.close();
  return openEncryptedDb(dbPath, key);
}

function decryptEncryptedDbInPlace(dbPath: string, key: string): Database.Database {
  const db = new Database(dbPath);
  applySqlCipherKey(db, key);
  assertReadable(db);
  db.pragma("journal_mode = DELETE");
  db.pragma("rekey = ''");
  db.close();
  return openPlainDb(dbPath);
}

/**
 * Opens a SQLite database, optionally encrypted with SQLCipher (legacy v4).
 * Migrates an existing plaintext database to encrypted when a key is supplied.
 */
export function openDatabase(opts: OpenDatabaseOptions): Database.Database {
  const { dbPath, encryptionKey } = opts;
  const fileExists = existsSync(dbPath);

  if (!encryptionKey) {
    if (!fileExists) return openPlainDb(dbPath);

    try {
      return openPlainDb(dbPath);
    } catch {
      throw new Error(
        "Database appears encrypted but encryption is disabled. Re-enable database encryption in Settings.",
      );
    }
  }

  if (!fileExists) {
    return openEncryptedDb(dbPath, encryptionKey);
  }

  try {
    return openEncryptedDb(dbPath, encryptionKey);
  } catch {
    try {
      return encryptPlainDbInPlace(dbPath, encryptionKey);
    } catch (err) {
      throw new Error(`Failed to open or migrate database: ${String(err)}`);
    }
  }
}

export function reconfigureDatabaseEncryption(
  dbPath: string,
  key: string | undefined,
  enable: boolean,
): void {
  const fileExists = existsSync(dbPath);
  if (!fileExists) return;

  if (enable && key) {
    try {
      openEncryptedDb(dbPath, key).close();
    } catch {
      encryptPlainDbInPlace(dbPath, key).close();
    }
    return;
  }

  if (!key) {
    throw new Error("Cannot disable database encryption without the existing key");
  }

  decryptEncryptedDbInPlace(dbPath, key).close();
}

export type SqliteDatabase = Database.Database;
