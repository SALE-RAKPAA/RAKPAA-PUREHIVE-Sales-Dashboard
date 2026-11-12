/* ============================================================
   dashboard.js — RAKPAA & PUREHIVE Sales Dashboard
   ============================================================ */

'use strict';

// ─── Config & State ───────────────────────────────────────────

const CONFIG = {
  get gasUrl() { return localStorage.getItem('gas_url') || ''; },
  set gasUrl(v){ localStorage.setItem('gas_url', v); }
};

const STATE = {
  allRows:     [],   // raw Master_Sales rows
  filteredRows:[],
  mapping:     {},   // channel mapping dict
  lastUpdated: null,
  loading:     false,
  charts:      {},   // Chart.js instances keyed by id
  masterPage:  1,
  masterSearch: '',
  masterSort:  { col: 'date', dir: -1 }
};

const FILTERS = {
  dateFrom:  '',
  dateTo:    '',
  products:  [],
  categories:[],
  warehouses:[],
  customers: [],
  statuses:  [],
  channels:  []
};

// ─── Helpers ──────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if(cls) e.className=cls; if(html) e.innerHTML=html; return e; };

function fmt(n) { return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n||0); }
function fmtInt(n) { return new Intl.NumberFormat('th-TH').format(Math.round(n||0)); }
function fmtPct(n) { return (n||0).toFixed(1) + '%'; }
function fmtDate(d) { if(!d) return '—'; const dt = new Date(d+'T00:00:00'); return dt.toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }); }

function getStatusClass(s) {
  const v = (s||'').toLowerCase();
  if (v.includes('ชำระแล้ว') || v.includes('paid')) return 'badge-paid';
  if (v.includes('ค้างชำระ') || v.includes('pending')) return 'badge-pending';
  if (v.includes('คืนเงิน') || v.includes('refund')) return 'badge-refunded';
  if (v.includes('ยกเลิก') || v.includes('cancel')) return 'badge-cancelled';
  return 'badge-other';
}

// ─── API ──────────────────────────────────────────────────────

async function apiFetch(url, opts={}) {
  const resp = await fetch(url, { ...opts, redirect: 'follow' });
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch(_) { throw new Error('ไม่สามารถอ่านข้อมูลจาก Apps Script ได้: ' + text.slice(0,200)); }
}

async function loadData() {
  STATE.loading = true;
  showLoadingState();

  // Local data mode: use window.LOCAL_DATA if present and no GAS URL
  if (!CONFIG.gasUrl && window.LOCAL_DATA) {
    STATE.allRows    = (window.LOCAL_DATA).map(normalizeRow);
    STATE.mapping    = {};
    STATE.lastUpdated= '2026-11-12T00:00:00Z';
    applyFilters();
    renderAll();
    $('last-updated').textContent = 'ข้อมูล: ม.ค.–พ.ย. 2569 (Rakpaa Honey)';
    STATE.loading = false;
    return;
  }

  if (!CONFIG.gasUrl) { showNoConfig(); STATE.loading = false; return; }

  try {
    const data = await apiFetch(CONFIG.gasUrl + '?action=getData');
    if (data.error) throw new Error(data.error);
    STATE.allRows    = (data.rows || []).map(normalizeRow);
    STATE.mapping    = data.mapping || {};
    STATE.lastUpdated= data.lastUpdated;
    applyFilters();
    renderAll();
    if (STATE.lastUpdated) {
      $('last-updated').textContent = 'อัปเดต: ' + new Date(STATE.lastUpdated).toLocaleString('th-TH');
    }
  } catch(e) {
    // Fallback to local data on network error
    if (window.LOCAL_DATA) {
      STATE.allRows    = (window.LOCAL_DATA).map(normalizeRow);
      STATE.mapping    = {};
      STATE.lastUpdated= '2026-11-12T00:00:00Z';
      applyFilters();
      renderAll();
      $('last-updated').textContent = 'ข้อมูลจาก Local (GAS ไม่สามารถเชื่อมต่อได้)';
    } else {
      showError('โหลดข้อมูลไม่สำเร็จ: ' + e.message);
    }
  }
  STATE.loading = false;
}

function normalizeRow(r) {
  return {
    ...r,
    qty:                  parseFloat(r.qty||0),
    unit_price:           parseFloat(r.unit_price||0),
    discount_amount:      parseFloat(r.discount_amount||0),
    amount_before_discount: parseFloat(r.amount_before_discount||0),
    net_amount:           parseFloat(r.net_amount||0),
    is_cancelled:         r.is_cancelled === true || r.is_cancelled === 'TRUE',
    is_refunded:          r.is_refunded  === true || r.is_refunded  === 'TRUE',
    date:                 String(r.date||'').substring(0,10)
  };
}

// ─── Filters ──────────────────────────────────────────────────

function applyFilters() {
  STATE.filteredRows = STATE.allRows.filter(r => {
    if (FILTERS.dateFrom && r.date < FILTERS.dateFrom) return false;
    if (FILTERS.dateTo   && r.date > FILTERS.dateTo)   return false;
    if (FILTERS.products.length   && !FILTERS.products.includes(r.product_name))   return false;
    if (FILTERS.categories.length && !FILTERS.categories.includes(r.category))     return false;
    if (FILTERS.warehouses.length && !FILTERS.warehouses.includes(r.warehouse))    return false;
    if (FILTERS.customers.length  && !FILTERS.customers.includes(r.customer))      return false;
    if (FILTERS.statuses.length   && !FILTERS.statuses.includes(r.status))         return false;
    if (FILTERS.channels.length   && !FILTERS.channels.includes(r.channel))        return false;
    return true;
  });
}

function resetFilters() {
  Object.keys(FILTERS).forEach(k => { FILTERS[k] = Array.isArray(FILTERS[k]) ? [] : ''; });
  if (window._fpInstance) window._fpInstance.clear();
  document.querySelectorAll('.ms-wrapper').forEach(w => {
    w.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    updateMsToggle(w);
  });
  applyFilters();
  renderAll();
}

// ─── KPI Calculations ─────────────────────────────────────────

function calcKPIs(rows) {
  // Active rows = not cancelled (refunded rows stay with negative net_amount)
  const active = rows.filter(r => !r.is_cancelled);
  const netSales = active.reduce((s,r) => s + r.net_amount, 0);
  const totalDiscount = active.reduce((s,r) => s + r.discount_amount, 0);
  const totalBeforeDiscount = active.reduce((s,r) => s + r.amount_before_discount, 0);
  const discountRate = totalBeforeDiscount ? (totalDiscount / totalBeforeDiscount) * 100 : 0;
  // Distinct doc_no for non-cancelled rows (exclude refunds from transaction count? No — refunds are transactions too)
  const docNos = new Set(active.filter(r => !r.is_refunded).map(r => r.doc_no));
  const txCount = docNos.size || 1;
  const totalQty = active.filter(r => !r.is_refunded).reduce((s,r) => s + r.qty, 0);
  return {
    netSales, discountRate,
    avgBaht: netSales / txCount,
    unitPerTx: totalQty / txCount,
    txCount
  };
}

// ─── Render: KPI Cards ────────────────────────────────────────

function renderKPIs(rows) {
  const k = calcKPIs(rows);
  const cards = [
    { id:'kpi-net-sales',    label:'Net Sales', value:'฿' + fmt(k.netSales),    color:'#1B6B45', icon:'💰', sub: fmtInt(k.txCount) + ' ธุรกรรม' },
    { id:'kpi-discount',     label:'Discount Rate', value:fmtPct(k.discountRate), color:'#F4A261', icon:'🏷️', sub:'ส่วนลดรวม' },
    { id:'kpi-avg-baht',     label:'Avg ฿ / ธุรกรรม', value:'฿' + fmt(k.avgBaht), color:'#2563EB', icon:'📊', sub:'ต่อเลขที่เอกสาร' },
    { id:'kpi-unit-tx',      label:'Unit / ธุรกรรม', value: (k.unitPerTx).toFixed(1), color:'#7C3AED', icon:'📦', sub:'ชิ้น/ใบ' }
  ];
  const grid = $('kpi-grid');
  grid.innerHTML = cards.map(c => `
    <div class="kpi-card" style="--kpi-color:${c.color}">
      <div class="kpi-label">${c.icon} ${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');
}

// ─── Render: Status Overview ──────────────────────────────────

function renderStatusOverview(rows) {
  const statusMap = {};
  rows.forEach(r => {
    const s = r.status || 'ไม่ระบุ';
    if (!statusMap[s]) statusMap[s] = { count:0, net:0 };
    statusMap[s].count++;
    statusMap[s].net += r.net_amount;
  });
  const tbody = $('status-tbody');
  if (!Object.keys(statusMap).length) { tbody.innerHTML = '<tr><td colspan="3" class="state-box"><div class="state-icon">📋</div><div>ไม่มีข้อมูล</div></td></tr>'; return; }
  tbody.innerHTML = Object.entries(statusMap)
    .sort((a,b) => Math.abs(b[1].net) - Math.abs(a[1].net))
    .map(([s, d]) => `
      <tr>
        <td><span class="status-badge ${getStatusClass(s)}">${s}</span></td>
        <td class="num">${fmtInt(d.count)}</td>
        <td class="num ${d.net < 0 ? 'amount-negative':'amount-positive'}">
          ${d.net < 0 ? '−' : ''}฿${fmt(Math.abs(d.net))}
        </td>
      </tr>`).join('');
}

// ─── Render: Product Performance ─────────────────────────────

function renderProductPerformance(rows) {
  const topN = parseInt($('top-n-select').value) || 10;
  const active = rows.filter(r => !r.is_cancelled);
  const prodMap = {};
  active.forEach(r => {
    const name = r.product_name || r.product_code || 'ไม่ระบุ';
    if (!prodMap[name]) prodMap[name] = { name, qty:0, net:0, discSum:0, beforeSum:0 };
    prodMap[name].qty      += r.qty;
    prodMap[name].net      += r.net_amount;
    prodMap[name].discSum  += r.discount_amount;
    prodMap[name].beforeSum+= r.amount_before_discount;
  });
  const sorted = Object.values(prodMap).sort((a,b) => b.net - a.net).slice(0, topN);

  // Chart
  const labels = sorted.map(p => p.name.length > 18 ? p.name.slice(0,18)+'…' : p.name);
  const vals   = sorted.map(p => p.net);
  const ctx    = $('product-chart').getContext('2d');
  if (STATE.charts.product) STATE.charts.product.destroy();
  STATE.charts.product = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: vals, backgroundColor: '#2D9469', borderRadius: 5, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ' ฿' + fmt(ctx.raw) }
      }},
      scales: {
        x: { ticks: { callback: v => '฿' + fmtInt(v), font: { size: 11 } }, grid: { color: '#F0F3F7' } },
        y: { ticks: { font: { size: 11 } } }
      }
    }
  });

  // Table
  const tb = $('product-tbody');
  tb.innerHTML = sorted.map((p, i) => `
    <tr>
      <td class="rank">${i+1}</td>
      <td>${p.name}</td>
      <td class="num">${fmtInt(p.qty)}</td>
      <td class="num">฿${fmt(p.net)}</td>
      <td class="num">${fmtPct(p.beforeSum ? (p.discSum/p.beforeSum)*100 : 0)}</td>
    </tr>`).join('');
}

// ─── Render: Channel Performance ─────────────────────────────

function renderChannelPerformance(rows) {
  const active = rows.filter(r => !r.is_cancelled);
  const chanMap = {};
  active.forEach(r => {
    const c = r.channel || 'Unmapped';
    if (!chanMap[c]) chanMap[c] = { net:0, tx: new Set() };
    chanMap[c].net += r.net_amount;
    chanMap[c].tx.add(r.doc_no);
  });
  const channels = Object.entries(chanMap)
    .map(([k,v]) => ({ name:k, net:v.net, tx:v.tx.size }))
    .sort((a,b) => b.net - a.net);

  if (!channels.length) { $('channel-chart-wrap').innerHTML = '<div class="state-box"><div class="state-icon">📡</div><div>ไม่มีข้อมูล Channel</div></div>'; return; }

  const COLORS = ['#1B6B45','#2D9469','#52B788','#74C69D','#95D5B2','#F4A261','#E76F51','#2563EB','#7C3AED','#EC4899'];
  const labels = channels.map(c => c.name);
  const vals   = channels.map(c => c.net);
  const colors = channels.map((_, i) => COLORS[i % COLORS.length]);
  const totalNet = vals.reduce((a,b) => a+b, 0);

  const ctx = $('channel-chart').getContext('2d');
  if (STATE.charts.channel) STATE.charts.channel.destroy();
  STATE.charts.channel = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: vals,
        backgroundColor: colors,
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ฿${fmt(ctx.raw)} (${fmtPct(totalNet ? (ctx.raw/totalNet)*100 : 0)})` }}
      },
      scales: {
        x: { ticks: { callback: v => '฿' + fmtInt(v), font:{size:11} }, grid:{color:'#F0F3F7'} },
        y: { ticks: { font:{size:12} } }
      }
    }
  });

  // Legend as summary table
  const legend = $('channel-legend');
  legend.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse">
    <tr style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em">
      <th style="text-align:left;padding:4px 6px">Channel</th>
      <th style="text-align:right;padding:4px 6px">Net Sales</th>
      <th style="text-align:right;padding:4px 6px">%</th>
    </tr>` +
    channels.map((c, i) => `
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:5px 6px;display:flex;align-items:center;gap:5px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[i%COLORS.length]};flex-shrink:0"></span>
        ${c.name}
      </td>
      <td style="text-align:right;padding:5px 6px;font-weight:500">฿${fmt(c.net)}</td>
      <td style="text-align:right;padding:5px 6px;color:var(--text-muted)">${fmtPct(totalNet?(c.net/totalNet)*100:0)}</td>
    </tr>`).join('') + '</table>';

  // Warn about Unmapped
  const unmapped = chanMap['Unmapped'];
  const warn = $('unmapped-warning');
  if (unmapped && unmapped.net) {
    warn.style.display = 'block';
    warn.textContent = `⚠️ มี "Unmapped" ฿${fmt(unmapped.net)} กรุณาแก้ Channel Mapping`;
  } else {
    warn.style.display = 'none';
  }
}

// ─── Comparison Filter State ──────────────────────────────────

const CMP = { aFrom:'', aTo:'', bFrom:'', bTo:'', gran:'auto' };

// ─── Render: Sales Comparison ─────────────────────────────────

function renderSalesComparison() {
  const allActive = STATE.allRows.filter(r => !r.is_cancelled);
  if (!allActive.length) {
    $('comparison-container').innerHTML = '<div class="state-box"><div class="state-icon">📅</div><div>ไม่มีข้อมูล</div></div>';
    return;
  }

  // Auto-fill period A from main date filter or full data range; period B = prior equal length
  const dataMin = allActive.map(r=>r.date).sort()[0];
  const dataMax = allActive.map(r=>r.date).sort().at(-1);

  const aFrom = CMP.aFrom || FILTERS.dateFrom || dataMin;
  const aTo   = CMP.aTo   || FILTERS.dateTo   || dataMax;

  const aStart = new Date(aFrom), aEnd = new Date(aTo);
  const diffDays = Math.round((aEnd - aStart) / 86400000);

  let bFrom = CMP.bFrom;
  let bTo   = CMP.bTo;
  if (!bFrom || !bTo) {
    const bEnd   = new Date(aStart); bEnd.setDate(bEnd.getDate() - 1);
    const bStart = new Date(bEnd);   bStart.setDate(bStart.getDate() - diffDays);
    bFrom = bStart.toISOString().slice(0,10);
    bTo   = bEnd.toISOString().slice(0,10);
  }

  const gran = CMP.gran === 'auto'
    ? (diffDays <= 31 ? 'day' : diffDays <= 90 ? 'week' : 'month')
    : CMP.gran;

  const aBuckets = buildBuckets(aFrom, aTo, gran);
  const bBuckets = buildBuckets(bFrom, bTo, gran);

  const aData = aggregateToBuckets(allActive.filter(r => r.date >= aFrom && r.date <= aTo), aBuckets, gran);
  const bData = aggregateToBuckets(allActive.filter(r => r.date >= bFrom && r.date <= bTo), bBuckets, gran);

  const aTotal = aData.reduce((s,v)=>s+v, 0);
  const bTotal = bData.reduce((s,v)=>s+v, 0);
  const changePct = bTotal ? ((aTotal - bTotal) / Math.abs(bTotal)) * 100 : 0;

  $('cur-total').textContent  = '฿' + fmt(aTotal);
  $('prev-total').textContent = '฿' + fmt(bTotal);
  const deltaEl = $('period-delta');
  deltaEl.textContent = (changePct >= 0 ? '▲ +' : '▼ ') + Math.abs(changePct).toFixed(1) + '%';
  deltaEl.style.background = changePct >= 0 ? '#ECFDF5' : '#FEF2F2';
  deltaEl.style.color      = changePct >= 0 ? '#15803D' : '#DC2626';

  // Show period labels
  const fmtDate = d => {
    const [y,m,day] = d.split('-');
    const TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${parseInt(day)} ${TH[parseInt(m)-1]} ${parseInt(y)+543}`;
  };
  const lbl = $('cmp-period-labels');
  if (lbl) lbl.textContent = `A: ${fmtDate(aFrom)}–${fmtDate(aTo)}  |  B: ${fmtDate(bFrom)}–${fmtDate(bTo)}`;

  // Build labels aligning by index (pad shorter series)
  const maxLen = Math.max(aBuckets.length, bBuckets.length);
  const aLabels = aBuckets.map(b => formatBucketLabel(b, gran));
  const bLabels = bBuckets.map(b => formatBucketLabel(b, gran));
  // Use A labels for x-axis, pad B to same length
  const paddedB = [...bData];
  while (paddedB.length < aData.length) paddedB.push(null);
  const paddedA = [...aData];
  while (paddedA.length < maxLen) paddedA.push(null);
  while (paddedB.length < maxLen) paddedB.push(null);
  const xLabels = aLabels.length >= bLabels.length ? aLabels : bLabels;
  while (xLabels.length < maxLen) xLabels.push('');

  const ctx = $('comparison-chart').getContext('2d');
  if (STATE.charts.comparison) STATE.charts.comparison.destroy();
  STATE.charts.comparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: xLabels,
      datasets: [
        {
          label: `ช่วง A (${fmtDate(aFrom)}–${fmtDate(aTo)})`,
          data: paddedA,
          backgroundColor: 'rgba(27,107,69,0.8)',
          borderRadius: 4,
          borderSkipped: false,
          order: 1
        },
        {
          label: `ช่วง B (${fmtDate(bFrom)}–${fmtDate(bTo)})`,
          data: paddedB,
          backgroundColor: 'rgba(155,168,192,0.6)',
          borderRadius: 4,
          borderSkipped: false,
          order: 2
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font:{size:12}, boxWidth:12, padding:14 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label.split('(')[0].trim()}: ฿${fmt(ctx.raw || 0)}` }}
      },
      scales: {
        y: { ticks: { callback: v => '฿' + fmtInt(v), font:{size:11} }, grid:{color:'#F0F3F7'} },
        x: { ticks: { font:{size:10}, maxRotation:45 } }
      }
    }
  });
}

function buildBuckets(from, to, gran) {
  const buckets = [], cur = new Date(from), end = new Date(to);
  while (cur <= end) {
    const key = cur.toISOString().slice(0,10);
    if (gran === 'day') buckets.push(key);
    else if (gran === 'week') {
      const mon = new Date(cur); mon.setDate(mon.getDate() - ((mon.getDay()+6)%7));
      const wk = mon.toISOString().slice(0,10);
      if (!buckets.length || buckets.at(-1) !== wk) buckets.push(wk);
      cur.setDate(cur.getDate() + 7); continue;
    } else {
      const mo = key.slice(0,7);
      if (!buckets.length || buckets.at(-1) !== mo) buckets.push(mo);
      cur.setMonth(cur.getMonth() + 1); continue;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}

function aggregateToBuckets(rows, buckets, gran) {
  const sums = Object.fromEntries(buckets.map(b => [b, 0]));
  rows.forEach(r => {
    const key = gran === 'day' ? r.date : gran === 'week' ? getMonday(r.date) : r.date.slice(0,7);
    if (sums[key] !== undefined) sums[key] += r.net_amount;
  });
  return buckets.map(b => sums[b]);
}

function getMonday(dateStr) {
  const d = new Date(dateStr); const day = (d.getDay()+6)%7;
  d.setDate(d.getDate() - day); return d.toISOString().slice(0,10);
}

function formatBucketLabel(key, gran) {
  if (gran === 'month') {
    const [y, m] = key.split('-');
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return months[parseInt(m)-1] + ' ' + (parseInt(y)+543).toString().slice(-2);
  }
  if (gran === 'week') return 'สัปดาห์ ' + key.slice(5);
  const d = new Date(key+'T00:00:00');
  return d.toLocaleDateString('th-TH', { month:'short', day:'numeric' });
}

// ─── Render: Monthly Comparison ──────────────────────────────

function renderMonthlyComparison(rows) {
  const active = rows.filter(r => !r.is_cancelled);
  // Aggregate by month
  const monthMap = {};
  active.forEach(r => {
    const mo = r.date.slice(0,7);
    if (!monthMap[mo]) monthMap[mo] = 0;
    monthMap[mo] += r.net_amount;
  });
  const months = Object.keys(monthMap).sort();
  if (months.length < 2) {
    $('monthly-chart-container').innerHTML = '<div class="state-box"><div class="state-icon">📅</div><div>ต้องการข้อมูลอย่างน้อย 2 เดือน</div></div>';
    return;
  }

  const vals = months.map(m => monthMap[m]);
  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    const TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return TH[parseInt(mo)-1] + ' ' + (parseInt(y)+543).toString().slice(-2);
  });

  // Colors: green if >= prev, red if < prev
  const bgColors = vals.map((v, i) => {
    if (i === 0) return '#2D9469';
    return v >= vals[i-1] ? '#2D9469' : '#E63946';
  });

  const ctx = $('monthly-chart').getContext('2d');
  if (STATE.charts.monthly) STATE.charts.monthly.destroy();
  STATE.charts.monthly = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: vals, backgroundColor: bgColors, borderRadius: 5, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ฿${fmt(ctx.raw)}` }}
      },
      scales: {
        y: { ticks: { callback: v => '฿' + fmtInt(v), font:{size:11} }, grid:{color:'#F0F3F7'} },
        x: { ticks: { font:{size:11} } }
      }
    }
  });

  // Table: month, net sales, MoM change
  const tbody = $('monthly-tbody');
  tbody.innerHTML = months.map((mo, i) => {
    const v = monthMap[mo];
    const prev = i > 0 ? monthMap[months[i-1]] : null;
    const pct = prev ? ((v - prev) / Math.abs(prev)) * 100 : null;
    const badge = pct === null ? '' :
      `<span style="font-size:11px;padding:2px 7px;border-radius:12px;font-weight:500;background:${pct>=0?'#ECFDF5':'#FEF2F2'};color:${pct>=0?'#15803D':'#DC2626'}">${pct>=0?'▲ +':'▼ '}${Math.abs(pct).toFixed(1)}%</span>`;
    const prevCell = prev ? `฿${fmt(prev)}` : '—';
    return `<tr>
      <td style="padding:9px 12px;font-weight:500">${labels[i]}</td>
      <td style="text-align:right;padding:9px 12px;font-weight:600">฿${fmt(v)}</td>
      <td style="text-align:right;padding:9px 12px;color:var(--text-muted)">${prevCell}</td>
      <td style="text-align:right;padding:9px 12px">${badge}</td>
    </tr>`;
  }).reverse().join('');
}

// ─── Render All ───────────────────────────────────────────────

function renderAll() {
  const rows = STATE.filteredRows;
  renderKPIs(rows);
  renderStatusOverview(rows);
  renderProductPerformance(rows);
  renderChannelPerformance(rows);
  renderMonthlyComparison(rows);
  renderSalesComparison();
  populateFilterOptions();
  renderMasterTable();
}

// ─── Filter Options ───────────────────────────────────────────

function populateFilterOptions() {
  const all = STATE.allRows;
  buildMultiSelect('ms-products',   unique(all,'product_name'), FILTERS, 'products');
  buildMultiSelect('ms-categories', unique(all,'category'),     FILTERS, 'categories');
  buildMultiSelect('ms-warehouses', unique(all,'warehouse'),    FILTERS, 'warehouses');
  buildMultiSelect('ms-customers',  unique(all,'customer'),     FILTERS, 'customers');
  buildMultiSelect('ms-statuses',   unique(all,'status'),       FILTERS, 'statuses');
  buildMultiSelect('ms-channels',   unique(all,'channel'),      FILTERS, 'channels');
}

function unique(rows, field) {
  return [...new Set(rows.map(r => r[field]).filter(Boolean))].sort();
}

// ─── Multi-Select Widget ──────────────────────────────────────

function buildMultiSelect(containerId, options, filterObj, filterKey) {
  const wrap = $(containerId);
  if (!wrap) return;
  const toggle   = wrap.querySelector('.ms-toggle');
  const dropdown = wrap.querySelector('.ms-dropdown');
  const search   = wrap.querySelector('.ms-search');
  const list     = wrap.querySelector('.ms-list');
  const selAll   = wrap.querySelector('.ms-select-all');

  const renderOptions = (q='') => {
    const filtered = options.filter(o => o.toString().toLowerCase().includes(q.toLowerCase()));
    list.innerHTML = filtered.map(o => `
      <label class="ms-item">
        <input type="checkbox" value="${o}" ${filterObj[filterKey].includes(o)?'checked':''}> ${o}
      </label>`).join('');
    list.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', () => {
        const v = cb.value;
        if (cb.checked) { if (!filterObj[filterKey].includes(v)) filterObj[filterKey].push(v); }
        else filterObj[filterKey] = filterObj[filterKey].filter(x => x !== v);
        updateMsToggle(wrap);
        applyFilters(); renderAll();
      });
    });
  };

  if (search) search.addEventListener('input', e => renderOptions(e.target.value));
  if (selAll) selAll.addEventListener('click', () => {
    const all = list.querySelectorAll('input');
    const anyUnchecked = [...all].some(c => !c.checked);
    all.forEach(c => { c.checked = anyUnchecked; });
    filterObj[filterKey] = anyUnchecked ? options.slice() : [];
    updateMsToggle(wrap);
    applyFilters(); renderAll();
  });

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.ms-dropdown.open').forEach(d => { d.classList.remove('open'); d.parentElement.querySelector('.ms-toggle').classList.remove('open'); });
    if (!isOpen) { dropdown.classList.add('open'); toggle.classList.add('open'); renderOptions(); if(search) search.focus(); }
  });

  renderOptions();
  updateMsToggle(wrap);
}

function updateMsToggle(wrap) {
  const toggle = wrap.querySelector('.ms-toggle');
  const badge  = toggle.querySelector('.ms-badge');
  const key    = wrap.id.replace('ms-','');
  const filterKey = { products:'products',categories:'categories',warehouses:'warehouses',customers:'customers',statuses:'statuses',channels:'channels' }[key] || key;
  const count = FILTERS[filterKey] ? FILTERS[filterKey].length : 0;
  const labels = { products:'สินค้า',categories:'หมวดสินค้า',warehouses:'คลัง',customers:'ลูกค้า',statuses:'สถานะ',channels:'Channel' };
  if (badge) badge.remove();
  if (count) {
    toggle.dataset.label = count + ' รายการ';
    const b = document.createElement('span');
    b.className = 'ms-badge'; b.textContent = count;
    toggle.appendChild(b);
  } else {
    toggle.dataset.label = 'ทั้งหมด';
  }
  const textNode = toggle.childNodes[0];
  if (textNode && textNode.nodeType === 3) {
    textNode.textContent = count ? count + ' รายการ ' : (labels[key]||key) + ' ';
  }
}

// ─── Master Data Table ────────────────────────────────────────

const PAGE_SIZE = 50;

function renderMasterTable() {
  const q = STATE.masterSearch.toLowerCase();
  const { col, dir } = STATE.masterSort;
  let rows = STATE.allRows.filter(r =>
    !q || Object.values(r).some(v => String(v||'').toLowerCase().includes(q))
  ).sort((a,b) => {
    const va = a[col]||'', vb = b[col]||'';
    return va < vb ? -dir : va > vb ? dir : 0;
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  STATE.masterPage = Math.min(STATE.masterPage, pages);
  const slice = rows.slice((STATE.masterPage-1)*PAGE_SIZE, STATE.masterPage*PAGE_SIZE);

  const tb = $('master-tbody');
  if (!slice.length) {
    tb.innerHTML = `<tr><td colspan="10"><div class="state-box"><div class="state-icon">🔍</div><div class="state-title">ไม่พบข้อมูล</div></div></td></tr>`;
  } else {
    tb.innerHTML = slice.map(r => `
      <tr>
        <td>${r.doc_no||'—'}</td>
        <td>${fmtDate(r.date)}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.customer||''}">${r.customer||'—'}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.product_name||''}">${r.product_name||r.product_code||'—'}</td>
        <td>${r.category||'—'}</td>
        <td class="num">${fmtInt(r.qty)}</td>
        <td class="num ${r.net_amount<0?'amount-negative':''}">${r.net_amount<0?'−':''}฿${fmt(Math.abs(r.net_amount))}</td>
        <td><span class="status-badge ${getStatusClass(r.status)}">${r.status||'—'}</span></td>
        <td>${r.channel||'—'}</td>
        <td>${r.warehouse||'—'}</td>
      </tr>`).join('');
  }

  $('master-info').textContent = `แสดง ${slice.length} จาก ${fmtInt(total)} รายการ`;
  renderPagination(pages);
}

function renderPagination(pages) {
  const p = STATE.masterPage;
  const paginationEl = $('master-pagination');
  const btns = [];
  btns.push(`<button class="page-btn" onclick="changePage(${p-1})" ${p<=1?'disabled':''}>‹</button>`);
  const range = [...new Set([1, p-1, p, p+1, pages].filter(x => x >= 1 && x <= pages))].sort((a,b)=>a-b);
  let prev = 0;
  range.forEach(n => {
    if (n - prev > 1) btns.push('<span style="padding:0 4px;color:var(--text-light)">…</span>');
    btns.push(`<button class="page-btn ${n===p?'active':''}" onclick="changePage(${n})">${n}</button>`);
    prev = n;
  });
  btns.push(`<button class="page-btn" onclick="changePage(${p+1})" ${p>=pages?'disabled':''}>›</button>`);
  paginationEl.innerHTML = btns.join('');
}

function changePage(n) { STATE.masterPage = n; renderMasterTable(); }

// ─── Upload ───────────────────────────────────────────────────

function setupUploadHandlers() {
  const area = $('upload-area');
  const inp  = $('file-input');
  if (!area || !inp) return;

  area.addEventListener('click', () => inp.click());
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files[0]) handleFile(files[0]);
  });
  inp.addEventListener('change', e => { if(e.target.files[0]) handleFile(e.target.files[0]); });
}

function handleFile(file) {
  if (!CONFIG.gasUrl) { showError('กรุณาตั้งค่า Apps Script URL ก่อนอัปโหลด'); return; }
  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    showUploadResult('error', '⚠️ รองรับเฉพาะไฟล์ .xlsx, .xls เท่านั้น');
    return;
  }
  if (file.size > 20 * 1024 * 1024) { // 20MB limit
    showUploadResult('error', '⚠️ ไฟล์ใหญ่เกิน 20MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result.split(',')[1];
    showProgress(true, 'กำลังอ่านไฟล์…');
    try {
      setProgress(30); setProgress(60, 'กำลังประมวลผล…');
      const result = await apiFetch(CONFIG.gasUrl, {
        method: 'POST',
        body: JSON.stringify({ action:'upload', fileData: base64, fileName: file.name })
      });
      setProgress(100);
      if (result.error) throw new Error(result.error);
      showUploadResult('success',
        `✅ อัปโหลดสำเร็จ!\n` +
        `รายการใหม่: ${fmtInt(result.newRows)} | รายการซ้ำ: ${fmtInt(result.duplicates)}\n` +
        `Batch ID: ${result.batchId}`
      );
      await loadData(); // refresh dashboard
    } catch(err) {
      showUploadResult('error', '❌ ' + err.message);
    }
    showProgress(false);
  };
  reader.readAsDataURL(file);
}

function showProgress(show, label='') {
  const p = $('upload-progress');
  p.style.display = show ? 'flex' : 'none';
  if (label) $('progress-label').textContent = label;
}

function setProgress(pct, label='') {
  $('progress-fill').style.width = pct + '%';
  if (label) $('progress-label').textContent = label;
}

function showUploadResult(type, msg) {
  const r = $('upload-result');
  r.className = 'upload-result ' + type;
  r.style.display = 'block';
  r.innerHTML = msg.replace(/\n/g,'<br>');
}

// ─── Channel Mapping Editor ───────────────────────────────────

function renderMappingEditor() {
  const data = getChannelMappingFromSheet();
  const list = $('mapping-list');
  list.innerHTML = '';
  data.forEach((item, i) => {
    const row = el('div', 'mapping-row');
    row.innerHTML = `
      <input class="cust-input" placeholder="ชื่อลูกค้า" value="${item.customer||''}" data-i="${i}">
      <input class="chan-input" placeholder="Channel" value="${item.channel||''}" data-i="${i}">
      <div class="del-btn" onclick="this.closest('.mapping-row').remove()">✕</div>`;
    list.appendChild(row);
  });
  renderUnmappedList();
}

function getChannelMappingFromSheet() {
  const rows = document.querySelectorAll('#mapping-list .mapping-row');
  const result = [];
  rows.forEach(r => {
    const c = r.querySelector('.cust-input').value.trim();
    const ch= r.querySelector('.chan-input').value.trim();
    if (c) result.push({ customer:c, channel:ch });
  });
  return result;
}

function renderUnmappedList() {
  const unmapped = [...new Set(STATE.allRows.filter(r => r.channel === 'Unmapped').map(r => r.customer))];
  const wrap = $('unmapped-wrap');
  if (!unmapped.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  $('unmapped-items').innerHTML = unmapped.map(c => `
    <span class="unmapped-item" onclick="addMappingRow('${c.replace(/'/g,"\\'")}')">➕ ${c}</span>`
  ).join('');
}

function addMappingRow(customer='') {
  const list = $('mapping-list');
  const row  = el('div','mapping-row');
  row.innerHTML = `
    <input class="cust-input" placeholder="ชื่อลูกค้า" value="${customer}">
    <input class="chan-input" placeholder="Channel (เช่น LINE OA, Shopee, Walk-in)">
    <div class="del-btn" onclick="this.closest('.mapping-row').remove()">✕</div>`;
  list.appendChild(row);
  row.querySelector('.chan-input').focus();
}

async function saveChannelMapping() {
  if (!CONFIG.gasUrl) { alert('กรุณาตั้งค่า Apps Script URL ก่อน'); return; }
  const btn = $('save-mapping-btn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    const mapping = getChannelMappingFromSheet();
    const result  = await apiFetch(CONFIG.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action:'updateMapping', mapping })
    });
    if (result.error) throw new Error(result.error);
    btn.textContent = '✅ บันทึกแล้ว';
    await loadData();
    setTimeout(() => { btn.textContent = 'บันทึก Mapping'; btn.disabled = false; }, 2000);
  } catch(e) {
    alert('บันทึกไม่สำเร็จ: ' + e.message);
    btn.textContent = 'บันทึก Mapping'; btn.disabled = false;
  }
}

// ─── UI State Helpers ─────────────────────────────────────────

function showLoadingState() {
  $('kpi-grid').innerHTML = '<div class="state-box"><div class="spinner"></div><div style="margin-top:10px">กำลังโหลดข้อมูล…</div></div>';
}

function showError(msg) {
  $('kpi-grid').innerHTML = `<div class="state-box"><div class="state-icon">⚠️</div><div class="state-title">เกิดข้อผิดพลาด</div><div class="state-sub">${msg}</div></div>`;
}

function showNoConfig() {
  $('kpi-grid').innerHTML = `<div class="state-box full-width"><div class="state-icon">⚙️</div><div class="state-title">ยังไม่ได้ตั้งค่า</div><div class="state-sub">กรุณาใส่ Apps Script URL ในช่องด้านบน แล้วกด "บันทึก & โหลด"</div></div>`;
}

// ─── Navigation ───────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
  if (tab === 'mapping') renderMappingEditor();
}

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // GAS URL config
  const urlInput = $('gas-url-input');
  if (urlInput) {
    urlInput.value = CONFIG.gasUrl;
    $('save-url-btn').addEventListener('click', () => {
      CONFIG.gasUrl = urlInput.value.trim();
      loadData();
    });
    urlInput.addEventListener('keydown', e => { if(e.key==='Enter') $('save-url-btn').click(); });
  }

  // Date range with flatpickr
  const fp = flatpickr('#date-range-input', {
    mode: 'range', dateFormat: 'Y-m-d', locale: 'th',
    onChange([s, e]) {
      FILTERS.dateFrom = s ? s.toISOString().slice(0,10) : '';
      FILTERS.dateTo   = e ? e.toISOString().slice(0,10) : '';
      applyFilters(); renderAll();
    }
  });
  window._fpInstance = fp;

  // Reset filters button
  $('reset-filters-btn').addEventListener('click', resetFilters);

  // Top-N select
  $('top-n-select').addEventListener('change', () => renderProductPerformance(STATE.filteredRows));

  // Master search
  $('master-search').addEventListener('input', e => {
    STATE.masterSearch = e.target.value;
    STATE.masterPage = 1;
    renderMasterTable();
  });

  // Master sort headers
  document.querySelectorAll('.sort-header').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (STATE.masterSort.col === col) STATE.masterSort.dir *= -1;
      else { STATE.masterSort.col = col; STATE.masterSort.dir = -1; }
      renderMasterTable();
    });
  });

  // Upload handlers
  setupUploadHandlers();

  // Add mapping row button
  const addMapBtn = $('add-mapping-btn');
  if (addMapBtn) addMapBtn.addEventListener('click', () => addMappingRow());

  // Save mapping button
  const saveMapBtn = $('save-mapping-btn');
  if (saveMapBtn) saveMapBtn.addEventListener('click', saveChannelMapping);

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.ms-dropdown.open').forEach(d => {
      d.classList.remove('open');
      d.parentElement.querySelector('.ms-toggle').classList.remove('open');
    });
  });

  // Comparison period pickers
  if ($('cmp-a-input')) {
    flatpickr('#cmp-a-input', {
      mode: 'range', dateFormat: 'Y-m-d', locale: 'th',
      onChange([s, e]) {
        CMP.aFrom = s ? s.toISOString().slice(0,10) : '';
        CMP.aTo   = e ? e.toISOString().slice(0,10) : '';
        if (CMP.aFrom && CMP.aTo) renderSalesComparison();
      }
    });
    flatpickr('#cmp-b-input', {
      mode: 'range', dateFormat: 'Y-m-d', locale: 'th',
      onChange([s, e]) {
        CMP.bFrom = s ? s.toISOString().slice(0,10) : '';
        CMP.bTo   = e ? e.toISOString().slice(0,10) : '';
        if (CMP.bFrom && CMP.bTo) renderSalesComparison();
      }
    });
    $('cmp-gran').addEventListener('change', e => {
      CMP.gran = e.target.value;
      renderSalesComparison();
    });
    $('cmp-reset-btn').addEventListener('click', () => {
      CMP.aFrom = CMP.aTo = CMP.bFrom = CMP.bTo = '';
      CMP.gran = 'auto';
      $('cmp-a-input')._flatpickr && $('cmp-a-input')._flatpickr.clear();
      $('cmp-b-input')._flatpickr && $('cmp-b-input')._flatpickr.clear();
      $('cmp-gran').value = 'auto';
      renderSalesComparison();
    });
  }

  // Load data — LOCAL_DATA mode works without GAS URL
  loadData();
});
