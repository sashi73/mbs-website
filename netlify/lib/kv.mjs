// Job tracker storage: Netlify Blobs only (store "mbs-jobs"). Free, nothing to set up on Netlify.
// update() is safe when two changes arrive at the same moment: it retries instead of overwriting.
// A fresh store handle for every call: Netlify gives each request its own short-lived access token,
// so a handle kept from an earlier request fails with "Token expired" once the function stays warm.
let lib = null;
async function store() {
  if (!lib) lib = import('@netlify/blobs').catch((e) => { lib = null; throw e; });
  const { getStore } = await lib;
  return getStore({ name: 'mbs-jobs', consistency: 'strong' });
}

export async function get(key) {
  const s = await store();
  return (await s.get(key, { type: 'json' })) ?? null;
}

export async function set(key, val) {
  const s = await store();
  await s.setJSON(key, val);
}

// update(key, fn, fallback): reads the value, fn(value) returns the new value, saved safely. Returns the new value.
export async function update(key, fn, fallback = null) {
  const s = await store();
  const start = () => (typeof fallback === 'function' ? fallback() : structuredClone(fallback));
  for (let i = 0; i < 8; i++) {
    const cur = await s.getWithMetadata(key, { type: 'json' });
    let etag = cur && cur.etag;
    if (cur && !etag) {   // some Blobs servers don't send the version tag with a read: get it from the listing
      const { blobs } = await s.list({ prefix: key });
      const b = blobs.find((x) => x.key === key);
      etag = b && b.etag;
    }
    const v = fn(cur && cur.data != null ? cur.data : start());
    const opts = !cur ? { onlyIfNew: true } : etag ? { onlyIfMatch: etag } : {};
    const r = await s.setJSON(key, v, opts);
    if (!r || r.modified !== false) return v;
    await new Promise((res) => setTimeout(res, 40 + Math.random() * 160));   // someone else saved first: read again
  }
  throw new Error('Could not save ' + key + ' (too many changes at once, please try again)');
}

export async function keys(prefix = '') {
  const s = await store();
  const { blobs } = await s.list({ prefix });
  return blobs.map((b) => b.key);
}

// files (photos): stored as bytes with a little metadata
export async function putFile(key, buf, metadata = {}) {
  const s = await store();
  await s.set(key, buf, { metadata });
}
export async function getFile(key) {
  const s = await store();
  const r = await s.getWithMetadata(key, { type: 'arrayBuffer' });
  return r ? { buf: Buffer.from(r.data), metadata: r.metadata || {} } : null;
}
