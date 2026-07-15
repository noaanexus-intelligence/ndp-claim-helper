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
      const activeCond = c.active ? `AND ${qid(c.active)} = 'Y'` : '';
      return {
        sql: `SELECT ${qid(c.code)} AS code, ${qid(c.name)} AS name
                FROM ${qid(d.table)}
               WHERE ${isBlank(qid(c.license))} ${activeCond}
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
      const activeCond = c.active ? `AND ${qid(c.active)} = 'Y'` : '';
      return {
        sql: `SELECT ${qid(c.code)} AS code, ${qid(c.name)} AS name,
                     ${qid(c.providerType)} AS provider_type, ${qid(c.council)} AS council
                FROM ${qid(d.table)}
               WHERE (${isBlank(qid(c.providerType))} OR ${isBlank(qid(c.council))}) ${activeCond}
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
      const useCond = c.inUse ? `AND ${qid(c.inUse)} = 'Y'` : '';
      const extra = [c.subinscl && `${qid(c.subinscl)} AS subinscl`, c.stdCode && `${qid(c.stdCode)} AS std4`]
        .filter(Boolean).join(', ');
      return {
        sql: `SELECT ${qid(c.code)} AS code, ${qid(c.name)} AS name, ${qid(c.std)} AS inscl${extra ? ', ' + extra : ''}
                FROM ${qid(p.table)}
               WHERE ${isBlank(qid(c.std))} ${useCond}
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
    id: 'drug_no_adp_used',
    title: 'ยาที่ถูกสั่งใช้จริงแต่ยังไม่ผูก NHSO ADP Code',
    severity: 'warn',
    fixHint: 'ผูกเฉพาะตัวที่ใช้เบิกจริง — ตั้งค่ารายการยา → ADP Code/Type (หมวด 03,04 · CODESYS 001-TMT) เรียงตามความถี่การใช้ ตัวบนสุดกระทบเคลมมากสุด',
    relatedError: 'NDP จับคู่ (map) รายการยาไม่ได้',
    uses: ['drugitems', 'charge'],
    build: (m, opts) => {
      const t = m.drugitems, c = t.cols;
      const ch = m.charge, cc = ch.cols;
      const days = Number(opts.sinceDays || 90);
      return {
        sql: `SELECT d.${qid(c.code)} AS icode, d.${qid(c.name)} AS name,
                     COUNT(*) AS used_count, SUM(o.${qid(cc.price)}) AS total_price
                FROM ${qid(ch.table)} o
                JOIN ${qid(t.table)} d ON d.${qid(c.code)} = o.${qid(cc.icode)}
               WHERE ${isBlank('d.' + qid(c.adpCode))}
                 AND o.${qid(cc.date)} >= (CURRENT_DATE - INTERVAL ? DAY)
                 AND o.${qid(cc.price)} > 0
               GROUP BY d.${qid(c.code)}, d.${qid(c.name)}
               ORDER BY used_count DESC
               LIMIT 500`,
        params: [days],
      };
    },
  },
  {
    id: 'nondrug_no_adp_used',
    title: 'ค่าบริการ/หัตถการที่ถูกใช้จริงแต่ยังไม่ผูก NHSO ADP Code',
    severity: 'warn',
    fixHint: 'ผูกเฉพาะตัวที่ใช้เบิกจริง — NonDrug Item → ADP Code/Type + Bill Code เรียงตามความถี่การใช้ (เวชภัณฑ์/ของใช้ภายในที่ไม่เบิก ปล่อยว่างได้)',
    relatedError: 'NDP จับคู่ (map) รายการบริการไม่ได้',
    uses: ['nondrugitems', 'charge'],
    build: (m, opts) => {
      const t = m.nondrugitems, c = t.cols;
      const ch = m.charge, cc = ch.cols;
      const days = Number(opts.sinceDays || 90);
      return {
        sql: `SELECT d.${qid(c.code)} AS icode, d.${qid(c.name)} AS name,
                     COUNT(*) AS used_count, SUM(o.${qid(cc.price)}) AS total_price
                FROM ${qid(ch.table)} o
                JOIN ${qid(t.table)} d ON d.${qid(c.code)} = o.${qid(cc.icode)}
               WHERE ${isBlank('d.' + qid(c.adpCode))}
                 AND o.${qid(cc.date)} >= (CURRENT_DATE - INTERVAL ? DAY)
                 AND o.${qid(cc.price)} > 0
               GROUP BY d.${qid(c.code)}, d.${qid(c.name)}
               ORDER BY used_count DESC
               LIMIT 500`,
        params: [days],
      };
    },
  },
  {
    id: 'visit_charge_no_invoice',
    title: 'Visit ที่มีค่าใช้จ่ายแต่ยังไม่ปิดลูกหนี้ (ไม่มีเลข Invoice)',
    severity: 'crit',
    fixHint: 'Finance → ปิดลูกหนี้ (hosxp_xepcu) ให้ได้เลข Invoice + เลขปิดสิทธิ ก่อนส่งเข้า NDP — นี่คือ worklist รายวัน',
    relatedError: 'Cha.INVOICE_NO / Chad.INVOICE_NO เลขที่หนังสือต้องมากกว่า 0',
    uses: ['visit', 'charge', 'invoice'],
    build: (m, opts) => {
      const v = m.visit, vc = v.cols;
      const ch = m.charge, cc = ch.cols;
      const inv = m.invoice, ic = inv.cols;
      const days = Number(opts.sinceDays || 30);
      return {
        sql: `SELECT v.${qid(vc.vn)} AS vn, v.${qid(vc.date)} AS vstdate, v.${qid(vc.hn)} AS hn,
                     v.${qid(vc.pttype)} AS pttype, SUM(o.${qid(cc.price)}) AS total_charge
                FROM ${qid(v.table)} v
                JOIN ${qid(ch.table)} o ON o.${qid(cc.vn)} = v.${qid(vc.vn)}
                LEFT JOIN ${qid(inv.table)} fi ON fi.${qid(ic.vn)} = v.${qid(vc.vn)}
               WHERE v.${qid(vc.date)} >= (CURRENT_DATE - INTERVAL ? DAY)
                 AND fi.${qid(ic.id)} IS NULL
               GROUP BY v.${qid(vc.vn)}, v.${qid(vc.date)}, v.${qid(vc.hn)}, v.${qid(vc.pttype)}
              HAVING SUM(o.${qid(cc.price)}) > 0
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
