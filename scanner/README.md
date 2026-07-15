# NDP Claim Scanner (on-premise)

โปรแกรมสแกนฐานข้อมูล **HOSxP (MySQL/MariaDB)** เพื่อหา record ที่จะ "ติด C" ก่อนส่งเข้า NHSO Digital Platform — และแก้ไข **เฉพาะตารางตั้งค่า** (บุคลากร / สิทธิการรักษา) อย่างปลอดภัย

> ⚠️ ต้องรัน **บนเครื่องในเครือข่าย รพ.สต.** ที่ต่อกับฐานข้อมูล HOSxP ได้ — ห้ามเอาขึ้นคลาวด์ (PDPA)

---

## หลักความปลอดภัย

- **ค่าเริ่มต้น = อ่านอย่างเดียว** (`ALLOW_WRITES=false`) การสแกนทั้งหมดใช้ `SELECT` เท่านั้น
- **แก้ได้เฉพาะตารางตั้งค่า** (`doctor`, `pttype`) — ตารางธุรกรรม (visit/diag/charge) ถูกปฏิเสธเสมอ
- ก่อนแก้ทุกครั้ง: **สำรองค่าเดิมทั้งแถวลงไฟล์** ใน `backups/` + ทำใน transaction + ต้องกดยืนยัน
- **ตรวจ schema ก่อนเสมอ** — ถ้าชื่อตาราง/คอลัมน์ไม่ตรง จะข้าม check นั้นและแจ้งเตือน ไม่รันคำสั่งมั่ว
- ผูกที่ `127.0.0.1` เท่านั้น (ไม่เปิดออกเน็ต)

## วิธีติดตั้ง

ต้องมี **Node.js 18+** บนเครื่อง

```bash
cd scanner
npm install
cp .env.example .env      # แล้วแก้ค่าการเชื่อมต่อ DB
npm start                 # เปิด http://localhost:4300
```

### ตั้งค่า `.env`
```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=readonly_user     # แนะนำ: ใช้ user ที่มีสิทธิ์ SELECT อย่างเดียวก่อน
DB_PASSWORD=...
DB_NAME=hos
ALLOW_WRITES=false        # เปิดโหมดแก้ไขค่อยตั้ง true
PORT=4300
```

## ขั้นตอนใช้งาน

1. **สำรวจ Schema** (แท็บแรกที่ควรทำ) — ยืนยันชื่อตาราง/คอลัมน์จริง
   ถ้าไม่ตรง ให้สร้าง `schema-map.json` (ดูตัวอย่างด้านล่าง) แล้วรีสตาร์ท
2. **สแกนหาปัญหา** — กดสแกนแต่ละรายการ ดู worklist + ดาวน์โหลด CSV
3. **แก้ตารางตั้งค่า** — ดูตัวอย่างก่อน → เปิด `ALLOW_WRITES=true` → ยืนยัน

## ปรับ schema-map ให้ตรงฐานของคุณ

สร้างไฟล์ `scanner/schema-map.json` (override ค่าเริ่มต้นโดยไม่ต้องแก้โค้ด) เช่น:
```json
{
  "doctor": { "table": "doctor", "cols": { "license": "licenseno", "providerType": "provider_type", "council": "council_code" } },
  "pttype": { "table": "pttype", "cols": { "std": "nhso_code" } }
}
```

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|------|--------|
| `server.js` | Express API + เสิร์ฟหน้าเว็บ |
| `db.js` | เชื่อม MySQL + `readQuery` (กันไม่ให้เขียนผ่านช่องอ่าน) |
| `schema.js` | ตรวจ/สำรวจ information_schema |
| `schema-map.js` | แผนที่ logical → ชื่อจริง (override ด้วย schema-map.json) |
| `checks.js` | นิยามการสแกน (อ่านอย่างเดียว) |
| `fixes.js` | กรอบการแก้ตารางตั้งค่า (preview + backup + confirm) |
| `public/index.html` | หน้าเว็บใช้งาน |

## ⚠️ ข้อจำกัดความรับผิดชอบ

เป็นเครื่องมือช่วยงาน ไม่ใช่ระบบทางการของ สปสช./BMS การแก้ไขฐานข้อมูล HOSxP โดยตรงมีความเสี่ยง — ทดสอบกับฐานสำเนาก่อนใช้จริง และสำรองฐานข้อมูลเสมอ
