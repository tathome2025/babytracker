'use strict';

const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

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

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    hasOpenAIKey: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL
  });
});

app.post('/api/ai-weekly-report', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'Missing OPENAI_API_KEY in server .env'
      });
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const openaiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        input: [
          {
            role: 'system',
            content: '你是謹慎的兒科健康分析助理，只能提供參考建議，不能診斷疾病。'
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
      return res.status(502).json({
        error: 'OpenAI returned empty report text'
      });
    }

    return res.json({ report });
  } catch (error) {
    return res.status(500).json({
      error: error && error.message ? error.message : 'Server error'
    });
  }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'beta_index.html'));
});

app.listen(PORT, () => {
  console.log(`Baby tracker server running at http://localhost:${PORT}`);
});
