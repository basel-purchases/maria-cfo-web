import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseColumnarOcrItems} from '../js/image-column-parser.js';
import {reviewedOcrItemCandidates} from '../js/image-document-rules.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const documentText=[
  '\u0641\u0627\u062a\u0648\u0631\u0629 \u0628\u064a\u0639','\u0631\u0642\u0645 \u0627\u0644\u0639\u0645\u0644\u064a\u0629','809',
  '\u0627\u0644\u0635\u0646\u0641','\u0627\u0644\u0648\u062d\u062f\u0629 \u0627\u0644\u0643\u0645\u064a\u0629','\u0627\u0644\u0633\u0639\u0631','\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a',
  '\u0634\u0627\u064a','\u0623\u0648\u0632\u064a','\u062d\u0644\u0648\u0649',
  '\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a','\u0627\u0644\u0635\u0627\u0641\u064a',
  '200.00','200.00','1.00','unit',
  '30,000.00','########','3.00','unit',
  '1,500.00','1500.00','1.00','unit',
  '31,700.00','31700.00','3',
].join('\n');

test('column-aligned OCR finds names, values and preserves source total',()=>{
  const result=parseColumnarOcrItems(documentText);
  assert.equal(result.reason,'MATCHED_COLUMNS');
  assert.equal(result.rows.length,3);
  assert.equal(result.computedTotal,31700);
  assert.equal(result.footerTotal,31700);
  assert.equal(result.totalMatches,true);
  assert.equal(result.rows[0].name,'\u0634\u0627\u064a');
  assert.equal(result.rows[0].unit_price,'200');
});
test('derived unit price is flagged as requiring human review',()=>{
  const result=reviewedOcrItemCandidates(documentText);
  assert.equal(result.length,3);
  assert.equal(result[1].quantity,'3');
  assert.equal(result[1].unit_price,'10000');
  assert.ok(result[1].review_note);
  assert.equal(result[1].ocr_line_total,'30000');
});
test('inconsistent OCR amount group count is rejected, no shifted prices',()=>{
  const short=documentText.replace('1,500.00\n1500.00\n1.00\nunit\n','');
  const result=parseColumnarOcrItems(short);
  assert.equal(result.rows.length,0);
  assert.equal(result.reason,'COLUMN_COUNT_MISMATCH');
});
test('OCR text without verified item table is not guessed',()=>{
  assert.deepEqual(parseColumnarOcrItems('\u0645\u0628\u0644\u063a 30000\n\u0639\u0645\u064a\u0644 \u0645\u062d\u0645\u062f').rows,[]);
});
test('ambiguous comma decimals are rejected rather than misread as 100x',()=>{
  const bad=documentText.replace('200.00\n200.00\n1.00\nunit','1,50\n200.00\n1.00\nunit');
  assert.equal(parseColumnarOcrItems(bad).rows.length,0);
});
test('OCR remains separate from creation of rows, financial calls use existing workflow',()=>{
  const ui=readFileSync(join(root,'js/pages/images.js'),'utf8');
  const segment=ui.split('async function extractOne(')[1].split('async function extractMany(')[0];
  assert.doesNotMatch(segment,/doc\.items\s*=/);
  assert.match(ui,/data-reparse/);
  assert.match(ui,/review_note/);
  assert.match(ui,/await confirmBox/);
});
test('fast engine uses documented Arabic code and maps E201 to useful notice',()=>{
  const edge=readFileSync(join(root,'supabase/functions/ocr-space/index.ts'),'utf8');
  assert.match(edge,/engine===3\?'auto':'ara'/);
  assert.match(edge,/OCR_ENGINE1_ARABIC_UNAVAILABLE_USE_ENGINE3/);
});
