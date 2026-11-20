# Maria CFO Web v1.0.28 - Payroll period, service date protection and advances

## What changed

- Monthly payroll creation now requires an explicit entitlement date in the dialog. Any date within the intended month is accepted. For instance, choose 2026-11-15 on 2026-12-05 to create the November 2026 payroll; the actual creation timestamp is preserved by PostgreSQL.
- Monthly salary calculations continue to use the established payroll engine's intersection between the run's period and the employee hire/termination dates, with the v1.0.23 final-month policy retained. This release does not invent a different salary formula or rewrite settled payrolls.
- The new payroll draft stores a snapshot of the employee's effective service dates. If a service boundary changes, approval is blocked until the draft is recalculated. The guard also runs if an older client calls the former approval RPC.
- Advance entry (including the legacy RPC) and leave entry are rejected when the chosen work date falls outside the inclusive [hire_date, termination_date] range. Fixed-pay work dates also respect that range.
- The employee profile displays the current outstanding advance. The payroll statement displays the current balance and, for drafts only, the estimated balance after approval. The planned deduction is NOT deducted again from the stored balance after approval.
- Advances remain cash movements when actually issued; creating a payroll draft or allocating a repayment does not create a new cash receipt or payout.

## Sample

An employee has an outstanding advance of 3,500,000 SYP. Their payroll has an available balance of 2,000,000 SYP and allocates the full available amount to the advance. Before approval: current balance 3,500,000, expected after approval 1,500,000. Once approved: stored balance 1,500,000 and NO second subtraction from it. Payroll due cannot become negative from this repayment.

## Deployment order (IMPORTANT)

1. Keep a restorable Supabase backup; validate on an isolated staging database first.
2. Confirm all previous migrations are applied through v1.0.27.1 (database migrations through v1.0.27). The v1.0.27.1 boot hotfix itself did not require SQL.
3. Apply `database/Maria-CFO-Web-v1.0.28-Payroll-Period-Service-Advances.sql` in Supabase SQL Editor. It runs in one transaction and does NOT reset data, create any payroll, pay salaries or move cash.
4. Run `database/Maria-CFO-Web-v1.0.28-VERIFY-READONLY.sql` and confirm five RPCs and five triggers appear and that the service columns exist.
5. Recalculate any previously created monthly DRAFTS (they predate the new snapshots) before approval. Do NOT repeat an already approved payroll or salary payment.
6. Upload ALL web files from `Maria-CFO-Web-v1.0.28-FULL.zip` to the same deployment root as index.html; preserve the existing server `config.js` and never share it. Hard-refresh the browser or clear relevant CDN cache; verify `Web v1.0.28` appears.

## Staging acceptance checks

- Create November's monthly draft in December and verify its period_start/end are November 1 and 30, while created_at is the actual creation timestamp.
- Compare salary for an employee hired mid-month and one terminated mid-month (with the final-month paid-days setting, if used) against the established payroll rules.
- Try a loan and leave one day before hire_date and one day after termination_date. Both must fail without creating cash or leave records.
- Approve a draft with a smaller advance deduction than the outstanding amount; check that the residual remains outstanding and never becomes a negative salary.
- Edit a hire date in a draft, then try to approve: it must fail until recalculation. Approved historic payrolls are not automatically rewritten.
- Check multi-currency advances individually; never add SYP and USD in one total.

## Verification actually performed

- `node --test tests/*.test.mjs`: 482 tests, 475 passed, 7 skipped, 0 failed.
- Chromium browser: 6 scenarios with a simulated API, no page errors.
- NOT performed: execution of this SQL on a real PostgreSQL/Supabase server, application deployment to the customer's server, production payroll and financial end-to-end validation. This release must pass staging SQL and payroll acceptance tests before production use.

## Limitations / operating policy

- Existing approved payrolls, advance rows and cashbox movements are not rewritten or recalculated.
- Retroactive service date edits affecting approved monthly payroll are rejected: correct those cases through a separately reviewed, auditable historical adjustment, not an undocumented edit.
- The employee profile is an owner/manager administrative display, not a newly implemented employee self-service portal.
- Existing v1.0.27 manual hourly adjustment rates, Friday-exclusion calculation and historical rate snapshots are preserved.
