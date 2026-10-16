// Minimal content-addressed registry for adversarial repros.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const sha = (t) => `sha256:${createHash('sha256').update(t).digest('hex')}`;
export const OCI_M = 'application/vnd.oci.image.manifest.v1+json';
export const OCI_I = 'application/vnd.oci.image.index.v1+json';
export const DOCKER_M = 'application/vnd.docker.distribution.manifest.v2+json';
export const DOCKER_L = 'application/vnd.docker.distribution.manifest.list.v2+json';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Authorization, Accept, Cache-Control',
  'Access-Control-Expose-Headers': 'Docker-Content-Digest, Link',
};
export const createFake = async ({ pageSize, failBlobs = new Set(), delayMs = 0 } = {}) => {
  const manifests = new Map(); // digest -> {body, mediaType}
  const blobs = new Map();
  const tags = new Map(); // tag -> digest
  const deletes = [];
  const api = {
    deletes,
    image(label, created, mediaType = OCI_M, extraConfig = {}) {
      const cfg = JSON.stringify({ created, os: 'linux', architecture: label, ...extraConfig });
      const cd = sha(cfg + label);
      blobs.set(cd, cfg);
      const body = JSON.stringify({
        schemaVersion: 2,
        mediaType,
        config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: cd, size: cfg.length },
        layers: [{ mediaType: 'x', size: 10, digest: sha(`l${label}`) }],
      });
      const d = sha(body);
      manifests.set(d, { body, mediaType });
      return { digest: d, mediaType, size: body.length, configDigest: cd };
    },
    index(children, mediaType = OCI_I) {
      const body = JSON.stringify({
        schemaVersion: 2,
        mediaType,
        manifests: children.map((c, i) => ({
          mediaType: c.mediaType,
          digest: c.digest,
          size: c.size,
          platform: { os: 'linux', architecture: c.arch || `a${i}` },
        })),
      });
      const d = sha(body);
      manifests.set(d, { body, mediaType });
      return { digest: d, mediaType, size: body.length };
    },
    // Stores an arbitrary manifest body under a chosen digest, which a
    // content-addressed index() cannot: self-referencing and cyclic indexes.
    raw(digest, body, mediaType = OCI_I) {
      manifests.set(digest, { body: JSON.stringify({ schemaVersion: 2, mediaType, ...body }), mediaType });
      return { digest, mediaType };
    },
    tag(name, m) {
      tags.set(name, m.digest);
    },
    failBlob(d) {
      failBlobs.add(d);
    },
    exists(d) {
      return manifests.has(d);
    },
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    const send = (s, b, h = {}) => {
      const respond = () => {
        res.writeHead(s, { 'Content-Type': 'application/json', ...CORS, ...h });
        res.end(typeof b === 'string' ? b : JSON.stringify(b));
      };
      // Slow manifest reads, so a test can observe progress while they run.
      if (delayMs && p.includes('/manifests/') && req.method !== 'DELETE') setTimeout(respond, delayMs);
      else respond();
    };
    if (p === '/v2/_catalog') return send(200, { repositories: ['app'] });
    if (p === '/v2/app/tags/list') {
      const all = [...tags.keys()].sort();
      if (!pageSize) return send(200, { name: 'app', tags: all });
      const last = url.searchParams.get('last');
      const start = last ? all.findIndex((t) => t > last) : 0;
      const page = start < 0 ? [] : all.slice(start, start + pageSize);
      const more = start >= 0 && start + pageSize < all.length;
      return send(
        200,
        { name: 'app', tags: page },
        more ? { Link: `</v2/app/tags/list?n=${pageSize}&last=${encodeURIComponent(page.at(-1))}>; rel="next"` } : {},
      );
    }
    let m = /^\/v2\/app\/manifests\/(.+)$/.exec(p);
    if (m) {
      const ref = m[1];
      const d = tags.get(ref) || ref;
      if (req.method === 'DELETE') {
        deletes.push(ref);
        if (!ref.startsWith('sha256:')) return send(405, { errors: [{ code: 'UNSUPPORTED', message: 'unsupported' }] });
        if (!manifests.has(d))
          return send(404, { errors: [{ code: 'MANIFEST_UNKNOWN', message: 'manifest unknown' }] });
        manifests.delete(d);
        for (const [t, v] of [...tags]) if (v === d) tags.delete(t);
        return send(202, '');
      }
      const e = manifests.get(d);
      if (!e) return send(404, { errors: [{ code: 'MANIFEST_UNKNOWN', message: 'manifest unknown' }] });
      return send(200, e.body, { 'Content-Type': e.mediaType, 'Docker-Content-Digest': d });
    }
    m = /^\/v2\/app\/blobs\/(.+)$/.exec(p);
    if (m) {
      if (failBlobs.has(m[1])) return send(500, { errors: [{ code: 'X', message: 'blob broken' }] });
      const b = blobs.get(m[1]);
      return b ? send(200, b) : send(404, { errors: [{ code: 'BLOB_UNKNOWN', message: 'blob unknown' }] });
    }
    send(404, {});
  });
  await new Promise((r) => server.listen(0, r));
  api.url = `http://localhost:${server.address().port}`;
  api.close = () => new Promise((r) => server.close(r));
  return api;
};
