// /api/weeks
// Returns all reports for a given sync, across all weeks.
// Each entry: { weekEnding, reportId, businessPurpose, updatedAt, legacy }
// Sorted: newest weekEnding first; within a week, most recently updated first.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const sync = (url.searchParams.get('sync') || '').trim();
  if (!sync) return json({ reports: [] }, 200);

  const prefix = `expenses:${sync}:`;
  let cursor = undefined;
  const reports = [];
  while (true) {
    const page = await env.EXPENSES_KV.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      const suffix = k.name.slice(prefix.length);
      const m = /^(\d{4}-\d{2}-\d{2})(?::(.+))?$/.exec(suffix);
      if (!m) continue;
      const weekEnding = m[1];
      const reportId = m[2] || ''; // empty string = legacy key
      const rec = await env.EXPENSES_KV.get(k.name, 'json');
      reports.push({
        weekEnding,
        reportId,
        legacy: !reportId,
        businessPurpose: rec?.businessPurpose || rec?.data?.businessPurpose || '',
        updatedAt: rec?.updatedAt || ''
      });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  reports.sort((a, b) => {
    if (a.weekEnding !== b.weekEnding) {
      return b.weekEnding.localeCompare(a.weekEnding);
    }
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  return json({ reports }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
