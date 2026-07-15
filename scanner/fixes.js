'use strict';
/**
 * โมดูลแก้ไข "เฉพาะตารางตั้งค่า" อย่างปลอดภัย
 *
 * กติกาความปลอดภัย (บังคับทุกครั้ง):
 *  1) แก้ได้เฉพาะ logical table ที่ writable=true (doctor, pttype) เท่านั้น
 *     — ตารางธุรกรรม (visit/diag/charge) ถูกปฏิเสธเสมอ
 *  2) ต้องตั้ง ALLOW_WRITES=true ใน .env ถึงจะลงมือแก้จริงได้
 *  3) ก่อนแก้ทุกครั้ง: สำรอง (backup) ค่าเดิมทั้งแถวลงไฟล์ JSON ใน backups/
 *  4) ทำใน transaction + UPDATE โดยระบุ key ชัดเจน
 */
const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');
const { qid, verifyMap } = require('./schema');
const { loadMap } = require('./schema-map');

const BACKUP_DIR = path.join(__dirname, 'backups');

function writesAllowed() {
  return String(process.env.ALLOW_WRITES).toLowerCase() === 'true';
}

/** หา logical table + ตรวจว่าแก้ได้ไหม */
function resolveWritable(map, logical) {
  const t = map[logical];
  if (!t) throw new Error('ไม่รู้จักตาราง (logical): ' + logical);
  if (!t.writable) throw new Error(`ตาราง "${logical}" เป็นตารางธุรกรรม — ห้ามแก้ไขผ่านเครื่องมือนี้`);
  return t;
}

/**
 * ดูตัวอย่างก่อนแก้ (ไม่เขียนอะไร)
 * @returns { rows:[...], plan:{ table, setColumn, newValue, keyColumn, keyValue, willUpdate } }
 */
async function previewFix({ logical, keyValue, setField, newValue }) {
  const map = loadMap();
  const t = resolveWritable(map, logical);
  const v = await verifyMap(t);
  if (!v.ok) throw new Error('schema ของตารางนี้ยังไม่ตรง (ตรวจหน้า “สำรวจ Schema” ก่อน)');

  const keyCol = t.cols.code;
  const setCol = t.cols[setField];
  if (!setCol) throw new Error('ไม่รู้จักคอลัมน์ (logical): ' + setField);

  const [rows] = await getPool().query(
    `SELECT * FROM ${qid(t.table)} WHERE ${qid(keyCol)} = ? LIMIT 200`,
    [keyValue]
  );
  return {
    rows,
    plan: {
      table: t.table,
      keyColumn: keyCol,
      keyValue,
      setColumn: setCol,
      currentValues: rows.map((r) => r[setCol]),
      newValue,
      willUpdate: rows.length,
      writesAllowed: writesAllowed(),
    },
  };
}

/** ลงมือแก้จริง (มี backup + transaction) */
async function applyFix({ logical, keyValue, setField, newValue }) {
  if (!writesAllowed()) {
    throw new Error('โหมดแก้ไขปิดอยู่ — ตั้ง ALLOW_WRITES=true ใน .env ก่อน');
  }
  const map = loadMap();
  const t = resolveWritable(map, logical);
  const v = await verifyMap(t);
  if (!v.ok) throw new Error('schema ของตารางนี้ยังไม่ตรง');

  const keyCol = t.cols.code;
  const setCol = t.cols[setField];
  if (!setCol) throw new Error('ไม่รู้จักคอลัมน์ (logical): ' + setField);

  const conn = await getPool().getConnection();
  try {
    // 1) อ่านค่าเดิมทั้งแถวเพื่อสำรอง
    const [before] = await conn.query(
      `SELECT * FROM ${qid(t.table)} WHERE ${qid(keyCol)} = ?`,
      [keyValue]
    );
    if (before.length === 0) throw new Error('ไม่พบแถวที่จะแก้ (key: ' + keyValue + ')');

    // 2) เขียน backup ลงไฟล์
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `${stamp}_${t.table}_${setCol}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({
      table: t.table, keyColumn: keyCol, keyValue, setColumn: setCol, newValue, before,
    }, null, 2), 'utf8');

    // 3) UPDATE ใน transaction
    await conn.beginTransaction();
    const [res] = await conn.query(
      `UPDATE ${qid(t.table)} SET ${qid(setCol)} = ? WHERE ${qid(keyCol)} = ?`,
      [newValue, keyValue]
    );
    await conn.commit();

    return { affectedRows: res.affectedRows, backupFile: path.basename(backupFile) };
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { previewFix, applyFix, writesAllowed };
