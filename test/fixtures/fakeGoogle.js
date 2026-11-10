// A pretend Google Drive + Sheets for the report tests (records every request).

/** Whether a search (Drive "q", maybe "'<folder>' in parents" and a reportKind label) finds the file. */
function listed(url, file) {
  const q = url.searchParams.get('q') ?? '';
  const folder = q.match(/^.*'([^']*)' in parents/)?.[1];
  const kind = q.match(/key='reportKind' and value='([^']*)'/)?.[1];
  return !file.trashed && (!folder || Boolean(file.parents?.includes(folder))) && (!kind || file.appProperties?.reportKind === kind);
}

/** A pretend Drive + Sheets that records every request. */
export function fakeGoogle() {
  const files = new Map();
  const calls = [];
  let n = 0;
  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  const send = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', url: u, body });
    if (u.host === 'sheets.googleapis.com') return json(u.pathname.endsWith(':batchUpdate') ? {} : { sheets: [{ properties: { sheetId: 0 } }] });
    const id = u.pathname.match(/\/files\/([^/]+)/)?.[1];
    if (init.method === 'POST') { n += 1; const f = { id: `s${n}`, ...body }; files.set(f.id, f); return json(f); }
    if (init.method === 'PATCH') {
      const f = files.get(id);
      Object.assign(f, { ...body, appProperties: { ...f.appProperties, ...body.appProperties } });
      if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')];
      return json(f);
    }
    return json({ files: [...files.values()].filter((f) => listed(u, f)) });
  };
  return { files, calls, send };
}
