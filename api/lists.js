// Saved ticker lists — server side, so a list created on a laptop is there on
// a phone with no setup. Credentials stay in the Vercel environment; the
// browser never holds one.

import { SB_URL, SB_KEY, storageReady } from './runs.js';
import { parseSymbols } from './scan.js';

const TABLE = '/rest/v1/ticker_lists';

function sbHeaders(extra) {
  return { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, ...(extra || {}) };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!storageReady()) {
    return res.status(200).json({
      ok: true,
      configured: false,
      lists: [],
      hint: 'Set SUPABASE_ANON_KEY in the Vercel project environment variables, then redeploy.',
    });
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(
        SB_URL + TABLE + '?select=id,name,symbols,benchmark,updated_at&order=name.asc',
        { headers: sbHeaders() }
      );
      if (!r.ok) throw new Error(`select ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return res.status(200).json({ ok: true, configured: true, lists: await r.json() });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 80);
      const symbols = parseSymbols(
        Array.isArray(body.symbols) ? body.symbols.join(' ') : body.symbols
      );
      const benchmark = parseSymbols(body.benchmark)[0] || 'SPY';

      if (!name) return res.status(400).json({ ok: false, error: 'List needs a name' });
      if (!symbols.length) return res.status(400).json({ ok: false, error: 'List needs at least one valid ticker' });
      if (symbols.length > 200) return res.status(400).json({ ok: false, error: 'Limit is 200 tickers per list' });

      // Saving a list whose name already exists overwrites it, so "save" is
      // idempotent rather than quietly creating duplicates.
      const r = await fetch(SB_URL + TABLE + '?on_conflict=name', {
        method: 'POST',
        headers: sbHeaders({
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        }),
        body: JSON.stringify({ name, symbols, benchmark, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(`upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const rows = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, configured: true, list: rows[0] || { name, symbols, benchmark } });
    }

    if (req.method === 'DELETE') {
      const name = String((req.query && req.query.name) || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
      const r = await fetch(SB_URL + TABLE + '?name=eq.' + encodeURIComponent(name), {
        method: 'DELETE',
        headers: sbHeaders({ Prefer: 'return=representation' }),
      });
      if (!r.ok) throw new Error(`delete ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const rows = await r.json().catch(() => []);
      return res.status(200).json({ ok: true, configured: true, deleted: rows.length, name });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, configured: true, error: String((err && err.message) || err) });
  }
}
