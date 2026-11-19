-- Maria CFO v1.0.24: READ ONLY -- does not create sessions or alter cash.
-- Run after installing Maria-CFO-Web-v1.0.24-Cashbox-Continuity.sql.
-- One record per cashbox; today's amount should equal yesterday's live balance
-- plus actual cash transactions booked into today's session.
SELECT
  c.name AS cashbox_name,
  c.is_general,
  public.cashbox_business_today_v124() AS business_today,
  s.business_date AS current_session_date,
  s.status AS current_session_status,
  s.opening_balance_base AS current_session_opening_recorded,
  ss.expected_balance_base AS legacy_daily_expected_balance,
  public.cashbox_live_balance_base_v124(c.id,public.cashbox_business_today_v124()-1) AS yesterday_live_base,
  COALESCE((SELECT SUM(CASE WHEN t.direction='in' THEN t.amount_base
                            WHEN t.direction='out' THEN -t.amount_base ELSE 0 END)
             FROM public.cashbox_transactions t
             JOIN public.cashbox_sessions txs ON txs.id=t.session_id
            WHERE t.cashbox_id=c.id AND t.is_void=FALSE
              AND txs.business_date=public.cashbox_business_today_v124()),0) AS today_net_transactions_base,
  public.cashbox_live_balance_base_v124(c.id,public.cashbox_business_today_v124()) AS persistent_live_balance_base
FROM public.cashboxes c
LEFT JOIN public.cashbox_sessions s
  ON s.cashbox_id=c.id AND s.business_date=public.cashbox_business_today_v124()
LEFT JOIN public.cashbox_session_summary ss ON ss.session_id=s.id
ORDER BY c.display_order NULLS LAST,c.name;

-- If a routine is missing, v1.0.24 SQL has not been applied completely.
SELECT name, to_regprocedure('public.'||name) IS NOT NULL AS installed
FROM (VALUES
 ('get_or_create_cashbox_session(uuid,date)'),
 ('ensure_cashbox_day_v013(date)'),
 ('cashbox_live_balance_base_v124(uuid,date)'),
 ('cashbox_business_today_v124()'),
 ('get_cashbox_overview_v124(date)')
) AS expected(name);
