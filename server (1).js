// Cold Open local server. No dependencies. Needs Node 18+.
// Usage: node server.js   (optional: ANTHROPIC_API_KEY=... for AI coach notes)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.COLD_OPEN_MODEL || 'claude-sonnet-5-5';


// ---- Google Trends topics (cached 15 min per region) ----
const cache = {};
const dec = t => t.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)); return m ? dec(m[1].trim()) : ''; };
async function trends(geo) {
  const hit = cache[geo];
  if (hit && Date.now() - hit.t < 15 * 60 * 1000) return hit.d;
  const urls = [`https://trends.google.com/trending/rss?geo=${geo}`, `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const xml = await r.text();
      const out = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
        title: tag(m[1], 'title'), traffic: tag(m[1], 'ht:approx_traffic'),
        news: tag(m[1], 'ht:news_item_title'), source: tag(m[1], 'ht:news_item_source')
      })).filter(i => i.title);
      if (out.length) { cache[geo] = { t: Date.now(), d: out }; return out; }
    } catch (e) {}
  }
  return [];
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/status') return send(res, 200, { coach: !!KEY });

  if (req.method === 'GET' && url === '/api/topics') {
    const geo = (new URL(req.url, 'http://x').searchParams.get('geo') || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    return send(res, 200, await trends(geo));
  }

  if (req.method === 'POST' && url === '/api/coach') {
    if (!KEY) return send(res, 503, { error: 'ANTHROPIC_API_KEY not set' });
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 100000) return send(res, 413, { error: 'too large' }); }
    try {
      const { prompt } = JSON.parse(raw);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: String(prompt) }] })
      });
      const data = await r.json();
      if (!r.ok) return send(res, 502, { error: data });
      const text = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
      return send(res, 200, text);
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }

  if (req.method === 'GET' && (url === '/' || url === '/index.html'))
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
  send(res, 404, { error: 'not found' });
}).listen(PORT, process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`Cold Open running at http://localhost:${PORT}`);
  console.log(KEY ? 'AI coach notes: on' : 'AI coach notes: off (set ANTHROPIC_API_KEY to turn on)');
});
