# Guild Desk local item catalog v0.2

The catalog is stored in Guild Desk's database. EQResource is an optional source of item identity and details; browsing a cached item does not contact it. This catalog is partial. Loot text alone does not include full item statistics, and no complete game-file extraction or collector-import implementation is claimed.

Two bundled, partial source references were verified from EQResource page/indexed text:81773 Blood of the Dhampyre and44354 Ancient Pearlescent Mask. Known stats, restrictions, flags, Advanced Loot strings, and source dates are factual. They are examples, not a claim of progression-server drop availability. Retrieval time does not establish the game version. No image URL is guessed from an icon ID.

## Storage and integration

Apply migration0000 followed by0001. The second adds full_details_json, icon_url, metadata_complete, and source_status_json. No request creates tables. build.mjs injects the source adapter into createItemApi. cacheItemDetails and getCachedItemDetails are shared with boss loot preparation.

Reads require authentication and use only cached data. Mutations additionally require officer/admin, exact same Origin, and the session X-CSRF-Token. An unresolved manager identity cannot overwrite verified facts. Successful snapshots clear normalized fields explicitly returned as unknown. Omitted fields in an identity-only lookup retain cached details. A failed source request retains the cached record with an explicit unavailable status. An incomplete response cannot replace an earlier complete record; its status explains that the earlier record was retained.

## API

| Route | Behavior |
|---|---|
| GET /api/items?q=&class=&slot=&limit=50 | Search local names/ID and filter class/slot. Returns items,total,scope,catalogComplete:false,liveSyncAvailable:false,sourceNotice. Limit1-100. Explicit ALL matches a class; unknown classes do not. No writes. |
| POST /api/items/lookup | JSON {itemId}; accepts positive integer, exact HTTPS EQResource URL, or itemID^iconID^name. Seeds the two partial references. Unknown ID creates unresolved reference:202. No external fetch. |
| GET /api/items/:itemId | {item,sourceStatus}; cache-only details,404 if unknown. |
| POST /api/items/:itemId/refresh | Explicit officer refresh. Returns {item,sourceStatus}. Source failure returns retained item plus unavailable status, never complete metadata. |

Canonical item fields: itemId,name,classes,races,slots,stats,flags,advancedLoot,sourceUrl,sourceCheckedAt,sourceUpdatedAt,retrievedAt,verificationMethod,metadataStatus,iconUrl,metadataComplete,details,sourceStatus. Details contains ordered fields[{label,value}], effects[], augments[], lore, sourceText. Unknown values remain unknown, never inferred zero or ALL. The dialog shows every available field, beyond the normalized stat subset. Source text is plain text, never executable markup.

The source adapter always sets metadataComplete:false because raw live HTML/completeness remains unvalidated. See EQRESOURCE.md for parser limits and synthetic fixture provenance. Source image URLs require HTTPS, a known EQResource host, no credentials/port, and an image-file extension. No source JavaScript is embedded.

## Guild item history

GET /api/loot/items/:itemId/history returns published appearances, total quantities, and auction results. Drafts do not count. Legacy auctions and boss batches count once. Active sealed bids and awards remain hidden; history reveals full results only after closed settlement. See LOOT.md for response and limits.

## Completing the catalog

A complete item-data source still needs validation. Local names/IDs do not supply stats. An external collector describes server-sent records saved as items.jsonl (https://norrathcodex.com/collector). Current-client compatibility, field mappings, provenance and item variants must be checked before adopting that output. No collector has been run and no importer for its format is included in0.2.0.
## EQ-style profile and hover views

The hover and full details share a compact item pane: flags, slots, classes, races, normalized recorded stats, all known effects/focus, augment slots and expandable remaining source fields. Only validated source images appear. The partial Blood of Dhampyre reference includes Prismatic Ward VIII, Improved Dodge V and Corrupted Sylvan's Rot II from its EQResource item record; legacy copies of that known starter reference receive the same verified fields without a live request. Unknown items and failed refreshes do not inherit unrelated effects or claim complete metadata. Profile selections reuse this same pane.

## Compact item sections

The item pane separates AC/HP/mana/endurance, required/recommended levels, attributes with heroic values, saves, and regeneration/combat bonuses. Weight and tribute remain source facts but are omitted from the compact stat display. Effects/focus and augment information remain visible. Effect-specific spell-description hover is a future feature; this version does not claim a validated EQResource/Lucy spell catalog. Officer catalog management is separate from member profile/auction item details.
