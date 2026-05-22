# Encryption at rest

NoteTaker stores transcripts, summaries, and notes in a local SQLite database
under `~/Library/Application Support/NoteTaker`. By default this database is
encrypted with [SQLCipher](https://www.zetetic.net/sqlcipher/).

## Cipher

- SQLCipher v4 defaults
- AES-256 (CBC) with HMAC-SHA512 per page
- PBKDF2-SHA512, 256,000 iterations

## Key management

- A 256-bit random key is generated on first launch
- Stored in the macOS Keychain (service `NoteTaker`, account `db:encryption`)
- Never written to disk in plaintext, never sent over the network
- The same Keychain mechanism is used for cloud LLM API keys

## What is and isn't encrypted

| Encrypted                            | Not encrypted (by NoteTaker)                |
| ------------------------------------ | ------------------------------------------- |
| Transcript text                      | Raw audio (`.f32le` files, if you opt in)   |
| Speaker IDs and labels               | Crash logs (macOS-managed, local only)      |
| Summaries and notes                  | App preferences (whitelists, hotkey, etc.)  |
| Full-text search index               |                                             |

## Recovery

If your Keychain is wiped or your Mac is lost without a backup, the database
**cannot be decrypted by us or by anyone else**. That is the trade-off of a
zero-knowledge architecture.

Recommendations:

- Enable iCloud Keychain sync so the key follows your Apple ID across Macs.
- Keep Time Machine backups — they preserve both the encrypted database and
  the Keychain.
- Periodically export important sessions to Markdown for plain-text backups.

## Disabling encryption

You can disable encryption in **Settings → Behavior → Encrypt local
database**. The database will be migrated to plain SQLite, and the Keychain
key will be removed. Re-enabling will generate a new key. We recommend
leaving encryption on.

## Reporting an issue

Use [GitHub security advisories](https://github.com/AbijahKaj/notetaker/security/advisories/new)
for vulnerability reports rather than public issues.
