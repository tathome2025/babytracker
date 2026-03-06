'use strict';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function extractResponseText(payload) {
  if (!payload) return '';
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  if (!Array.isArray(payload.output)) return '';

  const lines = [];
  for (const out of payload.output) {
    if (!out || !Array.isArray(out.content)) continue;
    for (const part of out.content) {
      if (part && part.type === 'output_text' && part.text) {
        lines.push(part.text);
      }
    }
  }
  return lines.join('\n').trim();
}

function getPrompt(req) {
  const body = req.body;
  if (!body) return '';
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
    } catch (_) {
      return '';
    }
  }
  return typeof body.prompt === 'string' ? body.prompt.trim() : '';
}

function getLang(req) {
  const body = req.body;
  let value = '';
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      value = typeof parsed.lang === 'string' ? parsed.lang.trim().toLowerCase() : '';
    } catch (_) {
      value = '';
    }
  } else {
    value = typeof body?.lang === 'string' ? body.lang.trim().toLowerCase() : '';
  }
  return value.startsWith('en') ? 'en' : 'zh';
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY in Vercel environment variables' });
    }

    const prompt = getPrompt(req);
    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const lang = getLang(req);
    const systemPrompt = lang === 'en'
      ? 'You are a careful and gentle pediatric health assistant. Provide reference guidance only, no diagnosis. Acknowledge parents effort first, then give practical and gentle suggestions. Always respond in English.'
      : '你是謹慎且溫柔的兒科健康分析助理。你只能提供參考建議，不能診斷疾病。請先肯定家長努力，再以溫柔語氣給建議與提醒。請一律以繁體中文（香港用語）回覆。';

    const openaiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        input: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const contentType = openaiResp.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await openaiResp.json()
      : { raw: await openaiResp.text() };

    if (!openaiResp.ok) {
      const detail = payload.error?.message || payload.error || payload.raw || 'Unknown error';
      return res.status(openaiResp.status).json({
        error: `OpenAI request failed: ${detail}`
      });
    }

    const report = extractResponseText(payload);
    if (!report) {
      return res.status(502).json({ error: 'OpenAI returned empty report text' });
    }

    return res.status(200).json({ report });
  } catch (error) {
    return res.status(500).json({
      error: error && error.message ? error.message : 'Server error'
    });
  }
};
