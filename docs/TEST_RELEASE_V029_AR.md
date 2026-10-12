# Maria CFO Web v0.29 - release QA

Checks:
- Node native tests: 154 pass, 6 skipped, 0 failed (160 total).
- Long-select search: standalone Chromium DOM test passes; Arabic alphabetic
  sort, search filtering and selected native value verified.
- Source inventory: 451 material items; 1 source-positive-priced stocked item.
- Original 75 recipes, 729 lines; 64 with sale price, 0 fully costed from
  the provided source inventory workbook alone.
- Protected SQL reset: the initial confirmation is NOT_CONFIRMED; unknown
  public tables cause full rollback; auth/owner and app settings preserved.
- Supabase migrations and full integrated website not run against live DB.
- Review README_v029_AR.md before running any destructive SQL.
