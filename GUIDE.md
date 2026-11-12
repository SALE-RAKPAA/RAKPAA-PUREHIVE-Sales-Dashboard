# คู่มือการใช้งาน RAKPAA & PUREHIVE Sales Dashboard

## สิ่งที่ต้องเตรียม

1. **Google Account** ที่มีสิทธิ์ใช้ Google Sheets, Google Drive, Google Apps Script
2. **Google Sheets** สักไฟล์หนึ่ง (ระบบจะสร้าง sheets ให้เอง)
3. **ไฟล์ Report** จาก FlowAccount ที่ export เป็น `.xlsx`

---

## ขั้นตอนที่ 1 — ติดตั้ง Google Apps Script

### 1.1 สร้าง Google Spreadsheet ใหม่
- ไปที่ [sheets.google.com](https://sheets.google.com) และสร้างไฟล์ใหม่
- ตั้งชื่อว่า **"RAKPAA PUREHIVE Sales Data"** (หรืออะไรก็ได้)

### 1.2 เปิด Apps Script Editor
- ใน Spreadsheet: เมนู **Extensions → Apps Script**
- ลบโค้ดเดิมออกทั้งหมด
- **คัดลอกทุกอย่างในไฟล์ `Code.gs`** ไปวาง
- กด **Save** (Ctrl+S)

### 1.3 Enable Drive API
- ใน Apps Script: ไปที่ **Services** (ไอคอน + ด้านซ้าย)
- เพิ่ม **Drive API** → กด Add

### 1.4 Deploy เป็น Web App
- คลิก **Deploy → New deployment**
- ตั้งค่า:
  - Type: **Web app**
  - Execute as: **Me**
  - Who has access: **Anyone** *(หรือ Anyone with Google Account ก็ได้)*
- กด **Deploy**
- **คัดลอก URL** ที่ได้ไว้ (ตัวอย่าง: `https://script.google.com/macros/s/AKfyc…/exec`)

> ⚠️ **สำคัญ:** ถ้าแก้ไขโค้ด Apps Script ให้ Deploy ใหม่ทุกครั้ง (Manage deployments → แก้ version)

---

## ขั้นตอนที่ 2 — เปิด Dashboard

1. เปิดไฟล์ **`index.html`** ด้วยเบราว์เซอร์
2. ในช่อง **"Google Apps Script URL"** ใส่ URL จากขั้นตอน 1.4
3. กด **"บันทึก & โหลด"**
4. ครั้งแรกจะเป็น empty state เพราะยังไม่มีข้อมูล — ไปขั้นตอนที่ 3

---

## ขั้นตอนที่ 3 — อัปโหลด Report จาก FlowAccount

### 3.1 Export จาก FlowAccount
- ใน FlowAccount ไปที่ **รายงาน → รายการขาย** (หรือ Invoice Report)
- เลือกช่วงวันที่ที่ต้องการ
- กด **Export → Excel (.xlsx)**

### 3.2 อัปโหลดเข้าระบบ
- ใน Dashboard ไปที่แท็บ **"⬆️ Upload Report"**
- ลากไฟล์ .xlsx มาวาง หรือคลิกเลือกไฟล์
- รอสักครู่ ระบบจะ:
  - บันทึกไฟล์ต้นฉบับใน Google Drive โฟลเดอร์ `Sales_Reports_Raw`
  - แปลงข้อมูลและเพิ่มลงใน Master Data
  - แจ้งจำนวนรายการใหม่ และรายการซ้ำที่ถูกข้าม

> ✅ อัปโหลดได้ซ้ำได้ — ระบบจะไม่นับข้อมูลซ้ำ (key = เลขที่เอกสาร + รหัสสินค้า + วันที่)

---

## ขั้นตอนที่ 4 — ตรวจสอบ Master Data

ไปที่แท็บ **"📋 Master Data"** เพื่อดูข้อมูลทั้งหมดที่ระบบเก็บไว้

**สิ่งที่ควรตรวจ:**
- คอลัมน์ **Channel** — ลูกค้าที่ยังเป็น `Unmapped` ให้ไปตั้งค่า Channel Mapping
- คอลัมน์ **net_amount** — รายการ "คืนเงินแล้ว" ควรเป็นค่าติดลบ
- คอลัมน์ **is_cancelled** — รายการยกเลิกควรเป็น `TRUE`

---

## ขั้นตอนที่ 5 — ตั้งค่า Channel Mapping

ไปที่แท็บ **"🗺️ Channel Mapping"**

**วิธีเพิ่ม mapping:**
1. ถ้ามีลูกค้าที่ยังเป็น `Unmapped` จะแสดง shortcut ด้านบน — คลิกชื่อลูกค้าเพื่อเพิ่มแถวอัตโนมัติ
2. ใส่ชื่อ Channel ในช่องด้านขวา เช่น: `LINE OA`, `Shopee`, `Lazada`, `Walk-in`, `Distributor A`
3. กด **"บันทึก Mapping"**
4. ระบบจะอัปเดต Channel ในข้อมูลทั้งหมดโดยอัตโนมัติ

> 💡 ชื่อลูกค้าต้องตรงกับใน FlowAccount **ตัวพิมพ์เล็กใหญ่สำคัญ**

---

## ขั้นตอนที่ 6 — ใช้งาน Dashboard

### Filters ที่ใช้ได้
| Filter | วิธีใช้ |
|--------|---------|
| ช่วงวันที่ | คลิกเพื่อเปิด Calendar Picker เลือกวันเริ่ม-สิ้นสุด |
| สินค้า, หมวดสินค้า, คลัง, ลูกค้า, สถานะ, Channel | คลิก dropdown เลือกได้หลายรายการพร้อมกัน |
| รีเซ็ต Filters | คืนค่าทุก filter เป็นค่าเริ่มต้น (ดูข้อมูลทั้งหมด) |

### KPI Cards
- **Net Sales** — ยอดขายสุทธิ (ไม่นับที่ยกเลิก, รายการคืนเงินหักล้างด้วยค่าติดลบ)
- **Discount Rate** — ส่วนลดรวม ÷ มูลค่าก่อนส่วนลด
- **Avg ฿/ธุรกรรม** — Net Sales ÷ จำนวนเลขที่เอกสาร
- **Unit/ธุรกรรม** — จำนวนสินค้ารวม ÷ จำนวนเลขที่เอกสาร

### Sales Comparison
- เลือกช่วงวันที่ก่อน — กราฟจะเปรียบเทียบกับช่วงก่อนหน้าที่มีจำนวนวันเท่ากันอัตโนมัติ
- ตัวอย่าง: เลือก 1–31 ต.ค. → เปรียบเทียบกับ 1–30 ก.ย.

---

## Workflow รายเดือน

```
ต้นเดือน/สัปดาห์
    ↓
Export report จาก FlowAccount (.xlsx)
    ↓
เปิด index.html → Upload Report
    ↓
ตรวจสอบ Unmapped ใน Channel Mapping → เพิ่ม mapping
    ↓
กด Refresh บน Dashboard
    ↓
ดูข้อมูลบน Dashboard 🎉
```

---

## แก้ปัญหาที่พบบ่อย

### ❌ "ไม่พบคอลัมน์ที่จำเป็น"
- ตรวจสอบว่า export จาก FlowAccount แบบ "รายการสินค้า" ไม่ใช่แบบ "สรุป"
- ลองเปิดไฟล์ .xlsx ดูว่ามีคอลัมน์ชื่อ: เลขที่เอกสาร, วันที่, ลูกค้า, สินค้า, มูลค่ารวม หรือไม่

### ❌ "ไม่สามารถอ่านข้อมูลจาก Apps Script ได้"
- ตรวจสอบว่า URL ถูกต้องและ Deploy เป็น Web App แล้ว
- เปิด URL ในเบราว์เซอร์ใหม่ — ถ้าขึ้น `{"rows":[],...}` แสดงว่า Apps Script ทำงานได้

### ❌ Apps Script ขอ Authorization
- เมื่อ run ครั้งแรก Apps Script จะขอสิทธิ์ — กด "Review Permissions" → "Allow"

### ❌ CORS Error ใน Browser Console
- ต้องใช้ Deploy URL (ที่ลงท้ายด้วย `/exec`) ไม่ใช่ URL ของ Script Editor
- ถ้ายังมีปัญหา ลอง Deploy ใหม่

### ❌ วันที่แสดงผิด
- ถ้า FlowAccount export วันที่เป็น พ.ศ. (เช่น 2567) ระบบจะแปลงเป็น ค.ศ. ให้อัตโนมัติ
- ถ้าวันที่ยังผิด ตรวจดูรูปแบบวันที่ใน Excel และแจ้งให้ทีม dev ทราบ

---

## โครงสร้าง Google Sheets

ระบบจะสร้าง sheets เหล่านี้อัตโนมัติ:

| Sheet | หน้าที่ |
|-------|---------|
| `Raw_FlowAccount` | บันทึก log การอัปโหลดแต่ละครั้ง |
| `Master_Sales` | ข้อมูล Master ที่ประมวลผลแล้ว — **ห้ามแก้ไขมือ** |
| `Channel_Mapping` | customer_name → channel (แก้ไขผ่าน Dashboard) |
| `Config` | เก็บวันที่อัปเดตล่าสุด |

---

## Logic สถานะ (สำคัญ)

| สถานะ | นับใน Net Sales | แสดงใน Status Overview |
|-------|-----------------|------------------------|
| ชำระแล้ว | ✅ ใช่ | ✅ |
| ค้างชำระ | ✅ ใช่ | ✅ |
| คืนเงินแล้ว | ✅ ใช่ (ค่าติดลบ) | ✅ |
| ยกเลิก | ❌ ไม่นับ | ✅ |

> สถานะนี้กำหนดไว้ใน `Code.gs` บรรทัด `STATUS_CANCELLED` และ `STATUS_REFUNDED` สามารถแก้ไขได้ในอนาคต
