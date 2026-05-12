-- Atomic wallet registration RPC.
-- Inserts principal + wallet + sanctions_screening + x402_charge + wallet_credits
-- as a single transaction. Rolls back on any failure.
--
-- Trigger order matters: x402_charges_must_be_wallet checks that
-- principals.kind='wallet' for the principal_id. So principals INSERT
-- must come before x402_charges INSERT.
--
-- Returns JSONB: { principal_id, wallet_id, charge_id } on success.
-- On failure: raises exception, transaction rolls back.

CREATE OR REPLACE FUNCTION public.register_wallet_atomic(
  p_principal_id text,
  p_address text,
  p_chain text,
  p_charge_nonce text,
  p_charge_request_id text,
  p_charge_tx_hash text,
  p_charge_block_number bigint,
  p_charge_amount_usdc numeric,
  p_charge_facilitator_fee_usdc numeric,
  p_charge_network text,
  p_charge_asset text,
  p_charge_payer_address text,
  p_charge_recipient_address text,
  p_charge_facilitator text,
  p_charge_settled_at timestamptz,
  p_sanctions_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_charge_id uuid;
BEGIN
  -- Step 1: insert principal (kind='wallet')
  INSERT INTO principals (id, kind, metadata)
  VALUES (p_principal_id, 'wallet', '{}'::jsonb);

  -- Step 2: insert wallet (FK to principals)
  INSERT INTO wallets (id, address, chain, sanctions_status, sanctions_checked_at)
  VALUES (p_principal_id, p_address, p_chain, 'clean', now());

  -- Step 3: insert sanctions screening
  INSERT INTO sanctions_screenings (wallet_id, result, source)
  VALUES (p_principal_id, 'clean', p_sanctions_source);

  -- Step 4: insert x402_charge (status='settled')
  -- Trigger x402_charges_must_be_wallet now passes because principal exists with kind='wallet'.
  INSERT INTO x402_charges (
    principal_id,
    wallet_id,
    action,
    amount_usdc,
    amount_usd_at_receipt,
    network,
    asset,
    nonce,
    request_id,
    payer_address,
    recipient_address,
    status,
    facilitator,
    facilitator_fee_usdc,
    tx_hash,
    block_number,
    settled_at
  ) VALUES (
    p_principal_id,
    p_principal_id,
    'register',
    p_charge_amount_usdc,
    p_charge_amount_usdc,
    p_charge_network,
    p_charge_asset,
    p_charge_nonce,
    p_charge_request_id,
    p_charge_payer_address,
    p_charge_recipient_address,
    'settled',
    p_charge_facilitator,
    p_charge_facilitator_fee_usdc,
    p_charge_tx_hash,
    p_charge_block_number,
    p_charge_settled_at
  ) RETURNING id INTO v_charge_id;

  -- Step 5: insert wallet_credits with balance=0
  INSERT INTO wallet_credits (wallet_id, balance_usdc)
  VALUES (p_principal_id, 0);

  -- Return identifiers
  RETURN jsonb_build_object(
    'principal_id', p_principal_id,
    'wallet_id', p_principal_id,
    'charge_id', v_charge_id
  );
END;
$$;

-- Grant execute to service_role (what adminSupabase uses).
GRANT EXECUTE ON FUNCTION public.register_wallet_atomic(
  text, text, text, text, text, text, bigint, numeric, numeric,
  text, text, text, text, text, timestamptz, text
) TO service_role;
