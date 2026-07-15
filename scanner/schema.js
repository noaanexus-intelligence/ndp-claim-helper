'use strict';
const { readQuery } = require('./db');

/** escape ชื่อ identifier (ตาราง/คอลัมน์) กัน SQL injection จาก schema-map */
function qid(name) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name))) {
    throw new Error('ชื่อ identifier ไม่ถูกต้อง: ' + name);
  }
  return '`' + name + '`';
}

/** รายชื่อตารางทั้งหมดใน DB ปัจจุบัน */
async function listTables() {
  const rows = await readQuery(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS approx_rows
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME`
  );
  return rows;
}

/** รายชื่อคอลัมน์ของตารางหนึ่ง */
async function listColumns(table) {
  const rows = await readQuery(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_KEY AS keytype
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows;
}

/** ตรวจว่ามีตารางนี้ไหม */
async function tableExists(table) {
  const rows = await readQuery(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

/** คืน set ของคอลัมน์ที่มีจริงในตาราง (lowercase) */
async function columnSet(table) {
  const cols = await listColumns(table);
  return new Set(cols.map((c) => c.name.toLowerCase()));
}

/**
 * ตรวจว่า mapping ตรรกะ (logical) ตรงกับ schema จริงไหม
 * map = { table:'doctor', cols:{ license:'licenseno', ... } }
 * คืน { ok, missingTable, missingCols:[...] }
 */
async function verifyMap(map) {
  const exists = await tableExists(map.table);
  if (!exists) return { ok: false, missingTable: true, missingCols: [] };
  const have = await columnSet(map.table);
  const missing = Object.values(map.cols).filter((c) => !have.has(String(c).toLowerCase()));
  return { ok: missing.length === 0, missingTable: false, missingCols: missing };
}

module.exports = { qid, listTables, listColumns, tableExists, columnSet, verifyMap };
