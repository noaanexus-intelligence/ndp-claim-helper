'use strict';
/**
 * โมดูลแก้ไข "เฉพาะตารางตั้งค่า" อย่างปลอดภัย
 *
 * กติกาความปลอดภัย (บังคับทุกครั้ง):
 *  1) แก้ได้เฉพาะ logical table ที่ writable=true (doctor, pttype)
 *     — ตารางธุรกรรม (visit/diag/charge/invoice) ถูกปฏิเสธเสมอ
 *  2) แก้ได้เฉพาะฟิลด์ที่อยู่ใน whitelist (t.fixable) เท่านั้น
 *  3) ต้องตั้ง ALLOW_WRITES=true ใน .env ถึงจะลงมือแก้จริงได้
 *  4) ก่อนแก้ทุกแถว: สำรอง (backup) ค่าเดิมทั้งแถวลงไฟล์ JSON ใน backups/
 *  5) ทำใน transaction + UPDATE โดยระบุ key ชัดเจน (แก้ทีละ key)
 *  6) บันทึกทุกการแก้ลง audit log (backups/audit.log — append-only)
 */
const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');
const { qid, verifyMap } = require('./schema');
const { loadMap } = require('./schema-map');

const BACKUP_DIR = path.join(__dirname, 'backups');
const AUDIT_LOG = path.join(BACKUP_DIR, 'audit.log');

function writesAllowed() {
  return String(process.env.ALLOW_WRITES).toLowerCase() === 'true';
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** หา logical table + ตรวจว่าแก้ได้ไหม */
function resolveWritable(map, logical) {
  const t = map[logical];
  if (!t) throw new Error('ไม่รู้จักตาราง (logical): ' + logical);
  if (!t.writable) throw new Error(`ตาราง "${logical}" เป็นตารางธุรกรรม — ห้ามแก้ไขผ่านเครื่องมือนี้`);
  return t;
}

/** ตรวจว่าฟิลด์อยู่ใน whitelist และคืนชื่อคอลัมน์จริง */
function resolveFixableColumn(t, setField) {
  const allow = Array.isArray(t.fixable) ? t.fixable : [];
  if (!allow.includes(setField)) {
    throw new Error(`ฟิลด์ "${setField}" ไม่อยู่ในรายการที่อนุญาตให้แก้ (${allow.join(', ') || 'ไม่มี'})`);
  }
  const setCol = t.cols[setField];
  if (!setCol) throw new Error('ไม่รู้จักคอลัมน์ (logical): ' + setField);
  return setCol;
}

/** normalize keyValue -> array ของ key (รองรับแก้ทีละหลาย key) */
function toKeyList(keyValue) {
  const list = Array.isArray(keyValue) ? keyValue : [keyValue];
  const out = list.map((k) => String(k).trim()).filter(Boolean);
  if (!out.length) throw new Error('ต้องระบุ key อย่างน้อย 1 ค่า');
  if (out.length > 50) throw new Error('แก้ได้ครั้งละไม่เกิน 50 รายการ');
  return out;
}

/**
 * ดูตัวอย่างก่อนแก้ (ไม่เขียนอะไร)
 */
async function previewFix({ logical, keyValue, setField, newValue }) {
  const map = loadMap();
  const t = resolveWritable(map, logical);
  const v = await verifyMap(t);
  if (!v.ok) throw new Error('schema ของตารางนี้ยังไม่ตรง (ตรวจหน้า “สำรวจ Schema” ก่อน)');

  const keyCol = t.cols.code;
  const setCol = resolveFixableColumn(t, setField);
  const keys = toKeyList(keyValue);

  const [rows] = await getPool().query(
    `SELECT ${qid(keyCol)} AS __key, ${qid(t.cols.name)} AS __name, ${qid(setCol)} AS __current
       FROM ${qid(t.table)}
      WHERE ${qid(keyCol)} IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const found = new Set(rows.map((r) => String(r.__key)));
  return {
    plan: {
      table: t.table,
      keyColumn: keyCol,
      setColumn: setCol,
      newValue,
      willUpdate: rows.length,
      writesAllowed: writesAllowed(),
      rows: rows.map((r) => ({ key: r.__key, name: r.__name, current: r.__current, next: newValue })),
      notFound: keys.filter((k) => !found.has(k)),
    },
  };
}

/** ลงมือแก้จริง (มี backup + transaction + audit log) */
async function applyFix({ logical, keyValue, setField, newValue }) {
  if (!writesAllowed()) {
    throw new Error('โหมดแก้ไขปิดอยู่ — ตั้ง ALLOW_WRITES=true ใน .env ก่อน');
  }
  const map = loadMap();
  const t = resolveWritable(map, logical);
  const v = await verifyMap(t);
  if (!v.ok) throw new Error('schema ของตารางนี้ยังไม่ตรง');

  const keyCol = t.cols.code;
  const setCol = resolveFixableColumn(t, setField);
  const keys = toKeyList(keyValue);

  ensureBackupDir();
  const conn = await getPool().getConnection();
  const results = [];
  try {
    // 1) อ่านค่าเดิมทั้งแถวของทุก key เพื่อสำรอง
    const [before] = await conn.query(
      `SELECT * FROM ${qid(t.table)} WHERE ${qid(keyCol)} IN (${keys.map(() => '?').join(',')})`,
      keys
    );
    if (before.length === 0) throw new Error('ไม่พบแถวที่จะแก้ (keys: ' + keys.join(',') + ')');

    // 2) เขียน backup ค่าเดิมลงไฟล์
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `${stamp}_${t.table}_${setCol}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(
      { table: t.table, keyColumn: keyCol, setColumn: setCol, newValue, before }, null, 2), 'utf8');

    // 3) UPDATE ทีละ key ใน transaction เดียว
    await conn.beginTransaction();
    let affected = 0;
    for (const k of keys) {
      const [res] = await conn.query(
        `UPDATE ${qid(t.table)} SET ${qid(setCol)} = ? WHERE ${qid(keyCol)} = ?`,
        [newValue, k]
      );
      affected += res.affectedRows;
      results.push({ key: k, affected: res.affectedRows });
    }
    await conn.commit();

    // 4) audit log (append-only) — ทำหลัง commit เพื่อบันทึกเฉพาะที่สำเร็จ
    const entry = {
      ts: new Date().toISOString(),
      table: t.table, column: setCol, newValue,
      keys, affectedRows: affected, backupFile: path.basename(backupFile),
    };
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n', 'utf8');

    return { affectedRows: affected, results, backupFile: path.basename(backupFile) };
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

/** อ่าน audit log ล่าสุด (สำหรับแสดงในหน้าเว็บ) */
function readAudit(limit = 50) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const lines = fs.readFileSync(AUDIT_LOG, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch (_) { return { raw: l }; } });
}

module.exports = { previewFix, applyFix, writesAllowed, readAudit };
