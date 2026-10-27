// Copy every Storage file (ID photos, receipts, payment proofs, cheque photos, property photos,
// exports) from one Supabase project to another. Buckets missing on the target are created with
// the same settings. Safe to re-run: files already on the target with the same size are skipped.
//
// Usage:
//   SOURCE_URL=https://old.supabase.co SOURCE_SERVICE_KEY=... \
//   TARGET_URL=https://new.example.com TARGET_SERVICE_KEY=... \
//   [BUCKETS=guest-documents,expense-receipts] node infra/scripts/storage-copy.mjs
// The service keys bypass all access rules: run this only on a trusted machine and never commit them.
import { createClient } from "@supabase/supabase-js";

const env = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
  return v;
};
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const src = createClient(env("SOURCE_URL"), env("SOURCE_SERVICE_KEY"), opts);
const dst = createClient(env("TARGET_URL"), env("TARGET_SERVICE_KEY"), opts);
const only = process.env.BUCKETS ? new Set(process.env.BUCKETS.split(",").map((s) => s.trim())) : null;

/** All files under a folder, walking sub-folders (Storage lists one level at a time). */
async function listAll(client, bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listAll(client, bucket, path)));
      else files.push({ path, size: item.metadata?.size ?? null, type: item.metadata?.mimetype ?? undefined });
    }
    if (data.length < 1000) return files;
  }
}

const { data: buckets, error } = await src.storage.listBuckets();
if (error) throw error;
const { data: existing } = await dst.storage.listBuckets();
const have = new Set((existing ?? []).map((b) => b.id));
let copied = 0, skipped = 0, failed = 0;

for (const b of buckets) {
  if (only && !only.has(b.id)) continue;
  if (!have.has(b.id)) {
    const { error: e } = await dst.storage.createBucket(b.id, {
      public: b.public, fileSizeLimit: b.file_size_limit ?? undefined, allowedMimeTypes: b.allowed_mime_types ?? undefined,
    });
    if (e) throw new Error(`create bucket ${b.id}: ${e.message}`);
    console.log(`created bucket ${b.id}`);
  }
  const files = await listAll(src, b.id);
  const there = new Map((await listAll(dst, b.id)).map((f) => [f.path, f.size]));
  console.log(`${b.id}: ${files.length} files`);
  for (const f of files) {
    if (there.has(f.path) && there.get(f.path) === f.size) { skipped++; continue; }
    const { data: blob, error: de } = await src.storage.from(b.id).download(f.path);
    if (de) { failed++; console.error(`  download ${f.path}: ${de.message}`); continue; }
    const { error: ue } = await dst.storage.from(b.id).upload(f.path, blob, { upsert: true, contentType: f.type ?? blob.type });
    if (ue) { failed++; console.error(`  upload ${f.path}: ${ue.message}`); continue; }
    copied++;
  }
}
console.log(`done: ${copied} copied, ${skipped} already there, ${failed} failed`);
process.exit(failed ? 1 : 0);
