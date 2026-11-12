# Guild Desk 0.5.0

Version 0.5.0 makes the own-main profile the login Overview, limits equipment editing to its approved owner, counts attendance only from evidenced membership, and adds server-enforced access profiles with per-account overrides. Members default to five guild areas; attendance records, the ledger and catalog management move to the officer workspace. Audit filters support actor, affected account, character, activity, dates and search. EQ stats are grouped; explanatory callouts are reduced. DKP rules and sealed-bid privacy remain unchanged.

## Public sample data

The public distribution uses entirely artificial attendance files with 15 tab-separated columns: 26 rows in the first capture, 29 in the second, and 29 distinct fictional characters. Mainhero appears in both, while Secondhero appears only in the second. These examples exercise pending attendance, main approval, duplicate imports and missing-attendance corrections. Synthetic ranks, dates, notes, zones and numeric roster fields carry no real guild information or DKP authority. Item-only chat protocol examples use the verified message format and retain game-item names without player rosters or unrelated chat. Game-item reference facts and primary-source URLs are identified separately.

The public source is a fresh allowlisted snapshot. It includes no previous Git history, private hosting identity, accounts, databases, game logs, environment files, pairing tokens, companion state or original guild roster. Do not push the private working repository's history into a public repository. Initialize a fresh repository from the prepared snapshot instead.

## Verification and release process

Use Node.js 24 or later. Run `node build.mjs --local` and then `node --test`. CI performs those checks on both Linux and Windows. Start the saved local application with `Start-Guild-Desk.cmd` on Windows or `node server.mjs`; open http://localhost:4173. Accounts, attendance, DKP and drafts persist in SQLite between restarts. See local/README.md for storage and backup. A disposable in-memory preview remains available through `node dev-server.mjs`.

For live loot, create a capture in Guild Desk's Live loot capture screen, then run `companion/Start-Companion.cmd` or `node companion/start.mjs`, paste its pairing JSON and select the EQ log. Finish the capture in Guild Desk and prepare the boss draft before matching items and publishing reviewed auctions. See the companion README and CAPTURES.md for secure pairing and recovery.

To publish a reviewed release, update the package version and release notes, commit the clean public source, then create and push the matching version tag, such as `v0.5.0`. The tag workflow verifies that the tag matches the package version, builds without private host configuration, and runs the suite from a clean checkout. It packages only allowlisted tracked source and the generated Worker, then attaches a ZIP and SHA-256 checksum to a GitHub release using the workflow's short-lived token. Only the release job receives `contents: write`; CI is read-only. Tags do not deploy the application or publish a database.

The workflows are prepared configuration. They do not establish that a public repository, push, remote CI run, GitHub release, production deployment or outside security audit has already succeeded. EQResource access may fail, full item metadata remains unverified, and production hosting needs separate persistent database configuration and migrations.

Maintainers can prepare the initial clean snapshot with `node scripts/prepare-public-source.mjs`. The default destination is the workspace's `outputs/public-guild-desk` sibling directory. The exporter refuses an existing nonempty destination; use `--destination` with a fresh `outputs/public-guild-desk-v0.5.0-N` directory for a new candidate. It never deletes or rewrites existing output. Do not include local build/data outputs in the initial commit.

Workflow references: [GitHub's Node.js CI guide](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), [workflow token permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), and [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create).

New schema-only migrations 0005 and 0006 preserve existing accounts, records and balances. Attendance backfill uses evidence rather than inventing a join date; unknown legacy starts have no historical denominator. Profiles are initialized from existing administrator/member identities; officers can be assigned through Access control. A last-manager guard prevents accidental lockout. Class artwork, rendered browser acceptance and effect-specific spell hover remain pending.
