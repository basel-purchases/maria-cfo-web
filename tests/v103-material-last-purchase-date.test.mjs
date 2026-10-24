import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatMaterialLastPurchaseDate} from '../js/material-purchase-date-v103.js';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('last purchase shows the imported business calendar date, not the local timezone date', () => {
  assert.equal(formatMaterialLastPurchaseDate('2026-10-07T00:00:00+00:00'), '07/10/2026');
  assert.equal(formatMaterialLastPurchaseDate('2026-08-09T00:00:00+00:00'), '09/08/2026');
  assert.equal(formatMaterialLastPurchaseDate('2026-10-07'), '07/10/2026');
  assert.equal(formatMaterialLastPurchaseDate('2026-10-07 00:00:00+00'), '07/10/2026');
});

test('last purchase is unknown, not today or zero, when there is no date', () => {
  for (const value of [null, undefined, '', 'invalid', '2026-02-30', '2026-13-01']) {
    assert.equal(formatMaterialLastPurchaseDate(value), '—');
  }
});

test('materials screen retains purchase date in details and all-filtered-rows export', () => {
  const page = read('js/pages/materials.js');
  assert.match(page, /\['تاريخ آخر شراء معروف',formatMaterialLastPurchaseDate\(material\.last_purchase_at\)\]/);
  assert.match(page, /showMaterialDetailsV113/);
  assert.match(page, /headers:\[[^\]]*'تاريخ آخر شراء معروف'/);
  assert.match(page, /rows:filtered\.map\(x=>\{/);
  assert.match(page, /formatMaterialLastPurchaseDate\(x\.last_purchase_at\)/);
  assert.doesNotMatch(page, /\.from\(['"]purchase_invoices['"]\)/);
  const css = read('assets/styles.css');
  assert.match(css, /\.materials-compact-v113 \.materials-table\{min-width:0!important/);
  assert.match(css, /\.material-detail-grid-v113/);
});

test('new version invalidates cached materials module and stylesheet while preserving config reference', () => {
  const app = read('js/app.js');
  const index = read('index.html');
  assert.match(app, /materials\.js\?v=1\.0\.13/);
  assert.match(index, /styles\.css\?v=1\.0\.14/);
  assert.match(index, /app\.js\?v=1\.0\.14/);
  assert.match(index, /<script src="\.\/config\.js"><\/script>/);
  assert.equal(read('VERSION').trim(), '1.0.14');
});
