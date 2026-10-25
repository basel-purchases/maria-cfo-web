# Maria CFO Web v1.0.16 - Three cashbox balances in the top navigation

## The change

- The header always includes three compact cashbox cards in the center between the current page title and notifications.
- The cards show the cashbox name and the **current expected balance** from the same `cashboxOverview` data source and field precedence as the cashboxes page. They are ordered by the configured `display_order`, not by hard-coded IDs.
- Clicking **any** card immediately navigates to `#/cashboxes` using a normal link (also supports keyboard access).
- Balances refresh when the application opens, every 60 seconds while the browser is visible, and after returning to the tab. Cashbox adjustments on the cashboxes page update the header immediately using that page's already-fetched result.
- Missing balances show `-` instead of an invented zero. If refresh fails, the last displayed balance is marked visually as outdated and explained in the hover title. The UI does not silently claim a failed refresh is current.
- On wide screens the three cashbox cards appear in the same header row. On narrow screens they remain in the header in a centered second row with no horizontal scrolling.

## Accounting and data safety

- No new tables, no SQL migration, no balance editing, and no direct cashbox transaction writes were introduced for this feature.
- The header uses the same `cashboxOverview()` function used by the existing cashboxes page; that function ensures today's sessions as part of the existing workflow, then reads cashbox session summaries.
- Values are formatted as Syrian pound amounts with thousand separators, without unnecessary descriptions in the header.
- The three existing cashboxes are **Cashbox 1**, **Cashbox 2**, and **General Cashbox**, but labels and IDs are read from Supabase so they follow database changes.

## Deployment

1. Upload the **entire** ZIP to the website, replacing site files.
2. **Keep the existing `config.js` unchanged**; it is not included in the ZIP.
3. Hard refresh the browser and check that the sidebar says `Web v1.0.16`.
4. On two different pages check that the three balances appear and that clicking each one opens the cashboxes page.
5. After recording a test adjustment through the normal cashboxes screen, verify that both the card on that screen and the quick header display the same updated balance.

## Verification boundaries

- Local automated tests passed; the feature was not tested against the user's live Supabase project.
- The Chromium screenshot attempt could not complete in this environment. Verify the top header spacing at desktop and mobile widths on the published site.
