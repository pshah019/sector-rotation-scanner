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

/**
 * List stored runs.
 *
 * weekStart omitted => return the most recent runs and report which week they
 * belong to. Runs are filed by the week of the DATA's last bar, not by today's
 * date, so on a weekend (or any time before the first scan of a new week) the
 * calendar week is empty while real history sits in the previous one. Asking
 * for "latest" instead of "this calendar week" avoids showing a false empty.
 */
export async function listRuns(weekStart) {
  const base = SB_URL + '/rest/v1/rrg_runs?select=id,run_at,as_of,week_start,params,picks';
  const url = weekStart
    ? `${base}&week_start=eq.${encodeURIComponent(weekStart)}&order=run_at.desc`
    : `${base}&order=run_at.desc&limit=25`;
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`select ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (weekStart) return { rows, week: weekStart };

  // Narrow "latest" down to just the newest week so the view stays coherent.
  const week = rows.length ? rows[0].week_start : null;
  return { rows: week ? rows.filter((x) => x.week_start === week) : rows, week };
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
  const hasWeek = ISO_DATE.test(week);

  try {
    if (req.method === 'DELETE') {
      // Deleting is destructive, so it never guesses a week.
      if (!hasWeek) {
        return res.status(400).json({ ok: false, error: 'week must be YYYY-MM-DD' });
      }
      const deleted = await deleteWeek(week);
      return res.status(200).json({ ok: true, configured: true, deleted, week });
    }
    if (week && !hasWeek) {
      return res.status(400).json({ ok: false, error: 'week must be YYYY-MM-DD' });
    }
    const out = await listRuns(hasWeek ? week : null);
    return res.status(200).json({ ok: true, configured: true, rows: out.rows, week: out.week });
  } catch (err) {
    return res.status(500).json({ ok: false, configured: true, error: String(err.message || err) });
  }
}
