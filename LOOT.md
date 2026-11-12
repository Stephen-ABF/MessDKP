# Boss loot preparation API v0.2

Item matching uses only the active officer-uploaded SODEQ/EQItems catalog. The running application never searches or fetches EQResource; item-ID source URLs are hardlinks only. Imported full names are retained verbatim in evidence. Base, Darkened and Fabled names remain separate rows and identities. Only a unique exact complete name can match automatically. Multiple IDs with the same complete name require officer selection; missing names remain unresolved until new data is uploaded or an ID is explicitly selected. See CATALOG.md for import setup and limits.

Production exports `createLootApi({catalog,fileOnly:true,parseChatLootSources,clock?})`; the returned `handleLootApi(request,env,{user,csrfToken})` handles the routes below. Unique local matches and manager-supplied IDs hydrate selected uploaded details into the reference cache. Remote callbacks and bundled source seeds are ignored in file-only mode. Historical source-adapter unit tests are retained separately and do not enable production remote access. Unmatched paths return null. No schema changes occur during requests.

All draft routes require the admin/officer role. Mutations require exact same-origin Origin and X-CSRF-Token. Authenticated members may read published item history, which never exposes active sealed bids. JSON errors are `{error,code}` and all responses are no-store.

| Method and route | Input | Response |
| --- | --- | --- |
| GET /api/loot/drafts | None | `{drafts:[DraftSummary]}` newest 100 |
| POST /api/loot/drafts | `{bossName,raidId?:string,text?:string,files?:[{name,text,format?:'names'|'log'}],format?:'names'|'log',idempotencyKey?:string}` | 201 `{draft:Draft}`; matching keyed retry 200 |
| GET /api/loot/drafts/:id | None | `{draft:Draft}` |
| PUT /api/loot/drafts/:id/items/:rowId | `{expectedRevision,itemId?:number,confirm?:true,quantity?:number,name?:string,ignore?:boolean}` | `{draft:Draft}`. Explicit item selection requires confirm:true. |
| POST /api/loot/drafts/:id/match | `{expectedRevision,rowIds?:[string]}` | `{draft:Draft,searched:number,remaining:number}`. At most 10 selected unresolved names per call; cached matches and supplied IDs are resolved first. |
| POST /api/loot/drafts/:id/publish | `{expectedRevision}` | `{draft:Draft,auctions:[PublishedAuction],alreadyPublished:boolean}`; repeated/concurrent publication returns the original auctions |
| GET /api/loot/items/:itemId/history | Optional `limit=50` (1-100) | `{itemId,appearanceCount,totalQuantity,appearances:[Appearance],auctions:[PastAuction]}` |

`DraftSummary`: `{id,bossName,raidId,status:'draft'|'published',revision,totalPieces,itemCount,unresolvedCount,createdAt,updatedAt,publishedAt:null|string}`.

`Draft` adds `{sources:[{name,text,format}],warnings:[string],readyToPublish:boolean,items:[DraftItem]}`. Original source text is immutable. `DraftItem`: `{id,ordinal,name,normalizedName,quantity,itemId:null|number,matchStatus:'unmatched'|'ambiguous'|'matched'|'manual_verified'|'needs_review'|'ignored',candidates:[Candidate],rawLines:[{sourceName,lineNumber,text}],note:null|string,sourceUrl:null|string,displayName:string,metadataStatus:null|string,auctionId:null|string}`. `Candidate`: `{itemId,name,sourceUrl,match:'exact'|'candidate'}`. Only a unique exact normalized-name result auto-matches. An ambiguous result always needs explicit manager selection. Source failures leave draft rows available for manual review. An ID supplied in a real Advanced Loot string or EQResource link is preserved as direct ID evidence; this does not claim complete verified metadata.

`PublishedAuction`: `{id,itemId,itemName,quantity,minimumBid,publishedAt,closesAt}`. Publishing validates every non-ignored row, requires a cached item reference and a nonempty title, and creates the entire boss batch in one transaction. The batch shares one publication timestamp and an exact 24-hour deadline. No DKP is charged by import or publication. Existing sealed bidding and individual award confirmation remain unchanged.

`Appearance`: `{draftId:null|string,bossName:null|string,raidId:null|string,raidName:null|string,quantity,publishedAt,auctionId}`. `PastAuction`: `{id,itemName,quantity,publishedAt,closesAt,status,resultsReady,bids:null|[{characterName,userName,amount,eligible}],awards:[{characterName,userName,price,status}]}`. `appearanceCount` is the total number of published auction/listing events for that item across the complete guild auction system; `totalQuantity` sums their quantities. The arrays are limited to the latest requested number, while counts cover all events. Legacy/manual auctions are included with null boss/draft context. Draft links add context without double counting; unpublished drafts never count. Active auctions may be listed as references, but their bids and awards are withheld until the deadline and final results exist. Expired, unsettled auctions report `resultsReady:false` rather than fabricate results.

## Import boundaries

Plain names mode accepts one item per line, optional `2 x Item Name` / `Item Name (x2)` quantities, actual `itemID^iconID^name` Advanced Loot strings, numeric IDs, or exact EQResource item links. Identical normalized names aggregate quantities while retaining every raw source line. Timestamped/chat-looking lines are flagged for review rather than assumed to be item names. Log mode currently recognizes only direct Advanced Loot references; other log lines remain review rows until an actual loot-log format is supplied and verified. A manager can mark a non-loot review row ignored. There is no claim of generic EverQuest log parsing without a sample.

Up to 200 nonempty source lines and 1000 total pieces are accepted per batch, with at most 50 identical copies in one auction. More than 50 total pieces are supported. Existing published drafts cannot be edited or re-imported. Name/source strings and all match decisions are audited. Manual metadata is explicitly manager-provided, never silently promoted to verified source facts.

If different input rows resolve to the same item ID, the draft is blocked with `readyToPublish:false`, a warning, and publication error `duplicate_item_rows`. The manager combines the copies into one row's quantity (maximum 50) and ignores the extra rows; every original source line and each review decision remain preserved. The backend never publishes separate auctions for the same included item ID in a boss batch. Combined quantities above 50 require reducing/splitting the source into explicitly reviewed separate boss batches.

File-only matching does not seed bundled item references. Existing published auction identities, names, classes and results remain historical snapshots when a newer catalog is activated. Loot draft preparation and lookup do not create auctions or change DKP; publication and officer award confirmation remain separate explicit actions.

## Review usability (0.9)

Import preview/review decorates unique exact uploaded names with available icons in bounded chunks. Ambiguous names remain unresolved. Draft item details include their reference advancedLoot icon identity. Clear Remove from auction / Restore actions reuse audited exclusions and draft revision checks, without erasing original source evidence or changing published auctions.
