# Maria CFO Web v0.22 - OCR Column Reconstruction

## What changed

OCR.space Engine 3 can return all product names first and all numeric columns afterward. In v0.21, this resulted in zero suggested items because the parser expected name, quantity and price on the same line. v0.22 conservatively identifies an explicitly marked item-name column and a matching number of rows terminated by unit labels.

An OCR operation still produces TEXT ONLY. The operator must click the separate button to transform reviewed text into suggested items. No OCR request creates catalog items, order drafts or posted financial transactions.

If a unit price is hidden or unreadable, it may be calculated as `line total / quantity` only when both values were read and every row aligns. The calculated price is prominently flagged for human review. Any row-count mismatch prevents column pairing entirely.

Engine 1 may currently reject Arabic with `E201` even though `ara` is its documented language code. The `ocr-space` Edge Function maps that response to a clear error instructing the user to try Engine 3. Engine 1 is deprecated; the project does not silently switch engines or spend Engine 3 quota.

## Deployment

1. Back up the current GitHub repository. Replace the existing project files with the full v0.22 ZIP, but keep existing `config.js` and all Git/GitHub settings. Do not delete the repository before copying.
2. Supabase SQL: **no new migration**. The existing v0.21 schema remains unchanged.
3. To improve the Engine 1 error message, replace the code in the existing `ocr-space` Supabase Edge Function with `supabase/functions/ocr-space/index.ts`, then Deploy. Do not replace `assistant`, `document-ocr` or the secret `OCR_SPACE_API_KEY`.
4. Hard-refresh the page and confirm the footer reads `Web v0.22`.

## Verification

- Engine 3 extraction: only text should change; the item table must remain unchanged until the user presses the conversion button.
- On an OCR response with nine separated item names and nine separated numeric groups, the conversion button should produce nine editable suggestions.
- Reference fixture: a document with item totals 200 + 150 + 1,500 + 2,000 + 4,000 + 30,000 + 1,500 + 2,500 + 1,500 should reconcile to 43,350. The price for the 30,000 total and quantity 3 is a *derived suggestion*, 10,000, and must be checked against the image.
- A mismatched number of names and numeric groups must not result in arbitrarily shifted values.
- Unmatched names still require selecting/creating the proper item in the catalog. Publishing requires the normal validated fields and explicit confirmation.

## Limits

This parser is designed for the provided Engine 3 output format and other similar column-wise OCR results. It does not guarantee all receipt designs will parse automatically; users should edit the text or input missing rows manually when document alignment is ambiguous. JavaScript and TypeScript syntax checks and local tests ran without connecting to the user's live Supabase or OCR.space key.
