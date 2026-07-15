'use strict';
/**
 * นิยาม "การสแกน" (อ่านอย่างเดียว) หา record ที่จะติด C ก่อนส่ง NDP
 *
 * แต่ละ check ประกาศ:
 *  - uses:   logical tables ที่ต้องใช้ (โปรแกรมจะตรวจ schema ให้ก่อน)
 *  - build:  ฟังก์ชันสร้าง { sql, params } จาก map + options (คืน SELECT เท่านั้น)
 *  - fixHint: ไปแก้ที่เมนูไหนใน HOSxP
 */
const { qid } = require('./schema');

/** helper: สร้างเงื่อนไข "ค่าว่าง" (NULL หรือ '') ของคอลัมน์ */
function isBlank(col) {
  return `(${col} IS NULL OR TRIM(${col}) = '')`;
}

const CHECKS = [
  {
    id: 'provider_no_license',
    title: 'บุคลากรที่ยังไม่มีเลขใบประกอบวิชาชีพ',
    severity: 'crit',
    fixHint: 'Tools > OPD > บุคลากรทางการแพทย์ → กรอกเลขใบประกอบวิชาชีพ',
    relatedError: 'Diagnosis.PROFESSION_ID ว่าง / L100',
    uses: ['doctor'],
    build: (m) => {
      const d = m.doctor, c = d.cols;
      return {
        sql: `SELECT ${qid(c.code)} AS code, ${qid(c.name)} AS name
                FROM ${qid(d.table)}
               WHERE ${isBlank(qid(c.license))}
               ORDER BY ${qid(c.name)}
               LIMIT 500`,
        params: [],
      };
    },
  },
  {
    id: 'provider_no_type',
    title: 'บุคลากรที่ยังไม่ได้กำหนด Provider Type / รหัสสภาวิชาชีพ',
    severity: 'crit',
    fixHint: 'Tools > OPD > บุคลากรทางการแพทย์ → Provider Type + รหัสสภาวิชาชีพ 01-07',
    relatedError: 'L100 แฟ้ม 3 ProviderType ไม่มีในฐานข้อมูล',
    uses: ['doctor'],
    build: (m) => {
      const d = m.doctor, c = d.cols;
      return {
        sql: `SELECT ${qid(c.code)} AS code, ${qid(c.name)} AS name,
                     ${qid(c.providerType)} AS provider_type, ${qid(c.council)} AS council
                FROM ${qid(d.table)}
               WHERE ${isBlank(qid(c.providerType))} OR ${isBlank(qid(c.council))}
               ORDER BY ${qid(c.name)}
               LIMIT 500`,
        params: [],
      };
    },
  },
  {
    id: 'pttype_no_std',
    title: 'สิทธิการรักษาที่ยังไม่ตั้งรหัสมาตรฐาน INSCL',
    severity: 'warn',
    fixHint: 'Tools > OPD > สิทธิการรักษา → ช่องรหัสมาตรฐาน INSCL',
    relatedError: 'INSCL ไม่ตรงมาตรฐาน สปสช.',
    uses: ['pttype'],
    build: (m) => {
      const p = m.pttype, c = p.cols;
      return {
        sql: `SELECT ${qid(c.code)} AS code, ${qid(c.name)} AS name, ${qid(c.std)} AS std_code
                FROM ${qid(p.table)}
               WHERE ${isBlank(qid(c.std))}
               ORDER BY ${qid(c.code)}
               LIMIT 500`,
        params: [],
      };
    },
  },
  {
    id: 'diag_missing_type',
    title: 'การวินิจฉัยที่ยังไม่ระบุประเภท (DIAGTYPE) — ช่วง N วันล่าสุด',
    severity: 'warn',
    fixHint: 'หน้าตรวจรักษา > การวินิจฉัย → กำหนด DIAGTYPE (แก้ใน HOSxP เอง)',
    relatedError: 'Diagnosis.DIAGTYPE ไม่ครบ',
    uses: ['diag', 'visit'],
    build: (m, opt) => {
      const g = m.diag, gc = g.cols, v = m.visit, vc = v.cols;
      const days = Number(opt.sinceDays || 30);
      return {
        sql: `SELECT g.${qid(gc.vn)} AS vn, v.${qid(vc.date)} AS vstdate,
                     v.${qid(vc.hn)} AS hn, g.${qid(gc.code)} AS diagcode
                FROM ${qid(g.table)} g
                JOIN ${qid(v.table)} v ON v.${qid(vc.vn)} = g.${qid(gc.vn)}
               WHERE ${isBlank('g.' + qid(gc.type))}
                 AND v.${qid(vc.date)} >= (CURRENT_DATE - INTERVAL ? DAY)
               ORDER BY v.${qid(vc.date)} DESC
               LIMIT 500`,
        params: [days],
      };
    },
  },
  {
    id: 'visit_no_diag',
    title: 'Visit ที่ยังไม่มีการวินิจฉัยเลย — ช่วง N วันล่าสุด',
    severity: 'crit',
    fixHint: 'หน้าตรวจรักษา > การวินิจฉัย → เพิ่มรหัส ICD-10 (แก้ใน HOSxP เอง)',
    relatedError: 'Diagnosis.DIAG ว่าง',
    uses: ['visit', 'diag'],
    build: (m, opt) => {
      const v = m.visit, vc = v.cols, g = m.diag, gc = g.cols;
      const days = Number(opt.sinceDays || 30);
      return {
        sql: `SELECT v.${qid(vc.vn)} AS vn, v.${qid(vc.date)} AS vstdate, v.${qid(vc.hn)} AS hn
                FROM ${qid(v.table)} v
                LEFT JOIN ${qid(g.table)} g ON g.${qid(gc.vn)} = v.${qid(vc.vn)}
               WHERE g.${qid(gc.vn)} IS NULL
                 AND v.${qid(vc.date)} >= (CURRENT_DATE - INTERVAL ? DAY)
               ORDER BY v.${qid(vc.date)} DESC
               LIMIT 500`,
        params: [days],
      };
    },
  },
];

module.exports = { CHECKS };
