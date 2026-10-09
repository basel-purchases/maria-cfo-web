# Maria CFO Web v0.21 - OCR.space deployment

This release replaces the **active local OCR workflow** on the Images page with an authenticated Supabase proxy to OCR.space. It preserves the original local image archive and all existing financial RPC workflows.

## Deploy in this order

1. Take a backup of the Supabase database and current GitHub repository.
2. Run `database/Maria_CFO_Web_v0.21_Migration.sql` **once** in Supabase SQL Editor. It creates only an OCR usage audit table and read-only usage RPC; it does not change the financial accounting schema.
3. Confirm an Edge Function Secret named `OCR_SPACE_API_KEY` exists. Do not put the key in GitHub, `config.js`, the browser, or this chat.
4. Create a NEW Supabase Edge Function named exactly `ocr-space`; paste the contents of `supabase/functions/ocr-space/index.ts`, then deploy it. Do not replace `assistant` or `document-ocr`.
5. Copy files from the v0.21 ZIP over your existing GitHub Pages repository **without deleting the repository first**. Keep your own `config.js`, `.git`, `.github`, and existing GitHub settings intact.
6. Hard refresh the web page and check the sidebar footer says `Web v0.21`.

## OCR operation

- Engine 1: fast Arabic printed documents (`language=ara`), but this OCR.space engine is deprecated and may eventually stop working.
- Engine 3: stronger OCR including Arabic and some handwriting (`language=auto`), with a much smaller free quota.
- The daily/monthly counters are app-side attempts recorded in Supabase since this migration was deployed. They are **not** official remaining OCR.space credit. They also exclude use outside Maria CFO, and use UTC dates.
- The browser stores images and edited text in IndexedDB. On explicit OCR extraction a copy of the image is sent to OCR.space through the Supabase Edge Function. No image is permanently stored in Supabase by this OCR workflow.
- OCR returns **text only**. The user must explicitly click the button to convert reviewed text into draft rows, or add rows manually.
- New purchase material: type the new name, choose a valid base unit, and confirm creating the draft or posting. The material will be created at that point; an existing exact name should be reused instead of duplicated.
- New order product: use the new-product dialog to specify price and recipe ingredients; return to the selected order row. If a recipe is omitted the food cost may remain provisional.
- Posting requires a complete validated document and explicit user confirmation, then uses existing Supabase RPCs. In the event of an ambiguous network failure, review the server record rather than clicking publish again.

## Verification after deployment

1. Check that the usage counters appear for both engines. If they do not, verify that the SQL migration and `ocr-space` function were deployed successfully.
2. Test one printed Arabic document with Engine 3. Only the raw text should change; **no items should be added automatically**.
3. Click 'convert reviewed text to items', then edit the names, units, quantities and prices in the full-width table. Check the datalist search and creation of an unmatched material/product.
4. Save locally; only when ready and using disposable test data, try creating a draft. Confirm it exists once in Supabase before proceeding to any financial posting.
5. If you see an OCR provider error, read the `ocr-space` Edge Function logs, not `assistant` logs.

## Test limitations

This release passed local source/static and unit tests only. It was not executed against the live database or your API key, and automated Chromium navigation was unavailable in the testing environment. OCR quality, posted financial operations and account quotas therefore require verification after deploying.
