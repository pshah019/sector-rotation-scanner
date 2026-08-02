// Run storage — server side.
//
// The dashboard never talks to Supabase directly and never holds a key. The
// credential lives in a Vercel environment variable, so any device that can
// open the site gets the same history with no setup.

export const SB_URL = process.env.SUPABASE_URL || 'https://ihlggfdwbhgechoqvrri.supabase.co';
export const SB_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';

export const storageReady = () => !!(SB_URL && SB_KEY);

function sbHeaders(extra) {
  return { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, ...(extra || {}) };
}

export async function insertRun(row) {
  const r = await fetch(SB_URL + '/rest/v1/rrg_runs', {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insert ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export async function listRuns(weekStart) {
  const url =
    SB_URL +
    '/rest/v1/rrg_runs?week_start=eq.' +
    encodeURIComponent(weekStart) +
    '&select=id,run_at,as_of,params,picks&order=run_at.desc';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`select ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function deleteWeek(weekStart) {
  const r = await fetch(
    SB_URL + '/rest/v1/rrg_runs?week_start=eq.' + encodeURIComponent(weekStart),
    { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=representation' }) }
  );
  if (!r.ok) throw new Error(`delete ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!storageReady()) {
    return res.status(200).json({
      ok: true,
      configured: false,
      rows: [],
      hint: 'Set SUPABASE_ANON_KEY in the Vercel project environment variables, then redeploy.',
    });
  }

  const week = (req.query && req.query.week) || '';
  if (!ISO_DATE.test(week)) {
    return res.status(400).json({ ok: false, error: 'week must be YYYY-MM-DD' });
  }

  try {
    if (req.method === 'DELETE') {
      const deleted = await deleteWeek(week);
      return res.status(200).json({ ok: true, configured: true, deleted, week });
    }
    const rows = await listRuns(week);
    return res.status(200).json({ ok: true, configured: true, rows, week });
  } catch (err) {
    return res.status(500).json({ ok: false, configured: true, error: String(err.message || err) });
  }
}
