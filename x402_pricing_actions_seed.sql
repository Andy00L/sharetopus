-- x402 pay-per-call pricing seed
-- Run once after deploying the x402 routes.
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO public.pricing_actions (action, display_name, usdc_price, description, recurrence, metadata)
VALUES
  ('post.text',         'Post text',        0.50,  'Single text post on linkedin/tiktok/pinterest/instagram',                'one_time', '{}'),
  ('post.image',        'Post image',       0.75,  'Single image post on linkedin/tiktok/pinterest/instagram',               'one_time', '{}'),
  ('post.video',        'Post video',       1.00,  'Single video post on linkedin/tiktok/pinterest/instagram',               'one_time', '{}'),
  ('upload_url',        'Mint upload URL',  0.10,  'Sign a Supabase Storage upload URL for media',                           'one_time', '{}'),
  ('reschedule',        'Reschedule post',  0.10,  'Change the scheduled_at of one or more scheduled posts',                 'one_time', '{}'),
  ('cancel',            'Cancel post',      0.001, 'Cancel scheduled posts (minimum onchain fee due to EIP-3009 value > 0)', 'one_time', '{}'),
  ('delete',            'Delete post',      0.001, 'Hard delete scheduled or completed posts',                               'one_time', '{}'),
  ('list_connections',  'List connections', 0.001, 'Read list of connected social accounts',                                 'one_time', '{}'),
  ('list_posts',        'List posts',       0.001, 'Read scheduled posts',                                                   'one_time', '{}'),
  ('list_history',      'List history',     0.001, 'Read content history',                                                   'one_time', '{}'),
  ('analytics_query',   'Analytics query',  0.05,  'Query analytics_metrics for posted content',                             'one_time', '{}'),
  ('storage_overage',   'Storage overage',  0.05,  'Per-GB monthly storage charge (informational only for MVP)',             'monthly',  '{}')
ON CONFLICT (action) DO NOTHING;
