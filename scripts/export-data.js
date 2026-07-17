'use strict';
/**
 * ดึงฐานความรู้จาก index.html (แหล่งความจริงเดียว) ออกเป็น JSON ใน data/
 * ใช้: node scripts/export-data.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = html.slice(html.indexOf('const CATS'), html.indexOf('/* ---------- Render'));
const out = vm.runInNewContext(code + ';({CATS,DATA,ERRORS,CODESYS,BILLGRP,CHECKLIST})', {});

const today = new Date().toISOString().slice(0, 10);
const dataDir = path.join(root, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

fs.writeFileSync(path.join(dataDir, 'errors.json'), JSON.stringify(
  { updated: today, source: 'ndp-claim-helper', errors: out.ERRORS }, null, 2));
fs.writeFileSync(path.join(dataDir, 'pp-activities.json'), JSON.stringify(
  { updated: today, note: 'เทียบประกาศ สปสช. ฉบับล่าสุดก่อนใช้', categories: out.CATS, activities: out.DATA }, null, 2));
fs.writeFileSync(path.join(dataDir, 'codesys.json'), JSON.stringify(
  { codesys: out.CODESYS, billgrcs: out.BILLGRP }, null, 2));

console.log(`export เสร็จ: errors ${out.ERRORS.length} | activities ${out.DATA.length} | codesys ${out.CODESYS.length}`);
