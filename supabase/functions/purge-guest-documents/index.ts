// NFR-04 / CR-08: delete ID & passport images whose retention date has passed.
// Runs daily from pg_cron. Uses the service role (built into Edge Functions),
// removes the storage objects first, then the guest_documents rows.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const BATCH = 500;

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().slice(0, 10);
  let purged = 0;

  for (;;) {
    const { data: docs, error } = await supabase
      .from("guest_documents")
      .select("id, storage_path")
      .lt("delete_after", today)
      .limit(BATCH);
    if (error) return Response.json({ error: error.message, purged }, { status: 500 });
    if (!docs?.length) break;

    const { error: rmError } = await supabase.storage.from("guest-docs").remove(docs.map((d) => d.storage_path));
    if (rmError) return Response.json({ error: rmError.message, purged }, { status: 500 });

    const { error: delError } = await supabase.from("guest_documents").delete().in("id", docs.map((d) => d.id));
    if (delError) return Response.json({ error: delError.message, purged }, { status: 500 });

    purged += docs.length;
    if (docs.length < BATCH) break;
  }

  return Response.json({ purged, date: today });
});
