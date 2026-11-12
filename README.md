# RAKPAA & PUREHIVE Sales Dashboard

แดชบอร์ดวิเคราะห์ยอดขายสำหรับแบรนด์ **RAKPAA** และ **PUREHIVE** สร้างด้วย HTML/CSS/JavaScript ล้วนๆ ไม่ต้องติดตั้งอะไรเพิ่มเติม

---

## ✨ ฟีเจอร์หลัก

- **KPI Cards** — ยอดขายรวม, จำนวน Invoice, ยอดเฉลี่ยต่อ Invoice, ยอดเฉลี่ยต่อวัน
- **Channel Performance** — กราฟแท่งแนวนอนเปรียบเทียบยอดขายตามช่องทาง
- **Top Products** — สินค้าขายดี 10 อันดับ พร้อมตาราง
- **Monthly Comparison** — เปรียบเทียบยอดขายรายเดือน พร้อม MoM %
- **Sales Comparison** — ฟิลเตอร์อิสระเลือก Period A / Period B เปรียบเทียบกันได้อย่างอิสระ
- **Daily Trend** — กราฟแนวโน้มยอดขายรายวัน
- **Customer Ranking** — จัดอันดับลูกค้าตามยอดซื้อ

## 📱 Responsive Design

รองรับทุกขนาดหน้าจอ — Desktop, Tablet, Mobile

---

## 🚀 วิธีใช้งาน

### วิธีที่ 1 — เปิดไฟล์ Standalone (แนะนำ)

เปิดไฟล์ `dashboard_standalone.html` ด้วย Chrome หรือ Edge ได้เลย ไม่ต้องติดตั้งอะไร ข้อมูลทั้งหมดฝังอยู่ในไฟล์แล้ว

### วิธีที่ 2 — เปิดจากหลายไฟล์

```
index.html      ← หน้าหลัก
dashboard.js    ← Logic ทั้งหมด
dashboard.css   ← Styles
data.js         ← ข้อมูลยอดขาย (window.LOCAL_DATA)
```

เปิด `index.html` ผ่าน local server หรือ VS Code Live Server

### วิธีที่ 3 — เชื่อมต่อ Google Apps Script

1. Deploy `Code.gs` เป็น Web App บน Google Apps Script
2. ใส่ URL ใน Config Panel ของ dashboard
3. ข้อมูลจะโหลดจาก Google Sheets โดยตรง

---

## 📂 โครงสร้างไฟล์

```
├── index.html                  # หน้าหลัก
├── dashboard.js                # JavaScript (Chart.js, Flatpickr)
├── dashboard.css               # CSS (Responsive)
├── data.js                     # ข้อมูลยอดขายแบบ Embedded
├── dashboard_standalone.html   # All-in-one ไฟล์เดียว (910KB)
└── Code.gs                     # Google Apps Script Backend
```

---

## 🛠️ Tech Stack

| เทคโนโลยี | เวอร์ชัน | ใช้ทำอะไร |
|-----------|---------|-----------|
| Chart.js | 4.4.1 | กราฟทุกประเภท |
| Flatpickr | 4.6.13 | Date Range Picker (Thai locale) |
| Google Apps Script | — | Backend / Google Sheets |
| Vanilla JS/CSS | — | UI ทั้งหมด ไม่ใช้ Framework |

---

## 📊 ข้อมูลที่ใช้

ข้อมูลยอดขายปี 2026 จาก FlowAccount ส่งออกเป็น `.xlsx` แล้วแปลงเป็น `data.js` ด้วย PowerShell

- ช่วงข้อมูล: มกราคม — พฤศจิกายน 2026
- จำนวน Invoice: ~653 ใบ
- จำนวนแถวข้อมูล: ~1,398 แถว

---

## 🔄 อัปเดตข้อมูล

1. Export ไฟล์ใหม่จาก FlowAccount → `SalesByProductReport_YYYY.xlsx`
2. รัน `extract_xlsx.ps1` เพื่อสร้าง `data.js` ใหม่
3. Rebuild `dashboard_standalone.html` ถ้าต้องการ all-in-one

---

## 📝 License

สงวนสิทธิ์ © 2026 RAKPAA & PUREHIVE — ใช้สำหรับการดำเนินงานภายในเท่านั้น
