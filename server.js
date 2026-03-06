'use strict';

const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const {
  getEsliteBestsellers,
  getViewerCountryFromHeaders
} = require('./lib/eslite-bestsellers');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REPORT_MAIL_FROM = process.env.REPORT_MAIL_FROM || process.env.MAIL_FROM || '';

app.use(express.json({ limit: '12mb' }));

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

function normalizeLang(value) {
  const lang = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return lang.startsWith('en') ? 'en' : 'zh';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendReportEmailViaResend({ toEmail, subject, periodText, babyName, lang, reportText }) {
  if (!RESEND_API_KEY) {
    throw new Error('Missing RESEND_API_KEY in server environment variables');
  }
  if (!REPORT_MAIL_FROM) {
    throw new Error('Missing REPORT_MAIL_FROM (or MAIL_FROM) in server environment variables');
  }

  const safePeriod = escapeHtml(periodText || '');
  const safeBabyName = escapeHtml(babyName || 'Baby');
  const safeReportText = escapeHtml(reportText || '');
  const isEn = String(lang || '').toLowerCase().startsWith('en');
  const intro = isEn
    ? '<p style="margin:0 0 12px;">Here is your text report.</p>'
    : '<p style="margin:0 0 12px;">以下是文字版報告。</p>';
  const periodRow = safePeriod
    ? `<p style="margin:0 0 12px;"><strong>${isEn ? 'Analysis range:' : '分析區間：'}</strong> ${safePeriod}</p>`
    : '';
  const textHeading = isEn ? 'Extracted Text Report' : '文字版報告';

  const html = `
    <div style="font-family:Segoe UI,Tahoma,sans-serif;background:#f4efe6;padding:20px;color:#3f372d;">
      <div style="max-width:760px;margin:0 auto;background:#fffdf9;border:1px solid #d8cfbf;border-radius:14px;padding:18px;">
        <h2 style="margin:0 0 10px;color:#A45A3F;">${escapeHtml(subject || '')}</h2>
        <p style="margin:0 0 8px;"><strong>${isEn ? 'Baby:' : '寶寶：'}</strong> ${safeBabyName}</p>
        ${periodRow}
        ${intro}
        <h3 style="margin:14px 0 8px;color:#A45A3F;">${textHeading}</h3>
        <pre style="white-space:pre-wrap;line-height:1.55;margin:0;background:#fff;border:1px dashed #d8cfbf;border-radius:10px;padding:12px;">${safeReportText}</pre>
      </div>
    </div>
  `;

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: REPORT_MAIL_FROM,
      to: [toEmail],
      subject,
      html
    })
  });

  const contentType = resendResp.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await resendResp.json()
    : { raw: await resendResp.text() };

  if (!resendResp.ok) {
    const detail = payload.message || payload.error?.message || payload.error || payload.raw || 'Unknown error';
    throw new Error(`Resend request failed: ${detail}`);
  }

  return payload;
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

    const lang = normalizeLang(req.body?.lang);
    const systemPrompt = lang === 'en'
      ? 'You are a careful and gentle pediatric health assistant. Provide reference guidance only, no diagnosis. Acknowledge parents effort first, then give practical and gentle suggestions. Always respond in English.'
      : '你是謹慎且溫柔的兒科健康分析助理。你只能提供參考建議，不能診斷疾病。請先肯定家長努力，再以溫柔語氣給建議與提醒。請一律以繁體中文（香港用語）回覆。';

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

app.post('/api/send-report-email', async (req, res) => {
  try {
    const toEmail = typeof req.body?.toEmail === 'string' ? req.body.toEmail.trim() : '';
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const periodText = typeof req.body?.periodText === 'string' ? req.body.periodText.trim() : '';
    const babyName = typeof req.body?.babyName === 'string' ? req.body.babyName.trim() : '寶寶';
    const lang = typeof req.body?.lang === 'string' ? req.body.lang.trim() : 'zh';
    const reportText = typeof req.body?.reportText === 'string' ? req.body.reportText : '';

    if (!isValidEmail(toEmail)) {
      return res.status(400).json({ error: 'Invalid recipient email' });
    }
    if (!subject) {
      return res.status(400).json({ error: 'Missing email subject' });
    }
    if (!reportText.trim()) {
      return res.status(400).json({ error: 'Missing report text' });
    }

    const result = await sendReportEmailViaResend({
      toEmail,
      subject,
      periodText,
      babyName,
      lang,
      reportText
    });

    return res.json({ ok: true, id: result.id || null });
  } catch (error) {
    return res.status(500).json({
      error: error && error.message ? error.message : 'Server error'
    });
  }
});

app.get('/api/eslite-bestsellers', async (req, res) => {
  try {
    const forceRefresh = String(req.query?.refresh || '') === '1';
    const seed = req.query?.seed;
    const viewerCountry = getViewerCountryFromHeaders(req.headers || {});
    const payload = await getEsliteBestsellers({
      forceRefresh,
      seed,
      viewerCountry
    });
    return res.json(payload);
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
