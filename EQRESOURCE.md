# EQResource item adapter

`worker/eqresource.mjs` provides ordinary, bounded source retrieval. It does not maintain a separate item database or write to Guild Desk's cache. The caller can cache a successfully retrieved canonical item and retain previously verified data when refresh fails.

## Source verification and current limitation

Primary source references examined on November 12, 2026:

- [Public item search](https://items.eqresource.com/itemsearch.php)
- [Ancient Pearlescent Mask, item 44354](https://items.eqresource.com/items.php?id=44354)
- [Blood of the Dhampyre, item 81773](https://items.eqresource.com/items.php?id=81773)

Search-indexed EQResource item pages verified the item URL/ID convention, item names, Advanced Loot `itemID^iconID^name` text, class/race/slot labels, numerical statistics, effects, augmentation text, lore, and source checked/updated timestamps. Those pages also expose an item search link and `Total results` text on search results.

Direct web retrieval returned HTTP 403 in this environment; the local command runtime could not resolve the source host. No real raw HTML search form or item page fixture was captured. A production name-query parameter, JSON API, image directory, and complete HTML layout are therefore **unverified**. The adapter deliberately does not invent them. A working Internet connection in the eventual server runtime may allow ordinary retrieval, but that has not been demonstrated here.

At runtime, name search first loads the public search page and discovers exactly one form with an explicit Item Name label. It uses that form's actual input name, hidden values, method and same-source action. An unsupported or ambiguous form returns `unavailable`. An access denial is reported rather than retried through another identity or a proxy. Officers can retain their parsed loot names and review/confirm an item ID without having fake metadata substituted.

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

The item page must identify exactly one requested Advanced Loot record, provide an unambiguous matching item heading before its class field and have a recognizable item panel boundary after the record. Navigation/header/footer contents and executable markup are removed before field selection. Duplicate eligibility fields or headings fail closed. Comments are excluded. `sourceText` is plain item panel text, never an entire body dump. Render all strings as escaped text, not HTML. The icon URL is populated only when an actual source image element points to an allowed image filename matching the source icon ID. No image URL is constructed from an assumed directory.

`metadataStatus: 'verified_reference'` means a source page identified this item. `metadataComplete` remains **false** because complete extraction against the real HTML has not been verified. The UI should disclose partial metadata and retain the EQResource link. Retrieval success must not be presented as proof that every possible game field was extracted.

## Retrieval limits

Requests and redirects are restricted to HTTPS on `items.eqresource.com`; arbitrary hosts, userinfo and fragments are rejected. No application credentials/cookies are forwarded. A bounded anonymous source-cookie jar supports ordinary public form submissions. Redirects are manual and limited to three. Each operation shares one timeout; response bodies are capped at 1 MiB and isolated item panels at 30,000 characters. HTTP 401, 403 and 429 produce explicit source-access failures. No CAPTCHA or access-control bypass is implemented.

## Validation

Run `node --test tests/eqresource.test.mjs`.

Ten passing tests cover observed-control discovery, unique/ambiguous/paginated matching, same-source GET/POST/redirect handling, unavailable source states, size/type/URL restrictions, factual indexed item fields, heroic values, unknown-field retention, panel isolation, navigation eligibility contamination, direct canonical return values and explicit errors. The tests use injected fetch responses and **synthetic HTML wrappers**, with primary-source factual item text clearly identified. They establish local protocol/parser behavior; they do not claim that a real raw HTML fixture or live end-to-end source retrieval has passed.
