<#
  update-dashboard.ps1
  อ่านตาราง RawData จากไฟล์ SalesByProduct_RAW_Template.xlsx แล้วสร้างข้อมูล Dashboard ใหม่ทั้งหมด
  (data.js + ข้อมูลที่ฝังใน dashboard_standalone.html) ให้ตรงกับ RAW ทุกแถว

  ใช้:  powershell -ExecutionPolicy Bypass -File update-dashboard.ps1 -Excel "<path>\SalesByProduct_RAW_Template.xlsx" [-Push]
        -Push = commit + push ขึ้น GitHub (หน้าเว็บอัปเดตใน 1-2 นาที)
#>
param(
  [Parameter(Mandatory = $true)][string]$Excel,
  [switch]$Push
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Repo = $PSScriptRoot
if (-not (Test-Path $Excel)) { throw "ไม่พบไฟล์: $Excel" }
$Excel = (Resolve-Path $Excel).Path
$tmp = Join-Path $env:TEMP ("rawdata_" + [guid]::NewGuid().ToString('N') + '.csv')

# ---------- 1) อ่านตาราง RawData (ค่าจริง ไม่ปัดทศนิยม) ----------
Write-Host "อ่าน RAW จาก $Excel ..."
$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($Excel, 0, $true)
  $lo = $null
  foreach ($ws in $wb.Worksheets) { foreach ($t in $ws.ListObjects) { if ($t.Name -eq 'RawData') { $lo = $t } } }
  if (-not $lo) { throw 'ไม่พบตาราง RawData ในไฟล์' }
  $nb = $xl.Workbooks.Add(); $dst = $nb.Worksheets.Item(1)
  $lo.Range.Copy() | Out-Null
  $dst.Range('A1').PasteSpecial(-4163) | Out-Null
  $dst.UsedRange.NumberFormat = 'General'
  $nb.SaveAs($tmp, 62); $nb.Close($false); $wb.Close($false)
} finally { $xl.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null }
$raw = Import-Csv $tmp -Encoding UTF8
Remove-Item $tmp -ErrorAction SilentlyContinue
if ($raw.Count -eq 0) { throw 'RAW ไม่มีข้อมูล' }

# ---------- 2) แปลงเป็นข้อมูล Dashboard ----------
$map = [ordered]@{
  product_code = 'รหัสสินค้า'; product_name = 'ชื่อสินค้า'; doc_no = 'เลขที่เอกสาร'; date = 'วัน/เดือน/ปี'
  customer = 'ชื่อลูกค้า'; qty = 'จำนวน'; unit = 'หน่วยสินค้า'; unit_price = 'ราคาต่อหน่วย'
  amount_before_discount = 'มูลค่าก่อนส่วนลด'; discount_amount = 'ส่วนลดรวม'; net_amount = 'มูลค่า'
  vat = 'ภาษีมูลค่าเพิ่ม'; total = 'ยอดรวมสุทธิ'; status = 'สถานะ'; channel = 'หมวดสินค้า'
  salesperson = 'พนักงานขาย'; warehouse = 'คลังสินค้า'
}
$cols = $raw[0].PSObject.Properties.Name
foreach ($k in $map.Keys) { if ($cols -notcontains $map[$k]) { throw "RAW ไม่มีคอลัมน์ '$($map[$k])'" } }
$numKeys = 'qty', 'unit_price', 'amount_before_discount', 'discount_amount', 'net_amount', 'vat', 'total'
function JS([string]$v) {
  $sb = New-Object Text.StringBuilder; [void]$sb.Append('"')
  foreach ($ch in $v.ToCharArray()) {
    $null = switch ($ch) { '"' { $sb.Append('\"') } '\' { $sb.Append('\\') } "`n" { $sb.Append('\n') } "`r" { $sb.Append('\r') } "`t" { $sb.Append('\t') } default { $sb.Append($ch) } }
  }
  [void]$sb.Append('"'); $sb.ToString()
}
$out = New-Object Text.StringBuilder; [void]$out.Append('[')
$sum = 0.0; $months = @{}; $minD = $null; $maxD = $null; $i = 0
foreach ($r in $raw) {
  $o = @()
  foreach ($k in $map.Keys) {
    $v = "$($r.($map[$k]))"; if ($k -eq 'date' -or $numKeys -contains $k) { $v = $v.Trim() }
    if ($k -eq 'date') {
      $d = 0.0
      if ([double]::TryParse($v, [ref]$d)) { $v = [DateTime]::FromOADate($d).ToString('yyyy-MM-dd') }
      elseif ($v -match '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$') { $v = '{0}-{1:D2}-{2:D2}' -f $matches[3], [int]$matches[2], [int]$matches[1] }
      else { throw "แถว $($i + 2): วันที่อ่านไม่ได้ '$v'" }
      if (-not $minD -or $v -lt $minD) { $minD = $v }; if (-not $maxD -or $v -gt $maxD) { $maxD = $v }
    }
    if ($numKeys -contains $k -and $v -eq '') { $v = '-' }
    if ($k -eq 'total' -and $v -ne '-') { $t = [double]$v; $sum += $t; $months[$o[3].Substring(1, 7)] += $t }
    $o += (JS $v)
  }
  if ($i -gt 0) { [void]$out.Append(',') }
  [void]$out.Append('{' + ((@($map.Keys) | ForEach-Object -Begin { $j = 0 } -Process { (JS $_) + ':' + $o[$j]; $j++ }) -join ',') + '}')
  $i++
}
[void]$out.Append(']')
$arr = $out.ToString()

$th = 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
function ThDate([string]$iso) { $p = $iso.Split('-'); "$([int]$p[2]) $($th[[int]$p[1] - 1]) $([int]$p[0] + 543)" }
$info = "ข้อมูล: $(ThDate $minD) – $(ThDate $maxD) · อัปเดต $((Get-Date).ToString('dd\/MM\/') + ((Get-Date).Year + 543)) $((Get-Date).ToString('HH:mm'))"
$infoLine = 'window.LOCAL_DATA_INFO = ' + (JS $info) + ';'

# ---------- 3) เขียนไฟล์ ----------
$utf8 = New-Object Text.UTF8Encoding $true
[IO.File]::WriteAllText("$Repo\data.js", "window.LOCAL_DATA = $arr;`r`n$infoLine`r`n", $utf8)
$html = [IO.File]::ReadAllText("$Repo\dashboard_standalone.html", [Text.Encoding]::UTF8)
$mark = 'window.LOCAL_DATA = '
$s = $html.IndexOf($mark); if ($s -lt 0) { throw 'ไม่พบ window.LOCAL_DATA ใน dashboard_standalone.html' }
$s += $mark.Length
$e = $html.IndexOf('}];', $s); if ($e -lt 0) { throw 'ไม่พบจุดสิ้นสุดข้อมูลใน dashboard_standalone.html' }
$html = $html.Substring(0, $s) + $arr + $html.Substring($e + 2)
$re = [regex]'window\.LOCAL_DATA_INFO = "(?:[^"\\]|\\.)*";'
$after = $s + $arr.Length + 1   # position after "];"
if ($re.IsMatch($html)) { $html = $re.Replace($html, $infoLine.Replace('$', '$$'), 1) }
else { $html = $html.Substring(0, $after) + "`n$infoLine" + $html.Substring($after) }
[IO.File]::WriteAllText("$Repo\dashboard_standalone.html", $html, $utf8)

# ---------- 4) สรุป ----------
Write-Host ''
Write-Host ("แถวทั้งหมด: {0:N0}   ช่วงวันที่: {1} ถึง {2}" -f $raw.Count, $minD, $maxD)
Write-Host ("ยอดรวมสุทธิ (รวม VAT): {0:N2}   <- ต้องตรงกับชีต ตรวจสอบยอด บรรทัด 'RAW ทั้งหมด'" -f $sum)
$months.Keys | Sort-Object | Select-Object -Last 3 | ForEach-Object { Write-Host ("  {0}: {1:N2}" -f $_, $months[$_]) }

if ($Push) {
  Push-Location $Repo
  try {
    git pull --ff-only --quiet
    git add data.js dashboard_standalone.html
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host 'ข้อมูลไม่มีการเปลี่ยนแปลง ไม่ต้อง push' }
    else {
      git commit -q -m "Update data: $($raw.Count) rows ($minD to $maxD)"
      git push --quiet
      if ($LASTEXITCODE -ne 0) { throw 'git push ไม่สำเร็จ' }
      Write-Host 'Push แล้ว - หน้าเว็บจะอัปเดตภายใน 1-2 นาที (ถ้ายังเห็นของเดิม กด Ctrl+F5)'
    }
  } finally { Pop-Location }
} else {
  Write-Host 'อัปเดตไฟล์ในเครื่องแล้ว (ยังไม่ push) - ใส่ -Push เพื่อขึ้นหน้าเว็บ'
}
