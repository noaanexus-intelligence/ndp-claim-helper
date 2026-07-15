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
  // ✅ ยืนยันชื่อคอลัมน์กับฐานจริง (HOSxP XE PCU) แล้ว 14 ก.ค. 69
  doctor: {
    table: 'doctor',
    writable: true,
    cols: {
      code: 'code',
      name: 'name',
      license: 'licenseno',            // เลขใบประกอบวิชาชีพ
      providerType: 'provider_type_code',
      council: 'council_code',         // รหัสสภาวิชาชีพ 01-07
      cid: 'cid',
      active: 'active',                // กรองเฉพาะที่ใช้งานจริง
    },
  },
  // สิทธิการรักษา (ตารางตั้งค่า — แก้ไขได้)
  // ✅ ยืนยันแล้ว: INSCL หลัก = nhso_code, ย่อย = nhso_subinscl, มาตรฐาน = pttype_std_code
  pttype: {
    table: 'pttype',
    writable: true,
    cols: {
      code: 'pttype',
      name: 'name',
      std: 'nhso_code',                // รหัสมาตรฐาน INSCL (หลัก)
      subinscl: 'nhso_subinscl',       // INSCL ย่อย
      stdCode: 'pttype_std_code',      // รหัสมาตรฐาน 4 หลัก
      inUse: 'isuse',                  // กรองเฉพาะที่เปิดใช้
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
  // ✅ ยืนยันแล้ว: รหัสโรคอยู่คอลัมน์ icd10
  diag: {
    table: 'ovstdiag',
    writable: false,
    cols: {
      vn: 'vn',
      code: 'icd10',
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
