'use strict';
const mysql = require('mysql2/promise');

let pool;

/** สร้าง/คืน connection pool (อ่านค่าจาก .env) */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 4,
      // ปลอดภัยไว้ก่อน: ไม่อนุญาต multiple statements ในหนึ่ง query
      multipleStatements: false,
      dateStrings: true,
    });
  }
  return pool;
}

/** query อ่านอย่างเดียว — ปฏิเสธคำสั่งที่ไม่ใช่ SELECT/SHOW/DESCRIBE */
async function readQuery(sql, params = []) {
  const head = sql.trim().slice(0, 12).toUpperCase();
  if (!(head.startsWith('SELECT') || head.startsWith('SHOW') || head.startsWith('DESCRIBE') || head.startsWith('DESC '))) {
    throw new Error('readQuery รับเฉพาะ SELECT/SHOW/DESCRIBE เท่านั้น');
  }
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** ทดสอบการเชื่อมต่อ + คืนข้อมูลเวอร์ชัน */
async function ping() {
  const rows = await readQuery('SELECT VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS user');
  return rows[0];
}

module.exports = { getPool, readQuery, ping };
