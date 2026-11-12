/**
 * Pure auction proposals only. This module never writes balances, reserves DKP,
 * or changes a ledger. Do not expose its results before a sealed auction closes.
 */
const MAX_UNITS = BigInt(Number.MAX_SAFE_INTEGER);
export class AuctionRuleError extends Error {
 constructor(code, message) { super(message); this.name = 'AuctionRuleError'; this.code = code; }
}
const invalid = (code, message) => { throw new AuctionRuleError(code, message); };
function positiveInteger(value, field) {
 if (!Number.isSafeInteger(value) || value < 1) invalid('invalid_configuration', `${field} must be an explicit positive safe integer.`);
 return value;
}
function moneyRules(config) {
 if (!config || typeof config !== 'object' || Array.isArray(config)) invalid('money_configuration_required', 'Explicit precision and bidIncrement are required.');
 if (!Number.isInteger(config.precision) || config.precision < 0 || config.precision > 6) invalid('invalid_configuration', 'precision must be an integer from 0 through 6.');
 if (config.bidIncrement === undefined) invalid('money_configuration_required', 'An explicit bidIncrement is required.');
 const precision = config.precision, scale = 10n ** BigInt(precision);
 function parse(value, label) {
  if (typeof value === 'number') {
   if (precision !== 0 || !Number.isSafeInteger(value)) invalid('invalid_amount', `${label} must be a decimal string; numeric values are accepted only for safe integers at precision zero.`);
   value = String(value);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 32) invalid('invalid_amount', `${label} must be a nonnegative decimal string without exponent notation.`);
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision) invalid('invalid_amount', `${label} exceeds the explicitly configured precision.`);
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(precision, '0') || '0');
  if (units > MAX_UNITS) invalid('amount_overflow', `${label} exceeds the supported exact scaled-unit range.`);
  return units;
 }
 function format(units) {
  const whole = units / scale, fraction = (units % scale).toString().padStart(precision, '0');
  return precision ? `${whole}.${fraction}` : String(whole);
 }
 const increment = parse(config.bidIncrement, 'bidIncrement');
 const minimum = parse(config.minimumBid === undefined ? '1' : config.minimumBid, 'minimumBid');
 if (increment <= 0n || minimum <= 0n) invalid('invalid_configuration', 'bidIncrement and minimumBid must be positive.');
 return { parse, format, increment, minimum, scale, precision };
}
function submissionTime(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalid('invalid_timestamp', 'amountFirstSubmittedAt must be a canonical UTC ISO timestamp.');
 const milliseconds = Date.parse(value);
 const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
 if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== canonical) invalid('invalid_timestamp', 'amountFirstSubmittedAt is not a valid calendar date and time.');
 return { milliseconds, iso: canonical };
}
function review(issues, eligibleCount, excludedBidders, quantity) {
 return { status: 'officer_review', proposedAwards: [], unawardedCopies: quantity, eligibleCount, excludedBidders, issues };
}
/**
 * @param {{quantity:number,bids:Array<{bidderId:string,bid:string|number,
 * amountFirstSubmittedAt:string,acceptanceSequence?:number,eligible:boolean}>,
 * money:{precision:number,bidIncrement:string|number,minimumBid?:string|number},
 * maxAwardsPerBidder:number,noLowerBidPrice?:'minimum'|'full_bid'|'officer_review'}} input
 * @returns {object} Proposed allocations, never actual charges.
 */
export function proposeAuction(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('invalid_input', 'An auction input object is required.');
 const quantity = positiveInteger(input.quantity, 'quantity');
 const maxAwardsPerBidder = positiveInteger(input.maxAwardsPerBidder, 'maxAwardsPerBidder');
 const money = moneyRules(input.money);
 if (!Array.isArray(input.bids) || input.bids.length > 10000) invalid('invalid_input', 'bids must be an array containing at most 10000 records.');
 if (input.noLowerBidPrice !== undefined && !['minimum', 'full_bid', 'officer_review'].includes(input.noLowerBidPrice)) invalid('invalid_configuration', 'noLowerBidPrice must be minimum, full_bid, or officer_review.');
 const identities = new Set(), sequences = new Set(), eligible = [], excludedBidders = [];
 for (const record of input.bids) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) invalid('invalid_bid', 'Every bid must be an object.');
  const bidderId = record.bidderId;
  if (typeof bidderId !== 'string' || bidderId.length > 128 || !bidderId.trim() || bidderId !== bidderId.trim()) invalid('invalid_bidder', 'Every bidder needs a stable nonempty identity without surrounding whitespace.');
  if (identities.has(bidderId)) invalid('duplicate_bidder', 'Duplicate bidder identities must be resolved before ranking.');
  identities.add(bidderId);
  if (typeof record.eligible !== 'boolean') invalid('eligibility_required', 'Each bid requires an explicit approved eligibility flag.');
  const bid = money.parse(record.bid, 'bid');
  if (bid < money.minimum || (bid - money.minimum) % money.increment !== 0n) invalid('invalid_amount', 'Bid does not satisfy the configured minimum and bid increment.');
  const time = submissionTime(record.amountFirstSubmittedAt);
  const sequence = record.acceptanceSequence;
  if (sequence !== undefined) { if (!Number.isSafeInteger(sequence) || sequence < 1) invalid('invalid_acceptance_sequence', 'An acceptance sequence must be a positive safe integer.'); if (sequences.has(sequence)) invalid('duplicate_acceptance_sequence', 'An acceptance sequence must identify exactly one accepted bid.'); sequences.add(sequence); }
  // Current or projected balances are deliberately never consulted.
  if (record.eligible) eligible.push({ bidderId, bid, time, sequence });
  else excludedBidders.push({ bidderId, reason: 'caller_marked_ineligible' });
 }
 if (!eligible.length) return { status: 'no_bids', proposedAwards: [], unawardedCopies: quantity, eligibleCount: 0, excludedBidders, issues: [] };
 // The one-bid-per-person contract cannot invent allocation or per-copy pricing
 // for several awards to one person. A future approved policy may extend it.
 if (maxAwardsPerBidder !== 1) return review([{ code: 'multiple_awards_policy_required', message: 'An allocation and pricing policy for multiple awards to one bidder must be approved before this engine can propose it.' }], eligible.length, excludedBidders, quantity);
 eligible.sort((a, b) => a.bid === b.bid ? a.time.milliseconds - b.time.milliseconds || (a.sequence !== undefined && b.sequence !== undefined ? a.sequence-b.sequence : 0) : a.bid > b.bid ? -1 : 1);
 const tieIssues = [];
 for (let i = 0; i < eligible.length;) {
  let end = i + 1;
  while (end < eligible.length && eligible[end].bid === eligible[i].bid && eligible[end].time.milliseconds === eligible[i].time.milliseconds) end++;
  if (end - i > 1 && eligible.slice(i,end).some(b=>b.sequence===undefined)) tieIssues.push({ code: 'identical_bid_and_timestamp', bidderIds: eligible.slice(i, end).map(b => b.bidderId).sort(), bid: money.format(eligible[i].bid), amountFirstSubmittedAt: eligible[i].time.iso, message: 'An atomic acceptance sequence or officer decision is required; input order is not a tiebreaker.' });
  i = end;
 }
 if (tieIssues.length) return review(tieIssues, eligible.length, excludedBidders, quantity);
 const winners = eligible.slice(0, quantity), proposedAwards = [];
 for (let i = 0; i < winners.length; i++) {
  const winner = winners[i], next = eligible[i + 1]; let price, pricingBasis;
  if (next) {
   const candidate = next.bid + money.scale;
   price = candidate > winner.bid ? winner.bid : candidate;
   pricingBasis = 'next_ranked_bid_plus_one';
  } else if (quantity === 1 && eligible.length === 1) {
   price = money.minimum; pricingBasis = 'single_bid_minimum';
  } else {
   if (input.noLowerBidPrice === undefined) return review([{ code: 'no_lower_bid_policy_required', bidderId: winner.bidderId, message: 'Specify noLowerBidPrice for a multiple-copy winner without a next-ranked bid.' }], eligible.length, excludedBidders, quantity);
   if (input.noLowerBidPrice === 'officer_review') return review([{ code: 'no_lower_bid_officer_review', bidderId: winner.bidderId, message: 'The selected no-lower-bid policy requires an officer decision.' }], eligible.length, excludedBidders, quantity);
   price = input.noLowerBidPrice === 'minimum' ? money.minimum : winner.bid;
   pricingBasis = input.noLowerBidPrice === 'minimum' ? 'explicit_minimum' : 'explicit_full_bid';
  }
  if (price < money.minimum || price > winner.bid || price > MAX_UNITS) invalid('amount_overflow', 'Proposed price is outside the configured exact range.');
  proposedAwards.push({ bidderId: winner.bidderId, copyNumber: i + 1, winningBid: money.format(winner.bid), proposedPrice: money.format(price), amountFirstSubmittedAt: winner.time.iso, pricingBasis });
 }
 return { status: 'proposed', proposedAwards, unawardedCopies: quantity - winners.length, eligibleCount: eligible.length, excludedBidders, issues: [] };
}
