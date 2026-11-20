import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p, import.meta.url),'utf8');
test('payroll module does not statically import an export from employees page',()=>{
  const payroll=read('js/pages/payroll-v034.js');
  const profile=read('js/pages/employees.js');
  const shared=read('js/employee-adjustment-modal-v1271.js');
  assert.doesNotMatch(payroll,/from\s+['"]\.\/employees\.js/);
  assert.match(payroll,/from ['"]\.\.\/employee-adjustment-modal-v1271\.js\?v=1\.0\.29/);
  assert.match(shared,/export function openEmployeeAdjustmentModalV127\(/);
  assert.match(profile,/export function openEmployeeAdjustmentModalV127\(/);
  assert.match(profile,/sharedEmployeeAdjustmentModalV1271/);
});
test('entrypoint and dependency URLs are revisioned to prevent stale cache mixing',()=>{
  const html=read('index.html');
  const app=read('js/app.js');
  const payroll=read('js/pages/payroll-v034.js');
  assert.match(html,/js\/app\.js\?v=1\.0\.34/);
  assert.match(app,/pages\/payroll-v034\.js\?v=1\.0\.29/);
  assert.match(app,/pages\/employees\.js\?v=1\.0\.29/);
  assert.match(payroll,/employee-adjustment-modal-v1271\.js\?v=1\.0\.29/);
  assert.equal(read('VERSION').trim(),'1.0.34.1');
});
