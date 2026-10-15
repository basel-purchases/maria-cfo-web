import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>readFileSync(resolve(root,p),'utf8');

test('v0.40.1: every JavaScript module is fully parsed, including function bodies',()=>{
  const check=String.raw`
    const fs=require('fs'),path=require('path'),vm=require('vm');
    let count=0;
    function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
      const f=path.join(dir,ent.name);
      if(ent.isDirectory())walk(f);
      else if(f.endsWith('.js')){new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{identifier:f});count++;}
    }}
    walk(process.argv[1]);
    console.log('Parsed',count,'JavaScript modules');
  `;
  const r=spawnSync(process.execPath,['--no-warnings','--experimental-vm-modules','-e',check,resolve(root,'js')],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/Parsed \d+ JavaScript modules/);
});

test('v0.40.1: app module import graph links without missing exports or files',()=>{
  const check=String.raw`
    const vm=require('vm'),fs=require('fs'),path=require('path');
    const cache=new Map();
    function mod(f){if(cache.has(f))return cache.get(f);
      const m=new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{identifier:f});cache.set(f,m);return m;}
    const entry=mod(path.join(process.argv[1],'js/app.js'));
    entry.link((spec,parent)=>{
      if(/^https?:\/\//.test(spec))return new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',()=>null);},{identifier:spec});
      const f=path.resolve(path.dirname(parent.identifier),spec.split('?')[0]);
      if(!fs.existsSync(f))throw new Error('Missing imported file: '+spec+' from '+parent.identifier);
      return mod(f);
    }).then(()=>console.log('Linked',cache.size,'modules')).catch(err=>{console.error(err);process.exitCode=1;});
  `;
  const r=spawnSync(process.execPath,['--no-warnings','--experimental-vm-modules','-e',check,root],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/Linked \d+ modules/);
});

test('v0.40.1: corrected error message is quoted and cache bust forces new app/modules',()=>{
  assert.match(read('js/pages/events-v034.js'),/EVENT_TABLE_NO_UNPAID_EXTRAS:'لا توجد طلبات معلقة/);
  assert.match(read('js/app.js'),/events-v034\.js\?v=0\.(?:40\.1|41)/);
  assert.match(read('index.html'),/app\.js\?v=0\.(?:40\.1|41)/);
  assert.match(read('index.html'),/id="maria-startup-retry"/);
  assert.match(read('index.html'),/window\.setTimeout\(showStartupError, 12000\)/);
});
