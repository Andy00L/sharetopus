// /supabase/functions/process-scheduled-posts/index.ts
{
  /**import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Configuration
const VERCEL_ENDPOINT = 'https://sharetopus.com/api/cron/process-scheduled-posts';
const CRON_SECRET = 'u&ATp$uz1%Wudp3wyPuM6!V$Mfd%Am8Eq28rP*xY5xMmaWtZ1e';
Deno.serve(async (req)=>{
  const startTime = Date.now();
  console.log("🚀 Edge function triggered for scheduled posts processing");
  // Create Supabase client with admin privileges
  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    // STEP 1: Find all scheduled posts that are due
    const { data: duePosts, error: queryError } = await supabaseAdmin.from('scheduled_posts').select('batch_id, user_id').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString());
    if (queryError) throw queryError;
    // Get unique batch IDs
    const batches = duePosts ? Array.from(new Set(duePosts.map((post)=>JSON.stringify({
        batch_id: post.batch_id,
        user_id: post.user_id
      })))).map((str)=>JSON.parse(str)) : [];
    console.log(`Found ${batches.length} batches to notify API about`);
    if (batches.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No scheduled posts due for processing',
        timestamp: new Date().toISOString(),
        executionTimeMs: Date.now() - startTime
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    // STEP 2: Notify API about each batch (fire and forget)
    for (const batch of batches){
      try {
        // Don't await this - fire and forget
        fetch(VERCEL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CRON_SECRET}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            batch_id: batch.batch_id,
            user_id: batch.user_id,
            secret: CRON_SECRET
          })
        });
        console.log(`Notified API about batch: ${batch.batch_id}`);
      } catch (error) {
        console.error(`Error notifying API about batch ${batch.batch_id}:`, error);
      }
    }
    // STEP 3: Return summary
    return new Response(JSON.stringify({
      success: true,
      notified_batches: batches.length,
      execution_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("FATAL ERROR IN EDGE FUNCTION:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      execution_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
*/
}
