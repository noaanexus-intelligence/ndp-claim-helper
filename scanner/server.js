'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');

const { ping } = require('./db');
const { listTables, listColumns, verifyMap } = require('./schema');
const { loadMap } = require('./schema-map');
const { CHECKS } = require('./checks');
const { getPool } = require('./db');
const { qid } = require('./schema');
const { previewFix, applyFix, writesAllowed } = require('./fixes');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function fail(res, e) {
  console.error(e);
  res.status(400).json({ ok: false, error: e.message || String(e) });
}

/** สถานะการเชื่อมต่อ + โหมด */
app.get('/api/ping', async (req, res) => {
  try {
    const info = await ping();
    res.json({ ok: true, info, writesAllowed: writesAllowed() });
  } catch (e) { fail(res, e); }
});

/** สำรวจ schema: รายชื่อตาราง */
app.get('/api/tables', async (req, res) => {
  try { res.json({ ok: true, tables: await listTables() }); }
  catch (e) { fail(res, e); }
});

/** สำรวจ schema: คอลัมน์ของตาราง */
app.get('/api/columns', async (req, res) => {
  try { res.json({ ok: true, columns: await listColumns(String(req.query.table || '')) }); }
  catch (e) { fail(res, e); }
});

/** ตรวจว่า schema-map ตรงกับฐานจริงไหม (ทีละ logical table) */
app.get('/api/schema-status', async (req, res) => {
  try {
    const map = loadMap();
    const out = {};
    for (const [logical, t] of Object.entries(map)) {
      out[logical] = { table: t.table, writable: !!t.writable, ...(await verifyMap(t)) };
    }
    res.json({ ok: true, status: out });
  } catch (e) { fail(res, e); }
});

/** รายการ check ทั้งหมด + สถานะ (พร้อมรัน / ต้องแมป schema) */
app.get('/api/checks', async (req, res) => {
  try {
    const map = loadMap();
    const list = [];
    for (const c of CHECKS) {
      let ready = true, note = '';
      for (const logical of c.uses) {
        const t = map[logical];
        if (!t) { ready = false; note = 'ไม่มี logical table: ' + logical; break; }
        const v = await verifyMap(t);
        if (!v.ok) { ready = false; note = v.missingTable ? `ไม่พบตาราง ${t.table}` : `คอลัมน์ไม่ตรง: ${v.missingCols.join(', ')}`; break; }
      }
      list.push({ id: c.id, title: c.title, severity: c.severity, fixHint: c.fixHint, relatedError: c.relatedError, ready, note });
    }
    res.json({ ok: true, checks: list });
  } catch (e) { fail(res, e); }
});

/** รัน check หนึ่งตัว (อ่านอย่างเดียว) */
app.post('/api/run-check', async (req, res) => {
  try {
    const { id, sinceDays } = req.body || {};
    const check = CHECKS.find((c) => c.id === id);
    if (!check) throw new Error('ไม่พบ check: ' + id);
    const map = loadMap();
    for (const logical of check.uses) {
      const v = await verifyMap(map[logical] || {});
      if (!v.ok) throw new Error(`ตาราง "${logical}" ยังไม่แมป schema`);
    }
    const { sql, params } = check.build(map, { sinceDays });
    const [rows] = await getPool().query(sql, params);
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) { fail(res, e); }
});

/** ดูตัวอย่างก่อนแก้ (ไม่เขียน) */
app.post('/api/preview-fix', async (req, res) => {
  try { res.json({ ok: true, ...(await previewFix(req.body || {})) }); }
  catch (e) { fail(res, e); }
});

/** ลงมือแก้จริง (ต้องส่ง confirm:true) */
app.post('/api/apply-fix', async (req, res) => {
  try {
    if (!req.body || req.body.confirm !== true) throw new Error('ต้องยืนยัน (confirm:true) ก่อนแก้');
    res.json({ ok: true, ...(await applyFix(req.body)) });
  } catch (e) { fail(res, e); }
});

const PORT = Number(process.env.PORT || 4300);
const BIND = process.env.BIND || '127.0.0.1';
app.listen(PORT, BIND, () => {
  console.log(`\n  NDP Claim Scanner`);
  console.log(`  เปิดหน้าเว็บที่:  http://${BIND}:${PORT}`);
  console.log(`  โหมดแก้ไข (ALLOW_WRITES): ${writesAllowed() ? 'เปิด ⚠️' : 'ปิด (อ่านอย่างเดียว)'}\n`);
});
