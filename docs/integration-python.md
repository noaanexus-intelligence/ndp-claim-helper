# ฝังฐานความรู้ NDP เข้าโปรแกรม Python (เช่น NHSO Close Rights)

ฐานความรู้ถูกแยกเป็น JSON ในโฟลเดอร์ `data/` — โปรแกรมภาษาอะไรก็อ่านได้:

| ไฟล์ | เนื้อหา |
|---|---|
| `data/errors.json` | Error 10 ตัว: รหัส, ข้อความ, วิธีแก้, เมนูที่ต้องไป, คีย์เวิร์ดสำหรับจับคู่ |
| `data/pp-activities.json` | ชุดรหัสเบิก PP 40 กิจกรรม (ICD-10 + TMLT/CSMBS/NHSO/TMT + เงื่อนไข + ตัวอย่าง) |
| `data/codesys.json` | ตาราง CODESYS 001-008 + หมวด BILLGRCS |

## ระดับ 1: เปิดคู่มือ offline จากเมนู (2 บรรทัด)

แนบ `index.html` (เปลี่ยนชื่อเป็น `ndp_helper.html`) ไว้ข้าง exe แล้ว:

```python
import webbrowser, os, sys
BASE = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else __file__)
webbrowser.open('file:///' + os.path.join(BASE, 'ndp_helper.html').replace('\\', '/'))
```

## ระดับ 2: ถอดรหัส error อัตโนมัติในตาราง "ผลตรวจสอบ"

จับคู่ข้อความ error ที่ NDP/ตัวตรวจสอบตอบกลับ กับคำแนะนำ แล้วแสดงใน tooltip
หรือหน้าต่างรายละเอียด (double-click):

```python
import json, os

def load_error_kb(base_dir):
    with open(os.path.join(base_dir, 'data', 'errors.json'), encoding='utf-8') as f:
        return json.load(f)['errors']

def decode_error(message, kb):
    """คืนรายการคำแนะนำที่เข้ากับข้อความ error (เรียงตามจำนวนคีย์เวิร์ดที่แมตช์)"""
    msg = message.lower()
    hits = []
    for e in kb:
        score = sum(1 for kw in e['kw'].split() if kw in msg)
        # จับคู่จากรหัส error ตรงๆ ด้วย เช่น L100, L108, INVOICE_NO
        for token in e['code'].replace('/', ' ').split():
            if len(token) >= 3 and token.lower() in msg:
                score += 3
        if score:
            hits.append((score, e))
    return [e for _, e in sorted(hits, key=lambda x: -x[0])]

# ตัวอย่างใช้ในหน้าต่างรายละเอียดแถว
kb = load_error_kb(BASE)
for advice in decode_error('เตือน: งาน KTB/PP เบิกแยก อย่าส่งใน 13แฟ้ม (L108): 3500219(12001)', kb):
    print(f"[{advice['code']}] {advice['fix']}")
    print(f"  เมนู: {advice['path']}")
```

ผลลัพธ์: แถวที่ติด L108 จะแสดงวิธีแก้ + เมนูที่ต้องไป ใต้ผลตรวจสอบทันที
โดยไม่ต้องเปิดเว็บ ไม่ต้องต่อเน็ต

## ระดับ 3: ค้นชุดรหัสเบิก PP ในโปรแกรม

`pp-activities.json` โครงสร้างต่อกิจกรรม: `no, cat, pren (ต้องมีแฟ้ม Prenatal),
price, nm (ชื่อ), recipe [[ชื่อรหัส, เงื่อนไข, ค่า]], ex (ตัวอย่างชุดเบิก), note`
— ทำช่องค้นหาใน Tkinter แล้วกรองจาก `nm`/`recipe` ได้เลย

## การอัปเดตฐานความรู้

ไฟล์ JSON ถูก generate จาก `index.html` (แหล่งความจริงเดียว) ด้วย:
```
node scripts/export-data.js
```
เมื่อประกาศ สปสช. เปลี่ยนหรือเจอ error ใหม่ → แก้ที่เว็บ → export JSON ใหม่ →
วางทับในโฟลเดอร์ data ของโปรแกรม
