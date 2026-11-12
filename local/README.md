# Persistent local Guild Desk

Install Node.js 24 or newer. Double-click `Start-Guild-Desk.cmd` from the project folder, then open the address printed in its window. The launcher builds the application and runs `node server.mjs`. Keep the window open while using Guild Desk. Press Ctrl+C to stop safely.

The default address is `http://localhost:4173`. The server listens only on this computer at `127.0.0.1`. If that port is already occupied, stop the other server or set `PORT` to a free port before launching. The server does not stop another running preview.

The persistent SQLite database is `data/guild-desk.sqlite`. Accounts, sessions, attendance, loot imports, auctions, bids, settings, and audit records survive restarts. No sample users are created. The first account registered on a new database becomes administrator. `GUILD_DESK_DB` can select another filename; relative paths resolve from the project folder. Using a different path opens a different database.

For a manual start:

```powershell
node build.mjs --local
node server.mjs
```

Stop Guild Desk before copying `data/guild-desk.sqlite` for a backup. While the server is running, SQLite may also need its `-wal` and `-shm` files. Do not delete or replace database files while Guild Desk is running.

At startup the server reads `drizzle/meta/_journal.json`, checks every previously applied migration's SQL and journal hashes, and applies new migrations in one transaction. Applied migration files must remain unchanged. Missing, changed, or failed migrations prevent the server from listening. An existing database without this migration history is rejected; it is never automatically adopted or overwritten.

The disposable `dev-server.mjs` remains a separate testing tool. It does not use this persistent database. Request uploads have a 6 MiB maximum.
