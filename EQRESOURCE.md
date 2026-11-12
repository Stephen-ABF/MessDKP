# EQResource item adapter

`worker/eqresource.mjs` provides ordinary, bounded source retrieval. It does not maintain a separate item database or write to Guild Desk's cache. The caller can cache a successfully retrieved canonical item and retain previously verified data when refresh fails.

## Source verification and current limitation

Primary source references examined on November 12, 2026:

- [Public item search](https://items.eqresource.com/itemsearch.php)
- [Indexed dedicated item-search result](https://items.eqresource.com/itemsearch.php?searchid=3)
- [Live browser basic-search result for Froglok Bonecaster's Robe](https://items.eqresource.com/itemsearch.php?searchid=164526)
- [Ancient Pearlescent Mask, item 44354](https://items.eqresource.com/items.php?id=44354)
- [Blood of the Dhampyre, item 81773](https://items.eqresource.com/items.php?id=81773)

Search-indexed EQResource item pages verified the item URL/ID convention, item names, Advanced Loot `itemID^iconID^name` text, class/race/slot labels, numerical statistics, effects, augmentation text, lore, and source checked/updated timestamps. Those pages also expose an item search link and `Total results` text on search results.

The dedicated basic search was verified in the live browser on November 12, 2026. Its actual form uses `method="post" action="dosearch.php"`, text input `id="name" name="name"`, hidden input `id="searched" name="searched"` with an empty value, and submit input `name="Submit" value="Submit"`. The Item Name table-cell label is outside the form. Submitting the full name `Froglok Bonecaster's Robe` navigated to the result URL above and returned the base item ID1608, Darkened variant146278 and Fabled variant82707 as three separate rows. The regression fixture records this observed DOM form contract and those source identities, rather than claiming to capture the entire raw response.

The exact [Froglok Bonecaster's Robe page1608](https://items.eqresource.com/items.php?id=1608) was also inspected in the browser. Its outer page H1 duplicates the in-panel item name. The source collector's first `.postcontent` contains a nested gold-border statistics table and separate Misc Item Values/Item Updates tables, including the requested Advanced Loot identity. The parser now uses that balanced post boundary instead of mixing the duplicate page heading or later comments into item metadata. The regression includes the observed column layout, class/slot fields, numerical values, augment labels, source timestamps and actual icon src. The compact test fixture is a structure/value excerpt, not the complete raw HTML response.

Direct web retrieval still returned HTTP 403 in this environment; an earlier local command attempt could not resolve the source host. Browser verification does not establish that ordinary server-side retrieval will succeed. A JSON API, image directory, and complete raw HTML item layout remain unverified; no endpoints or metadata are invented to bypass source-access failures.

At runtime, name search first loads the dedicated item search page and discovers exactly one labeled form or the unambiguous observed basic-form signature above. It accepts same-source `itemsearch.php` compatibility forms and the verified POST-only `dosearch.php` action; a general site search form is excluded. It submits that form's observed name control, hidden values, selected defaults, checked controls, method and single named submit button, then follows the ordinary same-source redirect back to item results. An unsupported or ambiguous form returns `unavailable`. An access denial is reported rather than retried through another identity or a proxy. Officers can retain their parsed loot names and review/confirm an item ID without having fake metadata substituted.

Item-name comparison ignores case and redundant whitespace but preserves complete names, prefixes and punctuation. Base, Darkened and Fabled versions remain different items. No expansion prefix, leading word, apostrophe or suffix is removed to make a match. A single exact complete name is eligible for automatic selection only when the result set is complete and unambiguous. A changed detail-page name or a cached identity conflict cannot attach another variant's statistics.

## Explicit source search in Guild Desk

`GET /api/items` searches saved references only. `POST /api/items/search` with `{name}` explicitly searches EQResource's dedicated item database, requiring item-write access, Origin and CSRF. It returns `{query,status,candidates,exactMatch,item,sourceStatus,sourceUrl}`. A unique complete-name source identity is cached automatically with available verified page data. Ambiguous or prefixed near-matches stay choices for officer review. Source denial is `unavailable`, never `not_found`; a detail-page failure can return an exact identity with `sourceStatus.status:identity_only`, and missing stats remain unknown. Requests are limited to 2 KiB and printable names of 1-250 characters. The name search factory dependency is `createItemApi({searchItemsByName,fetchItemDetails})`.

Boss draft matching uses the same dedicated source adapter. Per-item source-search and detail budgets are 5 and 3 seconds respectively, replacing a 1.5-second budget that covered multiple HTTP requests. A batch still processes at most ten unresolved rows with three workers. Source failures preserve drafts and all raw imported names.

## Export contracts

```js
const result = await searchItemsByName(name, { fetchImpl, timeoutMs });
// {
//   status: 'matched' | 'ambiguous' | 'not_found' | 'unavailable',
//   query, candidates, exactMatch, sourceUrl,
//   reason, message, code?, additionalPages?
// }
// candidate: { itemId, name, sourceUrl, match: 'exact' | 'candidate', nameConflict }

const item = await fetchItemDetails(itemId, { fetchImpl, timeoutMs });
// Returns the canonical item directly; throws SourceError on failure.
```

Both options are optional. `fetchImpl` defaults to the runtime's native fetch. `timeoutMs` defaults to 8000 and must be between 1 and 30000. `message` aliases `reason` for display. `SourceError` exposes `code`, `status`, and `message`; invalid inputs use status 400, source failures use 503.

Name matching normalizes Unicode, whitespace and case while preserving punctuation. Automatic selection requires exactly one exact normalized name with no conflicting name for that ID or indicated additional result pages. Similar names and duplicate exact names require review. `not_found` requires recognized zero-result text; an unrecognized response is unavailable. Candidate URLs must identify one positive integer ID on the source item endpoint. No arbitrary first result is selected.

The direct canonical item contains:

```js
{
  itemId, name, classes, races, slots, stats, flags, advancedLoot,
  sourceUrl, sourceCheckedAt, sourceUpdatedAt, retrievedAt,
  verificationMethod, metadataStatus, iconUrl, metadataComplete,
  details: { fields: [{ label, value }], effects: [], augments: [], lore, sourceText }
}
```

`classes` uses the sixteen EverQuest class abbreviations. `['ALL']` is returned only when the source explicitly says All. Unrecognized eligibility is `null`, never all classes. Unknown structured data is left unknown; the ordered field list and item panel text preserve source values beyond the current numerical mapping. Heroic values remain separate from their base statistic. `effects` and `augments` contain source strings; no effect descriptions are fabricated. Checked/updated timestamps retain the source's text because its timezone is not established.

The item page must identify exactly one requested Advanced Loot record and provide an unambiguous matching panel heading before its class field. When the observed `.postcontent` exists, only the first source-collector post is considered; its balanced closing tag is the item boundary, and a mismatched/missing identity never falls through to a later comment. Otherwise the compatibility parser still requires a recognizable panel boundary after the record. Navigation/header/footer contents and executable markup are removed before field selection. Duplicate eligibility fields or panel headings fail closed. Comments are excluded. `sourceText` is plain item panel text, never an entire body dump. Render all strings as escaped text, not HTML. The icon URL is populated only when an actual source image element points to an allowed image filename matching the source icon ID. No image URL is constructed from an assumed directory.

`metadataStatus: 'verified_reference'` means a source page identified this item. `metadataComplete` remains **false** because complete extraction against the real HTML has not been verified. The UI should disclose partial metadata and retain the EQResource link. Retrieval success must not be presented as proof that every possible game field was extracted.

## Retrieval limits

Requests and redirects are restricted to HTTPS on `items.eqresource.com`; arbitrary hosts, userinfo and fragments are rejected. No application credentials/cookies are forwarded. A bounded anonymous source-cookie jar supports ordinary public form submissions. Redirects are manual and limited to three. Each operation shares one timeout; response bodies are capped at 1 MiB and isolated item panels at 30,000 characters. HTTP 401, 403 and 429 produce explicit source-access failures. No CAPTCHA or access-control bypass is implemented.

## Validation

Run `node --test tests/eqresource.test.mjs`.

Ten passing tests cover observed-control discovery, unique/ambiguous/paginated matching, same-source GET/POST/redirect handling, unavailable source states, size/type/URL restrictions, factual indexed item fields, heroic values, unknown-field retention, panel isolation, navigation eligibility contamination, direct canonical return values and explicit errors. The tests use injected fetch responses and **synthetic HTML wrappers**, with primary-source factual item text clearly identified. They establish local protocol/parser behavior; they do not claim that a real raw HTML fixture or live end-to-end source retrieval has passed.


## Current production source policy

The adapter described above is historical compatibility/test code. It is excluded from the production Worker bundle. Current production item data comes only from uploaded EQItems/SODEQ files. EQResource is manual hyperlinks only; no remote searches, refresh fetches or icons. See CATALOG.md.
