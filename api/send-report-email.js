'use strict';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return {};
    }
  }
  return body;
}

function parsePdfDataUrl(dataUrl) {
  const match = /^data:application\/pdf(?:;[^,]*)?,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) return null;
  return { base64: match[1] };
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

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    const mailFrom = process.env.REPORT_MAIL_FROM || process.env.MAIL_FROM || '';
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing RESEND_API_KEY in Vercel environment variables' });
    }
    if (!mailFrom) {
      return res.status(500).json({ error: 'Missing REPORT_MAIL_FROM (or MAIL_FROM) in Vercel environment variables' });
    }

    const body = getBody(req);
    const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const periodText = typeof body.periodText === 'string' ? body.periodText.trim() : '';
    const babyName = typeof body.babyName === 'string' ? body.babyName.trim() : 'Baby';
    const lang = typeof body.lang === 'string' ? body.lang.trim() : 'zh';
    const reportText = typeof body.reportText === 'string' ? body.reportText : '';
    const reportPdfDataUrl = typeof body.reportPdfDataUrl === 'string' ? body.reportPdfDataUrl : '';

    if (!isValidEmail(toEmail)) {
      return res.status(400).json({ error: 'Invalid recipient email' });
    }
    if (!subject) {
      return res.status(400).json({ error: 'Missing email subject' });
    }
    if (!reportText.trim()) {
      return res.status(400).json({ error: 'Missing report text' });
    }
    const parsedPdf = parsePdfDataUrl(reportPdfDataUrl);
    if (!parsedPdf) {
      return res.status(400).json({ error: 'Invalid report PDF data' });
    }

    const isEn = String(lang).toLowerCase().startsWith('en');
    const safeSubject = escapeHtml(subject);
    const safeBabyName = escapeHtml(babyName);
    const safePeriod = escapeHtml(periodText);
    const safeReport = escapeHtml(reportText);
    const intro = isEn
      ? '<p style="margin:0 0 12px;">Your report is attached as a print-ready PDF preserving the same visual layout.</p>'
      : '<p style="margin:0 0 12px;">你的報告已附上可列印 PDF，並保留與頁面一致的視覺版面。</p>';
    const periodRow = safePeriod
      ? `<p style="margin:0 0 12px;"><strong>${isEn ? 'Analysis range:' : '分析區間：'}</strong> ${safePeriod}</p>`
      : '';
    const textHeading = isEn ? 'Extracted Text Report' : '文字版報告';

    const html = `
      <div style="font-family:Segoe UI,Tahoma,sans-serif;background:#f4efe6;padding:20px;color:#3f372d;">
        <div style="max-width:760px;margin:0 auto;background:#fffdf9;border:1px solid #d8cfbf;border-radius:14px;padding:18px;">
          <h2 style="margin:0 0 10px;color:#A45A3F;">${safeSubject}</h2>
          <p style="margin:0 0 8px;"><strong>${isEn ? 'Baby:' : '寶寶：'}</strong> ${safeBabyName}</p>
          ${periodRow}
          ${intro}
          <h3 style="margin:14px 0 8px;color:#A45A3F;">${textHeading}</h3>
          <pre style="white-space:pre-wrap;line-height:1.55;margin:0;background:#fff;border:1px dashed #d8cfbf;border-radius:10px;padding:12px;">${safeReport}</pre>
        </div>
      </div>
    `;

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: mailFrom,
        to: [toEmail],
        subject,
        html,
        attachments: [
          {
            filename: 'baby-health-report.pdf',
            content: parsedPdf.base64
          }
        ]
      })
    });

    const contentType = resendResp.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await resendResp.json()
      : { raw: await resendResp.text() };

    if (!resendResp.ok) {
      const detail = payload.message || payload.error?.message || payload.error || payload.raw || 'Unknown error';
      return res.status(resendResp.status).json({
        error: `Resend request failed: ${detail}`
      });
    }

    return res.status(200).json({ ok: true, id: payload.id || null });
  } catch (error) {
    return res.status(500).json({
      error: error && error.message ? error.message : 'Server error'
    });
  }
};
