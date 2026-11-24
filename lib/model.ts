// Launch Radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that passes one screen, applied at every size: it records no token
// (no market cap, no CoinGecko id, no symbol) and it is not a wrapped, staked or bridged product of a
// protocol whose token already trades, not an exchange, and not a versioned pool of another protocol.
// That is the watchlist's own rule without its $50M floor, so the 40 watchlist protocols are covered
// by construction and the radar adds the early protocols below the floor on the same terms.
//
// Implied value is calibrated from the snapshot itself, never from a list of names:
//
//   peers      = the snapshot's live-token protocols in the same category that record a market cap
//   multiple   = median(mcap_usd / tvl_usd) over those peers (the category's own market price of TVL);
//                a category with fewer than MIN_PEERS peers falls back to the whole market's median
//   base       = tvl_usd x multiple
//   growthMult = 1 + (clamp(change_7d, -50, 100) / 100) x GROWTH_WEIGHT   (unreported growth: 0)
//   maturity   = 0.70 + 0.30 x min(age_days, 1460) / 1460                  (unknown age: 365 days)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The same function scores every row; the dashboard states the constants and shows each row's parts.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_peers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  min_peers: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 36;

/** One category's calibration: how the market prices a dollar of TVL in it. */
export interface PeerStat {
  category: string;
  peers: number;
  median_multiple: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_scope: string;
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  tvl_multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  screened_out: number;
  global_multiple: number;
  peers: PeerStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another protocol's asset, not launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word that marks a wrapped or staked product. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name: the exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * The screen, the watchlist's rule at every size: pre-token, and not a wrapped, staked or bridged
 * product of a token that trades, not an exchange, not a versioned pool.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The calibration: for every category, the median market-cap-to-TVL multiple of the snapshot's own
 * live-token protocols in it, plus the whole market's median as the fallback. Computed from the
 * snapshot at run time; nothing about it is written down in advance.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, PeerStat>; global: PeerStat; table: PeerStat[] } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    // A peer must record a positive market cap: a recorded zero prices nothing and would drag a
    // median toward a value no market ever paid.
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const global: PeerStat = { category: 'All categories', peers: all.length, median_multiple: round4(median(all)) };
  const byCategory = new Map<string, PeerStat>();
  const table: PeerStat[] = [];
  for (const key of [...ratios.keys()].sort()) {
    const list = ratios.get(key)!;
    const stat: PeerStat = { category: key, peers: list.length, median_multiple: round4(median(list)) };
    byCategory.set(key, stat);
    if (list.length >= model.min_peers) table.push(stat);
  }
  table.sort((a, b) => b.median_multiple - a.median_multiple || (a.category < b.category ? -1 : 1));
  return { byCategory, global, table };
}

/** The multiple one protocol is priced with: its category's own, or the market's when peers are few. */
function multipleFor(p: SnapshotProtocol, cal: { byCategory: Map<string, PeerStat>; global: PeerStat }, model: ModelConstants): { multiple: number; peers: number; scope: string } {
  const stat = cal.byCategory.get(p.category ?? 'Uncategorised');
  if (stat !== undefined && stat.peers >= model.min_peers) {
    return { multiple: stat.median_multiple, peers: stat.peers, scope: `category ${stat.category}` };
  }
  return { multiple: cal.global.median_multiple, peers: cal.global.peers, scope: 'whole market (few live peers in its category)' };
}

/** The parts of one protocol's implied value under `model`, and the value itself. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  cal: { byCategory: Map<string, PeerStat>; global: PeerStat },
  model: ModelConstants,
): { implied: number; base: number; multiple: number; peers: number; scope: string; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, peers, scope } = multipleFor(protocol, cal, model);
  const base = protocol.tvl_usd * multiple;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base, multiple, peers, scope, growthPct, growthMult, maturityMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; calibration: ReturnType<typeof calibrate>; screenedOut: number } {
  const cal = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);
  const screenedOut = snapshot.protocols.filter(isPreToken).length - chosen.length;
  const scored = chosen.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, cal, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      peer_multiple: s.v.multiple,
      peer_count: s.v.peers,
      peer_scope: s.v.scope,
      base_usd: Math.round(s.v.base),
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
  return { board, calibration: cal, screenedOut };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: { text: string; cost: string; time: string }): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough gas tier for a chain, so a plan's costs follow the chain the position lives on. */
function gasFor(chain: string): { label: string; one: number; week: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { label: 'Ethereum mainnet gas', one: 12, week: 6 };
  if (c.includes('solana')) return { label: 'Solana fees', one: 1, week: 1 };
  if (c.includes('bitcoin') || c.includes('bsc') || c.includes('binance')) return { label: 'chain fees', one: 3, week: 2 };
  return { label: 'layer-2 gas', one: 2, week: 1 };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('uncollateralized')) return `Lend $${capital} of USDC through ${name}'s borrower pool on ${chain} and keep the loan position open.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow about 40% of it once so the position counts as both supply and borrow activity.`;
  if (c.includes('dex') || c.includes('cross chain')) return `Swap about $${Math.max(25, Math.round(capital / 4))} through ${name} on ${chain}, then provide the rest of the $${capital} as liquidity in its main pool.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it after a day so volume and an open-interest record both count.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in one app on the far side.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the farming wallet.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; pick the vault with the most depositors, not the highest headline yield.`;
  if (c.includes('basis')) return `Open a delta-neutral pair through ${name} on ${chain}: $${capital} long spot against an equal short, so the position earns the funding spread without price risk.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market, sized small enough to hold to settlement.`;
  if (c.includes('launchpad')) return `Register the wallet on ${name} and complete its participation steps for one sale, committing at most $${capital}.`;
  if (c.includes('stable') || c.includes('algo')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} after its onboarding check and hold the asset.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for one protocol you already use and keep the policy to expiry.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s shielded pool on ${chain} and make one shielded transfer to your own second wallet.`;
  if (c.includes('synthetic') || c.includes('index')) return `Mint $${capital} of ${name}'s index or synthetic asset on ${chain} and hold it.`;
  if (c.includes('payments') || c.includes('card')) return `Activate ${name} with the wallet, fund $${capital} and make one real payment through it.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the receipt token.`;
  if (c.includes('chain')) return `Fund the wallet on ${name} with $${capital}, use two of its native apps and bridge a small amount back out.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action: what to repeat so the record keeps growing. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'add a small top-up deposit or adjust the borrow once';
  if (c.includes('dex') || c.includes('cross chain')) return 'make one swap of $25 or more and rebalance the pool position once';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'open and close one small hedged trade';
  if (c.includes('bridge')) return 'bridge a small amount in one direction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return 'move a small amount between two vaults or add a top-up deposit';
  if (c.includes('prediction')) return 'take one small position in a new market';
  return 'repeat the core action once with a small amount';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names: the same rules write every plan, and the figures in it are the protocol's own.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const steps: { text: string; cost: string; time: string }[] = [
    {
      text: `Create a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline on paper.`,
      cost: `under $${gas.one} of ${gas.label} for its first transaction`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas.one} of ${gas.label}`,
      time: '20 minutes to set up',
    },
  ];
  if (p.chains.length > 1) {
    steps.push({
      text: `Repeat a smaller version of the position on ${p.chains[1]}, the second chain ${p.name} counts TVL on, so the wallet shows activity on more than one network.`,
      cost: `about $${Math.max(25, Math.round(capital / 4))} of extra capital plus bridge fees of about $${gas.one}`,
      time: '25 minutes',
    });
  } else {
    steps.push({
      text: `Deepen the same position once after the first week: add about a quarter of the starting capital so the record shows a returning user, not a one-off deposit.`,
      cost: `about $${Math.max(25, Math.round(capital / 4))} of extra capital plus about $${gas.week} of ${gas.label}`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `Once a week, ${weeklyFor(p)} on ${p.name}; steady weekly records are what points programs and snapshots reward.`,
      cost: `about $${gas.week} of ${gas.label} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one weekly snapshot of ${p.name}'s record.`,
      cost: `the $${capital} stays in the position for the whole hold`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own announcements and points page before withdrawing, and claim only from the link the protocol itself publishes; never pay a fee to claim.`,
      cost: 'nothing to check; a claim fee is a scam',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log with the wallet, the dates and every transaction hash, and unwind the position once the log shows a full season or the protocol confirms a launch with no allocation for farmers.`,
      cost: 'nothing but the log; unwinding costs about the same gas as entering',
      time: '15 minutes at the end',
    },
  );
  return steps.map(stepText);
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      tvl_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration, screenedOut } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    screened_out: screenedOut,
    global_multiple: calibration.global.median_multiple,
    peers: calibration.table,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `the board invents the slug ${r.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = board.slice().sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
