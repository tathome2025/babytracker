'use strict';

const ONLINE_BESTSELLER_API = 'https://athena.eslite.com/api/v1/best_sellers/online/day';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = '__babyTrackerEsliteCacheV1';

const CATEGORY = {
  toddler: { id: '42638', limit: 2 },
  parent: { id: '83', limit: 2 }
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

function mapBook(product, rank) {
  return {
    rank,
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

async function fetchTopByCategory(regionKey, categoryId, limit) {
  const region = REGION_CONFIG[regionKey] || REGION_CONFIG.tw;
  const url = new URL(ONLINE_BESTSELLER_API);
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
  return list.slice(0, limit).map((book, index) => mapBook(book, index + 1));
}

async function fetchRegionBooks(regionKey) {
  const [toddler, parent] = await Promise.all([
    fetchTopByCategory(regionKey, CATEGORY.toddler.id, CATEGORY.toddler.limit),
    fetchTopByCategory(regionKey, CATEGORY.parent.id, CATEGORY.parent.limit)
  ]);

  return { toddler, parent };
}

async function refreshCache() {
  const [hk, tw] = await Promise.all([fetchRegionBooks('hk'), fetchRegionBooks('tw')]);
  const cache = {
    updatedAt: new Date().toISOString(),
    regions: { hk, tw }
  };
  globalThis[CACHE_KEY] = cache;
  return cache;
}

function isCacheStale(cache, nowMs) {
  if (!cache || !cache.updatedAt || !cache.regions) return true;
  const updatedAtMs = Date.parse(cache.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs >= CACHE_TTL_MS;
}

async function getEsliteBestsellers(options = {}) {
  const nowMs = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);
  const viewerCountry = normalizeCountryCode(options.viewerCountry);
  const mappedRegion = mapRegionFromCountry(viewerCountry);

  let source = 'cache';
  let cache = globalThis[CACHE_KEY];

  if (forceRefresh || isCacheStale(cache, nowMs)) {
    cache = await refreshCache();
    source = 'live';
  }

  return {
    updatedAt: cache.updatedAt,
    source,
    viewerCountry,
    recommendedRegion: mappedRegion || 'tw',
    regions: cache.regions
  };
}

module.exports = {
  getEsliteBestsellers,
  getViewerCountryFromHeaders,
  mapRegionFromCountry
};
