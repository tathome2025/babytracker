'use strict';

const ONLINE_BESTSELLER_API_BASE = 'https://athena.eslite.com/api/v1/best_sellers/online';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = '__babyTrackerEsliteCacheV1';

const CATEGORY = {
  toddler: { id: '42638', pickSize: 2, poolSize: 24 },
  parent: { id: '83', pickSize: 2, poolSize: 24 }
};

const REGION_CONFIG = {
  hk: {
    locale: 'zh-HK',
    acceptLanguage: 'zh-HK,zh;q=0.9,en;q=0.8'
  },
  tw: {
    locale: 'zh-TW',
    acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8'
  }
};

function normalizeCountryCode(value) {
  return String(value || '').trim().toUpperCase();
}

function getViewerCountryFromHeaders(headers = {}) {
  return normalizeCountryCode(
    headers['x-vercel-ip-country'] ||
      headers['x-country-code'] ||
      headers['cf-ipcountry'] ||
      headers['x-appengine-country']
  );
}

function mapRegionFromCountry(country) {
  const code = normalizeCountryCode(country);
  if (code === 'HK' || code === 'CN' || code === 'MO') return 'hk';
  if (code === 'TW' || code === 'JP') return 'tw';
  return '';
}

function productUrlFromProduct(product) {
  const esliteSn = String(product?.eslite_sn || '').trim();
  if (esliteSn) {
    return `https://www.eslite.com/product/${encodeURIComponent(esliteSn)}`;
  }

  const title = String(product?.name || '').trim();
  if (!title) return 'https://www.eslite.com/';
  return `https://www.eslite.com/search?keyword=${encodeURIComponent(title)}`;
}

function mapBook(product, rank, category) {
  return {
    rank,
    category,
    title: String(product?.name || '').trim() || 'Untitled',
    imageUrl: String(product?.product_photo_url || '').trim(),
    productUrl: productUrlFromProduct(product)
  };
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    const contentType = resp.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await resp.json()
      : { raw: await resp.text() };

    if (!resp.ok) {
      const detail = payload?.error?.message || payload?.message || payload?.raw || 'Unknown error';
      throw new Error(`Eslite API ${resp.status}: ${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTopByCategory(regionKey, categoryId, limit, period = 'week') {
  const region = REGION_CONFIG[regionKey] || REGION_CONFIG.tw;
  const safePeriod = ['day', 'week', 'month'].includes(period) ? period : 'day';
  const url = new URL(`${ONLINE_BESTSELLER_API_BASE}/${safePeriod}`);
  url.searchParams.set('l1', categoryId);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', String(limit));
  url.searchParams.set('locale', region.locale);

  const payload = await fetchJson(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Language': region.acceptLanguage,
      'User-Agent': 'baby-tracker/1.0 (+https://vercel.com)'
    }
  });

  const list = Array.isArray(payload?.products) ? payload.products : [];
  return list.slice(0, limit);
}

async function fetchCategoryPools(period = 'week') {
  const [toddlerPool, parentPool] = await Promise.all([
    fetchTopByCategory('tw', CATEGORY.toddler.id, CATEGORY.toddler.poolSize, period),
    fetchTopByCategory('tw', CATEGORY.parent.id, CATEGORY.parent.poolSize, period)
  ]);

  return { toddlerPool, parentPool };
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.abs(parsed) : fallback;
}

function pickCycledBooks(pool, pickSize, cursor, category) {
  if (!Array.isArray(pool) || pool.length === 0 || pickSize <= 0) return [];
  const safePick = Math.min(pickSize, pool.length);
  const out = [];
  for (let i = 0; i < safePick; i++) {
    const idx = (cursor + i) % pool.length;
    out.push(mapBook(pool[idx], idx + 1, category));
  }
  return out;
}

function composeBooksFromPools(pools, seed) {
  const seedUsed = toPositiveInt(seed, Date.now());
  const toddlerPool = Array.isArray(pools?.toddlerPool) ? pools.toddlerPool : [];
  const parentPool = Array.isArray(pools?.parentPool) ? pools.parentPool : [];
  const toddlerCursor = toddlerPool.length > 0 ? seedUsed % toddlerPool.length : 0;
  const parentCursor = parentPool.length > 0 ? (seedUsed * 7 + 3) % parentPool.length : 0;

  const toddler = pickCycledBooks(toddlerPool, CATEGORY.toddler.pickSize, toddlerCursor, 'toddler');
  const parent = pickCycledBooks(parentPool, CATEGORY.parent.pickSize, parentCursor, 'parent');

  return {
    seedUsed,
    books: [...toddler, ...parent]
  };
}

async function refreshCache() {
  const pools = await fetchCategoryPools('week');

  const cache = {
    updatedAt: new Date().toISOString(),
    pools
  };
  globalThis[CACHE_KEY] = cache;
  return cache;
}

function isCacheStale(cache, nowMs) {
  if (!cache || !cache.updatedAt || !cache.pools) return true;
  const updatedAtMs = Date.parse(cache.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs >= CACHE_TTL_MS;
}

async function getEsliteBestsellers(options = {}) {
  const nowMs = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);
  const seed = options.seed;
  const viewerCountry = normalizeCountryCode(options.viewerCountry);

  let source = 'cache';
  let cache = globalThis[CACHE_KEY];

  if (forceRefresh || isCacheStale(cache, nowMs)) {
    cache = await refreshCache();
    source = 'live';
  }

  const picks = composeBooksFromPools(cache.pools, seed);

  return {
    updatedAt: cache.updatedAt,
    source,
    sourcePeriod: 'week',
    viewerCountry,
    seedUsed: picks.seedUsed,
    books: picks.books
  };
}

module.exports = {
  getEsliteBestsellers,
  getViewerCountryFromHeaders,
  mapRegionFromCountry
};
