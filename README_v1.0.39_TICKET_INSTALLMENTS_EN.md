# Maria CFO Web v1.0.39 - Event Ticket Installments and Latin Digits

## What changed

- Seat-ticket reservations support an unpaid booking, full collection, or a positive partial first installment.
- Optional next installment due date and notes are attached to the reservation.
- Later installments can be collected from the booking. The view shows ticket total, amount collected, outstanding amount, next due date, installment state and receipt history.
- Each positive installment posts exactly that amount into the selected cashbox using the existing booking payment ledger. Adjusting due dates does not post cash.
- An operation UUID prevents repeat submission of the same deposit or installment from posting a duplicate payment.
- Arabic and Eastern Arabic numerals are displayed as ASCII digits 0-9 throughout the UI. Arabic labels and RTL layout remain unchanged.

## Deployment order

1. Back up your live website and Supabase database. Test changes against a staging Supabase instance before production.
2. Run `database/Maria-CFO-Web-v1.0.39-Event-Ticket-Installments.sql` using Supabase SQL Editor. Your database must already include the existing v1.0.13 seat booking functions, bookings, payments, cashboxes and owner guard.
3. Deploy all files from the ZIP to the existing web root, preserving your existing environment connection configuration. Do not upload a default or blank `config.js` over a working configuration.
4. Force refresh and check that the app reports `v1.0.39`.
5. Create a test ticket booking with an upfront payment smaller than its total; confirm the remaining amount and one cashbox receipt. Collect a second installment and verify it posts once. Check non-payment updates create no receipts.

## Important

- This update does NOT reset any imported menu, ingredient, purchase, sale, inventory, payroll or event records.
- The new audit table `event_booking_installment_ops_v139` is NOT a second cash ledger. The existing booking-payment function remains the sole cash posting authority.
- Existing bookings keep their current payments and balances; they can receive later installments without being re-created.
- An unset ticket price is NOT guessed. An amount of zero can be booked without cash collection.
- SQL was not executed against the user's live Supabase. JavaScript module tests and a Chromium end-to-end simulation with a synthetic API passed; verify database permissions and real posting in staging before using real cash.
- Old source tests that assert retired module versions or Arabic-Indic digit output may fail under this new release. See `tests/v139-event-installments-latin-digits.test.mjs` for the new behavior.
