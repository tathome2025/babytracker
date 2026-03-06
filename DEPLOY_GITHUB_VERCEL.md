# GitHub Pages + Vercel Deployment

## 1) Frontend (GitHub Pages)
- Push `beta_index.html`, `ai_weekly_report.html`, `app_config.js` to GitHub.
- Enable GitHub Pages for this repository.

## 2) Backend API (Vercel)
- Import the same repo into Vercel.
- Vercel will expose API route:
  - `/api/ai-weekly-report` (from `api/ai-weekly-report.js`)
- In Vercel Project Settings -> Environment Variables, add:
  - `OPENAI_API_KEY=...`
  - `OPENAI_MODEL=gpt-4.1-mini` (optional)

## 3) Connect frontend to Vercel API
Edit `app_config.js`:

```js
window.BABY_AI_API_BASE = 'https://your-vercel-project.vercel.app';
```

Then redeploy/push GitHub Pages.

## Notes
- Do not commit `.env` or `node_modules`.
- API key must stay only in Vercel environment variables.
