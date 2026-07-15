'use strict';
/**
 * แผนที่ชื่อตาราง/คอลัมน์ (logical -> physical) ของ HOSxP
 *
 * ⚠️ ค่าเริ่มต้นด้านล่างเป็น "ค่าที่พบบ่อย" ใน HOSxP — แต่ยังไม่ยืนยันกับฐานจริงของคุณ
 * ให้เปิดหน้า "สำรวจ Schema" ในโปรแกรม เพื่อดูชื่อจริง แล้วแก้ไฟล์นี้ให้ตรง
 * (หรือสร้างไฟล์ schema-map.json วางข้าง ๆ เพื่อ override โดยไม่ต้องแก้โค้ด)
 *
 * โปรแกรมจะตรวจก่อนเสมอว่าตาราง/คอลัมน์เหล่านี้ "มีจริง" ไหม
 * ถ้าไม่ตรง จะข้าม check นั้นและแจ้งว่า "ต้องแมป schema" — ไม่รันคำสั่งมั่ว
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_MAP = {
  // บุคลากรทางการแพทย์ (ตารางตั้งค่า — แก้ไขได้)
  doctor: {
    table: 'doctor',
    writable: true,
    cols: {
      code: 'code',
      name: 'name',
      license: 'licenseno',       // เลขใบประกอบวิชาชีพ
      providerType: 'provider_type',
      council: 'council_code',    // รหัสสภาวิชาชีพ 01-07
      cid: 'cid',
    },
  },
  // สิทธิการรักษา (ตารางตั้งค่า — แก้ไขได้)
  pttype: {
    table: 'pttype',
    writable: true,
    cols: {
      code: 'pttype',
      name: 'name',
      std: 'nhso_code',           // รหัสมาตรฐาน INSCL
    },
  },
  // การมารับบริการ (ตารางธุรกรรม — อ่านอย่างเดียว ห้ามแก้)
  visit: {
    table: 'ovst',
    writable: false,
    cols: {
      vn: 'vn',
      date: 'vstdate',
      hn: 'hn',
      pttype: 'pttype',
      doctor: 'doctor',
    },
  },
  // การวินิจฉัย (ตารางธุรกรรม — อ่านอย่างเดียว ห้ามแก้)
  diag: {
    table: 'ovstdiag',
    writable: false,
    cols: {
      vn: 'vn',
      code: 'diagcode',
      type: 'diagtype',
    },
  },
};

function loadMap() {
  const override = path.join(__dirname, 'schema-map.json');
  if (fs.existsSync(override)) {
    try {
      const json = JSON.parse(fs.readFileSync(override, 'utf8'));
      // merge ตื้น ๆ ต่อ logical table
      const merged = {};
      for (const k of Object.keys(DEFAULT_MAP)) {
        merged[k] = { ...DEFAULT_MAP[k], ...(json[k] || {}),
          cols: { ...DEFAULT_MAP[k].cols, ...((json[k] || {}).cols || {}) } };
      }
      return merged;
    } catch (e) {
      console.error('อ่าน schema-map.json ไม่สำเร็จ ใช้ค่าเริ่มต้นแทน:', e.message);
    }
  }
  return DEFAULT_MAP;
}

module.exports = { DEFAULT_MAP, loadMap };
