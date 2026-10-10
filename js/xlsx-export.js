// Dependency-free, Excel-compatible OOXML writer. One sheet, no external network dependencies.
// Exports only the filtered rows passed to it; never reads from a separate unfiltered source.
const encoder=new TextEncoder();
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const colId=index=>{
  let a=index+1,out='';
  while(a>0){a--;out=String.fromCharCode(65+a%26)+out;a=Math.floor(a/26);}
  return out;
};
const txtCell=(value,ref,style=0)=>{
  const text=String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
};
const numericCell=(v,ref)=>`<c r="${ref}" s="2"><v>${v}</v></c>`;

function sheet(headers,rows){
  const all=[headers,...rows];
  const cells=all.map((data,i)=>{
    const content=data.map((value,j)=>{
      const ref=`${colId(j)}${i+1}`;
      if(i>0&&typeof value==='number'&&Number.isFinite(value))return numericCell(value,ref);
      return txtCell(value,ref,i===0?1:0);
    }).join('');
    return `<row r="${i+1}"${i===0?' ht="28" customHeight="1"':''}>${content}</row>`;
  }).join('');
  const widths=headers.map((h,j)=>{
    const max=Math.min(50,Math.max(14,String(h).length*1.8,Math.min(45,...rows.map(r=>String(r[j]??'').length*1.1))));
    return `<col min="${j+1}" max="${j+1}" width="${max.toFixed(1)}" customWidth="1"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><cols>${widths}</cols><sheetData>${cells}</sheetData><autoFilter ref="A1:${colId(Math.max(0,headers.length-1))}${all.length}"/></worksheet>`;
}

const u16=(a,n)=>{a.push(n&255,(n>>>8)&255);};
const u32=(a,n)=>{a.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);};
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xEDB88320:0);}return(c^0xFFFFFFFF)>>>0;}
function zip(files){
  const parts=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const n=encoder.encode(name),b=encoder.encode(text),crc=crc32(b);
    const local=[];u32(local,0x04034b50);u16(local,20);u16(local,0);u16(local,0);u16(local,0);u16(local,0);u32(local,crc);u32(local,b.length);u32(local,b.length);u16(local,n.length);u16(local,0);
    parts.push(Uint8Array.from(local),n,b);
    const header=[];u32(header,0x02014b50);u16(header,20);u16(header,20);u16(header,0);u16(header,0);u16(header,0);u16(header,0);u32(header,crc);u32(header,b.length);u32(header,b.length);u16(header,n.length);u16(header,0);u16(header,0);u16(header,0);u16(header,0);u32(header,0);u32(header,offset);
    central.push(Uint8Array.from(header),n);
    offset+=local.length+n.length+b.length;
  }
  const centralSize=central.reduce((sum,b)=>sum+b.length,0);
  const end=[];u32(end,0x06054b50);u16(end,0);u16(end,0);u16(end,Object.keys(files).length);u16(end,Object.keys(files).length);u32(end,centralSize);u32(end,offset);u16(end,0);
  return new Blob([...parts,...central,Uint8Array.from(end)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

export function buildXlsxBlob(headers,rows,tab='Report'){
  if(!Array.isArray(headers)||headers.length===0||headers.length>100)throw Error('Invalid headers');
  const name=String(tab||'Report').replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'Report';
  return zip({
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF68465D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml':sheet(headers,rows),
  });
}

export function downloadXlsx(filename,headers,rows,tab='Report'){
  const url=URL.createObjectURL(buildXlsxBlob(headers,rows,tab));
  const a=document.createElement('a');a.href=url;a.download=filename.endsWith('.xlsx')?filename:`${filename}.xlsx`;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
