'use strict';

const {
  getEsliteBestsellers,
  getViewerCountryFromHeaders
} = require('../lib/eslite-bestsellers');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const forceRefresh = String(req.query?.refresh || '') === '1';
    const seed = req.query?.seed;
    const viewerCountry = getViewerCountryFromHeaders(req.headers || {});
    const payload = await getEsliteBestsellers({
      forceRefresh,
      seed,
      viewerCountry
    });

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      error: error && error.message ? error.message : 'Server error'
    });
  }
};
