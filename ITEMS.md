# Guild Desk uploaded item catalog

The running application uses officer-uploaded SODEQ/EQItems data. It does not search, scrape, refresh, or fetch images from EQResource or any other item site. EQResource URLs are ordinary item-ID links that a user can choose to open. Earlier source adapters and their parser tests are historical code, not the production data source.

Upload the original `items.txt.gz` or a small original headered `items.txt` in Officer workspace → Item references. The main dump is available at https://items.sodeq.org/download.php. Uploading a newer file replaces the active searchable catalog only after every row validates. Existing auctions, attendance, balances, item history and profile selections are retained. See CATALOG.md for format, import limits, provenance and setup.

## Storage and access

Migration 0008 adds staged catalogs and an atomic active-catalog pointer. Catalog imports do not bulk-rewrite `item_references`: selected item IDs are copied there when used by equipment or loot. Reads use the active upload; a previously saved reference can still be shown when its ID is absent from the active upload, with an explicit retained-data status. Previously published auction names, classes, results and prices remain historical snapshots.

The main Worker enforces the configured items ACL. Catalog management requires item read/write access; mutations additionally require exact same Origin and the session X-CSRF-Token. Members can see permitted item details in profiles and auctions without gaining catalog administration access.

## API

| Route | Behavior |
| --- | --- |
| GET /api/items?q=&class=&slot=&limit=50 | Search uploaded names or exact ID and filter classes/slots. Returns items,total,scope,catalog,revision and sourceNotice. Limit 1–100. No writes or network calls. |
| POST /api/items/search | JSON `{name}`; exact complete-name search in the upload. A unique exact ID is hydrated into saved references; multiple IDs with the same name require selection. Prefixes remain significant. |
| POST /api/items/lookup | JSON `{itemId}`; accepts an integer, exact HTTPS EQResource item URL, or itemID^iconID^name. Hydrates an ID present in the upload; otherwise returns an honest identity-only reference (202). No bundled starter data or external fetch. |
| GET /api/items/:itemId | Active uploaded details, or previously saved retained reference; 404 if unknown. |
| POST /api/items/:itemId/refresh | Rehydrate from the active uploaded file. This compatibility route never contacts an external site. |

Canonical item fields include itemId,name,classes,races,slots,stats,flags,advancedLoot,sourceUrl,sourceCheckedAt,sourceUpdatedAt,retrievedAt,verificationMethod,metadataStatus,iconId,iconUrl,metadataComplete,details,sourceStatus and catalog. `sourceStatus.status` is `uploaded` for current file data. `metadataStatus:'verified_reference'` means an imported item identity and supplied fields were validated; it does not mean the current live game was inspected. The file hash, uploader, optional source date and counts are recorded for each import.

## Item panes

The compact item pane groups AC/HP/mana/endurance, required/recommended levels, attributes and heroics, saves, and regeneration/combat bonuses. Weight and tribute remain preserved source fields but are omitted from the compact stat display. Flags, slots, classes, races, effect/focus entries and augmentation slots are shown. The full details view can show every supplied field, including unknown fields. Source text is always plain text, never executable markup.

Effect IDs and supplied names are imported from the dump. Missing names remain unknown until a separate name reference can resolve them. Main-file data does not provide full spell descriptions or icon image files: `metadataComplete` remains false and catalog `iconUrl` is null. No image URL is guessed from an icon ID. Optional lore/charm files and a full spell-description dataset are not yet imported.

Missing effect names can now be filled from the separate persistent Raidloot spell-name cache; supplied item names always take priority. Unknown numeric fallback labels are hidden in the compact effects list while structured spell IDs remain available. This cache stores names only and never changes item stats. See SPELL_NAMES.md for the fixed primary source, its older source date, bounded read-through download and officer refresh action.

## Guild history

GET /api/loot/items/:itemId/history returns published appearances, total quantities and closed auction results. Drafts do not count, legacy/manual auctions count once, and active sealed bids remain hidden. See LOOT.md.
