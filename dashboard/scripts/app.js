const PAGES = [
  { id: 'master', title: 'ภาพรวมผลประกอบการ', icon: '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M80-120v-80h800v80H80Zm40-120v-280h120v280H120Zm200 0v-480h120v480H320Zm200 0v-360h120v360H520Zm200 0v-600h120v600H720Z"/></svg>' },
  { id: 'daily', title: 'วิเคราะห์และเปรียบเทียบผลการดำเนินงาน', icon: '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="m320-160-56-57 103-103H80v-80h287L264-503l56-57 200 200-200 200Zm320-240L440-600l200-200 56 57-103 103h287v80H593l103 103-56 57Z"/></svg>' },
  { id: 'oilprice', title: 'ตรวจสอบราคาน้ำมันดีเซล', icon: '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M160-120v-640q0-33 23.5-56.5T240-840h240q33 0 56.5 23.5T560-760v280h40q33 0 56.5 23.5T680-400v180q0 17 11.5 28.5T720-180q17 0 28.5-11.5T760-220v-288q-9 5-19 6.5t-21 1.5q-42 0-71-29t-29-71q0-32 17.5-57.5T684-694l-84-84 42-42 148 144q15 15 22.5 35t7.5 41v380q0 42-29 71t-71 29q-42 0-71-29t-29-71v-200h-60v300H160Zm80-440h240v-200H240v200Zm480 0q17 0 28.5-11.5T760-600q0-17-11.5-28.5T720-640q-17 0-28.5 11.5T680-600q0 17 11.5 28.5T720-560ZM240-200h240v-280H240v280Zm240 0H240h240Z"/></svg>' }
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MTH = { January: 'ม.ค.', February: 'ก.พ.', March: 'มี.ค.', April: 'เม.ย.', May: 'พ.ค.', June: 'มิ.ย.', July: 'ก.ค.', August: 'ส.ค.', September: 'ก.ย.', October: 'ต.ค.', November: 'พ.ย.', December: 'ธ.ค.' };
const COLORS = ['#3b82f6', '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
let DATA = null, currentPage = 0;
const DASHBOARD_API_CONFIG = window.DASHBOARD_API_CONFIG || {};
const API_BASE_URL = String(DASHBOARD_API_CONFIG.baseUrl || '').trim();
const API_TIMEOUT_MS = 20000;
const API_TRIPS_TIMEOUT_MS = 45000;
const API_CACHE = { summary: null, trips: null, oil: null };
const LEGACY_SCRIPT_PROMISES = {};
let TRIPS_READY = false;
let TRIPS_LOADING_PROMISE = null;
const DATA_SOURCE_STATE = {
  summary: 'pending',
  trips: 'pending',
  oil: 'pending',
  notes: []
};

function isApiEnabled() {
  return API_BASE_URL.length > 0;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value, fallback = '-') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function normalizeIsoDate(value) {
  if (value == null) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const text = String(value).trim();
  if (!text) return '';

  // YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const yyyy = m[1];
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[3])).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // DD/MM/YYYY (support Buddhist year)
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let yyyy = Number(m[3]);
    if (yyyy > 2500) yyyy -= 543;
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[1])).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

async function fetchJsonWithTimeout(url, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(action, params = {}, timeoutMs = API_TIMEOUT_MS) {
  if (!isApiEnabled()) return null;
  const url = new URL(API_BASE_URL, window.location.href);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  const payload = await fetchJsonWithTimeout(url.toString(), timeoutMs);
  if (payload && payload.error) throw new Error(payload.error);
  return payload;
}

// Helpers for multi-month readiness
function getActiveMonths(data, key) {
  // Return months that have any non-zero data across all records
  const records = data[key] || data.routeTrend || [];
  return MONTHS.filter(m => records.some(r => ((r.months && r.months[m]) || (r[m])) && ((r.months?.[m]?.trips || 0) > 0 || (r.months?.[m]?.margin || 0) !== 0 || (r.months?.[m]?.loss || 0) > 0)));
}
function getActiveMonthsFromLoss(lt) {
  if (!lt || !lt.byMonth) return [];
  return MONTHS.filter(m => lt.byMonth[m] && ((lt.byMonth[m].count || 0) > 0 || (lt.byMonth[m].loss || 0) !== 0));
}
function monthRangeLabel(activeMonths) {
  if (!activeMonths || activeMonths.length === 0) return '-';
  const first = MTH[activeMonths[0]] || activeMonths[0];
  const last = MTH[activeMonths[activeMonths.length - 1]] || activeMonths[activeMonths.length - 1];
  return `${first} - ${last} ${new Date().getFullYear() + 543}`;
}
function monthCountLabel(count) {
  return `รายได้รวม ${count} เดือน`;
}

// Helpers
const fmt = n => n == null || isNaN(n) || n === Infinity || n === -Infinity ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtB = n => n == null || isNaN(n) || n === Infinity || n === -Infinity ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0 });
const fmtP = n => n == null || isNaN(n) || n === Infinity || n === -Infinity ? '-' : Number(n).toFixed(2) + '%';
const hasNum = n => Number.isFinite(Number(n));
const pc = n => n >= 0 ? 'positive' : 'negative'; // unused – kept for safety
function calcMoMDeltaPct(current, previous, useAbsPrevious = false) {
  const curr = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  const base = useAbsPrevious ? Math.abs(prev) : prev;
  if (base === 0) return null;
  return (curr - prev) / base * 100;
}
function renderMoMDelta(current, previous, increaseIsGood = true, useAbsPrevious = false) {
  const delta = calcMoMDeltaPct(current, previous, useAbsPrevious);
  if (delta == null) return '<div style="font-size:9px;color:var(--muted);margin-top:1px">—</div>';
  // Hide if delta is exactly 0.0%
  if (Math.abs(delta) < 0.05) return '<div style="font-size:9px;color:var(--muted);margin-top:1px">—</div>';
  const isIncrease = delta >= 0;
  const isGood = increaseIsGood ? isIncrease : !isIncrease;
  const arrow = isIncrease ? '▲' : '▼';
  const color = isGood ? '#22c55e' : '#ef4444';
  return `<div style="font-size:9px;color:${color};margin-top:1px">${arrow} ${Math.abs(delta).toFixed(1)}%</div>`;
}

const tag = (t, c) => `<span class="tag tag-${c}">${t}</span>`;
const esc = s => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Customer alias map — keep in sync with Dashboard/API/config.gs
const CUSTOMER_ALIAS = {
  kerry: 'KEX',
  fash: 'FLASH'
};
const mapCustomer = name => {
  if (!name) return name;
  const raw = String(name).trim();
  if (raw.toUpperCase().indexOf('FLASH') === 0) return 'FLASH';
  const alias = CUSTOMER_ALIAS[raw] || CUSTOMER_ALIAS[raw.toLowerCase()];
  if (alias) return alias;
  return raw;
};

function getMonthNameFromDate(dateStr) {
  if (!dateStr) return null;
  const dt = new Date(dateStr);
  if (isNaN(dt)) return null;
  return MONTHS[dt.getMonth()];
}
function getMonthlyStatsFromDaily(d, monthName) {
  const daily = Array.isArray(d?.daily) ? d.daily : [];
  let trips = 0, recv = 0, margin = 0, found = false;
  if (daily.length > 0) {
    daily.forEach(day => {
      if (!Array.isArray(day?.rows)) return;
      day.rows.forEach(r => {
        if (getMonthNameFromDate(r.date) !== monthName) return;
        const rcv = Number(r.recv) || 0;
        const pay = Number(r.pay) || 0;
        const oil = Number(r.oil) || 0;
        const mgRaw = Number(r.margin);
        const mg = Number.isFinite(mgRaw) ? mgRaw : (rcv - pay - oil);
        trips += 1;
        recv += rcv;
        margin += mg;
        found = true;
      });
    });
  }
  return found ? { trips, recv, margin } : null;
}

function canonicalizeTripRow(row) {
  const recv = toFiniteNumber(row?.recv);
  const pay = toFiniteNumber(row?.pay);
  const oil = toFiniteNumber(row?.oil);
  const marginRaw = Number(row?.margin);
  return {
    ...row,
    date: normalizeIsoDate(row?.date),
    customer: mapCustomer(normalizeText(row?.customer, '-')),
    route: normalizeText(row?.route, '-'),
    routeDesc: normalizeText(row?.routeDesc, '-'),
    vtype: normalizeText(row?.vtype, '-'),
    driver: normalizeText(row?.driver, '-'),
    plate: normalizeText(row?.plate, '-'),
    payee: normalizeText(row?.payee, '-'),
    recv,
    pay,
    oil,
    margin: Number.isFinite(marginRaw) ? marginRaw : (recv - pay - oil)
  };
}

function deriveCustomerProfitFromTrips(trips) {
  const groups = {};
  trips.forEach(rawTrip => {
    const trip = canonicalizeTripRow(rawTrip);
    const customer = trip.customer || '-';
    const month = getMonthNameFromDate(trip.date);
    if (!groups[customer]) {
      groups[customer] = { name: customer, margin: 0, trips: 0, recv: 0, pay: 0, oil: 0, loss: 0, months: {} };
    }
    const bucket = groups[customer];
    bucket.margin += trip.margin;
    bucket.trips += 1;
    bucket.recv += trip.recv;
    bucket.pay += trip.pay;
    bucket.oil += trip.oil;
    if (trip.margin < 0) bucket.loss += 1;
    if (month) {
      if (!bucket.months[month]) {
        bucket.months[month] = { trips: 0, margin: 0, recv: 0, pay: 0, oil: 0, loss: 0 };
      }
      bucket.months[month].trips += 1;
      bucket.months[month].margin += trip.margin;
      bucket.months[month].recv += trip.recv;
      bucket.months[month].pay += trip.pay;
      bucket.months[month].oil += trip.oil;
      if (trip.margin < 0) bucket.months[month].loss += 1;
    }
  });
  return Object.values(groups)
    .map(row => ({
      ...row,
      avgMargin: row.trips > 0 ? row.margin / row.trips : 0,
      pct: row.recv > 0 ? row.margin / row.recv * 100 : 0
    }))
    .sort((a, b) => b.margin - a.margin);
}

function deriveRevenueConcentrationFromCustomers(customerRows) {
  const rows = Array.isArray(customerRows) ? customerRows : [];
  const totalRecv = rows.reduce((sum, row) => sum + toFiniteNumber(row.recv), 0);
  const customers = rows
    .map(row => ({
      name: row.name || '-',
      recv: toFiniteNumber(row.recv),
      pct: totalRecv > 0 ? toFiniteNumber(row.recv) / totalRecv * 100 : 0
    }))
    .sort((a, b) => b.recv - a.recv);
  return {
    totalRecv,
    customers,
    top3Share: customers.slice(0, 3).reduce((sum, row) => sum + toFiniteNumber(row.pct), 0)
  };
}

function isCompanyTrip(row) {
  const payee = normalizeText(row?.payee, '-');
  const driver = normalizeText(row?.driver, '-');
  return payee === '-' || payee === driver || payee.includes('บริษัท');
}

function deriveOwnVsOutsourceFromTrips(trips) {
  const createSide = () => ({ margin: 0, trips: 0, recv: 0, pay: 0, oil: 0, pct: 0, topRoutes: [] });
  const company = createSide();
  const outsource = createSide();
  const companyRoutes = {};
  const outsourceRoutes = {};

  trips.forEach(rawTrip => {
    const trip = canonicalizeTripRow(rawTrip);
    const target = isCompanyTrip(trip) ? company : outsource;
    const routeMap = target === company ? companyRoutes : outsourceRoutes;
    target.margin += trip.margin;
    target.trips += 1;
    target.recv += trip.recv;
    target.pay += trip.pay;
    target.oil += trip.oil;
    if (!routeMap[trip.route]) {
      routeMap[trip.route] = { route: trip.route, trips: 0, margin: 0, recv: 0 };
    }
    routeMap[trip.route].trips += 1;
    routeMap[trip.route].margin += trip.margin;
    routeMap[trip.route].recv += trip.recv;
  });

  [company, outsource].forEach((side, index) => {
    side.pct = side.recv > 0 ? side.margin / side.recv * 100 : 0;
    const routes = Object.values(index === 0 ? companyRoutes : outsourceRoutes)
      .map(route => ({
        ...route,
        pct: route.recv > 0 ? route.margin / route.recv * 100 : 0
      }))
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 10);
    side.topRoutes = routes;
  });

  return { company, outsource };
}

function deriveLossTripFromTrips(trips) {
  const lossTrips = trips
    .map(canonicalizeTripRow)
    .filter(trip => trip.margin < 0);
  const byMonth = {};
  const byRoute = {};
  const byCustomer = {};
  let totalLoss = 0;

  lossTrips.forEach(trip => {
    totalLoss += trip.margin;
    const month = getMonthNameFromDate(trip.date);
    if (month) {
      if (!byMonth[month]) byMonth[month] = { count: 0, loss: 0 };
      byMonth[month].count += 1;
      byMonth[month].loss += trip.margin;
    }
    if (!byRoute[trip.route]) byRoute[trip.route] = { name: trip.route, count: 0, loss: 0 };
    byRoute[trip.route].count += 1;
    byRoute[trip.route].loss += trip.margin;

    if (!byCustomer[trip.customer]) byCustomer[trip.customer] = { name: trip.customer, count: 0, loss: 0 };
    byCustomer[trip.customer].count += 1;
    byCustomer[trip.customer].loss += trip.margin;
  });

  const routeRows = Object.values(byRoute).sort((a, b) => a.loss - b.loss);
  const customerRows = Object.values(byCustomer).sort((a, b) => a.loss - b.loss);
  return {
    total: lossTrips.length,
    totalTrips: trips.length,
    lossPct: trips.length > 0 ? lossTrips.length / trips.length * 100 : 0,
    totalLoss,
    byMonth,
    byRoute: routeRows,
    byCustomer: customerRows,
    worstRoutes: routeRows.slice(0, 10)
  };
}

function mergeMonthStats(target, source) {
  Object.entries(source || {}).forEach(([month, stats]) => {
    if (!target[month]) {
      target[month] = { trips: 0, margin: 0, recv: 0, pay: 0, oil: 0, loss: 0 };
    }
    target[month].trips += toFiniteNumber(stats?.trips);
    target[month].margin += toFiniteNumber(stats?.margin);
    target[month].recv += toFiniteNumber(stats?.recv);
    target[month].pay += toFiniteNumber(stats?.pay);
    target[month].oil += toFiniteNumber(stats?.oil);
    target[month].loss += toFiniteNumber(stats?.loss);
  });
}

function regroupCustomerProfit(rows) {
  const groups = {};
  (rows || []).forEach(row => {
    const name = mapCustomer(row?.name || '-');
    if (!groups[name]) {
      groups[name] = { name, margin: 0, trips: 0, recv: 0, pay: 0, oil: 0, loss: 0, months: {} };
    }
    const target = groups[name];
    target.margin += toFiniteNumber(row?.margin);
    target.trips += toFiniteNumber(row?.trips);
    target.recv += toFiniteNumber(row?.recv);
    target.pay += toFiniteNumber(row?.pay);
    target.oil += toFiniteNumber(row?.oil);
    target.loss += toFiniteNumber(row?.loss);
    mergeMonthStats(target.months, row?.months || {});
  });
  return Object.values(groups)
    .map(row => ({
      ...row,
      avgMargin: row.trips > 0 ? row.margin / row.trips : 0,
      pct: row.recv > 0 ? row.margin / row.recv * 100 : 0
    }))
    .sort((a, b) => b.margin - a.margin);
}

function regroupRevenueConcentration(concentration) {
  const totals = {};
  (concentration?.customers || []).forEach(row => {
    const name = mapCustomer(row?.name || '-');
    totals[name] = (totals[name] || 0) + toFiniteNumber(row?.recv);
  });
  const totalRecv = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const customers = Object.entries(totals)
    .map(([name, recv]) => ({
      name,
      recv,
      pct: totalRecv > 0 ? recv / totalRecv * 100 : 0
    }))
    .sort((a, b) => b.recv - a.recv);
  return {
    totalRecv,
    customers,
    top3Share: customers.slice(0, 3).reduce((sum, row) => sum + toFiniteNumber(row.pct), 0)
  };
}

function regroupLossByCustomer(lossTrip) {
  const rows = Array.isArray(lossTrip?.byCustomer)
    ? lossTrip.byCustomer
    : Object.entries(lossTrip?.byCustomer || {}).map(([name, info]) => ({
        name,
        count: info?.count,
        loss: info?.loss
      }));
  const groups = {};
  rows.forEach(row => {
    const name = mapCustomer(row?.name || '-');
    if (!groups[name]) groups[name] = { name, count: 0, loss: 0 };
    groups[name].count += toFiniteNumber(row?.count);
    groups[name].loss += toFiniteNumber(row?.loss);
  });
  return Object.values(groups).sort((a, b) => a.loss - b.loss);
}

function normalizeSummaryData(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data.routeTrend)) {
    data.routeTrend.forEach(row => { row.customer = mapCustomer(row.customer); });
  }
  if (Array.isArray(data.routeRanking?.top)) {
    data.routeRanking.top.forEach(row => { row.customer = mapCustomer(row.customer); });
  }
  if (Array.isArray(data.routeRanking?.bottom)) {
    data.routeRanking.bottom.forEach(row => { row.customer = mapCustomer(row.customer); });
  }
  if (Array.isArray(data.customerProfit)) {
    data.customerProfit = regroupCustomerProfit(data.customerProfit);
  }
  if (data.revenueConcentration) {
    data.revenueConcentration = regroupRevenueConcentration(data.revenueConcentration);
  }
  if (data.lossTrip) {
    data.lossTrip.byCustomer = regroupLossByCustomer(data.lossTrip);
  }
  if (Array.isArray(data.daily)) {
    data.daily.forEach(day => {
      if (Array.isArray(day?.rows)) {
        day.rows = day.rows.map(row => ({
          ...row,
          customer: mapCustomer(row?.customer)
        }));
      }
    });
  }
  return data;
}

function alignDashboardData(summaryData, tripRows, opts = {}) {
  const data = deepClone(summaryData) || {};
  const trips = Array.isArray(tripRows) ? tripRows.map(canonicalizeTripRow) : [];
  normalizeSummaryData(data);

  if (opts.rebuildDerived === true && trips.length > 0) {
    data.customerProfit = deriveCustomerProfitFromTrips(trips);
    data.revenueConcentration = deriveRevenueConcentrationFromCustomers(data.customerProfit);
    data.ownVsOutsource = deriveOwnVsOutsourceFromTrips(trips);
    data.lossTrip = deriveLossTripFromTrips(trips);
  }

  return { data, trips };
}

function noteDataSource(key, mode, message = '') {
  if (key) DATA_SOURCE_STATE[key] = mode;
  if (message && !DATA_SOURCE_STATE.notes.includes(message)) {
    DATA_SOURCE_STATE.notes.push(message);
  }
}

function loadScriptOnce(src, globalName) {
  if (globalName && typeof window[globalName] !== 'undefined') {
    return Promise.resolve(window[globalName]);
  }
  if (LEGACY_SCRIPT_PROMISES[src]) return LEGACY_SCRIPT_PROMISES[src];
  LEGACY_SCRIPT_PROMISES[src] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (!globalName || typeof window[globalName] !== 'undefined') {
        resolve(globalName ? window[globalName] : true);
      } else {
        reject(new Error(`global ${globalName} not found after loading ${src}`));
      }
    };
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
  return LEGACY_SCRIPT_PROMISES[src];
}

async function loadLegacySummaryData() {
  await loadScriptOnce('data/data.js', 'DATA_JSON');
  if (typeof DATA_JSON === 'undefined') throw new Error('DATA_JSON unavailable');
  return deepClone(DATA_JSON);
}

async function loadLegacyTripsData() {
  await loadScriptOnce('data/fraud_data.js', 'FRAUD_DATA');
  if (typeof FRAUD_DATA === 'undefined' || !Array.isArray(FRAUD_DATA)) throw new Error('FRAUD_DATA unavailable');
  return deepClone(FRAUD_DATA);
}

async function loadLegacyOilData() {
  await loadScriptOnce('data/oil-price-data.js', 'OIL_PRICE_DATA');
  if (typeof OIL_PRICE_DATA === 'undefined') throw new Error('OIL_PRICE_DATA unavailable');
  return deepClone(OIL_PRICE_DATA);
}

// Sortable+Searchable table engine
let tableStates = {};
function mkTable(id, cols, data, opts = {}) {
  let s = tableStates[id];
  if (!s || !opts._restore) {
    s = tableStates[id] = { col: opts.defaultSort || 0, asc: opts.defaultAsc !== false, filter: '', page: 0, perPage: 50, _cols: cols, _data: data };
  } else {
    s._cols = cols; s._data = data;
  }
  function render() {
    const wasFocused = document.activeElement?.id === id + '_q';
    const caretPos = wasFocused ? document.activeElement.selectionStart : 0;
    const q = s.filter.toLowerCase();
    let fd = s._data.filter(r => !q || cols.some((_, i) => String(r[i] || '').toLowerCase().includes(q)));
    fd.sort((a, b) => {
      const av = a[s.col], bv = b[s.col];
      const n = typeof av === 'number' && typeof bv === 'number';
      const r = n ? (av - bv) : String(av || '').localeCompare(String(bv || ''));
      return s.asc ? r : -r;
    });
    const total = fd.length, pages = Math.ceil(total / s.perPage), start = s.page * s.perPage;
    const pd = fd.slice(start, start + s.perPage);
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <input id="${id}_q" type="text" placeholder="ค้นหา..." value="${esc(s.filter)}"
          style="flex:1;min-width:180px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px">
        <span style="font-size:12px;color:var(--muted)">${fmt(total)} รายการ | หน้า ${s.page + 1}/${pages || 1}</span>
        <div style="display:flex;gap:4px">
          <button onclick="tblPage('${id}',-1)" style="${btnSt}">‹</button>
          <button onclick="tblPage('${id}',1)" style="${btnSt}">›</button>
        </div>
        <select id="${id}_pp" style="padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
          ${[25, 50, 100, 250, 500].map(v => `<option value="${v}"${v === s.perPage ? ' selected' : ''}>${v} แถว</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table><thead><tr>${cols.map((c, i) => `<th onclick="tblSort('${id}',${i})" style="cursor:pointer;user-select:none">${esc(c)}${s.col === i ? (s.asc ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${pd.map((r, ri) => `<tr>${r.map((v, ci) => {
      if (typeof v === 'number') { return `<td class="${v < 0 ? 'negative' : v > 0 ? 'positive' : ''}">${fmt(v)}</td>` }
      if (typeof v === 'string' && v.startsWith('<')) { return `<td>${v}</td>` }
      return `<td>${esc(v)}</td>`
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
    const inp = document.getElementById(id + '_q');
    if (inp) {
      inp.addEventListener('input', e => { s.filter = e.target.value; s.page = 0; render(); });
      if (wasFocused) { inp.focus(); try { inp.setSelectionRange(caretPos, caretPos); } catch (e) { } }
    }
    const pp = document.getElementById(id + '_pp');
    if (pp) pp.addEventListener('change', e => { s.perPage = +e.target.value; s.page = 0; render(); });
  }
  render();
}
const btnSt = 'padding:4px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;font-size:13px';
function tblSort(id, col) {
  const s = tableStates[id]; if (!s) return;
  if (s.col === col) s.asc = !s.asc; else { s.col = col; s.asc = false; }
  s.page = 0; mkTable(id, s._cols, s._data, { _restore: true });
}
function tblPage(id, d) {
  const s = tableStates[id]; if (!s) return;
  const q = s.filter.toLowerCase();
  const fd = s._data.filter(r => !q || s._cols.some((_, i) => String(r[i] || '').toLowerCase().includes(q)));
  const pages = Math.ceil(fd.length / s.perPage);
  s.page = Math.max(0, Math.min(s.page + d, pages - 1));
  mkTable(id, s._cols, s._data, { _restore: true });
}

// Audit table engine for master dashboard detail views
let auditTableStates = {};
function auditGetValue(row, col) {
  return typeof col.value === 'function' ? col.value(row) : row[col.key];
}
function auditGetSortValue(row, col) {
  if (typeof col.sortValue === 'function') return col.sortValue(row);
  const val = auditGetValue(row, col);
  return val == null ? '' : val;
}
function auditGetFilterValue(row, filterDef) {
  return typeof filterDef.value === 'function' ? filterDef.value(row) : row[filterDef.key];
}
function auditEscapeCsv(val) {
  const raw = val == null ? '' : String(val);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}
function auditFormatCell(row, col) {
  const raw = auditGetValue(row, col);
  if (typeof col.render === 'function') return col.render(raw, row);
  if (raw == null || raw === '') return '-';
  if (col.type === 'percent') return fmtP(raw);
  if (col.type === 'number' || col.type === 'currency') return fmt(raw);
  if (col.type === 'integer') return fmtB(raw);
  if (col.html) return String(raw);
  return esc(raw);
}
function auditCellClass(row, col) {
  const classes = [];
  if (col.align === 'right') classes.push('is-right');
  if (col.strong) classes.push('is-strong');
  if (col.tone === 'sign') {
    const raw = Number(auditGetValue(row, col));
    if (Number.isFinite(raw)) {
      if (raw > 0) classes.push('is-positive');
      if (raw < 0) classes.push('is-negative');
    }
  }
  return classes.join(' ');
}
function auditFilterRows(state) {
  const cols = state.cols;
  const filters = state.filters;
  let rows = state.rows.slice();
  filters.forEach(filterDef => {
    const selected = state.filterValues[filterDef.key];
    if (!selected) return;
    rows = rows.filter(row => String(auditGetFilterValue(row, filterDef) ?? '') === selected);
  });
  const activeCol = cols.find(col => col.key === state.sortKey) || cols[0];
  rows.sort((a, b) => {
    const av = auditGetSortValue(a, activeCol);
    const bv = auditGetSortValue(b, activeCol);
    const aNum = Number(av);
    const bNum = Number(bv);
    const isNumeric = Number.isFinite(aNum) && Number.isFinite(bNum) && String(av).trim() !== '' && String(bv).trim() !== '';
    const result = isNumeric ? (aNum - bNum) : String(av || '').localeCompare(String(bv || ''), 'th');
    return state.sortAsc ? result : -result;
  });
  return rows;
}
function renderAuditTable(id, config, opts = {}) {
  const shell = document.getElementById(id);
  if (!shell) return;
  const firstThreeFilters = (config.cols || []).slice(0, 3).filter(col => !col.noFilter).map(col => ({
    key: col.key,
    label: col.label,
    value: row => {
      const v = typeof col.searchValue === 'function' ? col.searchValue(row) : auditGetValue(row, col);
      return String(v == null ? '' : v).trim();
    }
  }));
  let state = auditTableStates[id];
  if (!state || !opts.restore) {
    state = auditTableStates[id] = {
      cols: config.cols,
      rows: config.rows,
      filters: firstThreeFilters,
      sortKey: config.defaultSort || config.cols[0]?.key,
      sortAsc: config.defaultAsc !== false,
      page: 0,
      perPage: config.perPage || 12,
      filterValues: Object.fromEntries(firstThreeFilters.map(filterDef => [filterDef.key, ''])),
      csvName: config.csvName || id,
      onRowClick: typeof config.onRowClick === 'function' ? config.onRowClick : null
    };
  } else {
    state.cols = config.cols;
    state.rows = config.rows;
    state.filters = firstThreeFilters;
    state.csvName = config.csvName || id;
    state.onRowClick = typeof config.onRowClick === 'function' ? config.onRowClick : null;
    const keys = new Set(firstThreeFilters.map(filterDef => filterDef.key));
    Object.keys(state.filterValues).forEach(k => { if (!keys.has(k)) delete state.filterValues[k]; });
    firstThreeFilters.forEach(filterDef => {
      if (!(filterDef.key in state.filterValues)) state.filterValues[filterDef.key] = '';
    });
  }
  const filteredRows = auditFilterRows(state);
  const activeFilterCount = state.filters.reduce((count, filterDef) => count + (state.filterValues[filterDef.key] ? 1 : 0), 0);
  const total = filteredRows.length;
  const pages = Math.max(1, Math.ceil(total / state.perPage));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * state.perPage;
  const pageRows = filteredRows.slice(start, start + state.perPage);
  const filterHtml = state.filters.map(filterDef => {
    const options = (filterDef.options || Array.from(new Set(state.rows.map(row => auditGetFilterValue(row, filterDef)).filter(v => v != null && v !== ''))).sort((a, b) => String(a).localeCompare(String(b), 'th')))
      .map(opt => typeof opt === 'object' ? opt : { value: opt, label: opt });
    return `
      <label class="audit-table-filter">
        <span>${esc(filterDef.label)}</span>
        <select data-audit-filter="${esc(filterDef.key)}" class="audit-table-select">
          <option value="">ทั้งหมด</option>
          ${options.map(opt => `<option value="${esc(opt.value)}"${String(state.filterValues[filterDef.key] || '') === String(opt.value) ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
        </select>
      </label>
    `;
  }).join('');
  shell.innerHTML = `
    <div class="audit-table-toolbar">
      <div class="audit-table-toolbar-main">
        <div class="audit-table-status">
          <span class="audit-table-meta">${fmtB(total)} รายการ • หน้า ${state.page + 1}/${pages}${activeFilterCount ? ` • ใช้ตัวกรอง ${activeFilterCount}` : ''}</span>
        </div>
      </div>
      <div class="audit-table-toolbar-side">
        <div class="audit-table-actions">
          <button type="button" class="audit-table-button" onclick="auditExportXls('${id}')">Export XLSX</button>
          <button type="button" class="audit-table-button" onclick="auditMovePage('${id}',-1)">‹</button>
          <button type="button" class="audit-table-button" onclick="auditMovePage('${id}',1)">›</button>
          <select id="${id}_perpage" class="audit-table-select audit-table-select-sm">
            ${[10, 12, 25, 50].map(size => `<option value="${size}"${size === state.perPage ? ' selected' : ''}>${size} แถว</option>`).join('')}
          </select>
        </div>
      </div>
      ${filterHtml ? `<div class="audit-table-filter-row audit-table-filter-row-full">${filterHtml}</div>` : ''}
    </div>
    <div class="audit-table-wrap${config.compact ? ' compact' : ''}">
      <table class="audit-table${config.compact ? ' audit-table-compact' : ''}">
        <thead>
          <tr>
            ${state.cols.map(col => `<th class="${col.align === 'right' ? 'is-right' : ''}" onclick="auditSort('${id}','${esc(col.key)}')">${esc(col.label)}${state.sortKey === col.key ? (state.sortAsc ? ' ▲' : ' ▼') : ''}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${pageRows.length ? pageRows.map((row, rowIdx) => `<tr class="${state.onRowClick ? 'audit-row-action' : ''}" data-row-idx="${rowIdx}">${state.cols.map(col => `<td class="${auditCellClass(row, col)}">${auditFormatCell(row, col)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${state.cols.length}" class="audit-table-empty">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  shell.querySelectorAll('[data-audit-filter]').forEach(select => {
    select.addEventListener('change', e => {
      state.filterValues[e.target.dataset.auditFilter] = e.target.value;
      state.page = 0;
      renderAuditTable(id, config, { restore: true });
    });
  });
  const perPageSelect = document.getElementById(`${id}_perpage`);
  if (perPageSelect) {
    perPageSelect.addEventListener('change', e => {
      state.perPage = Number(e.target.value) || state.perPage;
      state.page = 0;
      renderAuditTable(id, config, { restore: true });
    });
  }
  if (state.onRowClick && pageRows.length) {
    shell.querySelectorAll('tbody tr[data-row-idx]').forEach(rowEl => {
      rowEl.addEventListener('click', () => {
        const idx = Number(rowEl.getAttribute('data-row-idx'));
        const row = pageRows[idx];
        if (!row) return;
        state.onRowClick(row);
      });
    });
  }
}
function auditSort(id, key) {
  const state = auditTableStates[id];
  if (!state) return;
  if (state.sortKey === key) state.sortAsc = !state.sortAsc;
  else {
    state.sortKey = key;
    state.sortAsc = false;
  }
  state.page = 0;
  renderAuditTable(id, state, { restore: true });
}
function auditMovePage(id, delta) {
  const state = auditTableStates[id];
  if (!state) return;
  const total = auditFilterRows(state).length;
  const pages = Math.max(1, Math.ceil(total / state.perPage));
  state.page = Math.max(0, Math.min(state.page + delta, pages - 1));
  renderAuditTable(id, state, { restore: true });
}
function auditExportXls(id) {
  const state = auditTableStates[id];
  if (!state) return;
  const rows = auditFilterRows(state);
  const aoa = [
    state.cols.map(col => col.label),
    ...rows.map(row => state.cols.map(col => {
      const exportValue = typeof col.exportValue === 'function' ? col.exportValue(row) : auditGetValue(row, col);
      return exportValue == null ? '' : exportValue;
    }))
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = state.cols.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${state.csvName}.xlsx`, { bookType: 'xlsx', cellStyles: true });
}
function buildAuditTableSection(id, title, icon, color, note = '') {
  return `
    <div class="modal-section-card">
      <div class="modal-section-header audit-table-section-header" style="justify-content:flex-start;gap:12px;">
        <div class="modal-section-icon" style="background:${color}15;border:1px solid ${color}30;color:${color}">${icon}</div>
        <div class="audit-table-section-copy">
          <div class="modal-section-title" style="position:static;left:auto;transform:none;">${title}</div>
          ${note ? `<div class="audit-table-section-note">${note}</div>` : ''}
        </div>
      </div>
      <div class="modal-section-body">
        <div id="${id}" class="audit-table-shell"></div>
      </div>
    </div>
  `;
}

// Loss drill-down (on-demand + cache)
const LOSS_DRILL_CACHE = new Map();

function lossDrillNorm(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function makeLossDrillKey(kind, row) {
  if (kind === 'monthly') return `monthly:${row?.monthKey || row?.month || ''}`;
  if (kind === 'customer') return `customer:${mapCustomer(row?.name || '-')}`;
  if (kind === 'route') return `route:${lossDrillNorm(row?.name || '-')}`;
  return `${kind}:${lossDrillNorm(JSON.stringify(row || {}))}`;
}

function collectLossCauses(trip) {
  const causes = [];
  const recv = Number(trip.recv) || 0;
  const pay = Number(trip.pay) || 0;
  const oil = Number(trip.oil) || 0;
  const margin = Number(trip.margin) || 0;
  if (recv > 0 && Math.abs(margin / recv * 100) >= 10) causes.push('ขาดทุนเกิน 10%');
  if (pay > recv) causes.push('ราคาจ่ายสูงกว่าราคารับ');
  if (pay > 0 && oil > pay * 0.5) causes.push('สำรองน้ำมัน > 50%');
  return causes;
}

function getLossCauseColor(cause) {
  const t = String(cause || '');
  if (t.startsWith('ขาดทุน ')) return 'red';
  if (t.includes('ราคาจ่าย')) return 'purple';
  if (t.includes('สำรองน้ำมัน')) return 'orange';
  return 'blue';
}

function renderLossCauseTags(causes) {
  const items = Array.isArray(causes) ? causes.filter(Boolean) : [];
  if (!items.length) return '<span class="loss-cause-empty">-</span>';
  return `<div class="loss-cause-tags">${items.map(c => `<span class="loss-cause-tag ${getLossCauseColor(c)}">${esc(c)}</span>`).join('')}</div>`;
}

function buildLossDrillPayload(kind, row, trips) {
  const lossTrips = (Array.isArray(trips) ? trips : [])
    .map(canonicalizeTripRow)
    .filter(t => Number(t.margin) < 0);

  let matched = [];
  let title = 'รายละเอียดขาดทุนเชิงลึก';
  let subtitle = '';

  if (kind === 'monthly') {
    const monthKey = row?.monthKey || '';
    matched = lossTrips.filter(t => getMonthNameFromDate(t.date) === monthKey);
    title = `รายละเอียดขาดทุนรายเดือน: ${row?.month || '-'}`;
    subtitle = `เที่ยวขาดทุนทั้งหมดในเดือน ${row?.month || '-'}`;
  } else if (kind === 'customer') {
    const customer = mapCustomer(row?.name || '-');
    matched = lossTrips.filter(t => mapCustomer(t.customer || '-') === customer);
    title = `ขาดทุนแยกตามลูกค้า: ${customer}`;
    subtitle = 'รายการเที่ยวที่มีส่วนต่างขาดทุนของลูกค้ารายนี้';
  } else if (kind === 'route') {
    const routeKey = lossDrillNorm(row?.name || '-');
    matched = lossTrips.filter(t => lossDrillNorm(t.route || '-') === routeKey);
    title = `ขาดทุนแยกตามเส้นทาง: ${row?.name || '-'}`;
    subtitle = 'รายการเที่ยวที่มีส่วนต่างขาดทุนของเส้นทางนี้';
  }

  matched.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || ((Number(a.margin) || 0) - (Number(b.margin) || 0)));

  const rows = matched.map((t, idx) => {
    const recv = Number(t.recv) || 0;
    const margin = Number(t.margin) || 0;
    const marginPct = recv > 0 ? (margin / recv) * 100 : null;
    const causesRaw = collectLossCauses(t);
    const lossPct = marginPct == null ? null : Math.abs(marginPct);
    const causesDisplay = causesRaw.map(c => {
      if (c === 'ขาดทุนเกิน 10%' && lossPct != null) return `ขาดทุน ${fmtP(lossPct)}`;
      return c;
    });
    return {
      idx: idx + 1,
      date: t.date || '-',
      customer: t.customer || '-',
      route: t.route || '-',
      vtype: t.vtype || '-',
      driver: t.driver || '-',
      plate: t.plate || '-',
      recv: recv,
      pay: Number(t.pay) || 0,
      oil: Number(t.oil) || 0,
      margin: margin,
      marginPct,
      causesRaw,
      causesDisplay,
      causes: causesDisplay.join(', ')
    };
  });

  const totalLoss = rows.reduce((sum, r) => sum + (Number(r.margin) || 0), 0);
  const topCauseMap = {};
  rows.forEach(r => {
    (Array.isArray(r.causesRaw) ? r.causesRaw : []).forEach(c => {
      topCauseMap[c] = (topCauseMap[c] || 0) + 1;
    });
  });
  const topCauses = Object.entries(topCauseMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return {
    title,
    subtitle,
    rows,
    summary: {
      trips: rows.length,
      totalLoss,
      avgLoss: rows.length > 0 ? Math.abs(totalLoss) / rows.length : 0,
      topCauses
    }
  };
}

async function getLossDrillPayload(kind, row) {
  const cacheKey = makeLossDrillKey(kind, row);
  if (LOSS_DRILL_CACHE.has(cacheKey)) return deepClone(LOSS_DRILL_CACHE.get(cacheKey));
  const trips = await ensureTripsReady();
  const payload = buildLossDrillPayload(kind, row, trips);
  LOSS_DRILL_CACHE.set(cacheKey, payload);
  return deepClone(payload);
}

window.closeLossDrillModal = function() {
  const modal = document.getElementById('lossDrillModal');
  if (modal) modal.style.display = 'none';
};

window.openLossDrillModal = async function(kind, row) {
  let modal = document.getElementById('lossDrillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lossDrillModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:1001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.74);backdrop-filter:blur(6px);';
    modal.onclick = function(e) { if (e.target === modal) window.closeLossDrillModal(); };
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="loss-drill-card">
      <div class="loss-drill-head">
        <div class="loss-drill-title-wrap">
          <div class="loss-drill-title">กำลังโหลดรายละเอียดเชิงลึก...</div>
          <div class="loss-drill-sub">ระบบกำลังดึงข้อมูลเฉพาะรายการที่เลือก</div>
        </div>
        <button class="loss-drill-close" type="button" onclick="window.closeLossDrillModal()">&times;</button>
      </div>
      <div class="loss-drill-body">
        <div class="loss-drill-loading">กำลังประมวลผลข้อมูลขาดทุนรายเที่ยว...</div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  try {
    const payload = await getLossDrillPayload(kind, row);
    const rowsHtml = payload.rows.length
      ? payload.rows.map(r => `<tr>
          <td>${fmtB(r.idx)}</td>
          <td>${esc(r.date)}</td>
          <td>${esc(r.customer)}</td>
          <td title="${esc(r.route)}">${esc(r.route)}</td>
          <td>${esc(r.vtype)}</td>
          <td>${esc(r.driver)}</td>
          <td>${esc(r.plate)}</td>
          <td class="is-right">${fmt(r.recv)}</td>
          <td class="is-right">${fmt(r.pay)}</td>
          <td class="is-right">${fmt(r.oil)}</td>
          <td class="is-right is-negative">${fmt(r.margin)}</td>
          <td class="is-right is-negative">${r.marginPct == null ? '-' : fmtP(r.marginPct)}</td>
          <td>${renderLossCauseTags(r.causesDisplay)}</td>
        </tr>`).join('')
      : `<tr><td colspan="13" class="audit-table-empty">ไม่พบเที่ยวขาดทุนในเงื่อนไขที่เลือก</td></tr>`;

    const topCauseHtml = payload.summary.topCauses.length
      ? payload.summary.topCauses
        .map(([name, count]) => `<span class="loss-drill-cause-item">&bull; ${esc(name)} (${fmtB(count)} เที่ยว)</span>`)
        .join('')
      : '<span class="loss-drill-cause-item">-</span>';

    modal.innerHTML = `
      <div class="loss-drill-card">
        <div class="loss-drill-head">
          <div class="loss-drill-title-wrap">
            <div class="loss-drill-title">${esc(payload.title)}</div>
            <div class="loss-drill-sub">${esc(payload.subtitle)}</div>
          </div>
          <button class="loss-drill-close" type="button" onclick="window.closeLossDrillModal()">&times;</button>
        </div>
        <div class="loss-drill-kpis">
          <div class="loss-drill-kpi metric metric-trips"><span>เที่ยวขาดทุน</span><b>${fmtB(payload.summary.trips)}</b></div>
          <div class="loss-drill-kpi metric metric-loss"><span>มูลค่าขาดทุนรวม</span><b class="neg">${fmt(payload.summary.totalLoss)} <em class="loss-drill-unit">THB</em></b></div>
          <div class="loss-drill-kpi causes"><span>สาเหตุหลัก</span><div class="loss-drill-cause-list">${topCauseHtml}</div></div>
        </div>
        <div class="loss-drill-body">
          <div class="audit-table-wrap">
            <table class="audit-table loss-drill-table">
              <thead>
                <tr>
                  <th>#</th><th>วันที่</th><th>ลูกค้า</th><th>เส้นทาง</th><th>ประเภทรถ</th><th>พขร.</th><th>ทะเบียน</th>
                  <th class="is-right">ราคารับ</th><th class="is-right">ราคาจ่าย</th><th class="is-right">สำรองน้ำมัน</th>
                  <th class="is-right">ส่วนต่าง</th><th class="is-right">กำไร %</th><th>สาเหตุที่พบ</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    modal.innerHTML = `
      <div class="loss-drill-card">
        <div class="loss-drill-head">
          <div class="loss-drill-title-wrap">
            <div class="loss-drill-title">โหลดรายละเอียดไม่สำเร็จ</div>
            <div class="loss-drill-sub">${esc(err.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ')}</div>
          </div>
          <button class="loss-drill-close" type="button" onclick="window.closeLossDrillModal()">&times;</button>
        </div>
      </div>
    `;
  }
};


// KPI card
const kpi = (label, val, cls = '', sub = '') => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${val}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

// Professional bar chart — 3-col layout: label | bar | value (value always visible outside bar)
function barChart(items, getLabel, getW, getVal, getColor, getSub, hideW, whiteVal) {
  return `<div style="padding:8px 0">${items.map((it, i) => {
    const w = Math.max(1, getW(it, i)).toFixed(1);
    const color = getColor ? getColor(it, i) : COLORS[i % 10];
    const label = String(getLabel(it, i));
    const val = getVal(it, i);
    const sub = getSub ? getSub(it, i) : '';
    const valColor = whiteVal ? '#ffffff' : color;
    return `<div style="display:grid;grid-template-columns:150px 1fr 150px;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.03)">
      <div style="text-align:right;line-height:1.4">
        <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(label)}">${esc(label.length > 22 ? label.substring(0, 21) + '\u2026' : label)}</div>
        ${sub ? `<div style="font-size:10px;color:var(--muted)">${sub}</div>` : ''}
      </div>
      <div style="background:rgba(255,255,255,0.05);border-radius:6px;height:26px;overflow:hidden">
        <div style="width:${w}%;height:100%;background:linear-gradient(90deg,${color}66,${color});border-radius:6px;box-shadow:0 2px 10px ${color}2a"></div>
      </div>
      <div style="font-size:12px;font-weight:700;color:${valColor};white-space:nowrap;padding-left:4px">${val}</div>
    </div>`;
  }).join('')}</div>`;
}

// Page builders
function buildTrend(d) {
  const s = d.summary;
  // Mini KPIs inside section
  let h = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">จำนวนเที่ยวทั้งหมด</div><div class="master-mini-kpi-value" style="color:#3b82f6">${fmt(s.totalTrips)}</div><div class="master-mini-kpi-sub">เที่ยว</div></div>
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">ราคารับรวม</div><div class="master-mini-kpi-value" style="color:#22c55e">${fmt(s.totalRevenue)}</div><div class="master-mini-kpi-sub">THB</div></div>
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">ส่วนต่างรวม</div><div class="master-mini-kpi-value" style="color:${s.totalMargin >= 0 ? '#22c55e' : '#ef4444'}">${fmt(s.totalMargin)}</div><div class="master-mini-kpi-sub">THB</div></div>
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">กำไร % เฉลี่ย</div><div class="master-mini-kpi-value" style="color:#8b5cf6">${fmtP(s.avgMarginPct)}</div><div class="master-mini-kpi-sub">เฉลี่ยทุกเที่ยว</div></div>
  </div>`;
  const rows = d.routeTrend.map(r => {
    const tot = MONTHS.reduce((a, m) => a + (r.months[m]?.trips || 0), 0);
    return [r.customer, r.vtype || '-', r.route, tot,
    ...MONTHS.flatMap(m => [r.months[m]?.trips || 0, r.months[m]?.margin || 0])
    ];
  });
  const cols = ['ลูกค้า', 'ประเภทรถ', 'เส้นทาง (Route)', 'จำนวนเที่ยวรวม', ...MONTHS.flatMap(m => [MTH[m] + ' (เที่ยว)', MTH[m] + ' (ส่วนต่าง)'])];
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>สรุปผลการดำเนินงานรายเส้นทางและแนวโน้มส่วนต่างกำไรประจำเดือน</h3></div><div class="table-wrap" id="t_trend"></div></div>`;
  setTimeout(() => mkTable('t_trend', cols, rows, { defaultSort: 3, defaultAsc: false }), 0);
  return h;
}

function buildRanking(d) {
  const rk = d.routeRanking;
  const mkRows = arr => arr.map(r => [r.customer, r.route, r.desc || '-', r.trips, r.margin, r.avgMargin, r.pct, r.loss]);
  const cols = ['ลูกค้า', 'เส้นทาง (Route)', 'ชื่อเส้นทาง', 'จำนวนเที่ยว', 'ส่วนต่างรวม', 'ส่วนต่างเฉลี่ย/เที่ยว', 'กำไร %', 'เที่ยวขาดทุน'];
  // Two highlight KPI cards
  let h = `<div class="master-grid-2" style="margin-bottom:20px;">
    <div class="master-mini-kpi" style="border-left:3px solid #22c55e;">
      <div class="master-mini-kpi-label">เส้นทางดีสุด</div>
      <div class="master-mini-kpi-value" style="color:#22c55e">${fmtB(rk.top[0]?.margin) + ' THB'}</div>
      <div class="master-mini-kpi-sub">${rk.top[0]?.route || '-'}</div>
    </div>
    <div class="master-mini-kpi" style="border-left:3px solid #ef4444;">
      <div class="master-mini-kpi-label">เส้นทางขาดทุนสูงสุด</div>
      <div class="master-mini-kpi-value" style="color:#ef4444">${fmtB(rk.bottom[0]?.margin) + ' THB'}</div>
      <div class="master-mini-kpi-sub">${rk.bottom[0]?.route || '-'}</div>
    </div>
  </div>`;
  h += `<div class="master-grid-2">
    <div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>จัดอันดับเส้นทางกำไรสูงสุด</h3></div><div id="t_top"></div></div>
    <div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>จัดอันดับเส้นทางขาดทุนสูงสุด</h3></div><div id="t_bot"></div></div>
  </div>`;
  setTimeout(() => { mkTable('t_top', cols, mkRows(rk.top), { defaultSort: 4, defaultAsc: false }); mkTable('t_bot', cols, mkRows(rk.bottom), { defaultSort: 4, defaultAsc: true }); }, 0);
  return h;
}

function buildCustomer(d) {
  const cp = d.customerProfit;
  const s = d.summary;
  const maxR = Math.max(...cp.map(c => c.recv), 1);
  const maxM = Math.max(...cp.filter(c => c.margin > 0).map(c => c.margin), 1);

  let h = `<div class="master-grid-2" style="margin-bottom:20px;">
    <div class="master-chart-card">
      <h4>รายได้แยกตามลูกค้า</h4>
      ${barChart(cp, c => c.name, c => c.recv / maxR * 100, c => fmt(c.recv) + ' THB', null, c => fmt(c.trips) + ' เที่ยว', true, true)}
    </div>
    <div class="master-chart-card">
      <h4>ส่วนต่างกำไรสุทธิแยกตามลูกค้า</h4>
      ${barChart(cp, c => c.name, c => c.margin <= 0 ? 1 : c.margin / maxM * 100, c => fmt(c.margin) + ' THB', c => c.margin >= 0 ? COLORS[2] : '#ef4444', null, true)}
    </div>
  </div>`;

  const rows = cp.map(c => [c.name, c.trips, c.recv, c.margin, c.pct, c.loss, c.oil, ...MONTHS.flatMap(m => [c.months[m]?.trips || 0, c.months[m]?.margin || 0])]);
  const cols = ['ลูกค้า', 'จำนวนเที่ยว', 'ราคารับ', 'ส่วนต่าง', 'กำไร %', 'เที่ยวขาดทุน', 'จ่ายสำรองน้ำมัน', ...MONTHS.flatMap(m => [MTH[m] + ' (เที่ยว)', MTH[m] + ' (ส่วนต่าง)'])];
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>ภาพรวมผลประกอบการและเสถียรภาพรายได้จำแนกตามรายลูกค้า</h3></div><div id="t_cust"></div></div>`;
  setTimeout(() => mkTable('t_cust', cols, rows, { defaultSort: 3, defaultAsc: false }), 0);
  return h;
}
function getSafeOwnOut(d) {
  const toSafeSide = side => {
    const trips = Number(side?.trips);
    const recv = Number(side?.recv);
    const margin = Number(side?.margin);
    const safeTrips = Number.isFinite(trips) ? trips : 0;
    const safeRecv = Number.isFinite(recv) ? recv : 0;
    const safeMargin = Number.isFinite(margin) ? margin : 0;
    const pctRaw = Number(side?.pct);
    const safePct = Number.isFinite(pctRaw) ? pctRaw : (safeRecv > 0 ? safeMargin / safeRecv * 100 : 0);
    const topRoutes = Array.isArray(side?.topRoutes) ? side.topRoutes : [];
    return {
      trips: safeTrips,
      recv: safeRecv,
      margin: safeMargin,
      pct: Number.isFinite(safePct) ? safePct : 0,
      topRoutes
    };
  };
  const ownOut = d?.ownVsOutsource || {};
  const company = toSafeSide(ownOut.company);
  const outsource = toSafeSide(ownOut.outsource);
  const totalTrips = company.trips + outsource.trips;
  const companyTripPct = totalTrips > 0 ? company.trips / totalTrips * 100 : 0;
  const outsourceTripPct = totalTrips > 0 ? outsource.trips / totalTrips * 100 : 0;
  return { company, outsource, totalTrips, companyTripPct, outsourceTripPct };
}
function buildOwnOut(d) {
  const { company: co, outsource: ou, companyTripPct, outsourceTripPct } = getSafeOwnOut(d);
  const coP = companyTripPct.toFixed(1);
  const ouP = outsourceTripPct.toFixed(1);

  let h = `<div class="master-grid-2" style="margin-bottom:20px;">
    <div class="master-vs-card" style="border-top:3px solid #3b82f6;">
      <div class="master-vs-header" style="color:#3b82f6;">รถบริษัท</div>
      <div class="master-vs-value" style="color:#3b82f6;">${fmt(co.trips)} <span style="font-size:16px;color:var(--muted)">เที่ยว</span></div>
      <div class="master-progress-wrap"><div class="master-progress-fill" style="width:${coP}%;background:linear-gradient(90deg,#3b82f677,#3b82f6);"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">${coP}% ของเที่ยวทั้งหมด</div>
      <div class="master-vs-detail">ราคารับ: <b>${fmt(co.recv)} THB</b></div>
      <div class="master-vs-detail" style="color:${co.margin >= 0 ? '#22c55e' : '#ef4444'};margin-top:4px;">ส่วนต่าง: <b>${fmt(co.margin)} THB</b> (${fmtP(co.pct)})</div>
    </div>
    <div class="master-vs-card" style="border-top:3px solid #6366f1;">
      <div class="master-vs-header" style="color:#6366f1;">รถจ้างภายนอก</div>
      <div class="master-vs-value" style="color:#6366f1;">${fmt(ou.trips)} <span style="font-size:16px;color:var(--muted)">เที่ยว</span></div>
      <div class="master-progress-wrap"><div class="master-progress-fill" style="width:${ouP}%;background:linear-gradient(90deg,#6366f177,#6366f1);"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">${ouP}% ของเที่ยวทั้งหมด</div>
      <div class="master-vs-detail">ราคารับ: <b>${fmt(ou.recv)} THB</b></div>
      <div class="master-vs-detail" style="color:${ou.margin >= 0 ? '#22c55e' : '#ef4444'};margin-top:4px;">ส่วนต่าง: <b>${fmt(ou.margin)} THB</b> (${fmtP(ou.pct)})</div>
    </div>
  </div>`;

  const mkR = arr => arr.map(r => [r.route, r.trips, r.margin]);
  const cols = ['เส้นทาง (Route)', 'จำนวนเที่ยว', 'ส่วนต่าง'];
  h += `<div class="master-grid-2">`;
  ['company', 'outsource'].forEach(k => {
    const label = k === 'company' ? 'รถบริษัท' : 'รถจ้างภายนอก';
    h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>Top Routes — ${label}</h3></div><div id="t_oo_${k}"></div></div>`;
  });
  h += `</div>`;
  setTimeout(() => {
    mkTable('t_oo_company', cols, mkR(co.topRoutes), { defaultSort: 1, defaultAsc: false });
    mkTable('t_oo_outsource', cols, mkR(ou.topRoutes), { defaultSort: 1, defaultAsc: false });
  }, 0);
  return h;
}


function buildLoss(d) {
  const lt = d.lossTrip;
  if (!lt) { return '<div class="master-mini-kpi"><div class="master-mini-kpi-value" style="color:#ef4444">ไม่มีข้อมูลขาดทุน</div></div>'; }

  const validMonths = MONTHS.filter(m => lt.byMonth && lt.byMonth[m]);
  const maxL = validMonths.length > 0 ? Math.max(...validMonths.map(m => Math.abs(lt.byMonth[m].loss || 0)), 1) : 1;

  let monthBars = '';
  if (validMonths.length > 0) {
    const maxC = Math.max(...validMonths.map(m => lt.byMonth[m].count || 0), 1);
    monthBars = validMonths.map(m => {
      const bm = lt.byMonth[m];
      const wC = Math.max(2, (bm.count || 0) / maxC * 100).toFixed(1);
      const wL = Math.max(2, (Math.abs(bm.loss || 0) / maxL * 100)).toFixed(1);
      return `<div class="master-loss-month">
        <div class="master-loss-month-header">
          <span class="master-loss-month-name">${MTH[m] || m}</span>
          <div class="master-loss-month-stats">
            <span style="color:var(--muted)">เที่ยว: <b style="color:var(--text)">${bm.count}</b></span>
            <span style="color:#ef4444;font-weight:600">มูลค่า: <b>${fmt(bm.loss)} THB</b></span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;margin-bottom:6px;">
          <div style="font-size:10px;color:var(--muted);text-align:right">จำนวนเที่ยว</div>
          <div class="master-loss-bar-track">
            <div class="master-loss-bar-fill" style="width:${wC}%;background:linear-gradient(90deg,#f59e0b77,#f59e0b);box-shadow:0 2px 8px #f59e0b33">${bm.count} เที่ยว</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;">
          <div style="font-size:10px;color:var(--muted);text-align:right">มูลค่าขาดทุน</div>
          <div class="master-loss-bar-track">
            <div class="master-loss-bar-fill" style="width:${wL}%;background:linear-gradient(90deg,#b9191977,#b91919);box-shadow:0 2px 8px #b9191933">${fmt(bm.loss)} THB</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // Summary mini KPIs
  let h = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
    <div class="master-mini-kpi" style="border-left:3px solid #ef4444;"><div class="master-mini-kpi-label">เที่ยวขาดทุน</div><div class="master-mini-kpi-value" style="color:#ef4444">${fmt(lt.total)}</div><div class="master-mini-kpi-sub">จาก ${fmt(lt.totalTrips)} เที่ยว</div></div>
    <div class="master-mini-kpi" style="border-left:3px solid #ef4444;"><div class="master-mini-kpi-label">อัตราขาดทุน</div><div class="master-mini-kpi-value" style="color:#ef4444">${fmtP(lt.lossPct)}</div><div class="master-mini-kpi-sub">ของทั้งหมด</div></div>
    <div class="master-mini-kpi" style="border-left:3px solid #ef4444;"><div class="master-mini-kpi-label">มูลค่าขาดทุนรวม</div><div class="master-mini-kpi-value" style="color:#ef4444">${fmt(lt.totalLoss)}</div><div class="master-mini-kpi-sub">THB</div></div>
    <div class="master-mini-kpi" style="border-left:3px solid #ef4444;"><div class="master-mini-kpi-label">ขาดทุนเฉลี่ย/เที่ยว</div><div class="master-mini-kpi-value" style="color:#ef4444">${lt.total > 0 ? fmt(Math.round((lt.totalLoss || 0) / lt.total)) + ' THB' : '-'}</div><div class="master-mini-kpi-sub">เฉลี่ย</div></div>
  </div>`;

  if (monthBars) {
    h += `<div class="master-chart-card" style="margin-bottom:20px;">
      <h4>จำนวนเที่ยวขาดทุนแยกเป็นรายเดือน</h4>
      ${monthBars}
    </div>`;
  }

  const custArr = Array.isArray(lt.byCustomer) ? lt.byCustomer :
    lt.byCustomer ? Object.entries(lt.byCustomer).map(([k, v]) => ({ name: k, count: v.count, loss: v.loss })) : [];
  const custRows = custArr.map(c => [c.name || '-', c.count || 0, c.loss || 0]);

  const routeArr = Array.isArray(lt.byRoute) ? lt.byRoute :
    lt.byRoute ? Object.entries(lt.byRoute).map(([k, v]) => ({ name: k, count: v.count, loss: v.loss })) : [];
  const routeRows = routeArr.map(r => [r.name || '-', r.count || 0, r.loss || 0]);

  h += `<div class="master-grid-2">`;
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>เที่ยวขาดทุนแยกตามรายลูกค้า</h3></div><div id="t_lc"></div></div>`;
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>เที่ยวขาดทุนแยกตามเส้นทาง</h3></div><div id="t_lr"></div></div>`;
  h += `</div>`;

  setTimeout(() => {
    if (document.getElementById('t_lc'))
      mkTable('t_lc', ['ลูกค้า', 'เที่ยวขาดทุน', 'มูลค่าขาดทุน (THB)'], custRows, { defaultSort: 2, defaultAsc: true });
    if (document.getElementById('t_lr'))
      mkTable('t_lr', ['เส้นทาง (Route)', 'เที่ยวขาดทุน', 'มูลค่าขาดทุน (THB)'], routeRows, { defaultSort: 1, defaultAsc: false });
  }, 0);
  return h;
}


function buildVehicle(d) {
  const vt = d.vehicleType;
  const maxT = Math.max(...vt.map(v => v.trips), 1);
  const maxM = Math.max(...vt.filter(v => v.margin > 0).map(v => v.margin), 1);
  const maxAvgM = Math.max(...vt.map(x => x.avgMargin || 0), 1);

  let h = `<div class="master-grid-2" style="margin-bottom:20px;">
    <div class="master-chart-card">
      <h4>สัดส่วนเที่ยวแยกตามประเภทรถ</h4>
      ${barChart(vt, v => v.type, v => v.trips / maxT * 100, v => fmt(v.trips) + ' เที่ยว', (v, i) => COLORS[i % 10], v => 'สัดส่วน ' + (Number(v.share)||0).toFixed(2) + '%', true, true)}
    </div>
    <div class="master-chart-card">
      <h4>ส่วนต่างเฉลี่ยสุทธิ/เที่ยว แยกตามประเภทรถ</h4>
      ${barChart(vt, v => v.type, v => v.avgMargin <= 0 ? 1 : v.avgMargin / maxAvgM * 100, v => fmt(v.avgMargin) + ' บาท/เที่ยว', (v, i) => v.avgMargin >= 0 ? COLORS[i % 10] : '#ef4444', v => 'ราคารับ ' + fmt(v.avgRecv) + ' THB/เที่ยว', true, true)}
    </div>
  </div>`;

  const rows = vt.map(v => [v.type, v.trips, v.share, v.recv, v.margin, v.avgRecv, v.avgMargin, v.pct, v.loss]);
  const cols = ['ประเภทรถ', 'จำนวนเที่ยว', 'สัดส่วน %', 'ราคารับรวม', 'ส่วนต่างรวม', 'ราคารับเฉลี่ย/เที่ยว', 'ส่วนต่างเฉลี่ย/เที่ยว', 'กำไร %', 'จำนวนเที่ยวที่ขาดทุน'];
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>ประสิทธิภาพแยกตามประเภทรถ</h3></div><div id="t_vt"></div></div>`;
  setTimeout(() => mkTable('t_vt', cols, rows, { defaultSort: 1, defaultAsc: false }), 0);
  return h;
}

/* ─── Full Modal Detail Builders — Professional Dashboard View ─── */

function sparkline(values, labels, color, height = 100) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const avgH = ((avg - min) / range * height);

  const bars = values.map((v, i) => {
    const h = Math.max(4, ((v - min) / range * height));
    const intensity = (v - min) / range;
    const opacity = 0.35 + (intensity * 0.65);
    const isHigh = v >= avg;
    return `<div class="sparkline-bar" 
      style="height:${h}px;
             background:linear-gradient(180deg, ${color}${Math.round(opacity*255).toString(16).padStart(2,'0')}, ${color}99);
             opacity:${0.7 + intensity*0.3};
             --glow-color:${color}40;
             animation-delay:${i * 80}ms;
             border-radius:6px 6px 0 0;"
      onmouseover="this.style.background='linear-gradient(180deg, ${color}, ${color}bb)';this.style.opacity='1'"
      onmouseout="this.style.background='linear-gradient(180deg, ${color}${Math.round(opacity*255).toString(16).padStart(2,'0')}, ${color}99)';this.style.opacity='${0.7 + intensity*0.3}'">
      <div class="sparkline-tooltip">
        <div style="font-weight:700;color:${color};margin-bottom:2px">${esc(labels[i])}</div>
        <div style="font-size:13px;color:var(--text)">${fmt(v)} ${isHigh ? '▲' : '▼'} <span style="color:var(--muted);font-size:10px">เฉลี่ย ${fmt(Math.round(avg))}</span></div>
      </div>
    </div>`;
  }).join('');

  return `<div class="sparkline-container" style="height:${height}px">
    ${bars}
    <div style="position:absolute;bottom:${8 + avgH}px;left:8px;right:8px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent);pointer-events:none;z-index:1"></div>
  </div>`;
}

function progressRing(pct, color, size = 80, stroke = 6) {
  const safePct = Number.isFinite(Number(pct)) ? Math.max(0, Math.min(100, Number(pct))) : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - safePct / 100);
  return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${circ}" stroke-dashoffset="${off}" stroke-linecap="round" style="transition:stroke-dashoffset 1s ease"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" transform="rotate(90 ${size/2} ${size/2})" fill="var(--text)" font-size="14" font-weight="800">${safePct.toFixed(1)}%</text>
  </svg>`;
}

function modalKPICard(label, value, sub, color, delta = null) {
  const hasDelta = Number.isFinite(Number(delta));
  // Hide delta if it's 0.0%
  const deltaHtml = hasDelta && Math.abs(Number(delta)) >= 0.05 ? `<span class="modal-kpi-delta ${Number(delta) >= 0 ? 'up' : 'down'}">${Number(delta) >= 0 ? '▲' : '▼'} ${Math.abs(Number(delta)).toFixed(1)}%</span>` : '';
  return `<div class="modal-kpi-card" style="--kpi-color:${color}">
    <div class="modal-kpi-label">${esc(label)}</div>
    <div class="modal-kpi-value" style="color:${color}">${esc(value)}${deltaHtml}</div>
    <div class="modal-kpi-sub">${esc(sub)}</div>
  </div>`;
}

function buildFullTrend(d) {
  const s = d.summary;
  // Determine which months actually have data
  const activeMonths = getActiveMonths(d, 'routeTrend');
  const monthCount = activeMonths.length || MONTHS.filter(m => d.routeTrend.some(r => r.months && r.months[m])).length || MONTHS.length;
  const monthsToShow = activeMonths.length > 0 ? activeMonths : MONTHS.slice(0, monthCount);

  // Monthly aggregates from routeTrend (only for active months)
  const monthTrips = monthsToShow.map(m => d.routeTrend.reduce((a, r) => a + (r.months[m]?.trips || 0), 0));
  const monthRevenue = monthsToShow.map(m => {
    const dailyStat = getMonthlyStatsFromDaily(d, m);
    if (dailyStat) return dailyStat.recv;
    return d.routeTrend.reduce((sum, row) => {
      const monthData = row.months?.[m] || {};
      const recvValue = Number(monthData.recv);
      if (Number.isFinite(recvValue)) return sum + recvValue;
      return sum + (Number(monthData.pay) || 0) + (Number(monthData.oil) || 0) + (Number(monthData.margin) || 0);
    }, 0);
  });
  const monthMargins = monthsToShow.map(m => d.routeTrend.reduce((a, r) => a + (r.months[m]?.margin || 0), 0));
  const monthLabels = monthsToShow.map(m => MTH[m] || m);
  const tripsDelta = monthTrips.length > 1 ? calcMoMDeltaPct(monthTrips[monthTrips.length - 1], monthTrips[monthTrips.length - 2]) : null;
  const revenueDelta = monthRevenue.length > 1 ? calcMoMDeltaPct(monthRevenue[monthRevenue.length - 1], monthRevenue[monthRevenue.length - 2]) : null;
  const marginDelta = monthMargins.length > 1 ? calcMoMDeltaPct(monthMargins[monthMargins.length - 1], monthMargins[monthMargins.length - 2], true) : null;
  const monthPct = monthRevenue.map((recv, i) => recv > 0 ? (monthMargins[i] / recv) * 100 : null);
  const avgPctDelta = monthPct.length > 1 ? calcMoMDeltaPct(monthPct[monthPct.length - 1], monthPct[monthPct.length - 2], true) : null;

  const top10 = d.routeTrend.slice().sort((a, b) => {
    const ta = monthsToShow.reduce((s, m) => s + (a.months[m]?.trips || 0), 0);
    const tb = monthsToShow.reduce((s, m) => s + (b.months[m]?.trips || 0), 0);
    return tb - ta;
  }).slice(0, 10);

  return `
    <!-- KPI Banner -->
    <div class="modal-full-grid">
      ${modalKPICard('จำนวนเที่ยวทั้งหมด', fmt(s.totalTrips) + ' เที่ยว', monthRangeLabel(monthsToShow), '#3b82f6', tripsDelta)}
      ${modalKPICard('ราคารับรวม', fmt(s.totalRevenue) + ' THB', monthCountLabel(monthCount), '#22c55e', revenueDelta)}
      ${modalKPICard('ส่วนต่างรวม', fmt(s.totalMargin) + ' THB', s.totalMargin >= 0 ? 'ทำกำไร' : 'ขาดทุน', s.totalMargin >= 0 ? '#22c55e' : '#ef4444', marginDelta)}
      ${modalKPICard('กำไร % เฉลี่ย', fmtP(s.avgMarginPct), 'เฉลี่ยทุกเที่ยว', '#8b5cf6', avgPctDelta)}
    </div>

    <!-- Charts -->
    <div class="modal-full-grid modal-full-grid-2">
      <div class="modal-chart-area" style="background:linear-gradient(180deg, rgba(59,130,246,0.03), rgba(59,130,246,0.01));border-color:rgba(59,130,246,0.15);">
        <div class="modal-chart-title" style="color:#3b82f6">แนวโน้มจำนวนเที่ยวรายเดือน</div>
        ${sparkline(monthTrips, monthLabels, '#3b82f6', 100)}
        <div style="display:flex;justify-content:space-between;margin-top:8px;padding:0 4px;">
          ${monthLabels.map((l, i) => `<div style="text-align:center;flex:1">
            <div style="font-size:11px;font-weight:700;color:var(--text)">${l}</div>
            <div style="font-size:13px;font-weight:800;color:#3b82f6;margin-top:2px">${fmt(monthTrips[i])}</div>
            ${i > 0 ? renderMoMDelta(monthTrips[i], monthTrips[i - 1], true, false) : '<div style="font-size:9px;color:var(--muted);margin-top:1px">—</div>'}
          </div>`).join('')}
        </div>
        <div style="text-align:right;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:baseline;justify-content:flex-end;gap:6px">
          <span style="font-size:13px;color:var(--muted);font-weight:600">รวม</span>
          <span style="font-size:14px;font-weight:800;color:#3b82f6">${fmt(monthTrips.reduce((a,b)=>a+b,0))} เที่ยว</span>
        </div>
      </div>
      <div class="modal-chart-area" style="background:linear-gradient(180deg, ${s.totalMargin>=0?'rgba(34,197,94,0.03), rgba(34,197,94,0.01)':'rgba(239,68,68,0.03), rgba(239,68,68,0.01)'});border-color:${s.totalMargin>=0?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)'};">
        <div class="modal-chart-title" style="color:${s.totalMargin>=0?'#22c55e':'#ef4444'}">แนวโน้มส่วนต่างกำไรรายเดือน</div>
        ${sparkline(monthMargins, monthLabels, s.totalMargin>=0?'#22c55e':'#ef4444', 100)}
        <div style="display:flex;justify-content:space-between;margin-top:8px;padding:0 4px;">
          ${monthLabels.map((l, i) => `<div style="text-align:center;flex:1">
            <div style="font-size:11px;font-weight:700;color:var(--text)">${l}</div>
            <div style="font-size:13px;font-weight:800;color:${s.totalMargin>=0?'#22c55e':'#ef4444'};margin-top:2px">${fmt(monthMargins[i])}</div>
            ${i > 0 ? renderMoMDelta(monthMargins[i], monthMargins[i - 1], true, true) : '<div style="font-size:9px;color:var(--muted);margin-top:1px">—</div>'}
          </div>`).join('')}
        </div>
        <div style="text-align:right;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:baseline;justify-content:flex-end;gap:6px">
          <span style="font-size:13px;color:var(--muted);font-weight:600">รวม</span>
          <span style="font-size:14px;font-weight:800;color:${s.totalMargin>=0?'#22c55e':'#ef4444'}">${fmt(monthMargins.reduce((a,b)=>a+b,0))} THB</span>
        </div>
      </div>
    </div>

    ${buildAuditTableSection('audit-overview-routes', 'Top 10 เส้นทางที่มีเที่ยววิ่งมากที่สุด', '&#10148;', '#3b82f6', 'กรองลูกค้า ประเภทรถ และตรวจสอบเที่ยวรายเดือนในตารางเดียว')}
    ${buildAuditTableSection('audit-overview-months', 'สรุปผลประกอบการรายเดือน', '&#8862;', '#8b5cf6', 'ตรวจสอบจำนวนเที่ยว รายได้ ส่วนต่าง และกำไร % รายเดือน')}
  `;
}

function buildFullRanking(d) {
  const rk = d.routeRanking;
  const routeKey = r => `${r?.customer || '-'}|${r?.route || '-'}|${r?.vtype || '-'}`;
  const allRoutes = [...rk.top, ...rk.bottom].sort((a, b) => b.margin - a.margin);
  const top10 = rk.top.slice(0, 10);
  const bot10 = rk.bottom.slice(0, 10);
  const uniqueRouteCount = new Set(allRoutes.map(routeKey)).size;

  // Profitability stats from available data
  const allMargins = [...rk.top.map(r => r.margin), ...rk.bottom.map(r => r.margin)].filter(m => m != null);
  const profitCount = rk.top.filter(r => (r.margin || 0) > 0).length;
  const lossCount = rk.bottom.filter(r => (r.margin || 0) < 0).length;
  const zeroCount = rk.top.filter(r => (r.margin || 0) === 0).length + rk.bottom.filter(r => (r.margin || 0) === 0).length;
  const totalRoutes = profitCount + lossCount + zeroCount;
  const profitPct = totalRoutes > 0 ? (profitCount / totalRoutes * 100).toFixed(1) : '0.0';
  const lossPct = totalRoutes > 0 ? (lossCount / totalRoutes * 100).toFixed(1) : '0.0';
  const zeroPct = totalRoutes > 0 ? (zeroCount / totalRoutes * 100).toFixed(1) : '0.0';
  const minM = allMargins.length > 0 ? Math.min(...allMargins) : 0;
  const maxM = allMargins.length > 0 ? Math.max(...allMargins) : 0;
  const avgM = allMargins.length > 0 ? allMargins.reduce((a, b) => a + b, 0) / allMargins.length : 0;
  const totalProfitMargin = [...rk.top, ...rk.bottom].filter(r => (r.margin || 0) > 0).reduce((a, r) => a + r.margin, 0);
  const totalLossMargin = [...rk.top, ...rk.bottom].filter(r => (r.margin || 0) < 0).reduce((a, r) => a + r.margin, 0);

  return `
    <!-- KPIs -->
    <div class="modal-full-grid modal-full-grid-3">
      ${modalKPICard('เส้นทางทั้งหมด', fmt(uniqueRouteCount), 'เส้นทางที่มีข้อมูล', '#3b82f6')}
      ${modalKPICard('กำไรสูงสุด', fmt(rk.top[0]?.margin) + ' THB', rk.top[0]?.route || '-', '#22c55e')}
      ${modalKPICard('ขาดทุนสูงสุด', fmt(rk.bottom[0]?.margin) + ' THB', rk.bottom[0]?.route || '-', '#ef4444')}
    </div>

    <!-- Profitability Overview -->
    <div class="modal-chart-area" style="background:linear-gradient(180deg, rgba(139,92,246,0.03), rgba(139,92,246,0.01));border-color:rgba(139,92,246,0.15);">
      <div class="modal-chart-title" style="color:#8b5cf6">ภาพรวมการกระจายตัวผลตอบแทน</div>

      <!-- Main Stacked Bar -->
      <div style="margin:16px 0;">
        <div style="display:flex;height:36px;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.25);">
          ${profitCount > 0 ? `<div style="flex:${profitCount};background:linear-gradient(180deg, #22c55edd, #22c55e);display:flex;align-items:center;justify-content:center;min-width:60px;transition:flex 0.8s ease;">
            <span style="font-size:12px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3)">${profitPct}% กำไร</span>
          </div>` : ''}
          ${zeroCount > 0 ? `<div style="flex:${zeroCount};background:linear-gradient(180deg, #f59e0bdd, #f59e0b);display:flex;align-items:center;justify-content:center;min-width:40px;transition:flex 0.8s ease;">
            <span style="font-size:12px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3)">${zeroPct}% เท่าทุน</span>
          </div>` : ''}
          ${lossCount > 0 ? `<div style="flex:${lossCount};background:linear-gradient(180deg, #ef4444dd, #ef4444);display:flex;align-items:center;justify-content:center;min-width:60px;transition:flex 0.8s ease;">
            <span style="font-size:12px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3)">${lossPct}% ขาดทุน</span>
          </div>` : ''}
        </div>
      </div>

      <!-- Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
        <div style="background:linear-gradient(180deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02));border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:11px;color:#22c55e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">เส้นทางกำไร</div>
          <div style="font-size:24px;font-weight:800;color:#22c55e;margin-bottom:2px;">${fmt(profitCount)}</div>
          <div style="font-size:12px;color:var(--muted);">${profitPct}% ของทั้งหมด</div>
          <div style="font-size:13px;color:var(--text);font-weight:700;margin-top:6px;">${fmt(totalProfitMargin)} THB</div>
        </div>
        <div style="background:linear-gradient(180deg, rgba(239,68,68,0.06), rgba(239,68,68,0.02));border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:11px;color:#ef4444;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">เส้นทางขาดทุน</div>
          <div style="font-size:24px;font-weight:800;color:#ef4444;margin-bottom:2px;">${fmt(lossCount)}</div>
          <div style="font-size:12px;color:var(--muted);">${lossPct}% ของทั้งหมด</div>
          <div style="font-size:13px;color:var(--text);font-weight:700;margin-top:6px;">${fmt(totalLossMargin)} THB</div>
        </div>
        <div style="background:linear-gradient(180deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02));border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:11px;color:#8b5cf6;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">ส่วนต่างเฉลี่ย</div>
          <div style="font-size:24px;font-weight:800;color:#8b5cf6;margin-bottom:2px;">${fmt(Math.round(avgM))}</div>
          <div style="font-size:12px;color:var(--muted);">THB / เส้นทาง</div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px;">สูงสุด ${fmt(maxM)}</div>
        </div>
      </div>

      <!-- Margin Range Table -->
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.02);border-radius:10px;border:1px solid var(--border);">
            <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#22c55e22,#22c55e11);display:flex;align-items:center;justify-content:center;font-size:16px;color:#22c55e;border:1px solid #22c55e30;font-weight:800;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#75FB4C"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg></div>
            <div>
              <div style="font-size:11px;color:var(--muted);font-weight:600;">กำไรสูงสุด</div>
              <div style="font-size:16px;font-weight:800;color:#22c55e;">${fmt(maxM)} THB</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.02);border-radius:10px;border:1px solid var(--border);">
            <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#ef444422,#ef444411);display:flex;align-items:center;justify-content:center;font-size:16px;color:#ef4444;border:1px solid #ef444430;font-weight:800;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#EA3323" style="display:block"><path d="M200-440v-80h560v80H200Z"/></svg></div>
            <div>
              <div style="font-size:11px;color:var(--muted);font-weight:600;">ขาดทุนสูงสุด</div>
              <div style="font-size:16px;font-weight:800;color:#ef4444;">${fmt(minM)} THB</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.02);border-radius:10px;border:1px solid var(--border);">
            <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#8b5cf622,#8b5cf611);display:flex;align-items:center;justify-content:center;font-size:16px;color:#8b5cf6;border:1px solid #8b5cf630;font-weight:800;"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#75FB4C"><path d="M441-120v-86q-53-12-91.5-46T293-348l74-30q15 48 44.5 73t77.5 25q41 0 69.5-18.5T587-356q0-35-22-55.5T463-458q-86-27-118-64.5T313-614q0-65 42-101t86-41v-84h80v84q50 8 82.5 36.5T651-650l-74 32q-12-32-34-48t-60-16q-44 0-67 19.5T393-614q0 33 30 52t104 40q69 20 104.5 63.5T667-358q0 71-42 108t-104 46v84h-80Z"/></svg></div>
            <div>
              <div style="font-size:11px;color:var(--muted);font-weight:600;">ส่วนต่างรวมทุกเส้นทาง</div>
              <div style="font-size:16px;font-weight:800;color:${totalProfitMargin + totalLossMargin >= 0 ? '#22c55e' : '#ef4444'};">${fmt(totalProfitMargin + totalLossMargin)} THB</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${buildAuditTableSection('audit-ranking-top', 'TOP 10 เส้นทางส่วนต่างกำไรสูงสุด', '&#8593;', '#22c55e', 'ใช้สำหรับตรวจสอบเส้นทางกำไรสูงสุดแบบจัดเรียงและค้นหาได้')}
    ${buildAuditTableSection('audit-ranking-bottom', 'TOP 10 เส้นทางส่วนต่างขาดทุนสูงสุด', '&#8595;', '#ef4444', 'ใช้สำหรับคัดกรองเส้นทางที่ต้องติดตามความเสี่ยงเป็นพิเศษ')}
  `;
}

function buildFullCustomer(d) {
  const cp = d.customerProfit;
  const top10 = cp.slice(0, 10);
  const maxR = Math.max(1, ...cp.map(c => Number(c.recv) || 0));
  const maxM = Math.max(1, ...cp.filter(c => (Number(c.margin)||0) > 0).map(c => Number(c.margin) || 0));

  return `
    <!-- KPIs -->
    <div class="modal-full-grid">
      ${modalKPICard('ลูกค้าทั้งหมด', fmt(cp.length), 'ราย', '#3b82f6')}
      ${modalKPICard('รายรับรวม', fmt(cp.reduce((a,c) => a + c.recv, 0)) + ' THB', 'จากทุกลูกค้า', '#22c55e')}
      ${modalKPICard('ส่วนต่างรวม', fmt(cp.reduce((a,c) => a + c.margin, 0)) + ' THB', 'กำไรสุทธิ', '#8b5cf6')}
      ${modalKPICard('ลูกค้ากำไรสูงสุด', cp[0]?.name || '-', fmt(cp[0]?.margin) + ' THB', '#f59e0b')}
    </div>

    <!-- Revenue Bar Chart -->
    <div class="modal-chart-area">
      <div class="modal-chart-title" style="color:#ffffff">รวมราคารับแยกตามลูกค้า </div>
      ${barChart(top10, c => c.name, c => (Number(c.recv)||0) / maxR * 100, c => fmt(c.recv) + ' THB', (c, i) => COLORS[i % 10], c => fmt(c.trips) + ' เที่ยว', true, true)}
    </div>

    <!-- Margin Bar Chart -->
    <div class="modal-chart-area">
      <div class="modal-chart-title" style="color:#ffffff">รวมส่วนต่างกำไรแยกตามลูกค้า </div>
      ${barChart(top10, c => c.name, c => Math.abs(Number(c.margin)||0) / maxM * 100, c => fmt(c.margin) + ' THB', (c, i) => (c.margin||0) >= 0 ? COLORS[i % 10] : '#ef4444', c => fmtP(c.pct), true, true)}
    </div>

    ${buildAuditTableSection('audit-customer-profit', 'รายละเอียดผลประกอบการรายลูกค้าทั้งหมด', '&#8857;', '#22c55e', 'กรองลูกค้าและสถานะผลตอบแทน พร้อม export เพื่อตรวจสอบต่อได้')}
  `;
}

function buildFullOwnOut(d) {
  const { company: co, outsource: ou, companyTripPct, outsourceTripPct } = getSafeOwnOut(d);
  const coP = companyTripPct.toFixed(1);
  const ouP = outsourceTripPct.toFixed(1);

  return `
    <!-- KPIs + Progress Rings -->
    <div class="modal-full-grid modal-full-grid-2" style="align-items:center;">
      <div style="display:flex;align-items:center;gap:20px;background:linear-gradient(135deg, rgba(59,130,246,0.04), transparent);border:1px solid var(--border);border-radius:14px;padding:24px;">
        <div style="flex-shrink:0;">${progressRing(parseFloat(coP), '#3b82f6', 100, 8)}</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#3b82f6;margin-bottom:4px;">รถบริษัท</div>
          <div style="font-size:28px;font-weight:800;color:var(--text);line-height:1.2;">${fmt(co.trips)} <span style="font-size:14px;color:var(--muted);">เที่ยว</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:6px;">รายได้ ${fmt(co.recv)} THB · ส่วนต่าง <span style="color:${co.margin>=0?'#22c55e':'#ef4444'};font-weight:700;">${fmt(co.margin)}</span></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:20px;background:linear-gradient(135deg, rgba(99,102,241,0.04), transparent);border:1px solid var(--border);border-radius:14px;padding:24px;">
        <div style="flex-shrink:0;">${progressRing(parseFloat(ouP), '#6366f1', 100, 8)}</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#6366f1;margin-bottom:4px;">รถจ้างภายนอก</div>
          <div style="font-size:28px;font-weight:800;color:var(--text);line-height:1.2;">${fmt(ou.trips)} <span style="font-size:14px;color:var(--muted);">เที่ยว</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:6px;">รายได้ ${fmt(ou.recv)} THB · ส่วนต่าง <span style="color:${ou.margin>=0?'#22c55e':'#ef4444'};font-weight:700;">${fmt(ou.margin)}</span></div>
        </div>
      </div>
    </div>

    <!-- Comparison Table -->
    <div class="modal-chart-area">
      <div class="modal-chart-title" style="color:#f59e0b">เปรียบเทียบตัวชี้วัดหลัก</div>
      <div class="modal-table-wrap" style="border:none;margin-top:12px;">
        <table>
          <thead><tr><th>ตัวชี้วัด</th><th style="text-align:right;color:#3b82f6">รถบริษัท</th><th style="text-align:right;color:#6366f1">รถจ้างภายนอก</th></tr></thead>
          <tbody>
            <tr><td style="font-weight:600">จำนวนเที่ยว</td><td style="text-align:right;font-weight:700">${fmt(co.trips)}</td><td style="text-align:right;font-weight:700">${fmt(ou.trips)}</td></tr>
            <tr><td style="font-weight:600">ราคารับรวม</td><td style="text-align:right;font-weight:700">${fmt(co.recv)}</td><td style="text-align:right;font-weight:700">${fmt(ou.recv)}</td></tr>
            <tr><td style="font-weight:600">ส่วนต่างรวม</td><td style="text-align:right;color:${co.margin>=0?'#22c55e':'#ef4444'};font-weight:700">${fmt(co.margin)}</td><td style="text-align:right;color:${ou.margin>=0?'#22c55e':'#ef4444'};font-weight:700">${fmt(ou.margin)}</td></tr>
            <tr><td style="font-weight:600">กำไร %</td><td style="text-align:right;font-weight:700">${fmtP(co.pct)}</td><td style="text-align:right;font-weight:700">${fmtP(ou.pct)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-full-grid modal-full-grid-2">
      ${buildAuditTableSection('audit-ownout-company', 'รถบริษัท', '&#9635;', '#3b82f6', 'ตรวจสอบเส้นทางหลักของรถบริษัทตามจำนวนเที่ยวและส่วนต่าง')}
      ${buildAuditTableSection('audit-ownout-outsource', 'รถจ้างภายนอก', '&#9733;', '#6366f1', 'ตรวจสอบเส้นทางหลักของรถจ้างภายนอกในรูปแบบเดียวกัน')}
    </div>
  `;
}

function buildFullLoss(d) {
  const lt = d.lossTrip;
  if (!lt) return `<div style="text-align:center;padding:40px;color:var(--muted);"><div style="font-size:48px;margin-bottom:12px;">✅</div><div style="font-size:18px;font-weight:700;">ไม่มีข้อมูลการขาดทุน</div><div style="font-size:13px;margin-top:8px;">ทุกเส้นทางทำกำไรในช่วงเวลานี้</div></div>`;

  const validMonths = MONTHS.filter(m => lt.byMonth && lt.byMonth[m]);
  const monthLoss = validMonths.map(m => Math.abs(lt.byMonth[m].loss || 0));
  const monthCounts = validMonths.map(m => lt.byMonth[m].count || 0);
  const monthLabels = validMonths.map(m => MTH[m] || m);
  const activeLossMonths = getActiveMonthsFromLoss(lt);
  const lossMonthCount = activeLossMonths.length || validMonths.length || MONTHS.length;

  const custArr = Array.isArray(lt.byCustomer) ? lt.byCustomer :
    lt.byCustomer ? Object.entries(lt.byCustomer).map(([k, v]) => ({ name: k, count: v.count || 0, loss: v.loss || 0 })) : [];
  const routeArr = Array.isArray(lt.byRoute) ? lt.byRoute :
    lt.byRoute ? Object.entries(lt.byRoute).map(([k, v]) => ({ name: k, count: v.count || 0, loss: v.loss || 0 })) : [];

  return `
    <!-- KPIs -->
    <div class="modal-full-grid">
      ${modalKPICard('จำนวนเที่ยวขาดทุน', fmt(lt.total), 'จาก ' + fmt(lt.totalTrips) + ' เที่ยว', '#ef4444')}
      ${modalKPICard('อัตราขาดทุน', fmtP(lt.lossPct), 'ของทั้งหมด', '#f59e0b')}
      ${modalKPICard('มูลค่าขาดทุนรวม', fmt(lt.totalLoss) + ' THB', 'สะสม ' + lossMonthCount + ' เดือน', '#ef4444')}
      ${modalKPICard('ขาดทุนเฉลี่ย/เที่ยว', lt.total > 0 ? fmt(Math.round((lt.totalLoss || 0) / lt.total)) + ' THB' : '-', 'เฉลี่ย', '#ef4444')}
    </div>

    <!-- Monthly Trend -->
    <div class="modal-full-grid modal-full-grid-2">
      <div class="modal-chart-area" style="background:linear-gradient(180deg, rgba(245,158,11,0.03), rgba(245,158,11,0.01));border-color:rgba(245,158,11,0.15);">
        <div class="modal-chart-title" style="color:#f59e0b">จำนวนเที่ยวขาดทุนรายเดือน</div>
        ${sparkline(monthCounts, monthLabels, '#f59e0b', 100)}
        <div style="display:flex;justify-content:space-between;margin-top:8px;padding:0 4px;">
          ${monthLabels.map((l, i) => `<div style="text-align:center;flex:1">
            <div style="font-size:11px;font-weight:700;color:var(--text)">${l}</div>
            <div style="font-size:13px;font-weight:800;color:#f59e0b;margin-top:2px">${fmt(monthCounts[i])}</div>
            ${i > 0 ? renderMoMDelta(monthCounts[i], monthCounts[i - 1], false, false) : '<div style="font-size:9px;color:var(--muted);margin-top:1px">—</div>'}
          </div>`).join('')}
        </div>
        <div style="text-align:right;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:baseline;justify-content:flex-end;gap:6px">
          <span style="font-size:13px;color:var(--muted);font-weight:600">รวม</span>
          <span style="font-size:14px;font-weight:800;color:#f59e0b">${fmt(monthCounts.reduce((a,b)=>a+b,0))} เที่ยว</span>
        </div>
      </div>
      <div class="modal-chart-area" style="background:linear-gradient(180deg, rgba(239,68,68,0.03), rgba(239,68,68,0.01));border-color:rgba(239,68,68,0.15);">
        <div class="modal-chart-title" style="color:#ef4444">มูลค่าขาดทุนรายเดือน (THB)</div>
        ${sparkline(monthLoss, monthLabels, '#ef4444', 100)}
        <div style="display:flex;justify-content:space-between;margin-top:8px;padding:0 4px;">
          ${monthLabels.map((l, i) => `<div style="text-align:center;flex:1">
            <div style="font-size:11px;font-weight:700;color:var(--text)">${l}</div>
            <div style="font-size:13px;font-weight:800;color:#ef4444;margin-top:2px">${fmt(monthLoss[i])}</div>
            ${i > 0 ? renderMoMDelta(monthLoss[i], monthLoss[i - 1], false, false) : '<div style="font-size:9px;color:var(--muted);margin-top:1px">—</div>'}
          </div>`).join('')}
        </div>
        <div style="text-align:right;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:baseline;justify-content:flex-end;gap:6px">
          <span style="font-size:13px;color:var(--muted);font-weight:600">รวม</span>
          <span style="font-size:14px;font-weight:800;color:#ef4444">${fmt(monthLoss.reduce((a,b)=>a+b,0))} THB</span>
        </div>
      </div>
    </div>

    ${buildAuditTableSection('audit-loss-monthly', 'รายละเอียดขาดทุนรายเดือน', '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#EA3323"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z"/></svg>', '#ef4444', 'ดูจำนวนเที่ยวขาดทุน มูลค่า และค่าเฉลี่ยต่อเที่ยวตามเดือน')}

    <!-- By Customer & Route -->
    <div class="modal-full-grid modal-full-grid-2">
      ${buildAuditTableSection('audit-loss-customer', 'ขาดทุนแยกตามลูกค้า', '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#F19E39"><path d="M234-276q51-39 114-61.5T480-360q69 0 132 22.5T726-276q35-41 54.5-93T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 59 19.5 111t54.5 93Zm146.5-204.5Q340-521 340-580t40.5-99.5Q421-720 480-720t99.5 40.5Q620-639 620-580t-40.5 99.5Q539-440 480-440t-99.5-40.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm100-95.5q47-15.5 86-44.5-39-29-86-44.5T480-280q-53 0-100 15.5T294-220q39 29 86 44.5T480-160q53 0 100-15.5ZM523-537q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm-43-43Zm0 360Z"/></svg>', '#f59e0b', 'จัดลำดับลูกค้าที่เกิดเที่ยวขาดทุนมากที่สุด')}
      ${buildAuditTableSection('audit-loss-route', 'ขาดทุนแยกตามเส้นทาง', '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#EA3323"><path d="M320-120v-160h80v160h-80Zm0-280v-160h80v160h-80Zm0-280v-160h80v160h-80ZM80-120l100-720h80L160-120H80Zm598.5-3q-5.5-3-8.5-9l-4-9q-23-48-64-82.5T532-302q-17-26-25-55t-8-59q0-78 57-130.5T692-599q78 0 133 56t55 135q0 29-8 56t-24 50q-29 44-70.5 78.5T714-141l-4 9q-3 6-8.5 9t-11.5 3q-6 0-11.5-3Zm68-230.5Q770-377 770-410t-23.5-56.5Q723-490 690-490t-56.5 23.5Q610-443 610-410t23.5 56.5Q657-330 690-330t56.5-23.5ZM494-599l-34-241h80l26 187q-20 11-38 24t-34 30Z"/></svg>', '#ef4444', 'จัดลำดับเส้นทางที่สร้างมูลค่าขาดทุนสะสมสูงสุด')}
    </div>
  `;
}

function buildFullVehicle(d) {
  const vt = d.vehicleType
    .filter(v => (Number(v.share) || 0) >= 0.5)
    .slice()
    .sort((a, b) => (Number(b.trips) || 0) - (Number(a.trips) || 0));
  if (!vt.length) {
    return '<div class="modal-section-card"><div class="modal-section-body" style="text-align:center;color:var(--muted);">ไม่มีข้อมูลประเภทรถ</div></div>';
  }

  const maxT = Math.max(1, ...vt.map(v => Number(v.trips) || 0));
  const totalTrips = vt.reduce((a, v) => a + (Number(v.trips) || 0), 0);
  const totalMargin = vt.reduce((a, v) => a + (Number(v.margin) || 0), 0);
  const totalRecv = vt.reduce((a, v) => a + (Number(v.recv) || 0), 0);
  const bestMargin = vt.reduce((b, v) => (Number(v.margin) > Number(b?.margin || -Infinity) ? v : b), vt[0]);
  const bestPct = vt.reduce((b, v) => (Number(v.pct) > Number(b?.pct || -Infinity) ? v : b), vt[0]);
  const dominant = vt[0];
  const overallPct = totalRecv > 0 ? (totalMargin / totalRecv) * 100 : 0;

  return `
    <div class="modal-full-grid">
      ${modalKPICard('ประเภทรถ', fmt(vt.length), 'ประเภท', '#3b82f6')}
      ${modalKPICard('จำนวนเที่ยวรวม', fmt(totalTrips), 'เที่ยว', '#22c55e')}
      ${modalKPICard('ส่วนต่างรวม', fmt(totalMargin) + ' THB', totalMargin >= 0 ? 'กำไร' : 'ขาดทุน', totalMargin >= 0 ? '#22c55e' : '#ef4444')}
      ${modalKPICard('ทำกำไรสูงสุด', esc(bestMargin?.type || '-'), fmt(bestMargin?.margin || 0) + ' THB', '#8b5cf6')}
    </div>

    <div class="vehperf-modal-layout">
      <section class="vehperf-brief">
        <div class="vehperf-brief-head">
          <div class="vehperf-brief-title">โครงสร้างประสิทธิภาพรถตามสัดส่วนเที่ยวและผลตอบแทน</div>
        </div>
        <div class="vehperf-brief-grid">
          <div class="vehperf-brief-card">
            <span class="vehperf-brief-label">รถที่มีสัดส่วนสูงสุด</span>
            <strong class="vehperf-brief-value">${esc(dominant?.type || '-')}</strong>
            <span class="vehperf-brief-sub">${(Number(dominant?.share) || 0).toFixed(2)}% ของเที่ยวทั้งหมด</span>
          </div>
          <div class="vehperf-brief-card">
            <span class="vehperf-brief-label">กำไรต่อรายได้รวม</span>
            <strong class="vehperf-brief-value">${fmtP(overallPct)}</strong>
            <span class="vehperf-brief-sub">คิดจากส่วนต่างรวมเทียบรายได้รวม</span>
          </div>
          <div class="vehperf-brief-card">
            <span class="vehperf-brief-label">กำไร % สูงสุด</span>
            <strong class="vehperf-brief-value">${esc(bestPct?.type || '-')}</strong>
            <span class="vehperf-brief-sub">${fmtP(bestPct?.pct || 0)} ต่อประเภทรถ</span>
          </div>
        </div>
      </section>

      <section class="vehperf-board">
        <div class="vehperf-board-head">
          <div>
            <div class="vehperf-board-title">จัดเรียงตามจำนวนเที่ยวรวม</div>
          </div>
        </div>
        <div class="vehperf-board-grid">
          ${vt.map((v, i) => {
            const col = COLORS[i % 10];
            const marginColor = (v.margin || 0) >= 0 ? '#22c55e' : '#ef4444';
            const pctColor = (v.pct || 0) >= 0 ? '#22c55e' : '#ef4444';
            const barW = Math.max(4, (Number(v.trips) || 0) / maxT * 100).toFixed(1);
            return `
              <article class="vehperf-board-card" style="--veh-color:${col};">
                <div class="vehperf-board-rank">${String(i + 1).padStart(2, '0')}</div>
                <div class="vehperf-board-row">
                  <div>
                    <div class="vehperf-board-type">${esc(v.type)}</div>
                    <div class="vehperf-board-share">${(Number(v.share) || 0).toFixed(2)}% ของเที่ยวทั้งหมด</div>
                  </div>
                  <div class="vehperf-board-pill">${fmt(v.trips)} เที่ยว</div>
                </div>
                <div class="vehperf-board-track"><div class="vehperf-board-fill" style="width:${barW}%;"></div></div>
                <div class="vehperf-board-metrics">
                  <div class="vehperf-board-metric"><span>รายได้</span><strong>${fmt(v.recv)}</strong></div>
                  <div class="vehperf-board-metric"><span>ส่วนต่าง</span><strong style="color:${marginColor};">${fmt(v.margin)}</strong></div>
                  <div class="vehperf-board-metric"><span>เฉลี่ย/เที่ยว</span><strong style="color:${marginColor};">${fmt(v.avgMargin)}</strong></div>
                  <div class="vehperf-board-metric"><span>กำไร %</span><strong style="color:${pctColor};">${fmtP(v.pct)}</strong></div>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    </div>

    ${buildAuditTableSection('audit-vehicle-performance', 'รายละเอียดประสิทธิภาพแยกตามประเภทรถ', '&#9881;', '#06b6d4', 'กรองประเภทรถตามสถานะผลตอบแทนและตรวจสอบโครงสร้างรายได้ต่อเที่ยว')}
  `;
}
/* โ”€โ”€โ”€ Compact Card Builders for Master Dashboard Grid โ”€โ”€โ”€ */
function buildTrendCard(d) {
  const s = d.summary;
  const topRoutes = d.routeTrend.slice().sort((a,b) => {
    const ta = MONTHS.reduce((sum,m) => sum + (a.months[m]?.trips||0), 0);
    const tb = MONTHS.reduce((sum,m) => sum + (b.months[m]?.trips||0), 0);
    return tb - ta;
  }).slice(0,5);
  return `
    <div class="master-grid-2" style="margin-bottom:6px;">
      <div class="master-mini-kpi" style="border-left:2px solid #3b82f6;"><div class="master-mini-kpi-label">เที่ยว</div><div class="master-mini-kpi-value" style="color:#3b82f6">${fmt(s.totalTrips)}</div></div>
      <div class="master-mini-kpi" style="border-left:2px solid #22c55e;"><div class="master-mini-kpi-label">รายได้</div><div class="master-mini-kpi-value" style="color:#22c55e">${fmt(s.totalRevenue)}</div></div>
      <div class="master-mini-kpi" style="border-left:2px solid ${s.totalMargin>=0?'#22c55e':'#ef4444'};"><div class="master-mini-kpi-label">ส่วนต่าง</div><div class="master-mini-kpi-value" style="color:${s.totalMargin>=0?'#22c55e':'#ef4444'}">${fmt(s.totalMargin)}</div></div>
      <div class="master-mini-kpi" style="border-left:2px solid #8b5cf6;"><div class="master-mini-kpi-label">กำไร %</div><div class="master-mini-kpi-value" style="color:#8b5cf6">${fmtP(s.avgMarginPct)}</div></div>
    </div>
    <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Top 5 เส้นทาง (เที่ยว)</div>
    <table class="master-compact-table">
      <thead><tr><th>ลูกค้า</th><th>เส้นทาง</th><th style="text-align:right">เที่ยว</th><th style="text-align:right">ส่วนต่าง</th></tr></thead>
      <tbody>${topRoutes.map(r => {
        const tot = MONTHS.reduce((a,m) => a + (r.months[m]?.trips||0), 0);
        const mg = MONTHS.reduce((a,m) => a + (r.months[m]?.margin||0), 0);
        return `<tr><td>${esc(r.customer)}</td><td title="${esc(r.route)}">${esc(r.route.length>20?r.route.slice(0,20)+'...':r.route)}</td><td style="text-align:right">${fmt(tot)}</td><td style="text-align:right;color:${mg>=0?'#22c55e':'#ef4444'}">${fmt(mg)}</td></tr>`;
      }).join('')}</tbody>
    </table>
  `;
}

function buildRankingCard(d) {
  const rk = d.routeRanking;
  const top3 = rk.top.slice(0,3);
  const bot3 = rk.bottom.slice(0,3);
  const mkRows = arr => arr.map(r => `<tr><td title="${esc(r.route)}">${esc(r.route.length>22?r.route.slice(0,22)+'...':r.route)}</td><td style="text-align:right;color:${r.margin>=0?'#22c55e':'#ef4444'}">${fmt(r.margin)}</td><td style="text-align:right">${fmt(r.trips)}</td></tr>`).join('');
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px;">
      <div class="master-mini-kpi" style="border-left:2px solid #22c55e;"><div class="master-mini-kpi-label">ดีสุด</div><div class="master-mini-kpi-value" style="color:#22c55e;font-size:13px">${fmt(rk.top[0]?.margin)}</div><div class="master-mini-kpi-sub" title="${esc(rk.top[0]?.route||'-')}">${esc((rk.top[0]?.route||'-').length>18?(rk.top[0]?.route||'-').slice(0,18)+'...':rk.top[0]?.route||'-')}</div></div>
      <div class="master-mini-kpi" style="border-left:2px solid #ef4444;"><div class="master-mini-kpi-label">ขาดทุนสูงสุด</div><div class="master-mini-kpi-value" style="color:#ef4444;font-size:13px">${fmt(rk.bottom[0]?.margin)}</div><div class="master-mini-kpi-sub" title="${esc(rk.bottom[0]?.route||'-')}">${esc((rk.bottom[0]?.route||'-').length>18?(rk.bottom[0]?.route||'-').slice(0,18)+'...':rk.bottom[0]?.route||'-')}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div>
        <div style="font-size:8px;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">TOP 3 กำไร</div>
        <table class="master-compact-table"><tbody>${mkRows(top3)}</tbody></table>
      </div>
      <div>
        <div style="font-size:8px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">TOP 3 ขาดทุน</div>
        <table class="master-compact-table"><tbody>${mkRows(bot3)}</tbody></table>
      </div>
    </div>
  `;
}

function buildCustomerCard(d) {
  const cp = d.customerProfit;
  const top5 = cp.slice(0,5);
  const maxR = Math.max(...cp.map(c => c.recv), 1);
  return `
    <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">รายได้ Top 5 ลูกค้า</div>
    ${top5.map((c, i) => {
      const w = (c.recv / maxR * 100).toFixed(1);
      const col = COLORS[i % 10];
      return `<div class="master-compact-bar">
        <div class="master-compact-bar-label">${esc(c.name)}</div>
        <div class="master-compact-bar-track"><div class="master-compact-bar-fill" style="width:${w}%;background:${col}">${fmt(c.recv)}</div></div>
      </div>`;
    }).join('')}
    <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 2px;">สรุปลูกค้า</div>
    <table class="master-compact-table">
      <thead><tr><th>ลูกค้า</th><th style="text-align:right">เที่ยว</th><th style="text-align:right">รายได้</th><th style="text-align:right">ส่วนต่าง</th></tr></thead>
      <tbody>${top5.map(c => `<tr><td>${esc(c.name)}</td><td style="text-align:right">${fmt(c.trips)}</td><td style="text-align:right">${fmt(c.recv)}</td><td style="text-align:right;color:${c.margin>=0?'#22c55e':'#ef4444'}">${fmt(c.margin)}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function buildOwnOutCard(d) {
  const { company: co, outsource: ou, companyTripPct, outsourceTripPct } = getSafeOwnOut(d);
  const coP = companyTripPct.toFixed(1);
  const ouP = outsourceTripPct.toFixed(1);
  const totalTrips = (Number(co.trips) || 0) + (Number(ou.trips) || 0);
  const totalRecv = (Number(co.recv) || 0) + (Number(ou.recv) || 0);
  const totalMargin = (Number(co.margin) || 0) + (Number(ou.margin) || 0);
  const coMarginCls = co.margin >= 0 ? 'fleet-pos' : 'fleet-neg';
  const ouMarginCls = ou.margin >= 0 ? 'fleet-pos' : 'fleet-neg';

  return `
    <section class="master-fleet">
      <div class="master-fleet-overview">
        <div class="fleet-overview-head">
          <span class="fleet-overview-title">\u0e2a\u0e31\u0e14\u0e2a\u0e48\u0e27\u0e19\u0e01\u0e32\u0e23\u0e43\u0e0a\u0e49\u0e23\u0e16</span>
          <span class="fleet-overview-total">\u0e23\u0e27\u0e21 ${fmt(totalTrips)} \u0e40\u0e17\u0e35\u0e48\u0e22\u0e27</span>
        </div>
        <div class="fleet-overview-bar">
          <div class="fleet-overview-seg fleet-company" style="width:${coP}%"></div>
          <div class="fleet-overview-seg fleet-outsource" style="width:${ouP}%"></div>
        </div>
        <div class="fleet-overview-legend">
          <span><i class="fleet-dot fleet-company"></i>\u0e23\u0e16\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17 ${coP}%</span>
          <span><i class="fleet-dot fleet-outsource"></i>\u0e23\u0e16\u0e08\u0e49\u0e32\u0e07\u0e20\u0e32\u0e22\u0e19\u0e2d\u0e01 ${ouP}%</span>
        </div>
      </div>

      <div class="master-fleet-grid">
        <div class="master-fleet-card fleet-company">
          <div class="fleet-card-head">
            <h4>\u0e23\u0e16\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17</h4>
            <span class="fleet-share">${coP}%</span>
          </div>
          <div class="fleet-main">${fmt(co.trips)} <small>\u0e40\u0e17\u0e35\u0e48\u0e22\u0e27</small></div>
          <div class="fleet-metrics">
            <div><span>\u0e23\u0e32\u0e22\u0e44\u0e14\u0e49</span><b>${fmt(co.recv)} THB</b></div>
            <div><span>\u0e2a\u0e48\u0e27\u0e19\u0e15\u0e48\u0e32\u0e07</span><b class="${coMarginCls}">${fmt(co.margin)} THB</b></div>
          </div>
        </div>

        <div class="master-fleet-card fleet-outsource">
          <div class="fleet-card-head">
            <h4>\u0e23\u0e16\u0e08\u0e49\u0e32\u0e07\u0e20\u0e32\u0e22\u0e19\u0e2d\u0e01</h4>
            <span class="fleet-share">${ouP}%</span>
          </div>
          <div class="fleet-main">${fmt(ou.trips)} <small>\u0e40\u0e17\u0e35\u0e48\u0e22\u0e27</small></div>
          <div class="fleet-metrics">
            <div><span>\u0e23\u0e32\u0e22\u0e44\u0e14\u0e49</span><b>${fmt(ou.recv)} THB</b></div>
            <div><span>\u0e2a\u0e48\u0e27\u0e19\u0e15\u0e48\u0e32\u0e07</span><b class="${ouMarginCls}">${fmt(ou.margin)} THB</b></div>
          </div>
        </div>
      </div>

      <div class="master-fleet-foot">
        <div class="fleet-foot-kpi"><span>\u0e23\u0e32\u0e22\u0e44\u0e14\u0e49\u0e23\u0e27\u0e21</span><b>${fmt(totalRecv)} THB</b></div>
        <div class="fleet-foot-kpi"><span>\u0e2a\u0e48\u0e27\u0e19\u0e15\u0e48\u0e32\u0e07\u0e23\u0e27\u0e21</span><b class="${totalMargin >= 0 ? 'fleet-pos' : 'fleet-neg'}">${fmt(totalMargin)} THB</b></div>
      </div>
    </section>
  `;
}

function buildLossCard(d) {
  const lt = d.lossTrip;
  if (!lt) return '<div style="text-align:center;color:var(--muted);font-size:11px;padding:20px;">ไม่มีข้อมูลขาดทุน</div>';
  const validMonths = MONTHS.filter(m => lt.byMonth && lt.byMonth[m]);
  const maxL = Math.max(...validMonths.map(m => Math.abs(lt.byMonth[m].loss||0)), 1);
  return `
    <div class="master-grid-2" style="margin-bottom:6px;">
      <div class="master-mini-kpi" style="border-left:2px solid #ef4444;"><div class="master-mini-kpi-label">เที่ยวขาดทุน</div><div class="master-mini-kpi-value" style="color:#ef4444">${fmt(lt.total)}</div></div>
      <div class="master-mini-kpi" style="border-left:2px solid #ef4444;"><div class="master-mini-kpi-label">มูลค่าขาดทุน</div><div class="master-mini-kpi-value" style="color:#ef4444">${fmt(lt.totalLoss)}</div></div>
    </div>
    <div style="font-size:8px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">ขาดทุนรายเดือน</div>
    ${validMonths.map(m => {
      const bm = lt.byMonth[m];
      const w = Math.max(5, (Math.abs(bm.loss||0) / maxL * 100)).toFixed(1);
      return `<div style="margin-bottom:3px;">
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:1px;">
          <span style="color:var(--text);font-weight:600;">${MTH[m]||m}</span>
          <span style="color:#ef4444;font-weight:700;">${fmt(bm.loss)} THB · ${bm.count} เที่ยว</span>
        </div>
        <div class="master-loss-bar-track-compact"><div class="master-loss-bar-fill-compact" style="width:${w}%;background:linear-gradient(90deg,#ef444477,#ef4444);">${bm.count} เที่ยว</div></div>
      </div>`;
    }).join('')}
  `;
}

function buildVehicleCard(d) {
  const vt = d.vehicleType
    .filter(v => (Number(v.share) || 0) >= 0.5)
    .slice()
    .sort((a, b) => (Number(b.trips) || 0) - (Number(a.trips) || 0));
  if (!vt.length) return '<div style="text-align:center;color:var(--muted);font-size:11px;padding:20px;">ไม่มีข้อมูลประเภทรถ</div>';

  const maxT = Math.max(1, ...vt.map(v => Number(v.trips) || 0));
  const lead = vt[0];
  const bestMargin = vt.reduce((b, v) => (Number(v.margin) > Number(b?.margin || -Infinity) ? v : b), vt[0]);

  return `
    <section class="vehperf-card-shell">
      <div class="vehperf-card-summary">
        <div class="vehperf-card-summary-box">
          <span class="vehperf-card-summary-label">ประเภทรถนำสัดส่วน</span>
          <strong class="vehperf-card-summary-value">${esc(lead?.type || '-')}</strong>
          <span class="vehperf-card-summary-sub">${(Number(lead?.share) || 0).toFixed(2)}% ของเที่ยวทั้งหมด</span>
        </div>
        <div class="vehperf-card-summary-box">
          <span class="vehperf-card-summary-label">ทำกำไรสูงสุด</span>
          <strong class="vehperf-card-summary-value">${esc(bestMargin?.type || '-')}</strong>
          <span class="vehperf-card-summary-sub">${fmt(bestMargin?.margin || 0)} THB</span>
        </div>
      </div>

      <div class="vehperf-card-list">
        ${vt.map((v, i) => {
          const col = COLORS[i % 10];
          const barW = Math.max(4, (Number(v.trips) || 0) / maxT * 100).toFixed(1);
          const marginColor = (v.margin || 0) >= 0 ? '#22c55e' : '#ef4444';
          const pctColor = (v.pct || 0) >= 0 ? '#22c55e' : '#ef4444';
          return `
            <article class="vehperf-card-row" style="--veh-color:${col};">
              <div class="vehperf-card-rank">${String(i + 1).padStart(2, '0')}</div>
              <div class="vehperf-card-main">
                <div class="vehperf-card-top">
                  <div>
                    <div class="vehperf-card-type" title="${esc(v.type)}">${esc(v.type)}</div>
                    <div class="vehperf-card-meta">${fmt(v.trips)} เที่ยว</div>
                  </div>
                  <div class="vehperf-card-share">${(Number(v.share)||0).toFixed(2)}%</div>
                </div>
                <div class="vehperf-card-track"><div class="vehperf-card-fill" style="width:${barW}%;"></div></div>
                <div class="vehperf-card-stats">
                  <span><b>ส่วนต่าง</b> <strong style="color:${marginColor};">${fmt(v.margin)}</strong></span>
                  <span><b>/เที่ยว</b> ${fmt(v.avgMargin)}</span>
                  <span><b>กำไร %</b> <strong style="color:${pctColor};">${fmtP(v.pct)}</strong></span>
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>`;
}
function getMasterModalTableConfigs(key, d) {
  if (!d) return [];
  if (key === 'overview') {
    const activeMonths = getActiveMonths(d, 'routeTrend');
    const monthsToShow = activeMonths.length ? activeMonths : MONTHS.filter(m => d.routeTrend.some(r => r.months && r.months[m]));
    const routeRows = d.routeTrend.slice().map(r => {
      const totalTrips = monthsToShow.reduce((sum, month) => sum + (r.months?.[month]?.trips || 0), 0);
      const totalMargin = monthsToShow.reduce((sum, month) => sum + (r.months?.[month]?.margin || 0), 0);
      const row = {
        customer: r.customer || '-',
        vtype: r.vtype || '-',
        route: r.route || '-',
        totalTrips,
        totalMargin
      };
      monthsToShow.forEach(month => { row[`m_${month}`] = r.months?.[month]?.trips || 0; });
      return row;
    }).filter(row => row.totalTrips > 0);
    const routeCols = [
      { key: 'customer', label: 'ลูกค้า' },
      { key: 'vtype', label: 'ประเภทรถ' },
      { key: 'route', label: 'เส้นทาง' },
      { key: 'totalTrips', label: 'เที่ยวรวม', type: 'number', align: 'right', strong: true },
      ...monthsToShow.map(month => ({ key: `m_${month}`, label: `${MTH[month] || month} (เที่ยว)`, type: 'number', align: 'right' })),
      { key: 'totalMargin', label: 'ส่วนต่างรวม', type: 'currency', align: 'right', strong: true, tone: 'sign' }
    ];
    const monthlyRows = monthsToShow.map((month, index) => {
      const dailyStat = getMonthlyStatsFromDaily(d, month);
      const trips = dailyStat ? dailyStat.trips : d.routeTrend.reduce((sum, row) => sum + (row.months?.[month]?.trips || 0), 0);
      const margin = dailyStat ? dailyStat.margin : d.routeTrend.reduce((sum, row) => sum + (row.months?.[month]?.margin || 0), 0);
      const recv = dailyStat ? dailyStat.recv : d.routeTrend.reduce((sum, row) => {
        const monthData = row.months?.[month] || {};
        const recvValue = Number(monthData.recv);
        if (Number.isFinite(recvValue)) return sum + recvValue;
        return sum + (Number(monthData.pay) || 0) + (Number(monthData.oil) || 0) + (Number(monthData.margin) || 0);
      }, 0);
      return {
        order: index,
        month: MTH[month] || month,
        trips,
        recv,
        margin,
        pct: recv > 0 ? (margin / recv) * 100 : null,
        status: margin > 0 ? 'กำไร' : margin < 0 ? 'ขาดทุน' : 'คงที่'
      };
    });
    return [
      {
        id: 'audit-overview-routes',
        csvName: 'overview-top-routes',
        rows: routeRows,
        cols: routeCols,
        filters: [
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'vtype', label: 'ประเภทรถ' }
        ],
        defaultSort: 'totalTrips',
        defaultAsc: false,
        perPage: 10
      },
      {
        id: 'audit-overview-months',
        csvName: 'overview-monthly-summary',
        rows: monthlyRows,
        cols: [
          { key: 'month', label: 'เดือน', strong: true, sortValue: row => row.order, noFilter: true },
          { key: 'trips', label: 'จำนวนเที่ยว', type: 'number', align: 'right', noFilter: true },
          { key: 'recv', label: 'ราคารับรวม', type: 'currency', align: 'right', noFilter: true },
          { key: 'margin', label: 'ส่วนต่างรวม', type: 'currency', align: 'right', strong: true, tone: 'sign' },
          { key: 'pct', label: 'กำไร %', type: 'percent', align: 'right', tone: 'sign' },
          { key: 'status', label: 'สถานะ' }
        ],
        filters: [{ key: 'status', label: 'สถานะ' }],
        defaultSort: 'month',
        defaultAsc: true,
        perPage: 12
      }
    ];
  }
  if (key === 'ranking') {
    const topSource = Array.isArray(d.routeRanking?.top) ? d.routeRanking.top : [];
    const bottomSource = Array.isArray(d.routeRanking?.bottom) ? d.routeRanking.bottom : [];
    const topSorted = topSource.slice().sort((a, b) => (Number(b.margin) || 0) - (Number(a.margin) || 0));
    const bottomSorted = bottomSource.slice().sort((a, b) => (Number(a.margin) || 0) - (Number(b.margin) || 0));
    const normalizeRankRow = (row, rank, group) => ({
      rank,
      group,
      customer: row.customer || '-',
      route: row.route || '-',
      trips: Number(row.trips) || 0,
      margin: Number(row.margin) || 0,
      avgMargin: Number(row.avgMargin) || 0,
      pct: Number(row.pct) || 0
    });
    return [
      {
        id: 'audit-ranking-top',
        csvName: 'ranking-top-profit-routes',
        rows: topSorted.slice(0, 10).map((row, idx) => normalizeRankRow(row, idx + 1, 'กำไร')),
        cols: [
          { key: 'rank', label: 'อันดับ', type: 'integer', align: 'right', strong: true, noFilter: true },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'route', label: 'เส้นทาง' },
          { key: 'trips', label: 'เที่ยว', type: 'number', align: 'right' },
          { key: 'margin', label: 'ส่วนต่างรวม', type: 'currency', align: 'right', strong: true, tone: 'sign' },
          { key: 'avgMargin', label: 'ส่วนต่าง/เที่ยว', type: 'currency', align: 'right', tone: 'sign' },
          { key: 'pct', label: 'กำไร %', type: 'percent', align: 'right', tone: 'sign' }
        ],
        filters: [{ key: 'customer', label: 'ลูกค้า' }],
        defaultSort: 'margin',
        defaultAsc: false,
        perPage: 10
      },
      {
        id: 'audit-ranking-bottom',
        csvName: 'ranking-top-loss-routes',
        rows: bottomSorted.slice(0, 10).map((row, idx) => normalizeRankRow(row, idx + 1, 'ขาดทุน')),
        cols: [
          { key: 'rank', label: 'อันดับ', type: 'integer', align: 'right', strong: true, noFilter: true },
          { key: 'customer', label: 'ลูกค้า' },
          { key: 'route', label: 'เส้นทาง' },
          { key: 'trips', label: 'เที่ยว', type: 'number', align: 'right' },
          { key: 'margin', label: 'ส่วนต่างรวม', type: 'currency', align: 'right', strong: true, tone: 'sign' },
          { key: 'avgMargin', label: 'ส่วนต่าง/เที่ยว', type: 'currency', align: 'right', tone: 'sign' },
          { key: 'pct', label: 'กำไร %', type: 'percent', align: 'right', tone: 'sign' }
        ],
        filters: [{ key: 'customer', label: 'ลูกค้า' }],
        defaultSort: 'margin',
        defaultAsc: true,
        perPage: 10
      }
    ];
  }
  if (key === 'customer') {
    const rows = d.customerProfit.map(row => ({
      customer: row.name || '-',
      trips: Number(row.trips) || 0,
      recv: Number(row.recv) || 0,
      margin: Number(row.margin) || 0,
      pct: Number(row.pct) || 0,
      loss: Number(row.loss) || 0,
      oil: Number(row.oil) || 0,
      status: Number(row.margin) > 0 ? 'กำไร' : Number(row.margin) < 0 ? 'ขาดทุน' : 'คงที่'
    }));
    return [{
      id: 'audit-customer-profit',
      csvName: 'customer-profitability',
      rows,
      cols: [
        { key: 'customer', label: 'ลูกค้า', strong: true },
        { key: 'trips', label: 'จำนวนเที่ยว', type: 'number', align: 'right', noFilter: true },
        { key: 'recv', label: 'ราคารับ', type: 'currency', align: 'right', noFilter: true },
        { key: 'margin', label: 'ส่วนต่าง', type: 'currency', align: 'right', strong: true, tone: 'sign' },
        { key: 'pct', label: 'กำไร %', type: 'percent', align: 'right', tone: 'sign' },
        { key: 'loss', label: 'เที่ยวขาดทุน', type: 'number', align: 'right' },
        { key: 'oil', label: 'สำรองจ่ายน้ำมัน', type: 'currency', align: 'right' },
        { key: 'status', label: 'สถานะ' }
      ],
      filters: [{ key: 'status', label: 'สถานะ' }],
      defaultSort: 'margin',
      defaultAsc: false,
      perPage: 12
    }];
  }
  if (key === 'ownout') {
    const { company, outsource } = getSafeOwnOut(d);
    const mapRows = (rows, ownership) => rows.map(row => ({
      ownership,
      route: row.route || '-',
      trips: Number(row.trips) || 0,
      margin: Number(row.margin) || 0,
      status: Number(row.margin) > 0 ? 'กำไร' : Number(row.margin) < 0 ? 'ขาดทุน' : 'คงที่'
    }));
    const cols = [
      { key: 'route', label: 'เส้นทาง' },
      { key: 'trips', label: 'เที่ยว', type: 'number', align: 'right', noFilter: true },
      { key: 'margin', label: 'ส่วนต่าง', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
      { key: 'status', label: 'สถานะ' }
    ];
    return [
      {
        id: 'audit-ownout-company',
        csvName: 'company-vehicle-routes',
        rows: mapRows(company.topRoutes || [], 'รถบริษัท'),
        cols,
        filters: [{ key: 'status', label: 'สถานะ' }],
        defaultSort: 'trips',
        defaultAsc: false,
        perPage: 10,
        compact: true
      },
      {
        id: 'audit-ownout-outsource',
        csvName: 'outsource-vehicle-routes',
        rows: mapRows(outsource.topRoutes || [], 'รถจ้างภายนอก'),
        cols,
        filters: [{ key: 'status', label: 'สถานะ' }],
        defaultSort: 'trips',
        defaultAsc: false,
        perPage: 10,
        compact: true
      }
    ];
  }
  if (key === 'loss') {
    const lt = d.lossTrip;
    if (!lt) return [];
    const validMonths = MONTHS.filter(month => lt.byMonth && lt.byMonth[month]);
    const monthlyRows = validMonths.map((month, index) => {
      const info = lt.byMonth[month];
      return {
        order: index,
        monthKey: month,
        month: MTH[month] || month,
        count: Number(info.count) || 0,
        loss: Number(info.loss) || 0,
        pct: lt.total > 0 ? ((Number(info.count) || 0) / lt.total) * 100 : null,
        avgLoss: Number(info.count) > 0 ? Math.abs(Number(info.loss) || 0) / Number(info.count) : null
      };
    });
    const custRows = (Array.isArray(lt.byCustomer) ? lt.byCustomer : Object.entries(lt.byCustomer || {}).map(([name, info]) => ({ name, count: info.count, loss: info.loss })))
      .map(row => ({
        name: row.name || '-',
        count: Number(row.count) || 0,
        loss: Number(row.loss) || 0,
        avgLoss: Number(row.count) > 0 ? Math.abs(Number(row.loss) || 0) / Number(row.count) : null
      }));
    const routeRows = (Array.isArray(lt.byRoute) ? lt.byRoute : Object.entries(lt.byRoute || {}).map(([name, info]) => ({ name, count: info.count, loss: info.loss })))
      .map(row => ({
        name: row.name || '-',
        count: Number(row.count) || 0,
        loss: Number(row.loss) || 0,
        avgLoss: Number(row.count) > 0 ? Math.abs(Number(row.loss) || 0) / Number(row.count) : null
      }));
    return [
      {
        id: 'audit-loss-monthly',
        csvName: 'loss-monthly-detail',
        rows: monthlyRows,
        cols: [
          { key: 'month', label: 'เดือน', strong: true, sortValue: row => row.order, noFilter: true },
          { key: 'count', label: 'จำนวนเที่ยวขาดทุน', type: 'number', align: 'right', noFilter: true },
          { key: 'loss', label: 'มูลค่าขาดทุน', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
          { key: 'pct', label: '% ของทั้งหมด', type: 'percent', align: 'right' },
          { key: 'avgLoss', label: 'เฉลี่ย/เที่ยว', type: 'currency', align: 'right' }
        ],
        defaultSort: 'month',
        defaultAsc: true,
        perPage: 12,
        onRowClick: row => window.openLossDrillModal('monthly', row)
      },
      {
        id: 'audit-loss-customer',
        csvName: 'loss-by-customer',
        rows: custRows,
        cols: [
          { key: 'name', label: 'ลูกค้า', strong: true },
          { key: 'count', label: 'จำนวนเที่ยวขาดทุน', type: 'number', align: 'right', noFilter: true },
          { key: 'loss', label: 'มูลค่า', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
          { key: 'avgLoss', label: 'เฉลี่ย/เที่ยว', type: 'currency', align: 'right' }
        ],
        defaultSort: 'loss',
        defaultAsc: true,
        perPage: 10,
        onRowClick: row => window.openLossDrillModal('customer', row)
      },
      {
        id: 'audit-loss-route',
        csvName: 'loss-by-route',
        rows: routeRows,
        cols: [
          { key: 'name', label: 'เส้นทาง', strong: true },
          { key: 'count', label: 'จำนวนเที่ยวขาดทุน', type: 'number', align: 'right', noFilter: true },
          { key: 'loss', label: 'มูลค่า', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
          { key: 'avgLoss', label: 'เฉลี่ย/เที่ยว', type: 'currency', align: 'right' }
        ],
        defaultSort: 'loss',
        defaultAsc: true,
        perPage: 10,
        onRowClick: row => window.openLossDrillModal('route', row)
      }
    ];
  }
  if (key === 'vehicle') {
    const rows = d.vehicleType
      .filter(row => (Number(row.share) || 0) >= 0.5)
      .slice()
      .sort((a, b) => (Number(b.trips) || 0) - (Number(a.trips) || 0))
      .map((row, idx) => ({
        rank: idx + 1,
        type: row.type || '-',
        trips: Number(row.trips) || 0,
        share: Number(row.share) || 0,
        recv: Number(row.recv) || 0,
        margin: Number(row.margin) || 0,
        avgRecv: Number(row.avgRecv) || 0,
        avgMargin: Number(row.avgMargin) || 0,
        pct: Number(row.pct) || 0,
        loss: Number(row.loss) || 0,
        status: Number(row.margin) > 0 ? 'กำไร' : Number(row.margin) < 0 ? 'ขาดทุน' : 'คงที่'
      }));
    return [{
      id: 'audit-vehicle-performance',
      csvName: 'vehicle-type-performance',
      rows,
      cols: [
        { key: 'rank', label: 'อันดับ', type: 'integer', align: 'right', strong: true },
        { key: 'type', label: 'ประเภทรถ', strong: true },
        { key: 'trips', label: 'เที่ยว', type: 'number', align: 'right', noFilter: true },
        { key: 'share', label: 'สัดส่วน %', type: 'percent', align: 'right' },
        { key: 'recv', label: 'รายได้', type: 'currency', align: 'right' },
        { key: 'margin', label: 'ส่วนต่าง', type: 'currency', align: 'right', strong: true, tone: 'sign' },
        { key: 'avgRecv', label: 'รายได้/เที่ยว', type: 'currency', align: 'right' },
        { key: 'avgMargin', label: 'ส่วนต่าง/เที่ยว', type: 'currency', align: 'right', tone: 'sign' },
        { key: 'pct', label: 'กำไร %', type: 'percent', align: 'right', tone: 'sign' },
        { key: 'loss', label: 'เที่ยวขาดทุน', type: 'number', align: 'right' },
        { key: 'status', label: 'สถานะ' }
      ],
      filters: [{ key: 'status', label: 'สถานะ' }],
      defaultSort: 'trips',
      defaultAsc: false,
      perPage: 12
    }];
  }
  return [];
}
function mountMasterModalTables(key, d) {
  getMasterModalTableConfigs(key, d).forEach(config => renderAuditTable(config.id, config));
}
window._masterModalData = {};
window._masterModalBuilders = {};
function openMasterModal(key, title, color) {
  const builder = window._masterModalBuilders[key];
  const contentHtml = builder ? builder(DATA) : (window._masterModalData[key] || '');
  let modal = document.getElementById('masterModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'masterModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);';
    modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;width:95%;max-width:1400px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:modalIn 0.3s ease;">
      <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="width:32px;height:32px;border-radius:8px;background:${color}15;border:1px solid ${color}30;display:flex;align-items:center;justify-content:center;color:${color};font-size:14px;font-weight:800;">${String.fromCharCode(0x25CF)}</div>
        <div style="flex:1;font-size:15px;font-weight:700;color:var(--text);">${esc(title)}</div>
        <button onclick="document.getElementById('masterModal').style.display='none'" style="background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--muted);width:32px;height:32px;cursor:pointer;font-size:16px;line-height:1;transition:all .2s;" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">&times;</button>
      </div>
      <div style="flex:1;overflow:auto;padding:20px;">${contentHtml}</div>
    </div>
  `;
  modal.style.display = 'flex';
  mountMasterModalTables(key, DATA);
}

function buildMasterDashboard(d) {
  const sections = [
    { id: 'overview', title: 'สรุปภาพรวมและดัชนีชี้วัดผลประกอบการหลัก', color: '#3b82f6', builder: buildTrendCard, fullBuilder: buildFullTrend },
    { id: 'ranking', title: 'การจัดลำดับเส้นทางตามผลตอบแทนสุทธิ', color: '#8b5cf6', builder: buildRankingCard, fullBuilder: buildFullRanking },
    { id: 'customer', title: 'อัตราผลตอบแทนและส่วนต่างกำไรรายลูกค้า', color: '#22c55e', builder: buildCustomerCard, fullBuilder: buildFullCustomer },
    { id: 'ownout', title: 'สัดส่วนการใช้รถบริษัทและรถรับจ้างภายนอก', color: '#f59e0b', builder: buildOwnOutCard, fullBuilder: buildFullOwnOut },
    { id: 'loss', title: 'ประสิทธิภาพของกลุ่มเที่ยววิ่งที่มีส่วนต่างขาดทุน', color: '#ef4444', builder: buildLossCard, fullBuilder: buildFullLoss },
    { id: 'vehicle', title: 'ประสิทธิภาพประเภทรถ', color: '#06b6d4', builder: buildVehicleCard, fullBuilder: buildFullVehicle },
  ];

  // Pre-generate full modal content
  window._masterModalData = {};
  window._masterModalBuilders = {};
  sections.forEach(sec => {
    window._masterModalData[sec.id] = sec.fullBuilder(d);
    window._masterModalBuilders[sec.id] = sec.fullBuilder;
  });

  let html = `<div class="master-dashboard-grid">`;
  sections.forEach((sec, i) => {
    const content = sec.builder(d);
    html += `
      <div id="master-${sec.id}" class="master-section">
        <div class="master-section-accent-line" style="background:${sec.color}"></div>
        <div class="master-section-header">
          <div class="master-section-num" style="color:${sec.color};border-color:${sec.color}40;">
            ${String(i + 1).padStart(2, '0')}
          </div>
          <div class="master-section-title-group">
            <div class="master-section-label" style="color:${sec.color};">Section ${i + 1}</div>
            <div class="master-section-title">${sec.title}</div>
          </div>
          <a href="#" class="master-section-viewall" onclick="event.preventDefault();openMasterModal('${sec.id}','${esc(sec.title)}','${sec.color}');">View All &rarr;</a>
        </div>
        <div class="master-section-body">
          ${content}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  // Animation: add visible class after small delay
  setTimeout(() => {
    document.querySelectorAll('.master-section').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 80);
    });
  }, 50);

  return html;
}

/* ─── หน้า Daily Comparison ver 2.0 — Date Range + Cascading Filters + Trip-Level Anomaly ─── */
function buildDailyCompare(data) {
  const fd = typeof FRAUD_DATA !== 'undefined' ? FRAUD_DATA : [];
  const validFd = fd
    .map(canonicalizeTripRow)
    .filter(r =>
      r &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') &&
      Number.isFinite(r.recv) &&
      Number.isFinite(r.pay) &&
      Number.isFinite(r.oil) &&
      Number.isFinite(r.margin)
    );
  const allDates = [...new Set(validFd.map(r => r.date))].sort();
  if (allDates.length === 0) {
    return `
      <div class="dc-card dc-empty">
        <div class="dc-empty-msg">ไม่พบข้อมูลวันที่ที่ใช้งานได้สำหรับการวิเคราะห์</div>
      </div>
    `;
  }
  const custOrder = {
    'FLASH': 0,
    'BEST Express': 1, 'BEST EXPRESS': 1, 'BEST': 1,
    'J&T': 2,
    'KEX': 3,
    'SGT': 4,
    'SPX-FSOC': 5, 'SPX': 5
  };

  let _isSingleMode = false;
  let _viewMode = 'normal';
  const _compareStatusFilters = {
    anomaly: new Set(),
    unmatched_a: new Set(),
    unmatched_b: new Set()
  };
  window.dcSetMode = function(mode) {
    _isSingleMode = mode === 'single';
    const sSingle = document.getElementById('dc_mode_single').style;
    const sCompare = document.getElementById('dc_mode_compare').style;
    sSingle.background = _isSingleMode ? 'linear-gradient(135deg,#3b82f6,#1d4ed8)' : 'transparent';
    sSingle.color = _isSingleMode ? '#fff' : 'var(--muted)';
    sSingle.boxShadow = _isSingleMode ? '0 2px 8px rgba(59,130,246,.4)' : 'none';
    sSingle.fontSize = '12px';
    sSingle.fontWeight = '700';
    sSingle.fontFamily = 'inherit';

    sCompare.background = !_isSingleMode ? 'linear-gradient(135deg,#3b82f6,#1d4ed8)' : 'transparent';
    sCompare.color = !_isSingleMode ? '#fff' : 'var(--muted)';
    sCompare.boxShadow = !_isSingleMode ? '0 2px 8px rgba(59,130,246,.4)' : 'none';
    sCompare.fontSize = '12px';
    sCompare.fontWeight = '700';
    sCompare.fontFamily = 'inherit';
    
    const pb = document.getElementById('dc_period_b_container');
    const vs = document.getElementById('dc_vs_badge');
    if (pb) { pb.style.opacity = _isSingleMode ? '0.2' : '1'; pb.style.pointerEvents = _isSingleMode ? 'none' : 'auto'; }
    if (vs) { vs.style.opacity = _isSingleMode ? '0.2' : '1'; }
    
    if (typeof _viewMode !== 'undefined' && _viewMode !== 'anomaly') {
      _viewMode = 'anomaly'; // Reset filter mode when toggling
    }
    if (typeof window.dcRunCompare === 'function') {
      window.dcRunCompare();
    }
  };

  // โ”€โ”€ Cascading filter options โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€
  const allCustomers = [...new Set(validFd.map(r => r.customer || '-'))].sort();

  // ── rangeStats: รวมข้อมูลจากหลายวัน ───────────────────────────────
  function rangeStats(dateStart, dateEnd, custF, routeF, vtypeF) {
    if (!dateStart || !dateEnd) return null;
    const rows = validFd.filter(r => {
      if (r.date < dateStart || r.date > dateEnd) return false;
      if (Array.isArray(custF) && custF.length > 0 && !custF.includes(r.customer || '-')) return false;
      if (Array.isArray(routeF) && routeF.length > 0 && !routeF.includes(r.route || '-')) return false;
      if (Array.isArray(vtypeF) && vtypeF.length > 0 && !vtypeF.includes(r.vtype || '-')) return false;
      return true;
    });
    if (!rows.length) return null;
    const recv = rows.reduce((s, r) => s + (r.recv || 0), 0);
    const pay = rows.reduce((s, r) => s + (r.pay || 0), 0);
    const oil = rows.reduce((s, r) => s + (r.oil || 0), 0);
    const margin = rows.reduce((s, r) => s + (r.margin || 0), 0);
    const trips = rows.length;
    const pct = recv ? margin / recv * 100 : 0;
    const oilRatio = pay ? oil / pay * 100 : 0;
    const label = dateStart === dateEnd ? dateStart : `${dateStart} → ${dateEnd}`;
    // route breakdown
    const routeMap = {};
    rows.forEach(r => {
      const k = `${r.customer || '-'}|${r.route || '-'}|${r.vtype || '-'}`;
      if (!routeMap[k]) routeMap[k] = { customer: r.customer || '-', route: r.route || '-', vtype: r.vtype || '-', recv: 0, pay: 0, oil: 0, margin: 0, trips: 0 };
      routeMap[k].recv += r.recv || 0; routeMap[k].pay += r.pay || 0; routeMap[k].oil += r.oil || 0; routeMap[k].margin += r.margin || 0; routeMap[k].trips++;
    });
    const routes = Object.values(routeMap)
      .map(v => ({ ...v, pct: v.recv ? v.margin / v.recv * 100 : 0 }))
      .sort((a, b) => b.margin - a.margin);
    return { dateStart, dateEnd, label, recv, pay, oil, margin, trips, pct, oilRatio, routes, rows };
  }

  // ── dcOpenRouteModal — แสดง Modal รายเที่ยวในเส้นทาง ────────────────
  function getOilPriceByDate(dateStr) {
    const op = (typeof OIL_PRICE_DATA !== 'undefined') ? OIL_PRICE_DATA : null;
    if (!op || !op.prices || !dateStr) return null;
    // หาราคาล่าสุดที่มีวัน <= dateStr (ราคามีผลจนถึงวันที่เปลี่ยนครั้งต่อไป)
    const sorted = [...op.prices].sort((a, b) => String(a.period_no).localeCompare(String(b.period_no)));
    let match = null;
    for (const p of sorted) {
      if (p.period_name <= dateStr) { match = p; } else { break; }
    }
    return match ? match.price : null;
  }

  window.dcOpenRouteModal = function (dateStart, dateEnd, routeStr, specificCust, specificVtype) {
    const rows = validFd.filter(r =>
      r.date >= dateStart && r.date <= dateEnd && r.route === routeStr &&
      (!specificCust || r.customer === specificCust) &&
      (!specificVtype || r.vtype === specificVtype)
    );
    if (!rows.length) return;
    const existing = document.getElementById('dc_route_modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'dc_route_modal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    const avgPay = rows.reduce((s, r) => s + (r.pay || 0), 0) / rows.length;
    const avgOil = rows.reduce((s, r) => s + (r.oil || 0), 0) / rows.length;
    const avgRecv = rows.reduce((s, r) => s + (r.recv || 0), 0) / rows.length;
    const colorMap = { red: '#ef4444', orange: '#f97316', purple: '#a855f7', blue: '#3b82f6' };
    const causeTag = (t, c) => `<span style="display:inline-block;margin:1px 2px 1px 0;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:400;background:${colorMap[c] || 'var(--muted)'};color:#fff;white-space:nowrap">${t}</span>`;
    let trs = '', totRcv = 0, totPay = 0, totOil = 0, totMg = 0;
    rows.forEach((r, idx) => {
      const mg = r.margin || 0; const mCls = mg >= 0 ? 'green' : 'red';
      totRcv += r.recv || 0; totPay += r.pay || 0; totOil += r.oil || 0; totMg += mg;
      const causes = [];
      if (mg < 0) { const lp = r.recv > 0 ? Math.abs(mg / r.recv * 100) : 0; causes.push(causeTag(`ขาดทุน ${lp.toFixed(0)}%`, 'red')); }
      if ((r.oil || 0) > (r.pay || 0) * 0.5 && (r.pay || 0) > 0) causes.push(causeTag('สำรองน้ำมัน>50%', 'orange'));
      if (rows.length > 1) {
        if (avgPay > 0 && (r.pay || 0) > avgPay * 1.05) causes.push(causeTag('ราคาจ่ายแพงกว่าค่าเฉลี่ย', 'purple'));
        if (avgOil > 0 && (r.oil || 0) > avgOil * 1.10) causes.push(causeTag('สำรองน้ำมันแพงกว่าค่าเฉลี่ย', 'orange'));
        if (avgRecv > 0 && (r.recv || 0) < avgRecv * 0.95) causes.push(causeTag('ราคารับต่ำกว่าค่าเฉลี่ย', 'blue'));
      }
      const causeCell = causes.length ? `<div class="dc-tags-wrap">${causes.join('')}</div>` : `<span style="color:var(--muted)">-</span>`;
      const oilPrice = getOilPriceByDate(r.date);
      const oilPriceFmt = oilPrice !== null ? fmt(oilPrice) + ' <span style="font-size:10px;color:var(--muted)">บ./ล.</span>' : '<span style="color:var(--muted)">-</span>';
      trs += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:9px 12px;font-weight:400;color:var(--muted)">${idx + 1}</td>
        <td style="padding:9px 12px;font-weight:400">${esc(r.date || '-')}</td>
        <td style="padding:9px 12px;font-weight:400">${esc(r.driver || '-')}</td>
        <td style="padding:9px 12px;font-weight:400;color:var(--muted)">${esc(r.vtype || '-')}</td>
        <td style="padding:9px 12px;font-weight:400;font-family:monospace;color:var(--accent)">${esc(r.plate || '-')}</td>
        <td style="padding:9px 12px;text-align:center;font-weight:400;color:var(--text)">${oilPriceFmt}</td>
        <td style="padding:9px 12px;text-align:right;font-weight:400;color:var(--orange)">${fmt(r.oil)}</td>
        <td style="padding:9px 12px;text-align:right;font-weight:400">${fmt(r.recv)}</td>
        <td style="padding:9px 12px;text-align:right;font-weight:400">${fmt(r.pay)}</td>
        <td style="padding:9px 12px;text-align:right;font-weight:400;color:var(--${mCls})">${fmt(mg)}</td>
        <td style="padding:9px 12px">${causeCell}</td>
      </tr>`;
    });
    const labelRange = dateStart === dateEnd ? dateStart : `${dateStart} → ${dateEnd}`;
    const exportIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="16" height="16" fill="#5985E1" aria-hidden="true"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h120v80H240v400h480v-400H600v-80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm200-240v-447l-64 64-56-57 160-160 160 160-56 57-64-64v447h-80Z"/></svg>';
    const exportBase = encodeURIComponent(`route_${routeStr || 'route'}`);
    modal.innerHTML = `
      <div id="dc_route_capture" data-export-root="1" style="background:var(--card);border:1px solid var(--border);border-radius:16px;max-width:1060px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6)">
        <div style="background:var(--surface);padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-size:16px;font-weight:800;color:var(--accent)">${esc(routeStr)}</div>
              <button type="button" onclick="window.dcExportModalPng('dc_route_capture', '${exportBase}')" title="Export PNG" aria-label="Export PNG"
                style="background:rgba(89,133,225,.10);border:1px solid rgba(89,133,225,.35);color:#dbeafe;width:28px;height:28px;border-radius:7px;cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;transition:all .2s;padding:0"
                onmouseover="this.style.background='rgba(89,133,225,.18)';this.style.borderColor='rgba(89,133,225,.55)'"
                onmouseout="this.style.background='rgba(89,133,225,.10)';this.style.borderColor='rgba(89,133,225,.35)'">${exportIcon}</button>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${labelRange} · ${rows.length} เที่ยว</div>
          </div>
          <button onclick="document.getElementById('dc_route_modal').remove()"
            style="background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:5px 13px;cursor:pointer;font-size:18px;line-height:1">&times;</button>
        </div>
        <div style="padding:20px;overflow-y:auto">
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead style="background:var(--surface);position:sticky;top:0;z-index:2">
                <tr style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px">
                  <th style="padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)">#</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)">วันที่</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)">พขร.</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)">ประเภทรถ</th>
                  <th style="padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)">ทะเบียน</th>
                  <th style="padding:10px 12px;text-align:center;border-bottom:1px solid var(--border)">ราคาน้ำมัน</th>
                  <th style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border)">สำรองน้ำมัน</th>
                  <th style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border)">ราคารับ</th>
                  <th style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border)">ราคาจ่าย</th>
                  <th style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border)">ส่วนต่าง</th>
                  <th style="padding:10px 12px;border-bottom:1px solid var(--border)">ความผิดปกติ</th>
                </tr>
              </thead>
              <tbody>${trs}</tbody>
              <tfoot>
                <tr style="background:rgba(59,130,246,.08);border-top:2px solid rgba(59,130,246,.3)">
                  <td colspan="6" style="padding:11px 12px;font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:.5px">รวม ${rows.length} เที่ยว</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400;color:var(--orange)">${fmt(totOil)}</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400">${fmt(totRcv)}</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400">${fmt(totPay)}</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400;color:var(--${totMg >= 0 ? 'green' : 'red'})">${fmt(totMg)}</td>
                  <td></td>
                </tr>
                <tr style="background:rgba(59,130,246,.05);border-top:1px solid rgba(255,255,255,.06)">
                  <td colspan="6" style="padding:11px 12px;font-weight:400;font-size:11px;text-transform:uppercase;letter-spacing:.5px">เฉลี่ย / เที่ยว</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400;color:var(--orange)">${fmt(Math.round(totOil / rows.length))}</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400">${fmt(Math.round(totRcv / rows.length))}</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400">${fmt(Math.round(totPay / rows.length))}</td>
                  <td style="padding:11px 12px;text-align:right;font-weight:400;color:var(--${totMg >= 0 ? 'green' : 'red'})">${fmt(Math.round(totMg / rows.length))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  };

  // defaults
  const d1def = allDates[allDates.length - 1] || '';
  const d2def = allDates[allDates.length - 2] || allDates[0] || '';

  function fmtDate(d) { if (!d) return ''; return d.split('-').reverse().join('/'); }
  function fmtRange(s, e) { return s === e ? fmtDate(s) : `${fmtDate(s)} – ${fmtDate(e)}`; }

  const SS = 'padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;cursor:pointer';

  const html = `
  <style>
    .dc-date-input {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 12px 9px 34px;
      background: rgba(59,130,246,.06);
      border: 1px solid rgba(59,130,246,.22);
      border-radius: 8px;
      color: var(--text, #f8fafc);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: border-color .2s;
      outline: none;
    }
    .dc-date-input:focus { border-color: #3b82f6; }
    .dc-date-input.period-b {
      background: rgba(99,102,241,.06);
      border-color: rgba(99,102,241,.22);
    }
    .dc-date-input.period-b:focus { border-color: #818cf8; }
    .dc-date-input.period-b:focus { border-color: #818cf8; }
    .dc-ms-btn {
      padding:9px 12px; background:var(--surface); border:1px solid rgba(255,255,255,.08);
      border-radius:8px; color:var(--text); font-size:12.5px; cursor:pointer;
      display:flex; justify-content:space-between; align-items:center; gap:8px;
      transition:all .2s; height:36px; box-sizing:border-box;
    }
    .dc-ms-btn:hover { border-color:rgba(255,255,255,.22); }
    .dc-ms-panel {
      position:absolute; top:100%; left:0; right:0; margin-top:4px;
      background:#1e222d; border:1px solid rgba(255,255,255,.1); border-radius:8px;
      box-shadow:0 8px 30px rgba(0,0,0,.5); z-index:99999; max-height:240px; overflow-y:auto;
      display:none; padding-bottom:6px;
    }
    .dc-ms-panel.show { display:block; }
    .dc-ms-item {
      padding:6px 12px; font-size:12.5px; cursor:pointer; color:var(--text);
      display:flex; align-items:flex-start; gap:8px; transition:background .15s;
    }
    .dc-ms-item:hover { background:rgba(59,130,246,.1); }
    .dc-ms-item input[type="checkbox"] { margin-top:2px; cursor:pointer; accent-color:var(--accent); width:14px; height:14px; flex-shrink:0; }
    .dc-ms-item span { flex:1; word-break:break-word; line-height:1.4; }
    @keyframes dc-vs-pulse {
      0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); transform: scale(1); border-color: rgba(255,255,255,.08); }
      50% { box-shadow: 0 0 12px 2px rgba(99, 102, 241, 0.3); transform: scale(1.08); border-color: rgba(99, 102, 241, 0.6); }
      100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); transform: scale(1); border-color: rgba(255,255,255,.08); }
    }
    @keyframes dc-vs-text {
      0% { color: #475569; }
      50% { color: #818cf8; }
      100% { color: #475569; }
    }
    .dc-vs-animate {
      animation: dc-vs-pulse 2.5s infinite ease-in-out;
    }
    .dc-vs-animate span {
      animation: dc-vs-text 2.5s infinite ease-in-out;
    }
    @keyframes dc-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
  <div class="master-section" style="margin-bottom:20px;z-index:10">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.18);">

      <!-- Row 1: Period Comparison -->
      <div style="padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">

        <!-- Period A -->
        <div style="flex:1;min-width:200px">
          <div style="position:relative">
            <svg style="position:absolute;left:11px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.45" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <input type="text" id="dc_rangeA" class="dc-date-input" placeholder="เลือกช่วงวันที่...">
          </div>
        </div>

        <!-- VS Badge -->
        <div id="dc_vs_badge" style="display:flex;align-items:center;justify-content:center;transition:opacity .2s">
          <div class="dc-vs-animate" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.025);display:flex;align-items:center;justify-content:center">
            <span style="font-size:8px;font-weight:800;color:#475569">VS</span>
          </div>
        </div>

        <!-- Period B -->
        <div id="dc_period_b_container" style="flex:1;min-width:200px;transition:opacity .2s">
          <div style="position:relative">
            <svg style="position:absolute;left:11px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.45" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <input type="text" id="dc_rangeB" class="dc-date-input period-b" placeholder="เลือกช่วงวันที่...">
          </div>
        </div>

        <!-- Vertical Separator -->
        <div style="width:1px;height:36px;background:rgba(255,255,255,.07);margin:0 12px 1px"></div>

      </div>

      <!-- Row 2: Filters -->
      <div style="border-top:1px solid rgba(255,255,255,.05);padding:11px 20px;display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:12px;align-items:end">

        <div style="position:relative;z-index:50">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#475569;margin-bottom:5px">ลูกค้า</div>
          <div id="ms_btn_cust" class="dc-ms-btn" onclick="dcToggleMs('cust',event)">
            <span id="ms_lbl_cust" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">ทั้งหมด</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div id="ms_pnl_cust" class="dc-ms-panel"></div>
        </div>

        <div style="position:relative;z-index:50">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#475569;margin-bottom:5px">เส้นทาง</div>
          <div id="ms_btn_route" class="dc-ms-btn" onclick="dcToggleMs('route',event)">
            <span id="ms_lbl_route" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">ทั้งหมด</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div id="ms_pnl_route" class="dc-ms-panel"></div>
        </div>

        <div style="position:relative;z-index:50">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#475569;margin-bottom:5px">ประเภทรถ</div>
          <div id="ms_btn_vtype" class="dc-ms-btn" onclick="dcToggleMs('vtype',event)">
            <span id="ms_lbl_vtype" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">ทั้งหมด</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div id="ms_pnl_vtype" class="dc-ms-panel"></div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;padding-bottom:1px">
          <div style="display:flex;background:rgba(0,0,0,.2);border-radius:8px;padding:3px;border:1px solid rgba(255,255,255,.05)">
            <button id="dc_mode_single" onclick="dcSetMode('single')"
              style="padding:8px 14px;background:transparent;color:var(--muted);border:none;border-radius:6px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s">
              มุมมองปกติ
            </button>
            <button id="dc_mode_compare" onclick="dcSetMode('compare')"
              style="padding:8px 14px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;border:none;border-radius:6px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s">
              เปรียบเทียบ
            </button>
          </div>
          <button id="dc_check_btn" onclick="dcRunCompare()"
            style="padding:8px 24px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;box-shadow:0 3px 12px rgba(16,185,129,.4);letter-spacing:.3px;transition:all .2s;display:flex;align-items:center;gap:8px"
            onmouseover="this.style.boxShadow='0 5px 18px rgba(16,185,129,.5)';this.style.transform='translateY(-1px)'"
            onmouseout="this.style.boxShadow='0 3px 12px rgba(16,185,129,.4)';this.style.transform='translateY(0)'">
            <span id="dc_check_text">ตรวจสอบ</span>
            <svg id="dc_check_spin" style="display:none;width:14px;height:14px;animation:dc-spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          </button>
          <button id="dc_export_btn" onclick="dcExportXls()"
            style="padding:8px 18px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;box-shadow:0 3px 12px rgba(99,102,241,.4);letter-spacing:.3px;transition:all .2s;display:flex;align-items:center;gap:6px"
            onmouseover="this.style.boxShadow='0 5px 18px rgba(99,102,241,.5)';this.style.transform='translateY(-1px)'"
            onmouseout="this.style.boxShadow='0 3px 12px rgba(99,102,241,.4)';this.style.transform='translateY(0)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export XLSX
          </button>
          <button onclick="dcClearFilters()"
            style="padding:8px 14px;background:transparent;border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#475569;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s"
            onmouseover="this.style.borderColor='rgba(239,68,68,.5)';this.style.color='#ef4444';this.style.background='rgba(239,68,68,.05)'"
            onmouseout="this.style.borderColor='rgba(255,255,255,.08)';this.style.color='#475569';this.style.background='transparent'">
            ล้างตัวกรอง
          </button>
        </div>
      </div>

    </div>
  </div>
  <div id="dc_result" class="master-section"></div>
  `;



  setTimeout(() => {
    let _stA = null, _stB = null, _labelA = '', _labelB = '';
    let _compareRunToken = 0;

    // โ”€โ”€ Initialize Flatpickr โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€
    if (typeof flatpickr !== 'undefined') {
      const fpOpts = {
        mode: "range",
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        locale: "th",
        allowInput: false,
        onClose: () => {
          if (typeof window.dcUpdateFilters === 'function') window.dcUpdateFilters(false);
        }
      };
      // flatpickr automatically applies the original input's class to the altInput
      flatpickr("#dc_rangeA", { ...fpOpts, defaultDate: [d1def, d1def], altInputClass: "dc-date-input" });
      flatpickr("#dc_rangeB", { ...fpOpts, defaultDate: [d2def, d2def], altInputClass: "dc-date-input period-b" });
    }

    function getRangeDates(id, defStart, defEnd) {
      const el = document.getElementById(id);
      if (el && el._flatpickr && el._flatpickr.selectedDates.length > 0) {
        const dts = el._flatpickr.selectedDates;
        const s = flatpickr.formatDate(dts[0], "Y-m-d");
        const e = dts.length > 1 ? flatpickr.formatDate(dts[1], "Y-m-d") : s;
        return [s, e];
      }
      return [defStart, defEnd];
    }

    // โ”€โ”€ Multi-select UI Logic (Portal Pattern) โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€
    function closeMsPanel(id) {
      const panel = document.getElementById('ms_pnl_' + id);
      if (!panel) return;
      panel.classList.remove('show');
      if (panel._portal) {
        panel._portal = false;
        panel.style.position = '';
        panel.style.top = '';
        panel.style.left = '';
        panel.style.width = '';
        panel.style.right = '';
        panel.style.marginTop = '';
        if (panel._origParent) panel._origParent.appendChild(panel);
      }
    }

    window.dcToggleMs = function (id, e) {
      if (e) e.stopPropagation();
      const targetPanel = document.getElementById('ms_pnl_' + id);
      if (!targetPanel) return;

      // Close others
      ['cust', 'route', 'vtype'].forEach(x => {
        if (x !== id) closeMsPanel(x);
      });

      if (targetPanel.classList.contains('show')) {
        closeMsPanel(id);
        return;
      }

      // Open with portal: move panel to body-level to escape stacking contexts
      const btn = document.getElementById('ms_btn_' + id);
      if (btn) {
        if (!targetPanel._origParent) targetPanel._origParent = targetPanel.parentElement;
        document.body.appendChild(targetPanel);
        targetPanel._portal = true;
        const rect = btn.getBoundingClientRect();
        targetPanel.style.position = 'fixed';
        targetPanel.style.top = (rect.bottom + 4) + 'px';
        targetPanel.style.left = rect.left + 'px';
        targetPanel.style.width = rect.width + 'px';
        targetPanel.style.right = 'auto';
        targetPanel.style.marginTop = '0';
      }
      targetPanel.classList.add('show');
    };
    if (!window.__dcGlobalClickBound) {
      document.addEventListener('click', e => {
        if (!e.target.closest('.dc-ms-btn') && !e.target.closest('.dc-ms-panel')) {
          ['cust', 'route', 'vtype'].forEach(x => closeMsPanel(x));
        }
      });
      window.__dcGlobalClickBound = true;
    }

    function getMsValues(id) {
      const cbs = document.querySelectorAll(`#ms_pnl_${id} input[type="checkbox"]:not([value="_ALL_"]):checked`);
      return Array.from(cbs).map(cb => cb.value);
    }

    window.dcMsToggleAll = function (id) {
      const pnl = document.getElementById('ms_pnl_' + id);
      const allCb = pnl.querySelector('#ms_all_' + id);
      const total = pnl.querySelectorAll('input[type="checkbox"]:not([value="_ALL_"])').length;
      if (allCb.checked) {
        // Clear all individual checkboxes -> "เลือกทั้งหมด" state
        pnl.querySelectorAll('input[type="checkbox"]:not([value="_ALL_"])').forEach(cb => cb.checked = false);
      } else {
        // Check all individual checkboxes -> "เลือกทั้งหมด" visual equivalent
        pnl.querySelectorAll('input[type="checkbox"]:not([value="_ALL_"])').forEach(cb => cb.checked = true);
      }
      dcMsChange(id, true);
    };

    window.dcMsChange = function (id, fromToggleAll = false) {
      const pnl = document.getElementById('ms_pnl_' + id);
      if (!pnl) return;
      const allCb = pnl.querySelector('#ms_all_' + id);
      const total = pnl.querySelectorAll('input[type="checkbox"]:not([value="_ALL_"])').length;
      const checked = pnl.querySelectorAll('input[type="checkbox"]:not([value="_ALL_"]):checked');

      let vals = Array.from(checked).map(cb => cb.value);

      if (!fromToggleAll && allCb) {
        if (vals.length === 0) {
          allCb.checked = true;
        } else if (vals.length === total) {
          allCb.checked = true;
          // Keep individual checkboxes checked; label will show "ทั้งหมด"
        } else {
          allCb.checked = false;
        }
      }

      const lbl = document.getElementById('ms_lbl_' + id);
      if (lbl) {
        if (vals.length === 0 || vals.length === total) lbl.textContent = 'ทั้งหมด';
        else if (vals.length === 1) lbl.textContent = vals[0];
        else lbl.textContent = `เลือก ${vals.length} รายการ`;
      }
      dcUpdateFilters(false);
    };

    window.dcMsSearch = function(id, query) {
      const pnl = document.getElementById('ms_items_' + id);
      if (!pnl) return;
      const q = query.toLowerCase().trim();
      const labels = pnl.querySelectorAll('.dc-ms-item');
      labels.forEach(lbl => {
        const val = lbl.getAttribute('data-ms-val') || '';
        if (q === '' || val.includes(q)) {
          lbl.style.display = 'flex';
        } else {
          lbl.style.display = 'none';
        }
      });
    };

    function buildMsOptions(id, options, currentVals = []) {
      const pnl = document.getElementById('ms_pnl_' + id);
      if (!pnl) return;
      if (options.length === 0) {
        pnl.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:12px;text-align:center">ไม่มีข้อมูล</div>';
        return;
      }
      const validVals = currentVals.filter(v => options.includes(v));
      const allChecked = validVals.length === 0 || validVals.length === options.length;

      pnl.innerHTML = `
        <div style="position:sticky;top:0;background:#1e222d;z-index:10;border-bottom:1px solid rgba(255,255,255,.05);padding-bottom:8px;margin-bottom:4px;padding-top:6px;">
          <div style="padding:4px 8px 8px 8px;">
            <input type="text" id="ms_search_${id}" placeholder="ค้นหา..." style="width:100%;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;outline:none;" oninput="dcMsSearch('${id}', this.value)" onclick="event.stopPropagation()">
          </div>
          <label class="dc-ms-item">
            <input type="checkbox" id="ms_all_${id}" value="_ALL_" onchange="dcMsToggleAll('${id}')" ${allChecked ? 'checked' : ''}>
            <span style="font-weight:700;color:var(--accent)">เลือกทั้งหมด</span>
          </label>
        </div>
        <div id="ms_items_${id}">
      ` + options.map(o => `
        <label class="dc-ms-item" data-ms-val="${esc(o).toLowerCase()}" style="display:flex;">
          <input type="checkbox" value="${esc(o)}" onchange="dcMsChange('${id}')" ${validVals.includes(o) ? 'checked' : ''}>
          <span>${esc(o)}</span>
        </label>
      `).join('') + `</div>`;
    }

    function getFilters() {
      return { custF: getMsValues('cust'), routeF: getMsValues('route'), vtypeF: getMsValues('vtype') };
    }

    // โ”€โ”€ Cascading filter updater โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€โ”€
    window.dcUpdateFilters = function (runNow) {
      const { custF, routeF, vtypeF } = getFilters();
      const [a1, a2] = getRangeDates('dc_rangeA', d1def, d1def);
      const [b1, b2] = getRangeDates('dc_rangeB', d2def, d2def);

      const allRows = validFd.filter(r => {
        const inA = r.date >= a1 && r.date <= a2;
        const inB = b1 && r.date >= b1 && r.date <= b2;
        if (!inA && !inB) return false;
        if (custF.length > 0 && !custF.includes(r.customer || '-')) return false;
        return true;
      });

      // Don't rebuild panels that are currently open to avoid destroying the DOM while user is interacting
      const routePanelOpen = document.getElementById('ms_pnl_route')?.classList.contains('show');
      const vtypePanelOpen = document.getElementById('ms_pnl_vtype')?.classList.contains('show');

      if (!routePanelOpen) {
        const routeOptions = [...new Set(allRows.map(r => r.route || '-'))].sort();
        buildMsOptions('route', routeOptions, routeF);
      }

      if (!vtypePanelOpen) {
        const vtypeOptions = [...new Set(allRows.filter(r => routeF.length === 0 || routeF.includes(r.route || '-')).map(r => r.vtype || '-'))].sort();
        buildMsOptions('vtype', vtypeOptions, vtypeF);
      }

      if (runNow) dcRunCompare();
    };

    window.dcClearFilters = function () {
      ['cust', 'route', 'vtype'].forEach(id => {
        closeMsPanel(id);
        document.querySelectorAll(`#ms_pnl_${id} input[type="checkbox"]`).forEach(cb => cb.checked = false);
        const lbl = document.getElementById('ms_lbl_' + id);
        if (lbl) lbl.textContent = 'ทั้งหมด';
      });
      dcUpdateFilters(false);
    };

    // Initial cascade populate
    buildMsOptions('cust', allCustomers, []);
    dcUpdateFilters(false);

    window.dcRunCompare = function runCompare() {
      const runToken = ++_compareRunToken;
      const btn = document.getElementById('dc_check_btn');
      const txt = document.getElementById('dc_check_text');
      const spin = document.getElementById('dc_check_spin');
      if (btn) { btn.style.pointerEvents = 'none'; btn.style.opacity = '0.7'; }
      if (txt) txt.textContent = 'กำลังตรวจสอบ...';
      if (spin) spin.style.display = 'block';

      setTimeout(() => {
        if (runToken !== _compareRunToken) return;
        const [a1, a2] = getRangeDates('dc_rangeA', d1def, d1def);
        const [b1, b2] = getRangeDates('dc_rangeB', d2def, d2def);
        const { custF, routeF, vtypeF } = getFilters();
        _stA = rangeStats(a1, a2, custF, routeF, vtypeF);
        _stB = rangeStats(b1, b2, custF, routeF, vtypeF);
        _labelA = fmtRange(a1, a2 || a1);
        _labelB = fmtRange(b1, b2 || b1);
        _viewMode = 'anomaly';
        renderAll();

        if (btn) { btn.style.pointerEvents = ''; btn.style.opacity = ''; }
        if (txt) txt.textContent = 'ตรวจสอบ';
        if (spin) spin.style.display = 'none';
      }, 400);
    }




    let _renderMemo = { key: '', html: '' };
    const _debounceMap = {};
    function debounceByKey(key, fn, wait = 120) {
      if (_debounceMap[key]) clearTimeout(_debounceMap[key]);
      _debounceMap[key] = setTimeout(() => {
        delete _debounceMap[key];
        fn();
      }, wait);
    }
    function renderStateKey() {
      const fAn = Array.from(_compareStatusFilters.anomaly || []).sort().join(',');
      const fUa = Array.from(_compareStatusFilters.unmatched_a || []).sort().join(',');
      const fUb = Array.from(_compareStatusFilters.unmatched_b || []).sort().join(',');
      const stAKey = _stA ? `${_stA.rows?.length || 0}|${_stA.routes?.length || 0}|${_stA.trips || 0}|${_stA.recv || 0}|${_stA.margin || 0}` : 'na';
      const stBKey = _stB ? `${_stB.rows?.length || 0}|${_stB.routes?.length || 0}|${_stB.trips || 0}|${_stB.recv || 0}|${_stB.margin || 0}` : 'nb';
      return [_isSingleMode ? 1 : 0, _viewMode || 'anomaly', _labelA || '', _labelB || '', stAKey, stBKey, fAn, fUa, fUb].join('||');
    }
    function renderAll() {
      const result = document.getElementById('dc_result');
      if (!result) return;
      const stateKey = renderStateKey();
      
      if (_isSingleMode) {
        const cards = `<div style="width:100%;margin:0 0 20px;">${renderCard(_stA, 'a', _labelA)}</div>`;
        const tbl = renderSingleTable(_stA);
        const html = cards + tbl;
        if (_renderMemo.key !== stateKey || _renderMemo.html !== html) {
          result.innerHTML = html;
          _renderMemo = { key: stateKey, html };
        }
        dcAnimateSections();
        return;
      }
      
      const cards = `<div class="dc-compare-grid"><div style="min-width:0">${renderCard(_stA, 'a', _labelA)}</div><div style="min-width:0">${renderCard(_stB, 'b', _labelB)}</div></div>`;
      const diff = renderDiff(_stA, _stB);
      const qfBar = renderQFBarModern();
      let tbl = '';
      if (_viewMode === 'unmatched_a') tbl = renderUnmatchedTable(_stA, _stB, 'a');
      else if (_viewMode === 'unmatched_b') tbl = renderUnmatchedTable(_stA, _stB, 'b');
      else tbl = renderAnomalyTable(_stA, _stB);
      const html = cards + diff + qfBar + tbl;
      if (_renderMemo.key !== stateKey || _renderMemo.html !== html) {
        result.innerHTML = html;
        _renderMemo = { key: stateKey, html };
      }
      bindQFEvents();
      dcAnimateSections();
    }

    function dcAnimateSections() {
      document.querySelectorAll('.master-section').forEach((el, i) => {
        el.classList.remove('visible');
        void el.offsetWidth; // force reflow
        setTimeout(() => el.classList.add('visible'), i * 80);
      });
    }
    
    function renderSingleTable(stA) {
      if (!stA || !stA.routes || stA.routes.length === 0) {
        return `<div class="dc-card dc-empty"><div class="dc-empty-msg">ไม่มีข้อมูลสำหรับช่วงเวลาที่เลือก</div></div>`;
      }

      const routes = [...stA.routes].sort((a,b) => {
        const ca = String(a.customer || '').trim().toUpperCase();
        const cb = String(b.customer || '').trim().toUpperCase();
        const pa = custOrder[ca] ?? 999;
        const pb = custOrder[cb] ?? 999;
        if (pa !== pb) return pa - pb;
        return b.margin - a.margin;
      });

      const getAnomalies = (r) => {
        const causes = [];
        const mg = r.margin || 0;
        if (mg < 0) { const lp = r.recv > 0 ? Math.abs(mg / r.recv * 100) : 0; causes.push({ text: `ขาดทุน ${lp.toFixed(0)}%`, color: 'red' }); }
        if ((r.oil || 0) > (r.pay || 0) * 0.5 && (r.pay || 0) > 0) causes.push({ text: 'สำรองน้ำมัน>50%', color: 'orange' });
        
        const rTrips = (stA.rows || []).filter(tr => tr.route === r.route && tr.customer === r.customer && tr.vtype === r.vtype);
        if (rTrips.length > 1) {
          const aPay = rTrips.reduce((s, tr) => s + (tr.pay || 0), 0) / rTrips.length;
          const aOil = rTrips.reduce((s, tr) => s + (tr.oil || 0), 0) / rTrips.length;
          const aRecv = rTrips.reduce((s, tr) => s + (tr.recv || 0), 0) / rTrips.length;
          
          let hPay = false, hOil = false, lRecv = false;
          rTrips.forEach(tr => {
            if (aPay > 0 && (tr.pay || 0) > aPay * 1.05) hPay = true;
            if (aOil > 0 && (tr.oil || 0) > aOil * 1.10) hOil = true;
            if (aRecv > 0 && (tr.recv || 0) < aRecv * 0.95) lRecv = true;
          });
          
          if (hPay) causes.push({ text: 'ราคาจ่ายแพงกว่าค่าเฉลี่ย', color: 'purple' });
          if (hOil) causes.push({ text: 'สำรองน้ำมันแพงกว่าค่าเฉลี่ย', color: 'orange' });
          if (lRecv) causes.push({ text: 'ราคารับต่ำกว่าค่าเฉลี่ย', color: 'blue' });
        }
        
        const priority = { red: 1, orange: 2, purple: 3, blue: 4 };
        causes.sort((a, b) => priority[a.color] - priority[b.color]);
        return causes;
      };

      const grouped = {};
      routes.forEach(r => {
        const c = r.customer || '-';
        if (!grouped[c]) grouped[c] = [];
        grouped[c].push(r);
      });

      const custColors = {
        'FLASH': '#3b82f6',
        'BEST EXPRESS': '#8b5cf6',
        'BEST': '#8b5cf6',
        'J&T': '#f59e0b',
        'KEX': '#10b981',
        'SGT': '#ec4899',
        'SPX-FSOC': '#06b6d4',
        'SPX': '#06b6d4'
      };

      let totalAnomalies = 0;
      const cardsHtml = Object.entries(grouped).map(([cust, custRoutes], cIdx) => {
        const cTrips = custRoutes.reduce((s, r) => s + (r.trips || 0), 0);
        const cRecv  = custRoutes.reduce((s, r) => s + (r.recv || 0), 0);
        const cPay   = custRoutes.reduce((s, r) => s + (r.pay || 0), 0);
        const cOil   = custRoutes.reduce((s, r) => s + (r.oil || 0), 0);
        const cMargin = custRoutes.reduce((s, r) => s + (r.margin || 0), 0);
        const cPct = cRecv > 0 ? (cMargin / cRecv * 100) : 0;

        const anomCount = custRoutes.filter(r => getAnomalies(r).length > 0).length;
        totalAnomalies += anomCount;

        const cColor = custColors[cust.trim().toUpperCase()] || 'var(--accent)';
        const mgCls = cMargin >= 0 ? 'green' : 'red';

        const colorMap = { red: '#ef4444', orange: '#f97316', purple: '#a855f7', blue: '#3b82f6' };
        
        let mappedRoutes = custRoutes.map(r => ({ r, anoms: getAnomalies(r) }));
        mappedRoutes.sort((a, b) => {
          if (a.anoms.length > 0 && b.anoms.length === 0) return -1;
          if (a.anoms.length === 0 && b.anoms.length > 0) return 1;
          return b.r.margin - a.r.margin;
        });

        const uniqueStatuses = new Set();
        mappedRoutes.forEach(({anoms}) => {
          if (anoms.length === 0) uniqueStatuses.add('ปกติ');
          else anoms.forEach(a => uniqueStatuses.add(a.text.includes('ขาดทุน') ? 'ขาดทุน' : a.text));
        });
        const filterOpts = Array.from(uniqueStatuses).map(s => `
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--text)">
            <input type="checkbox" value="${esc(s)}" class="filter-cb-${cIdx}" checked onchange="window.applyCustFilter(${cIdx})" style="accent-color:var(--accent);cursor:pointer;width:12px;height:12px;margin:0">
            ${esc(s)}
          </label>
        `).join('');
        const filterAllHtml = `
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--text);font-weight:400">
            <input type="checkbox" id="filter-cb-all-${cIdx}" checked onchange="window.toggleCustFilterAll(${cIdx}, this.checked)" style="accent-color:var(--accent);cursor:pointer;width:12px;height:12px;margin:0">
            ดูทั้งหมด
          </label>
        `;

        const routeRows = mappedRoutes.map(({ r, anoms }) => {
          const isNormal = anoms.length === 0;
          const statusList = isNormal ? 'ปกติ' : anoms.map(a => a.text.includes('ขาดทุน') ? 'ขาดทุน' : a.text).join(',');
          
          const anomHtml = isNormal
            ? `<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(16,185,129,.15);color:#10b981;font-size:10px;font-weight:400">ปกติ</span>`
            : `<div class="dc-tags-wrap-sm">${anoms.map(a => `<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:400;background:${colorMap[a.color]};color:#fff;white-space:nowrap">${a.text}</span>`).join('')}</div>`;

          const mgClr = r.margin >= 0 ? '#10b981' : '#ef4444';
          const bgHighlight = isNormal ? 'rgba(16, 185, 129, 0.05)' : 'transparent';

          return `<tr class="route-row-cust-${cIdx}" data-status="${esc(statusList)}" style="background:${bgHighlight};border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;transition:all .15s" onmouseover="this.style.background='rgba(59,130,246,.06)'" onmouseout="this.style.background='${bgHighlight}'" onclick="dcOpenRouteModal('${stA.dateStart}','${stA.dateEnd}','${esc(r.route)}','${esc(r.customer)}','${esc(r.vtype)}')">
            <td style="padding:10px 12px;font-size:12px;font-weight:400;color:var(--text);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.route)}">${esc(r.route)}</td>
            <td style="padding:10px 12px;text-align:center;font-size:12px;font-weight:400;color:var(--muted)">${esc(r.vtype || '-')}</td>
            <td style="padding:10px 12px;text-align:center;font-size:12px;font-weight:400">${fmt(r.trips)}</td>
            <td style="padding:10px 12px;text-align:right;font-size:12px;font-weight:400">${fmt(r.recv)}</td>
            <td style="padding:10px 12px;text-align:right;font-size:12px;font-weight:400">${fmt(r.pay)}</td>
            <td style="padding:10px 12px;text-align:right;font-size:12px;font-weight:400;color:var(--orange)">${fmt(r.oil)}</td>
            <td style="padding:10px 12px;text-align:right;font-size:12px;font-weight:400;color:${mgClr}">${fmt(r.margin)}</td>
            <td style="padding:10px 12px;text-align:right;font-size:12px;font-weight:400;color:${mgClr}">${fmtP(r.pct)}</td>
            <td style="padding:10px 12px;min-width:140px">${anomHtml}</td>
          </tr>`;
        }).join('');

        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:20px;box-shadow:0 4px 24px rgba(0,0,0,.18)">
          <div style="padding:18px 20px;background:linear-gradient(135deg,${cColor}12,transparent);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:12px;height:12px;border-radius:50%;background:${cColor};box-shadow:0 0 10px ${cColor}50"></div>
              <div>
                <div style="font-size:16px;font-weight:800;color:var(--text);letter-spacing:.3px">${esc(cust)}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:3px">${custRoutes.length} เส้นทาง · ${cTrips} เที่ยว</div>
              </div>
            </div>
            <div style="display:flex;gap:20px;align-items:center">
              <div style="text-align:right">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">ส่วนต่างรวม</div>
                <div style="font-size:18px;font-weight:800;color:var(--${mgCls});margin-top:2px">${fmt(cMargin)}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">กำไร %</div>
                <div style="font-size:18px;font-weight:800;color:var(--${mgCls});margin-top:2px">${cPct.toFixed(1)}%</div>
              </div>
              ${anomCount > 0 ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:5px 12px;display:flex;align-items:center;gap:6px">
                <span style="width:7px;height:7px;border-radius:50%;background:#ef4444"></span>
                <span style="font-size:12px;font-weight:700;color:#ef4444">${anomCount} ความผิดปกติ</span>
              </div>` : ''}
            </div>
          </div>
          <div style="padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:28px;flex-wrap:wrap;align-items:center">
            <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:600">ราคารับรวม</div><div style="font-size:13px;font-weight:700;color:var(--text);margin-top:3px">${fmt(cRecv)}</div></div>
            <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:600">ราคาจ่ายรวม</div><div style="font-size:13px;font-weight:700;color:var(--text);margin-top:3px">${fmt(cPay)}</div></div>
            <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:600">สำรองน้ำมัน</div><div style="font-size:13px;font-weight:700;color:var(--orange);margin-top:3px">${fmt(cOil)}</div></div>
            
            <div style="margin-left:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <span style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">กรองสถานะ:</span>
              <div style="display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.15);padding:6px 12px;border-radius:8px;border:1px solid var(--border)">
                ${filterAllHtml}
                <div style="width:1px;height:12px;background:var(--border)"></div>
                ${filterOpts}
              </div>
            </div>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px;background:var(--surface)">
                  <th style="padding:10px 12px;text-align:left;font-weight:700;border-bottom:1px solid var(--border)">เส้นทาง</th>
                  <th style="padding:10px 12px;text-align:center;font-weight:700;border-bottom:1px solid var(--border)">ประเภทรถ</th>
                  <th style="padding:10px 12px;text-align:center;font-weight:700;border-bottom:1px solid var(--border)">เที่ยว</th>
                  <th style="padding:10px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--border)">ราคารับ</th>
                  <th style="padding:10px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--border)">ราคาจ่าย</th>
                  <th style="padding:10px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--border)">สำรองน้ำมัน</th>
                  <th style="padding:10px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--border)">ส่วนต่าง</th>
                  <th style="padding:10px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--border)">กำไร %</th>
                  <th style="padding:10px 12px;text-align:left;font-weight:700;border-bottom:1px solid var(--border);min-width:140px">สถานะ</th>
                </tr>
              </thead>
              <tbody>${routeRows}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');

      return `<div style="margin-top:28px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <div style="width:4px;height:28px;background:linear-gradient(180deg,#3b82f6,#8b5cf6);border-radius:3px"></div>
          <div style="font-size:17px;font-weight:800;color:var(--text);letter-spacing:.3px">รายงานวิเคราะห์เส้นทางประจำวัน</div>
          <div style="flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)"></div>
          <div style="display:flex;gap:10px;align-items:center">
            ${totalAnomalies > 0 ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:20px;padding:5px 14px;display:flex;align-items:center;gap:6px">
              <span style="width:6px;height:6px;border-radius:50%;background:#ef4444"></span>
              <span style="font-size:11px;font-weight:700;color:#ef4444">พบ ${totalAnomalies} รายการผิดปกติ</span>
            </div>` : ''}
            <div style="font-size:11px;color:var(--muted);background:var(--surface);padding:5px 14px;border-radius:20px;border:1px solid var(--border);font-weight:600">${routes.length} เส้นทาง · ${stA.trips || 0} เที่ยว</div>
          </div>
        </div>
        ${cardsHtml}
      </div>`;
    }

    window.toggleCustFilterAll = function(cIdx, isChecked) {
      const cbs = document.querySelectorAll('.filter-cb-' + cIdx);
      cbs.forEach(cb => cb.checked = isChecked);
      window.applyCustFilter(cIdx, true);
    };

    window.applyCustFilter = function(cIdx, skipAllUpdate) {
      const cbs = document.querySelectorAll('.filter-cb-' + cIdx);
      const activeStatuses = Array.from(cbs).filter(cb => cb.checked).map(cb => cb.value);
      
      if (!skipAllUpdate) {
        const allCb = document.getElementById('filter-cb-all-' + cIdx);
        if (allCb) allCb.checked = (activeStatuses.length === cbs.length);
      }

      const rows = document.querySelectorAll('.route-row-cust-' + cIdx);
      rows.forEach(row => {
        if (activeStatuses.length === 0) {
          row.style.display = 'none';
        } else {
          const stList = row.getAttribute('data-status').split(',');
          const hasMatch = stList.some(s => activeStatuses.includes(s));
          row.style.display = hasMatch ? '' : 'none';
        }
      });
    };

    function getCompareStatusLabelMap() {
      return {
        loss: 'ขาดทุน',
        oil50: 'สำรองน้ำมัน>50%',
        payHigh: 'ราคาจ่ายแพงกว่าเดิม',
        oilHigh: 'สำรองน้ำมันแพงกว่าเดิม',
        recvLow: 'ราคารับต่ำกว่าเดิม',
        normal: 'ปกติ'
      };
    }

    function renderCompareStatusFilter(modeKey, optionKeys, selectedKeys) {
      const labels = getCompareStatusLabelMap();
      const allChecked = selectedKeys.length === optionKeys.length;
      const opts = optionKeys.map(k => `
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--text)">
          <input type="checkbox" value="${k}" class="cmp-filter-cb-${modeKey}" ${selectedKeys.includes(k) ? 'checked' : ''} onchange="window.dcApplyCompareStatusFilter('${modeKey}')" style="accent-color:var(--accent);cursor:pointer;width:12px;height:12px;margin:0">
          ${labels[k] || k}
        </label>
      `).join('');
      return `
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">กรองสถานะ:</span>
          <div style="display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.15);padding:6px 12px;border-radius:8px;border:1px solid var(--border);flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--text);font-weight:400">
              <input type="checkbox" id="cmp-filter-all-${modeKey}" ${allChecked ? 'checked' : ''} onchange="window.dcToggleCompareStatusAll('${modeKey}', this.checked)" style="accent-color:var(--accent);cursor:pointer;width:12px;height:12px;margin:0">
              ดูทั้งหมด
            </label>
            <div style="width:1px;height:12px;background:var(--border)"></div>
            ${opts}
          </div>
        </div>
      `;
    }

    function getSelectedCompareStatuses(modeKey, optionKeys) {
      const current = _compareStatusFilters[modeKey] ? Array.from(_compareStatusFilters[modeKey]) : [];
      const filtered = current.filter(v => optionKeys.includes(v));
      if (filtered.length === 0) return [...optionKeys];
      return filtered;
    }

    window.dcToggleCompareStatusAll = function(modeKey, isChecked) {
      const cbs = document.querySelectorAll('.cmp-filter-cb-' + modeKey);
      cbs.forEach(cb => cb.checked = isChecked);
      window.dcApplyCompareStatusFilter(modeKey, true);
    };

    window.dcApplyCompareStatusFilter = function(modeKey, fromToggleAll) {
      const cbs = document.querySelectorAll('.cmp-filter-cb-' + modeKey);
      const checked = Array.from(cbs).filter(cb => cb.checked).map(cb => cb.value);
      _compareStatusFilters[modeKey] = new Set(checked);
      const allCb = document.getElementById('cmp-filter-all-' + modeKey);
      if (allCb && !fromToggleAll) allCb.checked = checked.length === cbs.length;
      debounceByKey('dcApplyCompareStatusFilter:' + modeKey, () => renderAll(), 120);
    };

    function renderQFBar() {
      const btn = 'border:none;border-radius:20px;padding:8px 18px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .2s;';
      const aA = _viewMode === 'anomaly' ? 'background:#ef4444;color:#fff;box-shadow:0 4px 14px rgba(239,68,68,.4);' : 'background:rgba(255,255,255,.06);color:var(--muted);';
      const aUA = _viewMode === 'unmatched_a' ? 'background:#ef4444;color:#fff;box-shadow:0 4px 14px rgba(239,68,68,.4);' : 'background:rgba(255,255,255,.06);color:var(--muted);';
      const aUB = _viewMode === 'unmatched_b' ? 'background:#ef4444;color:#fff;box-shadow:0 4px 14px rgba(239,68,68,.4);' : 'background:rgba(255,255,255,.06);color:var(--muted);';
      return `<div style="display:flex;flex-direction:column;gap:12px;margin:16px 0;background:var(--card);padding:16px;border-radius:12px;border:1px solid var(--border);">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:-4px;">Quick Filter:</div>
        <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start;flex-wrap:wrap;">
          <button id="qf_anomaly" style="${btn}${aA}">ตรวจหาความผิดปกติรายเส้นทาง</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start;flex-wrap:wrap;">
          <button id="qf_unmatched_a" style="${btn}${aUA}">ตรวจหาความผิดปกติรายเส้นทาง (รายเส้นทางที่ไม่ถูกเปรียบเทียบ : ${_labelA})</button>
          <button id="qf_unmatched_b" style="${btn}${aUB}">ตรวจหาความผิดปกติรายเส้นทาง (รายเส้นทางที่ไม่ถูกเปรียบเทียบ : ${_labelB})</button>
        </div>
      </div>`;
    }

    function renderQFBarModern() {
      const isAnomaly = _viewMode === 'anomaly';
      const isUnmatchedA = _viewMode === 'unmatched_a';
      const isUnmatchedB = _viewMode === 'unmatched_b';
      return `<section class="dc-qf-panel">
        <div class="dc-qf-head">
          <div class="dc-qf-title-wrap">
            <span class="dc-qf-kicker">Quick Filter</span>
            <h3 class="dc-qf-title">ตรวจสอบความผิดปกติและรายการที่ไม่ถูกเปรียบเทียบ</h3>
          </div>
        </div>
        <div class="dc-qf-grid">
          <button id="qf_anomaly" class="dc-qf-btn${isAnomaly ? ' active' : ''}">
            <span class="dc-qf-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l8.5 15h-17L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
            </span>
            <span class="dc-qf-content">
              <span class="dc-qf-label">ตรวจหาความผิดปกติรายเส้นทาง</span>
              <span class="dc-qf-sub">แสดงเส้นทางที่มีสัญญาณผิดปกติจากข้อมูลเปรียบเทียบทั้งสองช่วง</span>
            </span>
          </button>
          <button id="qf_unmatched_a" class="dc-qf-btn${isUnmatchedA ? ' active' : ''}">
            <span class="dc-qf-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l8.5 15h-17L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
            </span>
            <span class="dc-qf-content">
              <span class="dc-qf-label">รายเส้นทางที่ไม่ถูกเปรียบเทียบ: ${esc(_labelA)}</span>
              <span class="dc-qf-sub">พบเฉพาะช่วงแรก และไม่มีคู่เปรียบเทียบในอีกช่วงเวลา</span>
            </span>
          </button>
          <button id="qf_unmatched_b" class="dc-qf-btn${isUnmatchedB ? ' active' : ''}">
            <span class="dc-qf-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3l8.5 15h-17L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>
            </span>
            <span class="dc-qf-content">
              <span class="dc-qf-label">รายเส้นทางที่ไม่ถูกเปรียบเทียบ: ${esc(_labelB)}</span>
              <span class="dc-qf-sub">พบเฉพาะช่วงหลัง และไม่มีคู่เปรียบเทียบจากช่วงก่อนหน้า</span>
            </span>
          </button>
        </div>
      </section>`;
    }

    function bindQFEvents() {
      document.getElementById('qf_anomaly')?.addEventListener('click', () => { _viewMode = 'anomaly'; renderAll(); });
      document.getElementById('qf_unmatched_a')?.addEventListener('click', () => { _viewMode = 'unmatched_a'; renderAll(); });
      document.getElementById('qf_unmatched_b')?.addEventListener('click', () => { _viewMode = 'unmatched_b'; renderAll(); });
    }

    function renderCard(st, side, label) {
      if (!st) return `<div class="dc-card dc-empty"><div class="dc-empty-msg">ไม่มีข้อมูล</div></div>`;
      const pctCls = st.pct >= 0 ? 'green' : 'red';
      const { custF, vtypeF } = getFilters();
      const sortedRoutes = [...st.routes].sort((a,b) => {
        const ca = String(a.customer || '').trim().toUpperCase();
        const cb = String(b.customer || '').trim().toUpperCase();
        const pa = custOrder[ca] ?? 999;
        const pb = custOrder[cb] ?? 999;
        if (pa !== pb) return pa - pb;
        return b.margin - a.margin;
      });
      const routeRows = sortedRoutes.map(r => {
        const rCls = r.pct >= 0 ? 'tag-green' : 'tag-red';
        const ds = esc(st.dateStart), de = esc(st.dateEnd), ro = esc(r.route);
        return `<tr style="cursor:pointer;transition:background .2s"
          onmouseover="this.style.background='rgba(59,130,246,.08)'" onmouseout="this.style.background=''"
          onclick="if(window.dcOpenRouteModal)window.dcOpenRouteModal('${ds}','${de}','${ro}','${esc(r.customer)}','${esc(r.vtype)}')">
          <td style="padding:6px 8px;color:var(--text)">${esc(r.customer)}</td>
          <td style="padding:6px 8px;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)" title="${ro}">${ro}</td>
          <td style="padding:6px 8px;text-align:center">${r.trips}</td>
          <td style="padding:6px 8px;text-align:right">${fmt(r.recv)}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600;color:${r.margin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(r.margin)}</td>
          <td style="padding:6px 8px;text-align:right"><span class="tag ${rCls}">${r.pct.toFixed(1)}%</span></td>
        </tr>`;
      }).join('');
      return `<div class="dc-card">
        <div class="dc-card-header dc-header-${side}">
          <div class="dc-date-badge">${esc(label || '')}</div>
          <div class="dc-trips-badge">${st.trips} เที่ยว</div>
        </div>
        <div class="dc-metrics">
          <div class="dc-metric"><div class="dc-metric-label">ราคารับรวม</div><div class="dc-metric-value accent">${fmt(st.recv)}</div></div>
          <div class="dc-metric"><div class="dc-metric-label">ราคาจ่ายรวม</div><div class="dc-metric-value">${fmt(st.pay)}</div></div>
          <div class="dc-metric"><div class="dc-metric-label">สำรองน้ำมัน</div><div class="dc-metric-value orange">${fmt(st.oil)}</div></div>
          <div class="dc-metric"><div class="dc-metric-label">ส่วนต่างรวม</div><div class="dc-metric-value ${st.margin >= 0 ? 'green' : 'red'}">${fmt(st.margin)}</div></div>
          <div class="dc-metric dc-metric-wide"><div class="dc-metric-label">กำไร %</div><div class="dc-metric-value ${pctCls}" style="font-size:32px">${st.pct.toFixed(2)}%</div></div>
          <div class="dc-metric dc-metric-wide"><div class="dc-metric-label">สัดส่วนน้ำมัน/ราคาจ่าย</div><div class="dc-metric-value">${st.oilRatio.toFixed(1)}%</div></div>
        </div>
        <div class="dc-route-section">
          <div class="dc-route-title">รายละเอียดตามเส้นทาง</div>
          <div style="overflow-x:hidden;max-height:400px;overflow-y:auto;border-bottom:1px solid var(--border)">
            <table style="width:100%;font-size:12px;border-collapse:collapse">
              <thead style="position:sticky;top:0;z-index:2;background:var(--card)">
                <tr style="color:var(--muted);font-size:10px;text-transform:uppercase">
                  <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid var(--border)">ลูกค้า</th>
                  <th style="padding:6px 8px;text-align:left;font-weight:600;border-bottom:1px solid var(--border)">เส้นทาง</th>
                  <th style="padding:6px 8px;text-align:center;font-weight:600;border-bottom:1px solid var(--border)">เที่ยว</th>
                  <th style="padding:6px 8px;text-align:right;font-weight:600;border-bottom:1px solid var(--border)">ราคารับ</th>
                  <th style="padding:6px 8px;text-align:right;font-weight:600;border-bottom:1px solid var(--border)">ส่วนต่าง</th>
                  <th style="padding:6px 8px;text-align:right;font-weight:600;border-bottom:1px solid var(--border)">กำไร%</th>
                </tr>
              </thead>
              <tbody>${routeRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    }

    function renderDiff(a, b) {
      if (!a || !b) return '';
      const dR = a.recv - b.recv, dP = a.pay - b.pay, dO = a.oil - b.oil, dM = a.margin - b.margin, dPct = a.pct - b.pct, dT = a.trips - b.trips;
      function dc(label, diff, fn, u = '') {
        const up = diff >= 0, cls = up ? 'positive' : 'negative', icon = up ? '▲' : '▼';
        return `<div class="diff-card ${cls}"><div class="diff-wave"></div><span class="diff-label">${label}</span><div class="diff-val"><span class="diff-icon">${icon}</span> ${fn(Math.abs(diff))}${u}</div><div class="diff-bg-bar" style="width:100%"></div></div>`;
      }
      return `<div class="dc-diff-panel">
        <div class="dc-diff-title" style="gap:16px;margin-bottom:24px"><span style="font-size:15px;font-weight:700;color:#d4d4d8;background:rgba(255,255,255,0.06);padding:6px 18px;border-radius:30px">สรุปส่วนต่างผลการดำเนินงาน</span></div>
        <div class="dc-diff-grid">
          ${dc('ราคารับ', dR, fmt)}${dc('ราคาจ่าย', dP, fmt)}${dc('สำรองน้ำมัน', dO, fmt)}
          ${dc('ส่วนต่าง', dM, fmt)}${dc('กำไร %', dPct, v => v.toFixed(2), '%')}${dc('จำนวนเที่ยว', dT, v => v.toFixed(0), ' เที่ยว')}
        </div>
      </div>`;
    }


    function renderAnomalyTable(stA, stB) {
      if (!stA) return '<div style="padding:40px;text-align:center;color:var(--muted)">กรุณาเลือกช่วงเวลาหลัก</div>';
      if (!_isSingleMode && (!stB || !stB.rows || stB.rows.length === 0)) {
        return '<div style="padding:40px;text-align:center;color:var(--muted)">ช่วงเวลาเปรียบเทียบไม่มีข้อมูล กรุณาเลือกวันที่ใหม่ หรือสลับเป็นมุมมองปกติ</div>';
      }
      const isValidDriver = d => d && d.trim() !== '-' && !/^null$/i.test(d.trim()) && !/^nan$/i.test(d.trim());
      const rowsA = (stA.rows || []).filter(r => isValidDriver(r.driver));
      const rowsB = (stB?.rows || []).filter(r => isValidDriver(r.driver));
      const colorMap = { red: '#ef4444', orange: '#f97316', purple: '#a855f7', blue: '#3b82f6', green: '#10b981' };
      const badge = (msg, lvl) => `<span style="display:inline-block;margin:1px 2px 1px 0;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:400;background:${colorMap[lvl] || 'var(--' + lvl + ')'};color:#fff;white-space:nowrap">${msg}</span>`;
      const thA = (t, al = 'right') => `<th style="padding:5px 9px;text-align:${al};font-size:10px;font-weight:700;color:#7dd3c7;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;background:rgba(20,184,166,.16);border-bottom:1px solid var(--border)">${t}</th>`;
      const thB = (t, al = 'right') => `<th style="padding:5px 9px;text-align:${al};font-size:10px;font-weight:700;color:#b8bdfd;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;background:rgba(99,102,241,.18);border-bottom:1px solid var(--border)">${t}</th>`;
      const thSep = `<th style="width:2px;padding:0;background:var(--border);border-bottom:1px solid var(--border)"></th>`;
      const tdSep = `<td style="width:2px;padding:0;background:var(--border)"></td>`;
      // Group by route key
      const groupA = {}, groupB = {};
      rowsA.forEach(r => {
        const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
        if (!groupA[k]) groupA[k] = { customer: r.customer, route: r.route, vtype: r.vtype, trips: [] };
        groupA[k].trips.push(r);
      });
      rowsB.forEach(r => {
        const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
        if (!groupB[k]) groupB[k] = { trips: [] };
        groupB[k].trips.push(r);
      });
      // INNER JOIN on Route Keys
      const commonKeys = Object.keys(groupA).filter(k => groupB[k]);
      let totalAnom = 0, totalRows = 0;
      let cardsData = [];

      commonKeys.forEach(key => {
        const ga = groupA[key], gb = groupB[key];
        const tripsA = ga.trips, tripsB = gb.trips;

        // Inner join by driver
        const norm = d => d ? d.trim().toLowerCase() : '';
        const usedB = new Set(), matched = [];
        tripsA.forEach(ra => {
          const idx = tripsB.findIndex((rb, i) => !usedB.has(i) && norm(rb.driver) === norm(ra.driver));
          if (idx >= 0) { usedB.add(idx); matched.push({ ra, rb: tripsB[idx] }); }
        });

        // Skip route entirely if no matched drivers exist
        if (matched.length === 0) return;

        const anomRows = [];
        matched.forEach(({ ra, rb }) => {
          const shortD = d => {
            if (!d) return '';
            const p = d.split('-');
            if (p.length === 3) {
               const mNames = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
               return `${parseInt(p[2], 10)} ${mNames[parseInt(p[1], 10)-1]} ${p[0].slice(-2)}`;
            }
            return d;
          };
          const dA = shortD(ra.date);
          const dB = shortD(rb.date);

          const flags = [];
          const flagItems = [];
          const statuses = new Set();
          if ((ra.margin || 0) < 0) {
            const lp = ra.recv > 0 ? Math.abs((ra.margin || 0) / ra.recv * 100) : 0;
            flagItems.push({ kind: 'loss', html: badge(`${dA} ขาดทุน ${lp.toFixed(0)}%`, 'red') });
            statuses.add('loss');
          }
          if ((rb.margin || 0) < 0) {
            const lp = rb.recv > 0 ? Math.abs((rb.margin || 0) / rb.recv * 100) : 0;
            flagItems.push({ kind: 'loss', html: badge(`${dB} ขาดทุน ${lp.toFixed(0)}%`, 'red') });
            statuses.add('loss');
          }

          if ((ra.oil || 0) > (ra.pay || 0) * 0.5 && (ra.pay || 0) > 0) {
            flagItems.push({ kind: 'oil50', html: badge(`${dA} สำรองน้ำมัน>50%`, 'orange') });
            statuses.add('oil50');
          }
          if ((rb.oil || 0) > (rb.pay || 0) * 0.5 && (rb.pay || 0) > 0) {
            flagItems.push({ kind: 'oil50', html: badge(`${dB} สำรองน้ำมัน>50%`, 'orange') });
            statuses.add('oil50');
          }

          if (rb.pay > 0 && (ra.pay || 0) > rb.pay * 1.05) {
            flagItems.push({ kind: 'payHigh', html: badge(`${dA} ราคาจ่ายแพงกว่าเดิม`, 'purple') });
            statuses.add('payHigh');
          }
          if (rb.oil > 0 && (ra.oil || 0) > rb.oil * 1.05) {
            flagItems.push({ kind: 'oilHigh', html: badge(`${dA} สำรองน้ำมันแพงกว่าเดิม`, 'orange') });
            statuses.add('oilHigh');
          }
          if (rb.recv > 0 && (ra.recv || 0) < rb.recv * 0.95) {
            flagItems.push({ kind: 'recvLow', html: badge(`${dA} ราคารับต่ำกว่าเดิม`, 'blue') });
            statuses.add('recvLow');
          }

          if (flagItems.length === 0) {
            flags.push(`<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(16,185,129,.15);color:#10b981;font-size:10px;font-weight:400">ปกติ</span>`);
            statuses.add('normal');
          } else {
            // Keep "ขาดทุน ...%" at the end to improve scan order in UI.
            flagItems.sort((a, b) => (a.kind === 'loss') - (b.kind === 'loss'));
            flagItems.forEach(item => flags.push(item.html));
          }
          anomRows.push({ ra, rb, flags, statuses: Array.from(statuses) });
        });

        const anomCount = anomRows.filter(r => r.flags.some(f => !f.includes('ปกติ'))).length;
        totalRows += anomRows.length;
        totalAnom += anomCount;

        // Sort rows within route: Anomalies first, Normal last
        anomRows.sort((a, b) => {
          const aNorm = a.flags.every(f => f.includes('ปกติ'));
          const bNorm = b.flags.every(f => f.includes('ปกติ'));
          if (aNorm && !bNorm) return 1;
          if (!aNorm && bNorm) return -1;
          return 0;
        });

        let severity = 0; // All normal
        if (anomCount > 0 && anomCount < anomRows.length) severity = 1; // Mixed
        else if (anomCount === anomRows.length) severity = 2; // All anomalous

        const cardStatuses = new Set();
        anomRows.forEach(r => (r.statuses || []).forEach(s => cardStatuses.add(s)));
        cardsData.push({ key, ga, anomRows, severity, statuses: [...cardStatuses] });
      });

      window._anomalyCardsData = cardsData;

      // Sort cards: Severity 2 (Top) -> 1 (Middle) -> 0 (Bottom) -> Customer order -> alphabetically
      cardsData.sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        const ca = String(a.ga.customer || '').trim().toUpperCase();
        const cb = String(b.ga.customer || '').trim().toUpperCase();
        const pa = custOrder[ca] ?? 999;
        const pb = custOrder[cb] ?? 999;
        if (pa !== pb) return pa - pb;
        return a.key.localeCompare(b.key);
      });

      const anomalyOptionKeys = ['loss', 'oil50', 'payHigh', 'oilHigh', 'recvLow', 'normal']
        .filter(k => cardsData.some(c => (c.statuses || []).includes(k)));
      const selectedAnomalyStatuses = getSelectedCompareStatuses('anomaly', anomalyOptionKeys);
      const selectedAnomalySet = new Set(selectedAnomalyStatuses);
      const filteredCardsData = cardsData.filter(c => {
        const statuses = c.statuses || [];
        return statuses.some(s => selectedAnomalySet.has(s));
      });

      window._anomalyCardsData = filteredCardsData;
      let html = '';
      filteredCardsData.forEach((card, cIdx) => {
        const { ga, anomRows } = card;

        // Sum only the perfectly matched drivers for apples-to-apples comparison
        const mTripsA = anomRows.map(r => r.ra);
        const mTripsB = anomRows.map(r => r.rb);
        const aSum = mTripsA.reduce((s, r) => ({ recv: s.recv + (r.recv || 0), pay: s.pay + (r.pay || 0), oil: s.oil + (r.oil || 0), margin: s.margin + (r.margin || 0) }), { recv: 0, pay: 0, oil: 0, margin: 0 });
        const bSum = mTripsB.reduce((s, r) => ({ recv: s.recv + (r.recv || 0), pay: s.pay + (r.pay || 0), oil: s.oil + (r.oil || 0), margin: s.margin + (r.margin || 0) }), { recv: 0, pay: 0, oil: 0, margin: 0 });

        let tripRows = '';
        anomRows.forEach(({ ra, rb, flags }, i) => {
          const isNormal = flags.length === 1 && flags[0].includes('ปกติ');
          const bgHighlight = isNormal ? 'rgba(16, 185, 129, 0.05)' : 'transparent';
          const bg = isNormal ? `background:${bgHighlight}` : (i % 2 ? 'background:rgba(255,255,255,.02)' : '');
          const aMClr = ra && (ra.margin || 0) >= 0 ? 'var(--green)' : 'var(--red)';
          const bMClr = rb && (rb.margin || 0) >= 0 ? 'var(--green)' : 'var(--red)';
          const aOilPct = ra && ra.pay > 0 ? (ra.oil || 0) / ra.pay * 100 : 0, aOilWarn = aOilPct > 50;
          const aOilCell = ra && ra.oil > 0 ? `<span style="${aOilWarn ? 'color:var(--orange)' : ''}">${fmt(ra.oil)}${aOilWarn ? ` <span style="font-size:9px;font-weight:400;background:var(--orange);color:#fff;padding:1px 4px;border-radius:3px">${aOilPct.toFixed(0)}%</span>` : ''}</span>` : `<span style="color:var(--muted)">-</span>`;
          const aFuelPrice = getOilPriceByDate(ra?.date);
          const bOilPct = rb && rb.pay > 0 ? (rb.oil || 0) / rb.pay * 100 : 0, bOilWarn = bOilPct > 50;
          const bOilCell = rb && rb.oil > 0 ? `<span style="${bOilWarn ? 'color:var(--orange)' : ''}">${fmt(rb.oil)}${bOilWarn ? ` <span style="font-size:9px;font-weight:400;background:var(--orange);color:#fff;padding:1px 4px;border-radius:3px">${bOilPct.toFixed(0)}%</span>` : ''}</span>` : `<span style="color:var(--muted)">-</span>`;
          const bFuelPrice = getOilPriceByDate(rb?.date);

          tripRows += `<tr style="${bg};transition:background .15s" onmouseover="this.style.background='rgba(59,130,246,.06)'" onmouseout="this.style.background='${bgHighlight}'">
            <td style="padding:6px 9px;font-weight:400;color:${ra ? 'var(--text)' : 'var(--muted)'}">${ra ? esc(ra.driver || '-') : `<span style="font-size:10px">ไม่มีข้อมูลช่วง ${esc(_labelA || 'หลัก')}</span>`}</td>
            <td style="padding:6px 9px;text-align:right;color:var(--blue)">${hasNum(aFuelPrice) ? fmt(aFuelPrice) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px">${aOilCell}</td>
            <td style="padding:6px 9px;text-align:right">${ra ? fmt(ra.recv) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px;text-align:right">${ra && hasNum(ra.pay) ? fmt(ra.pay) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px;text-align:right;font-weight:400;color:${aMClr}">${ra ? fmt(ra.margin) : '<span style="color:var(--muted)">-</span>'}</td>
            ${tdSep}
            <td style="padding:6px 9px;font-weight:400;color:${rb ? 'var(--text)' : 'var(--muted)'}">${rb ? esc(rb.driver || '-') : `<span style="font-size:10px">ไม่มีข้อมูลช่วง ${esc(_labelB || 'เปรียบเทียบ')}</span>`}</td>
            <td style="padding:6px 9px;text-align:right;color:var(--blue)">${hasNum(bFuelPrice) ? fmt(bFuelPrice) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px">${bOilCell}</td>
            <td style="padding:6px 9px;text-align:right">${rb ? fmt(rb.recv) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px;text-align:right">${rb && hasNum(rb.pay) ? fmt(rb.pay) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px;text-align:right;font-weight:400;color:${bMClr}">${rb ? fmt(rb.margin) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px 6px 14px;border-left:1px solid var(--border)">${flags.join('')}</td>
          </tr>`;
        });

        const sumRow = `<tr style="border-top:2px solid var(--border);background:rgba(255,255,255,.025)">
          <td style="padding:8px 9px;font-weight:400;font-size:12px;color:#7dd3c7">รวม ${mTripsA.length} เที่ยว</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px;color:var(--muted)">-</td>
          <td style="padding:8px 9px;font-weight:400;font-size:12px;color:var(--orange)">${fmt(aSum.oil)}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px">${fmt(aSum.recv)}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px">${hasNum(aSum.pay) ? fmt(aSum.pay) : '-'}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px;color:${aSum.margin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(aSum.margin)}</td>
          ${tdSep}
          <td style="padding:8px 9px;font-weight:400;font-size:12px;color:#b8bdfd">รวม ${mTripsB.length} เที่ยว</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px;color:var(--muted)">-</td>
          <td style="padding:8px 9px;font-weight:400;font-size:12px;color:var(--orange)">${fmt(bSum.oil)}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px">${fmt(bSum.recv)}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px">${hasNum(bSum.pay) ? fmt(bSum.pay) : '-'}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px;color:${bSum.margin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(bSum.margin)}</td>
          <td style="padding:8px 9px;border-left:1px solid var(--border);background:transparent">&nbsp;</td>
        </tr>`;

        html += `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'" onclick="dcOpenAnomalyModal(${cIdx})">
          <div style="background:var(--surface);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:12px">
            <div style="flex:1;min-width:240px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:10px;font-weight:400;letter-spacing:.6px;text-transform:uppercase;color:#9ca3af;background:rgba(148,163,184,.10);border:1px solid rgba(148,163,184,.22);border-radius:999px;padding:2px 9px">${esc(ga.customer || '-')} · ${esc(ga.vtype || '-')}</span>
              </div>
              <div style="font-size:14px;font-weight:600;color:#7aa2ff;line-height:1.35;letter-spacing:.2px;word-break:break-word">${esc(ga.route || '-')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:400;background:rgba(20,184,166,.22);color:#7dd3c7;padding:2px 8px;border-radius:6px">${esc(_labelA)}: <span style="color:var(--text);font-weight:400">${mTripsA.length} เที่ยว</span></span>
              <span style="font-size:11px;font-weight:400;background:rgba(99,102,241,.22);color:#b8bdfd;padding:2px 8px;border-radius:6px">${esc(_labelB)}: <span style="color:var(--text);font-weight:400">${mTripsB.length} เที่ยว</span></span>
            </div>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;min-width:max-content;border-collapse:collapse;font-size:12px;table-layout:auto;white-space:nowrap">
              <colgroup><col style="min-width:110px"><col style="width:90px"><col style="width:90px"><col style="width:85px"><col style="width:85px"><col style="width:85px"><col style="width:2px"><col style="min-width:110px"><col style="width:90px"><col style="width:90px"><col style="width:85px"><col style="width:85px"><col style="width:85px"><col style="min-width:230px"></colgroup>
              <thead>
                <tr>
                  <th colspan="6" style="padding:5px 9px;text-align:left;font-size:11px;font-weight:700;color:#7dd3c7;background:rgba(20,184,166,.16);border-bottom:1px solid var(--border)">${esc(_labelA)}</th>
                  ${thSep}
                  <th colspan="6" style="padding:5px 9px;text-align:left;font-size:11px;font-weight:700;color:#b8bdfd;background:rgba(99,102,241,.18);border-bottom:1px solid var(--border)">${esc(_labelB)}</th>
                  <th style="padding:5px 9px;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)"></th>
                </tr>
                <tr>
                  ${thA('พขร.', 'left')}${thA('ราคาน้ำมัน')}${thA('สำรองน้ำมัน', 'left')}${thA('ราคารับ')}${thA('ราคาจ่าย')}${thA('ส่วนต่าง')}
                  ${thSep}
                  ${thB('พขร.', 'left')}${thB('ราคาน้ำมัน')}${thB('สำรองน้ำมัน', 'left')}${thB('ราคารับ')}${thB('ราคาจ่าย')}${thB('ส่วนต่าง')}
                  <th style="padding:5px 9px 5px 14px;font-size:10px;font-weight:700;color:#f3b2c9;opacity:0.95;text-transform:uppercase;letter-spacing:.4px;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)">สาเหตุความผิดปกติ</th>
                </tr>
              </thead>
              <tbody>${tripRows}${sumRow}</tbody>
            </table>
          </div>
        </div>`;
      });
      if (!totalRows || filteredCardsData.length === 0) return `<div class="table-card" style="margin-top:0"><div style="padding:48px;text-align:center;color:var(--green)">✅ ไม่พบความผิดปกติในช่วงเวลาที่เลือก</div></div>`;
      return `<div style="margin-top:0">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:11px 16px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:12px">
          <h3 style="margin:0;font-size:14px;font-weight:600;color:#cfd5df">➢ สรุปผลการตรวจสอบรวม ${cardsData.length} เส้นทาง พบความผิดปกติ ${totalAnom} รายการ</h3>
          <div style="margin-left:auto">
            ${renderCompareStatusFilter('anomaly', anomalyOptionKeys, selectedAnomalyStatuses)}
          </div>
        </div>
        ${html}
      </div>`;
    }

  window.dcOpenAnomalyModal = function (idx) {
      const card = window._anomalyCardsData[idx];
      if (!card) return;
      const existing = document.getElementById('dc_anom_modal');
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.id = 'dc_anom_modal';
      modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
      modal.onclick = e => { if (e.target === modal) modal.remove(); };
      
      const thA = (t, al = 'right') => `<th style="padding:5px 4px;text-align:${al};font-size:10px;font-weight:700;color:#7dd3c7;background:rgba(20,184,166,.16);border-bottom:1px solid var(--border)">${t}</th>`;
      const thB = (t, al = 'right') => `<th style="padding:5px 4px;text-align:${al};font-size:10px;font-weight:700;color:#b8bdfd;background:rgba(99,102,241,.18);border-bottom:1px solid var(--border)">${t}</th>`;
      const thSep = `<th style="width:2px;padding:0;background:var(--border);border-bottom:1px solid var(--border)"></th>`;
      const tdSep = `<td style="width:2px;padding:0;background:var(--border)"></td>`;
      
      let trs = '';
      card.anomRows.forEach(({ ra, rb, flags }, i) => {
        const bg = i % 2 ? 'background:rgba(255,255,255,.02)' : '';
        const aMClr = ra && (ra.margin || 0) >= 0 ? 'var(--green)' : 'var(--red)';
        const bMClr = rb && (rb.margin || 0) >= 0 ? 'var(--green)' : 'var(--red)';
        
        const rA = ra || {};
        const rB = rb || {};
        const pA = getOilPriceByDate(rA.date);
        const pB = getOilPriceByDate(rB.date);
        
        trs += `<tr style="${bg};border-bottom:1px solid rgba(255,255,255,.05)">
          <td style="padding:6px 4px;white-space:nowrap">${esc(rA.date || '-')}</td>
          <td style="padding:6px 4px;font-weight:600;min-width:90px">${esc(rA.driver || '-')}</td>
          <td style="padding:6px 4px;color:var(--muted);white-space:nowrap">${esc(rA.vtype || '-')}</td>
          <td style="padding:6px 4px;font-family:monospace;white-space:nowrap">${esc(rA.plate || '-')}</td>
          <td style="padding:6px 4px;text-align:right;color:var(--blue)">${hasNum(pA) ? fmt(pA) : '-'}</td>
          <td style="padding:6px 4px;text-align:right;color:var(--orange)">${hasNum(rA.oil) ? fmt(rA.oil) : '-'}</td>
          <td style="padding:6px 4px;text-align:right">${hasNum(rA.recv) ? fmt(rA.recv) : '-'}</td>
          <td style="padding:6px 4px;text-align:right">${hasNum(rA.pay) ? fmt(rA.pay) : '-'}</td>
          <td style="padding:6px 4px;text-align:right;font-weight:700;color:${aMClr}">${hasNum(rA.margin) ? fmt(rA.margin) : '-'}</td>
          ${tdSep}
          <td style="padding:6px 4px;white-space:nowrap">${esc(rB.date || '-')}</td>
          <td style="padding:6px 4px;font-weight:600;min-width:90px">${esc(rB.driver || '-')}</td>
          <td style="padding:6px 4px;color:var(--muted);white-space:nowrap">${esc(rB.vtype || '-')}</td>
          <td style="padding:6px 4px;font-family:monospace;white-space:nowrap">${esc(rB.plate || '-')}</td>
          <td style="padding:6px 4px;text-align:right;color:var(--blue)">${hasNum(pB) ? fmt(pB) : '-'}</td>
          <td style="padding:6px 4px;text-align:right;color:var(--orange)">${hasNum(rB.oil) ? fmt(rB.oil) : '-'}</td>
          <td style="padding:6px 4px;text-align:right">${hasNum(rB.recv) ? fmt(rB.recv) : '-'}</td>
          <td style="padding:6px 4px;text-align:right">${hasNum(rB.pay) ? fmt(rB.pay) : '-'}</td>
          <td style="padding:6px 4px;text-align:right;font-weight:700;color:${bMClr}">${hasNum(rB.margin) ? fmt(rB.margin) : '-'}</td>
          <td style="padding:6px 4px 6px 10px;border-left:1px solid var(--border)"><div class="dc-tags-wrap-xs">${flags.join('')}</div></td>
        </tr>`;
      });

      const exportIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="16" height="16" fill="#5985E1" aria-hidden="true"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h120v80H240v400h480v-400H600v-80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm200-240v-447l-64 64-56-57 160-160 160 160-56 57-64-64v447h-80Z"/></svg>';
      const exportBase = encodeURIComponent(`anomaly_${card.ga.route || 'route'}`);
      modal.innerHTML = `
        <div id="dc_anom_capture" data-export-root="1" style="background:var(--card);border:1px solid var(--border);border-radius:12px;max-width:98vw;width:100%;max-height:95vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6)">
          <div style="background:var(--surface);padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start">
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-size:15px;font-weight:800;color:#cfd5df">รายละเอียดการเปรียบเทียบ: <span style="color:#7aa2ff">${esc(card.ga.route || '-')}</span></div>
                <button type="button" onclick="window.dcExportModalPng('dc_anom_capture', '${exportBase}')" title="Export PNG" aria-label="Export PNG"
                  style="background:rgba(89,133,225,.10);border:1px solid rgba(89,133,225,.35);color:#dbeafe;width:28px;height:28px;border-radius:7px;cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;transition:all .2s;padding:0"
                  onmouseover="this.style.background='rgba(89,133,225,.18)';this.style.borderColor='rgba(89,133,225,.55)'"
                  onmouseout="this.style.background='rgba(89,133,225,.10)';this.style.borderColor='rgba(89,133,225,.35)'">${exportIcon}</button>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">ลูกค้า: ${esc(card.ga.customer || '-')} · พบข้อมูล ${card.anomRows.length} รายการ</div>
            </div>
            <button onclick="document.getElementById('dc_anom_modal').remove()"
              style="background:rgba(255,255,255,.05);border:none;color:var(--muted);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .2s"
              onmouseover="this.style.background='rgba(255,255,255,.1)';this.style.color='var(--text)'"
              onmouseout="this.style.background='rgba(255,255,255,.05)';this.style.color='var(--muted)'">&times;</button>
          </div>
          <div style="flex:1;overflow:auto;padding:0">
            <table style="width:100%;min-width:max-content;border-collapse:collapse;font-size:11px">
              <thead style="position:sticky;top:0;z-index:5;background:var(--surface)">
                <tr>
                  <th colspan="9" style="padding:6px 4px;text-align:center;font-size:11px;font-weight:800;color:#7dd3c7;background:rgba(20,184,166,.16);border-bottom:1px solid var(--border)">${_labelA}</th>
                  ${thSep}
                  <th colspan="9" style="padding:6px 4px;text-align:center;font-size:11px;font-weight:800;color:#b8bdfd;background:rgba(99,102,241,.18);border-bottom:1px solid var(--border)">${_labelB}</th>
                  <th style="padding:6px 4px;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)"></th>
                </tr>
                <tr>
                  ${thA('วันที่','left')}${thA('พขร.','left')}${thA('รถ','left')}${thA('ทะเบียน','left')}${thA('ราคาน้ำมัน')}${thA('สำรองน้ำมัน')}${thA('รับ')}${thA('จ่าย')}${thA('ส่วนต่าง')}
                  ${thSep}
                  ${thB('วันที่','left')}${thB('พขร.','left')}${thB('รถ','left')}${thB('ทะเบียน','left')}${thB('ราคาน้ำมัน')}${thB('สำรองน้ำมัน')}${thB('รับ')}${thB('จ่าย')}${thB('ส่วนต่าง')}
                  <th style="padding:5px 4px 5px 10px;font-size:10px;font-weight:700;color:#f3b2c9;opacity:0.95;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)">ความผิดปกติ</th>
                </tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        </div>`;
      document.body.appendChild(modal);
    };

    function renderUnmatchedTable(stA, stB, side) {
      const isA = side === 'a';
      const mySt = isA ? stA : stB;
      const opSt = isA ? stB : stA;
      const myLabel = isA ? _labelA : _labelB;
      
      const themeColor = isA ? '#7dd3c7' : '#b8bdfd';
      const themeBg = isA ? 'rgba(20,184,166,.16)' : 'rgba(99,102,241,.18)';
      const themeBadgeBg = isA ? 'rgba(20,184,166,.22)' : 'rgba(99,102,241,.22)';
      const themeHover = isA ? 'rgba(20,184,166,.14)' : 'rgba(99,102,241,.14)';
      
      if (!mySt) return `<div style="padding:40px;text-align:center;color:var(--muted)">กรุณาเลือกช่วงเวลา</div>`;
      const isValidDriver = d => d && d.trim() !== '-' && !/^null$/i.test(d.trim()) && !/^nan$/i.test(d.trim());
      
      const myRows = (mySt.rows || []).filter(r => isValidDriver(r.driver));
      const opRows = (opSt?.rows || []).filter(r => isValidDriver(r.driver));
      
      const badge = (msg, lvl) => `<span style="display:inline-block;margin:1px 2px 1px 0;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:400;background:var(--${lvl});color:#fff;white-space:nowrap">${msg}</span>`;
      const thMy = (t, al = 'right') => `<th style="padding:5px 9px;text-align:${al};font-size:10px;font-weight:700;color:${themeColor};text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;background:${themeBg};border-bottom:1px solid var(--border)">${t}</th>`;
      
      const myGroup = {}, opGroup = {};
      myRows.forEach(r => {
        const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
        if (!myGroup[k]) myGroup[k] = { customer: r.customer, route: r.route, vtype: r.vtype, trips: [] };
        myGroup[k].trips.push(r);
      });
      opRows.forEach(r => {
        const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
        if (!opGroup[k]) opGroup[k] = { trips: [] };
        opGroup[k].trips.push(r);
      });
      
      let totalAnom = 0, totalRows = 0;
      let cardsData = [];
      
      Object.keys(myGroup).forEach(key => {
        const ga = myGroup[key], gb = opGroup[key];
        const myTrips = ga.trips, opTrips = gb ? gb.trips : [];
        
        const norm = d => d ? d.trim().toLowerCase() : '';
        const usedOp = new Set();
        
        const unmatched = [];
        myTrips.forEach(rmy => {
          const idx = opTrips.findIndex((rop, i) => !usedOp.has(i) && norm(rop.driver) === norm(rmy.driver));
          if (idx >= 0) {
            usedOp.add(idx); 
          } else {
            unmatched.push(rmy);
          }
        });
        
        if (unmatched.length === 0) return;
        
        const unRows = [];
        unmatched.forEach(ra => {
          const flags = [];
          const statuses = new Set();
          if ((ra.margin || 0) < 0) {
            const lp = ra.recv > 0 ? Math.abs((ra.margin || 0) / ra.recv * 100) : 0;
            flags.push(badge(`ขาดทุน ${lp.toFixed(0)}%`, 'red'));
            statuses.add('loss');
          }
          if ((ra.oil || 0) > (ra.pay || 0) * 0.5 && (ra.pay || 0) > 0) {
            flags.push(badge('สำรองน้ำมัน>50%', 'orange'));
            statuses.add('oil50');
          }

          if (flags.length === 0) {
            flags.push(`<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(16,185,129,.15);color:#10b981;font-size:11px;font-weight:400">ปกติ</span>`);
            statuses.add('normal');
          }
          unRows.push({ ra, flags, statuses: Array.from(statuses) });
        });
        
        const anomCount = unRows.filter(r => r.flags.some(f => !f.includes('ปกติ'))).length;
        totalRows += unRows.length;
        totalAnom += anomCount;
        
        unRows.sort((a, b) => {
          const aNorm = a.flags.every(f => f.includes('ปกติ'));
          const bNorm = b.flags.every(f => f.includes('ปกติ'));
          if (aNorm && !bNorm) return 1;
          if (!aNorm && bNorm) return -1;
          return 0;
        });
        
        let severity = 0;
        if (anomCount > 0 && anomCount < unRows.length) severity = 1;
        else if (anomCount === unRows.length) severity = 2;
        
        const cardStatuses = new Set();
        unRows.forEach(r => (r.statuses || []).forEach(s => cardStatuses.add(s)));
        cardsData.push({ key, ga, unRows, severity, statuses: [...cardStatuses] });
      });
      
      window._unmatchedCardsData = cardsData;
      
      cardsData.sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return a.key.localeCompare(b.key);
      });
      
      const unmatchedOptionKeys = ['loss', 'oil50', 'normal']
        .filter(k => cardsData.some(c => (c.statuses || []).includes(k)));
      const modeKey = side === 'a' ? 'unmatched_a' : 'unmatched_b';
      const selectedUnmatchedStatuses = getSelectedCompareStatuses(modeKey, unmatchedOptionKeys);
      const selectedUnmatchedSet = new Set(selectedUnmatchedStatuses);
      const filteredCardsData = cardsData.filter(c => {
        const statuses = c.statuses || [];
        return statuses.some(s => selectedUnmatchedSet.has(s));
      });

      // Recompute anomaly count from currently visible rows (after status filter),
      // based on displayed anomaly-cause badges.
      const visibleAnom = filteredCardsData.reduce((sum, card) => {
        const rows = card.unRows || [];
        const cnt = rows.filter(r => (r.flags || []).some(f => !String(f).includes('ปกติ'))).length;
        return sum + cnt;
      }, 0);

      window._unmatchedCardsData = filteredCardsData;
      let html = '';
      filteredCardsData.forEach((card, cIdx) => {
        const { ga, unRows } = card;
        
        const mTrips = unRows.map(r => r.ra);
        const mySum = mTrips.reduce((s, r) => ({ recv: s.recv + (r.recv || 0), pay: s.pay + (r.pay || 0), oil: s.oil + (r.oil || 0), margin: s.margin + (r.margin || 0) }), { recv: 0, pay: 0, oil: 0, margin: 0 });
        
        let tripRows = '';
        unRows.forEach(({ ra, flags }, i) => {
          const isNormal = flags.length === 1 && flags[0].includes('ปกติ');
          const bgHighlight = isNormal ? 'rgba(16, 185, 129, 0.05)' : 'transparent';
          const bg = isNormal ? `background:${bgHighlight}` : (i % 2 ? 'background:rgba(255,255,255,.02)' : '');
          const aMClr = ra && (ra.margin || 0) >= 0 ? 'var(--green)' : 'var(--red)';
          const aOilPct = ra && ra.pay > 0 ? (ra.oil || 0) / ra.pay * 100 : 0, aOilWarn = aOilPct > 50;
          const aOilCell = ra && ra.oil > 0 ? `<span style="${aOilWarn ? 'color:var(--orange)' : ''}">${fmt(ra.oil)}${aOilWarn ? ` <span style="font-size:9px;font-weight:400;background:var(--orange);color:#fff;padding:1px 4px;border-radius:3px">${aOilPct.toFixed(0)}%</span>` : ''}</span>` : `<span style="color:var(--muted)">-</span>`;
          const aFuelPrice = getOilPriceByDate(ra?.date);
          
          tripRows += `<tr style="${bg};transition:background .15s" onmouseover="this.style.background='${themeHover}'" onmouseout="this.style.background='${bgHighlight}'">
            <td style="padding:6px 9px;font-weight:400;color:var(--text)">${esc(ra.driver || '-')}</td>
            <td style="padding:6px 9px;text-align:right;color:var(--blue)">${hasNum(aFuelPrice) ? fmt(aFuelPrice) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px">${aOilCell}</td>
            <td style="padding:6px 9px;text-align:right">${fmt(ra.recv)}</td>
            <td style="padding:6px 9px;text-align:right">${hasNum(ra.pay) ? fmt(ra.pay) : '<span style="color:var(--muted)">-</span>'}</td>
            <td style="padding:6px 9px;text-align:right;font-weight:400;color:${aMClr}">${fmt(ra.margin)}</td>
            <td style="padding:6px 9px 6px 14px;border-left:1px solid var(--border)"><div class="dc-tags-wrap">${flags.join('')}</div></td>
          </tr>`;
        });
        
        const sumRow = `<tr style="border-top:2px solid var(--border);background:rgba(255,255,255,.025)">
          <td style="padding:8px 9px;font-weight:400;font-size:12px;color:#7dd3c7">รวม ${mTrips.length} เที่ยว</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px;color:var(--muted)">-</td>
          <td style="padding:8px 9px;font-weight:400;font-size:12px;color:var(--orange)">${fmt(mySum.oil)}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px">${fmt(mySum.recv)}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px">${hasNum(mySum.pay) ? fmt(mySum.pay) : '-'}</td>
          <td style="padding:8px 9px;text-align:right;font-weight:400;font-size:12px;color:${mySum.margin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(mySum.margin)}</td>
          <td style="padding:8px 9px;border-left:1px solid var(--border);background:transparent">&nbsp;</td>
        </tr>`;
        
        html += `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'" onclick="dcOpenUnmatchedModal(${cIdx}, '${side}')">
          <div style="background:var(--surface);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:12px">
            <div style="flex:1;min-width:240px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:10px;font-weight:400;letter-spacing:.6px;text-transform:uppercase;color:#9ca3af;background:rgba(148,163,184,.10);border:1px solid rgba(148,163,184,.22);border-radius:999px;padding:2px 9px">${esc(ga.customer || '-')} · ${esc(ga.vtype || '-')}</span>
              </div>
              <div style="font-size:14px;font-weight:600;color:#7aa2ff;line-height:1.35;letter-spacing:.2px;word-break:break-word">${esc(ga.route || '-')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:400;background:${themeBadgeBg};color:${themeColor};padding:2px 8px;border-radius:6px">${esc(myLabel)}: <span style="color:var(--text);font-weight:400">${mTrips.length} เที่ยว</span></span>
            </div>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;min-width:max-content;border-collapse:collapse;font-size:12px;table-layout:auto;white-space:nowrap">
              <colgroup><col style="min-width:110px"><col style="width:90px"><col style="width:100px"><col style="width:90px"><col style="width:90px"><col style="width:90px"><col></colgroup>
              <thead>
                <tr>
                  <th colspan="6" style="padding:5px 9px;text-align:left;font-size:11px;font-weight:700;color:${themeColor};background:${themeBg};border-bottom:1px solid var(--border)">${esc(myLabel)}</th>
                  <th style="padding:5px 9px;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)"></th>
                </tr>
                <tr>
                  ${thMy('พขร.', 'left')}${thMy('ราคาน้ำมัน')}${thMy('สำรองน้ำมัน', 'left')}${thMy('ราคารับ')}${thMy('ราคาจ่าย')}${thMy('ส่วนต่าง')}
                  <th style="padding:5px 9px 5px 14px;font-size:10px;font-weight:700;color:#f3b2c9;opacity:0.95;text-transform:uppercase;letter-spacing:.4px;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)">สาเหตุความผิดปกติ</th>
                </tr>
              </thead>
              <tbody>${tripRows}${sumRow}</tbody>
            </table>
          </div>
        </div>`;
      });
      
      if (!totalRows || filteredCardsData.length === 0) return `<div class="table-card" style="margin-top:0"><div style="padding:48px;text-align:center;color:var(--green)">✅ ไม่พบรายการเที่ยววิ่งที่จับคู่ไม่ได้ในหน้าต่างนี้</div></div>`;
      return `<div style="margin-top:0">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:11px 16px;background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:12px">
          <h3 style="margin:0;font-size:14px">➢ ข้อมูลที่ไม่ถูกเปรียบเทียบ: ${esc(myLabel)} (รวม ${cardsData.length} เส้นทาง / ${totalRows} เที่ยว)</h3>
          ${visibleAnom > 0 ? `<span style="font-size:11px;color:var(--red);background:rgba(239,68,68,.15);padding:2px 8px;border-radius:6px;font-weight:400">พบปัญหา ${visibleAnom} เที่ยว</span>` : ''}
          <div style="margin-left:auto">
            ${renderCompareStatusFilter(modeKey, unmatchedOptionKeys, selectedUnmatchedStatuses)}
          </div>
        </div>
        ${html}
      </div>`;
    }

  window.dcOpenUnmatchedModal = function (idx, side) {
      const card = window._unmatchedCardsData[idx];
      if (!card) return;
      const isA = side === 'a';
      const myLabel = isA ? _labelA : _labelB;
      
      const themeColor = isA ? '#7dd3c7' : '#b8bdfd';
      const themeBg = isA ? 'rgba(20,184,166,.16)' : 'rgba(99,102,241,.18)';
      const themeBadgeBg = isA ? 'rgba(20,184,166,.22)' : 'rgba(99,102,241,.22)';
      
      const existing = document.getElementById('dc_unm_modal');
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.id = 'dc_unm_modal';
      modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
      modal.onclick = e => { if (e.target === modal) modal.remove(); };
      
      const thMy = (t, al = 'right') => `<th style="padding:5px 6px;text-align:${al};font-size:10px;font-weight:700;color:${themeColor};background:${themeBg};border-bottom:1px solid var(--border)">${t}</th>`;
      
      let trs = '';
      card.unRows.forEach(({ ra, flags }, i) => {
        const bg = i % 2 ? 'background:rgba(255,255,255,.02)' : '';
        const aMClr = ra && (ra.margin || 0) >= 0 ? 'var(--green)' : 'var(--red)';
        const pA = getOilPriceByDate(ra?.date);
        
        trs += `<tr style="${bg};border-bottom:1px solid rgba(255,255,255,.05)">
          <td style="padding:8px 6px;white-space:nowrap">${esc(ra.date || '-')}</td>
          <td style="padding:8px 6px;font-weight:400;min-width:90px">${esc(ra.driver || '-')}</td>
          <td style="padding:8px 6px;color:var(--muted);white-space:nowrap">${esc(ra.vtype || '-')}</td>
          <td style="padding:8px 6px;font-family:monospace;white-space:nowrap">${esc(ra.plate || '-')}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--blue)">${hasNum(pA) ? fmt(pA) : '-'}</td>
          <td style="padding:8px 6px;text-align:right;color:var(--orange)">${hasNum(ra.oil) ? fmt(ra.oil) : '-'}</td>
          <td style="padding:8px 6px;text-align:right">${hasNum(ra.recv) ? fmt(ra.recv) : '-'}</td>
          <td style="padding:8px 6px;text-align:right">${hasNum(ra.pay) ? fmt(ra.pay) : '-'}</td>
          <td style="padding:8px 6px;text-align:right;font-weight:400;color:${aMClr}">${hasNum(ra.margin) ? fmt(ra.margin) : '-'}</td>
          <td style="padding:8px 6px 8px 10px;border-left:1px solid var(--border)"><div class="dc-tags-wrap">${flags.join('')}</div></td>
        </tr>`;
      });

      const exportIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="16" height="16" fill="#5985E1" aria-hidden="true"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h120v80H240v400h480v-400H600v-80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm200-240v-447l-64 64-56-57 160-160 160 160-56 57-64-64v447h-80Z"/></svg>';
      const exportBase = encodeURIComponent(`unmatched_${card.ga.route || 'route'}`);
      modal.innerHTML = `
        <div id="dc_unm_capture" data-export-root="1" style="background:var(--card);border:1px solid var(--border);border-radius:12px;max-width:900px;width:100%;max-height:95vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6)">
          <div style="background:var(--surface);padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start">
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="font-size:15px;font-weight:800;color:#cfd5df">รายละเอียดเที่ยวที่ไม่มีคู่ (${esc(myLabel)}): <span style="color:#7aa2ff">${esc(card.ga.route || '-')}</span></div>
                <button type="button" onclick="window.dcExportModalPng('dc_unm_capture', '${exportBase}')" title="Export PNG" aria-label="Export PNG"
                  style="background:rgba(89,133,225,.10);border:1px solid rgba(89,133,225,.35);color:#dbeafe;width:28px;height:28px;border-radius:7px;cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;transition:all .2s;padding:0"
                  onmouseover="this.style.background='rgba(89,133,225,.18)';this.style.borderColor='rgba(89,133,225,.55)'"
                  onmouseout="this.style.background='rgba(89,133,225,.10)';this.style.borderColor='rgba(89,133,225,.35)'">${exportIcon}</button>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">ลูกค้า: ${esc(card.ga.customer || '-')} · พบข้อมูล ${card.unRows.length} รายการ</div>
            </div>
            <button onclick="document.getElementById('dc_unm_modal').remove()"
              style="background:rgba(255,255,255,.05);border:none;color:var(--muted);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;transition:all .2s"
              onmouseover="this.style.background='rgba(255,255,255,.1)';this.style.color='var(--text)'"
              onmouseout="this.style.background='rgba(255,255,255,.05)';this.style.color='var(--muted)'">&times;</button>
          </div>
          <div style="flex:1;overflow:auto;padding:0">
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <thead style="position:sticky;top:0;z-index:5;background:var(--surface)">
                <tr>
                  <th colspan="9" style="padding:8px 6px;text-align:center;font-size:12px;font-weight:800;color:${themeColor};background:${themeBg};border-bottom:1px solid var(--border)">ช่วงข้อมูล: ${esc(myLabel)}</th>
                  <th style="padding:8px 6px;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)"></th>
                </tr>
                <tr>
                  ${thMy('วันที่','left')}${thMy('พขร.','left')}${thMy('รถ','left')}${thMy('ทะเบียน','left')}${thMy('ราคาน้ำมัน')}${thMy('สำรองน้ำมัน')}${thMy('รับ')}${thMy('จ่าย')}${thMy('ส่วนต่าง')}
                  <th style="padding:5px 6px 5px 10px;font-size:10px;font-weight:700;color:#f3b2c9;opacity:0.95;background:rgba(236,72,153,.16);border-bottom:1px solid var(--border);border-left:1px solid var(--border)">ความผิดปกติ</th>
                </tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        </div>`;
      document.body.appendChild(modal);
    };

    let _dcHtml2CanvasPromise = null;
    function ensureDcHtml2Canvas() {
      if (window.html2canvas) return Promise.resolve(window.html2canvas);
      if (_dcHtml2CanvasPromise) return _dcHtml2CanvasPromise;
      _dcHtml2CanvasPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.async = true;
        script.onload = () => window.html2canvas ? resolve(window.html2canvas) : reject(new Error('โหลด html2canvas ไม่สำเร็จ'));
        script.onerror = () => reject(new Error('ไม่สามารถโหลดไลบรารีสำหรับ Export PNG ได้'));
        document.head.appendChild(script);
      });
      return _dcHtml2CanvasPromise;
    }

    function dcShowExportOverlay(message) {
      const old = document.getElementById('dc_export_loading_overlay');
      if (old) old.remove();
      const overlay = document.createElement('div');
      overlay.id = 'dc_export_loading_overlay';
      overlay.style = 'position:fixed;inset:0;background:rgba(2,6,23,.62);backdrop-filter:blur(2px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px';
      overlay.innerHTML = `<div style="min-width:240px;max-width:360px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;color:var(--text);box-shadow:0 24px 64px rgba(0,0,0,.45)">
        <div style="font-size:13px;font-weight:600;color:#cbd5e1">${esc(message || 'กำลังสร้างภาพ PNG...')}</div>
        <div style="margin-top:10px;height:6px;border-radius:999px;background:rgba(148,163,184,.22);overflow:hidden">
          <div style="width:42%;height:100%;background:linear-gradient(90deg,#5985E1,#7AA2FF);animation:dcExportPulse 1.2s ease-in-out infinite"></div>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      return overlay;
    }

    window.dcExportModalPng = async function(targetId, baseName) {
      let clone = null;
      let overlay = null;
      try {
        const target = document.getElementById(targetId);
        if (!target) return;
        overlay = dcShowExportOverlay('กำลังเตรียมไฟล์ PNG...');
        const html2canvas = await ensureDcHtml2Canvas();

        // Capture full content (including horizontal/vertical overflow) via off-screen clone.
        clone = target.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.position = 'fixed';
        clone.style.left = '-100000px';
        clone.style.top = '0';
        clone.style.margin = '0';
        clone.style.maxWidth = 'none';
        clone.style.maxHeight = 'none';
        clone.style.width = 'auto';
        clone.style.height = 'auto';
        clone.style.overflow = 'visible';
        clone.style.zIndex = '-1';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);

        const descendants = Array.from(clone.querySelectorAll('*'));
        descendants.forEach(el => {
          const cs = window.getComputedStyle(el);
          if (cs.position === 'sticky') {
            el.style.position = 'static';
            el.style.top = 'auto';
          }
          const hasScroll =
            /auto|scroll/.test(cs.overflowX) ||
            /auto|scroll/.test(cs.overflowY) ||
            /auto|scroll/.test(cs.overflow);
          if (hasScroll) {
            el.style.overflow = 'visible';
            el.style.overflowX = 'visible';
            el.style.overflowY = 'visible';
            if (el.scrollWidth > el.clientWidth) el.style.width = `${el.scrollWidth}px`;
            if (el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight}px`;
            el.style.maxWidth = 'none';
            el.style.maxHeight = 'none';
          }
        });

        const fullWidth = Math.max(clone.scrollWidth, clone.offsetWidth, 1);
        const fullHeight = Math.max(clone.scrollHeight, clone.offsetHeight, 1);
        clone.style.width = `${fullWidth}px`;
        clone.style.height = `${fullHeight}px`;
        const pxArea = fullWidth * fullHeight;
        const exportScale = pxArea > 12000000 ? 1 : (pxArea > 7000000 ? 1.25 : 1.75);

        await new Promise(r => requestAnimationFrame(r));

        const canvas = await html2canvas(clone, {
          backgroundColor: '#0f172a',
          scale: exportScale,
          useCORS: true,
          logging: false,
          width: fullWidth,
          height: fullHeight,
          windowWidth: fullWidth,
          windowHeight: fullHeight,
          scrollX: 0,
          scrollY: 0
        });
        let decodedBase = String(baseName || 'compare');
        try { decodedBase = decodeURIComponent(decodedBase); } catch (_) {}
        const safeBase = decodedBase.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${safeBase}_${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        alert(err?.message || 'Export PNG ไม่สำเร็จ');
      } finally {
        if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    };

    window.dcExportXls = function() {
      if (typeof XLSX === 'undefined') { alert('ไม่พบไลบรารี XLSX กรุณารีเฟรชหน้า'); return; }
      if (!_stA) { alert('ยังไม่มีข้อมูล กรุณากด "ตรวจสอบ" ก่อน Export'); return; }
      if (!_isSingleMode && !_stB) {
        alert('ช่วงเปรียบเทียบไม่มีข้อมูล กรุณาเลือกช่วงวันที่ใหม่ หรือสลับเป็นมุมมองปกติก่อน Export');
        return;
      }

      const { custF, routeF, vtypeF } = getFilters();
      function fmtNum(n) { return (n == null || isNaN(n)) ? 0 : Math.round(Number(n) * 100) / 100; }

      function addCommas(str) {
        let result = '';
        let count = 0;
        for (let i = str.length - 1; i >= 0; i--) {
          if (count > 0 && count % 3 === 0) result = ',' + result;
          result = str[i] + result;
          count++;
        }
        return result;
      }
      function fmtMoney(n) {
        if (n == null || isNaN(n)) return '0.00';
        const v = Math.round(Number(n) * 100) / 100;
        const isNeg = v < 0;
        const [intStr, decStr] = Math.abs(v).toFixed(2).split('.');
        return (isNeg ? '-' : '') + addCommas(intStr) + '.' + decStr;
      }
      function fmtPercent(n) {
        if (n == null || isNaN(n)) return '0.00%';
        const v = Math.round(Number(n) * 100 * 100) / 100;
        const isNeg = v < 0;
        const [intStr, decStr] = Math.abs(v).toFixed(2).split('.');
        return (isNeg ? '-' : '') + addCommas(intStr) + '.' + decStr + '%';
      }
      function fmtInt(n) {
        if (n == null || isNaN(n)) return '0';
        const v = Math.round(Number(n));
        const isNeg = v < 0;
        return (isNeg ? '-' : '') + addCommas(String(Math.abs(v)));
      }
      function filterSummaryText() {
        return 'ลูกค้า: ' + (custF.length ? custF.join(', ') : 'ทั้งหมด') +
          ' | เส้นทาง: ' + (routeF.length ? routeF.join(', ') : 'ทั้งหมด') +
          ' | ประเภทรถ: ' + (vtypeF.length ? vtypeF.join(', ') : 'ทั้งหมด') +
          ' | โหมด: ' + (_isSingleMode ? 'มุมมองปกติ' : 'เปรียบเทียบ');
      }

      const allBorders = {
        top: { style: 'thin', color: { rgb: 'E5E7EB' } },
        bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
        left: { style: 'thin', color: { rgb: 'E5E7EB' } },
        right: { style: 'thin', color: { rgb: 'E5E7EB' } }
      };
      function hCell(v) {
        return { v: v, s: { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: '1F2937' }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'center' }, border: allBorders } };
      }
      function cCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10 }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.color) s.font.color = { rgb: opts.color };
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function rCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: 'DC2626' } }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function gCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: '16A34A' } }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function oCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: 'EA580C' } }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function mCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: '6B7280' } }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function pCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: 'A855F7' } }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function bCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: '3B82F6' } }, alignment: { vertical: 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      const nTHB = '#,##0.00';
      const nPct = '0.00%';
      const periodALabel = _stA ? (_labelA || fmtRange(_stA.dateStart, _stA.dateEnd)) : (_labelA || '-');
      const periodBLabel = (_stB && !_isSingleMode) ? (_labelB || fmtRange(_stB.dateStart, _stB.dateEnd)) : '';
      const addPeriod = (title, periodLabel) => `${title} (${periodLabel || '-'})`;
      const normDriver = d => String(d || '').trim().toLowerCase();

      function buildAnomalyExportCards(stA, stB) {
        const rowsA = (stA && stA.rows) ? stA.rows : [];
        const rowsB = (stB && stB.rows) ? stB.rows : [];
        const groupA = {};
        const groupB = {};
        rowsA.forEach(r => {
          const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
          if (!groupA[k]) groupA[k] = { key: k, customer: r.customer || '-', route: r.route || '-', vtype: r.vtype || '-', trips: [] };
          groupA[k].trips.push(r);
        });
        rowsB.forEach(r => {
          const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
          if (!groupB[k]) groupB[k] = { key: k, customer: r.customer || '-', route: r.route || '-', vtype: r.vtype || '-', trips: [] };
          groupB[k].trips.push(r);
        });

        const cards = [];
        Object.keys(groupA).forEach(k => {
          if (!groupB[k]) return;
          const ga = groupA[k];
          const gb = groupB[k];
          const usedB = new Set();
          const rows = [];
          ga.trips.forEach(ra => {
            const idx = gb.trips.findIndex((rb, i) => !usedB.has(i) && normDriver(rb.driver) === normDriver(ra.driver));
            if (idx < 0) return;
            usedB.add(idx);
            const rb = gb.trips[idx];
            const reasons = [];
            const statuses = new Set();
            if ((ra.margin || 0) < 0) {
              const lp = ra.recv > 0 ? Math.abs((ra.margin || 0) / ra.recv * 100) : 0;
              reasons.push(`${ra.date || '-'} ขาดทุน ${lp.toFixed(0)}%`);
              statuses.add('loss');
            }
            if ((rb.margin || 0) < 0) {
              const lp = rb.recv > 0 ? Math.abs((rb.margin || 0) / rb.recv * 100) : 0;
              reasons.push(`${rb.date || '-'} ขาดทุน ${lp.toFixed(0)}%`);
              statuses.add('loss');
            }
            if ((ra.oil || 0) > (ra.pay || 0) * 0.5 && (ra.pay || 0) > 0) {
              reasons.push(`${ra.date || '-'} สำรองน้ำมัน>50%`);
              statuses.add('oil50');
            }
            if ((rb.oil || 0) > (rb.pay || 0) * 0.5 && (rb.pay || 0) > 0) {
              reasons.push(`${rb.date || '-'} สำรองน้ำมัน>50%`);
              statuses.add('oil50');
            }
            if (rb.pay > 0 && (ra.pay || 0) > rb.pay * 1.05) {
              reasons.push(`${ra.date || '-'} ราคาจ่ายแพงกว่าเดิม`);
              statuses.add('payHigh');
            }
            if (rb.oil > 0 && (ra.oil || 0) > rb.oil * 1.05) {
              reasons.push(`${ra.date || '-'} สำรองน้ำมันแพงกว่าเดิม`);
              statuses.add('oilHigh');
            }
            if (rb.recv > 0 && (ra.recv || 0) < rb.recv * 0.95) {
              reasons.push(`${ra.date || '-'} ราคารับต่ำกว่าเดิม`);
              statuses.add('recvLow');
            }
            if (reasons.length === 0) {
              reasons.push('ปกติ');
              statuses.add('normal');
            }
            rows.push({ ra, rb, reasons, statuses: Array.from(statuses), isNormal: reasons.length === 1 && reasons[0] === 'ปกติ' });
          });
          if (!rows.length) return;
          const anomalyRows = rows.filter(r => !r.isNormal);
          if (!anomalyRows.length) return;
          cards.push({ key: k, ga, rows: anomalyRows });
        });

        cards.sort((a, b) => {
          const ca = String(a.ga.customer || '').trim().toUpperCase();
          const cb = String(b.ga.customer || '').trim().toUpperCase();
          const pa = custOrder[ca] ?? 999;
          const pb = custOrder[cb] ?? 999;
          if (pa !== pb) return pa - pb;
          return a.key.localeCompare(b.key);
        });
        return cards;
      }

      function buildUnmatchedExportCards(myRows, opRows) {
        const myGroup = {};
        const opGroup = {};
        (myRows || []).forEach(r => {
          const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
          if (!myGroup[k]) myGroup[k] = { key: k, customer: r.customer || '-', route: r.route || '-', vtype: r.vtype || '-', trips: [] };
          myGroup[k].trips.push(r);
        });
        (opRows || []).forEach(r => {
          const k = `${r.customer || ''}|${r.route || ''}|${r.vtype || ''}`;
          if (!opGroup[k]) opGroup[k] = { key: k, customer: r.customer || '-', route: r.route || '-', vtype: r.vtype || '-', trips: [] };
          opGroup[k].trips.push(r);
        });

        const cards = [];
        Object.keys(myGroup).forEach(k => {
          const ga = myGroup[k];
          const gb = opGroup[k];
          const opTrips = gb ? gb.trips : [];
          const used = new Set();
          const rows = [];
          ga.trips.forEach(ra => {
            const idx = opTrips.findIndex((rb, i) => !used.has(i) && normDriver(rb.driver) === normDriver(ra.driver));
            if (idx >= 0) {
              used.add(idx);
              return;
            }
            const reasons = [];
            const statuses = new Set();
            if ((ra.margin || 0) < 0) {
              const lp = ra.recv > 0 ? Math.abs((ra.margin || 0) / ra.recv * 100) : 0;
              reasons.push(`ขาดทุน ${lp.toFixed(0)}%`);
              statuses.add('loss');
            }
            if ((ra.oil || 0) > (ra.pay || 0) * 0.5 && (ra.pay || 0) > 0) {
              reasons.push('สำรองน้ำมัน>50%');
              statuses.add('oil50');
            }
            if (reasons.length === 0) {
              reasons.push('ปกติ');
              statuses.add('normal');
            }
            rows.push({ ra, reasons, statuses: Array.from(statuses), isNormal: reasons.length === 1 && reasons[0] === 'ปกติ' });
          });
          if (!rows.length) return;
          cards.push({ key: k, ga, rows });
        });

        cards.sort((a, b) => {
          const ca = String(a.ga.customer || '').trim().toUpperCase();
          const cb = String(b.ga.customer || '').trim().toUpperCase();
          const pa = custOrder[ca] ?? 999;
          const pb = custOrder[cb] ?? 999;
          if (pa !== pb) return pa - pb;
          return a.key.localeCompare(b.key);
        });
        return cards;
      }

      function buildUnmatchedSheet(cards, sheetTitle, myPeriodLabel, otherPeriodLabel) {
        const wsData = [];
        wsData.push([cCell(sheetTitle, { bold: true, sz: 12, color: '111827' })]);
        wsData.push([cCell(filterSummaryText(), { color: '6B7280', sz: 9 })]);
        wsData.push([cCell('ช่วงข้อมูลหลัก: ' + myPeriodLabel + ' | ช่วงเปรียบเทียบ: ' + otherPeriodLabel, { color: '374151', sz: 9 })]);
        wsData.push([]);
        const headers = [
          'ลูกค้า', 'เส้นทาง', 'ประเภทรถ', 'วันที่', 'พขร.', 'ทะเบียน',
          'ราคาน้ำมัน', 'ราคารับ', 'ราคาจ่าย', 'สำรองน้ำมัน', 'ส่วนต่าง', 'กำไร %', 'สถานะ'
        ];
        const headerRow = wsData.length;
        wsData.push(headers.map(t => hCell(t)));
        let rowIdx = headerRow + 1;

        cards.forEach(card => {
          const top = [
            cCell(card.ga.customer || '-', { bold: true, fill: 'DBEAFE' }),
            cCell(card.ga.route || '-', { bold: true, fill: 'DBEAFE' }),
            cCell(card.ga.vtype || '-', { bold: true, fill: 'DBEAFE' }),
            cCell('รวม ' + (card.rows || []).length + ' เที่ยว', { bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' })
          ];
          wsData.push(top);
          rowIdx++;

          (card.rows || []).forEach(entry => {
            const r = entry.ra || {};
            const mar = (r.margin == null || isNaN(r.margin)) ? ((r.recv || 0) - (r.pay || 0) - (r.oil || 0)) : r.margin;
            const pct = (r.recv || 0) > 0 ? mar / (r.recv || 0) : 0;
            const oilPrice = getOilPriceByDate(r.date);
            const statusText = (entry.reasons || []).join(', ');
            const zf = (rowIdx % 2 === 0) ? 'F9FAFB' : null;
            let statusCell;
            if (entry.isNormal) statusCell = mCell(statusText, { fill: zf });
            else if (statusText.includes('สำรองน้ำมัน')) statusCell = oCell(statusText, { fill: zf });
            else statusCell = rCell(statusText, { fill: zf });
            const row = [
              cCell(r.customer || '-', { fill: zf }),
              cCell(r.route || '-', { fill: zf }),
              cCell(r.vtype || '-', { fill: zf }),
              cCell(r.date || '-', { fill: zf }),
              cCell(r.driver || '-', { fill: zf }),
              cCell(r.plate || '-', { fill: zf }),
              hasNum(oilPrice) ? cCell(oilPrice, { numFmt: nTHB, align: 'right', fill: zf }) : cCell('-', { align: 'right', fill: zf }),
              cCell(r.recv, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(r.pay, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(r.oil, { numFmt: nTHB, align: 'right', fill: zf }),
              mar < 0 ? rCell(mar, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(mar, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(pct, { numFmt: nPct, align: 'right', fill: zf }),
              statusCell
            ];
            wsData.push(row);
            rowIdx++;
          });
        });

        if (cards.length === 0) {
          const noData = [mCell('ไม่พบข้อมูลตามเงื่อนไขที่เลือก', { align: 'center', bold: true })];
          for (let i = 1; i < 13; i++) noData.push(cCell(''));
          wsData.push(noData);
        }

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [
          { wch: 14 }, { wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 13 },
          { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 40 }
        ];
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: 12 } }
        ];
        ws['!autofilter'] = { ref: 'A5:M5' };
        ws['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };
        return ws;
      }

      // Sheet 1: สรุปผล
      const ws1Data = [];
      ws1Data.push([cCell('รายงานวิเคราะห์และเปรียบเทียบผลการดำเนินงาน', { bold: true, color: '111827', sz: 14 }), cCell(''), cCell(''), cCell('')]);
      ws1Data.push([cCell('เงื่อนไขการกรองข้อมูล', { bold: true })]);
      ws1Data.push([cCell(
        filterSummaryText(),
        { color: '6B7280', sz: 9 }
      ), cCell(''), cCell(''), cCell('')]);
      ws1Data.push([cCell('หมายเหตุ: ไฟล์นี้สร้างจากข้อมูลในหน้าวิเคราะห์และเปรียบเทียบผลการดำเนินงาน', { color: '6B7280', sz: 9 }), cCell(''), cCell(''), cCell('')]);
      ws1Data.push([]);

      if (_isSingleMode) {
        ws1Data.push([hCell('รายการ'), hCell('ค่า'), cCell(''), cCell('')]);
        const d1 = [
          [cCell('ช่วงเวลา', { bold: true }), cCell(periodALabel)],
          [cCell('ราคารับรวม', { bold: true }), cCell(fmtNum(_stA.recv), { numFmt: nTHB, align: 'right' })],
          [cCell('ราคาจ่ายรวม', { bold: true }), cCell(fmtNum(_stA.pay), { numFmt: nTHB, align: 'right' })],
          [cCell('สำรองน้ำมัน', { bold: true }), cCell(fmtNum(_stA.oil), { numFmt: nTHB, align: 'right' })],
          [cCell('ส่วนต่างรวม', { bold: true }), _stA.margin < 0 ? rCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' })],
          [cCell('จำนวนเที่ยว', { bold: true }), cCell(_stA.trips, { numFmt: '#,##0', align: 'right' })],
          [cCell('กำไร %', { bold: true }), cCell(_stA.pct / 100, { numFmt: nPct, align: 'right' })]
        ];
        d1.forEach(r => ws1Data.push(r));
      } else {
        ws1Data.push([hCell('รายการ'), hCell(periodALabel), hCell(periodBLabel), hCell('ผลต่าง')]);
        const dR = _stA.recv - _stB.recv, dP = _stA.pay - _stB.pay, dO = _stA.oil - _stB.oil, dM = _stA.margin - _stB.margin;
        const rows = [
          [cCell('ราคารับรวม', { bold: true }), cCell(fmtNum(_stA.recv), { numFmt: nTHB, align: 'right' }), cCell(fmtNum(_stB.recv), { numFmt: nTHB, align: 'right' }), dR < 0 ? rCell(fmtNum(dR), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dR), { numFmt: nTHB, align: 'right' })],
          [cCell('ราคาจ่ายรวม', { bold: true }), cCell(fmtNum(_stA.pay), { numFmt: nTHB, align: 'right' }), cCell(fmtNum(_stB.pay), { numFmt: nTHB, align: 'right' }), dP < 0 ? rCell(fmtNum(dP), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dP), { numFmt: nTHB, align: 'right' })],
          [cCell('สำรองน้ำมัน', { bold: true }), cCell(fmtNum(_stA.oil), { numFmt: nTHB, align: 'right' }), cCell(fmtNum(_stB.oil), { numFmt: nTHB, align: 'right' }), dO < 0 ? rCell(fmtNum(dO), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dO), { numFmt: nTHB, align: 'right' })],
          [cCell('ส่วนต่างรวม', { bold: true }), _stA.margin < 0 ? rCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }), _stB.margin < 0 ? rCell(fmtNum(_stB.margin), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(_stB.margin), { numFmt: nTHB, align: 'right' }), dM < 0 ? rCell(fmtNum(dM), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dM), { numFmt: nTHB, align: 'right' })],
          [cCell('จำนวนเที่ยว', { bold: true }), cCell(_stA.trips, { numFmt: '#,##0', align: 'right' }), cCell(_stB.trips, { numFmt: '#,##0', align: 'right' }), gCell(_stA.trips - _stB.trips, { numFmt: '#,##0', align: 'right' })],
          [cCell('กำไร %', { bold: true }), cCell(_stA.pct / 100, { numFmt: nPct, align: 'right' }), cCell(_stB.pct / 100, { numFmt: nPct, align: 'right' }), gCell((_stA.pct - _stB.pct) / 100, { numFmt: nPct, align: 'right' })]
        ];
        rows.forEach(r => ws1Data.push(r));
      }
      ws1Data.push([]);
      ws1Data.push([cCell('สร้างเมื่อ: ' + new Date().toLocaleString('th-TH'), { color: '6B7280', sz: 9 })]);
      ws1Data.push([cCell('รูปแบบไฟล์: .xlsx สำหรับการเปิดใช้งานทั่วไป และมีข้อมูลชีทครบถ้วน', { color: '6B7280', sz: 9 })]);

      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 24 }, { wch: 24 }];
      ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } }];
      ws1['!autofilter'] = { ref: 'A5:D5' };
      ws1['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };

      // Sheet 2: รายละเอียดเส้นทาง
      const ws2Data = [];
      let h2, colCnt2;
      if (!_isSingleMode && _stB) {
        h2 = [
          'ลูกค้า', 'เส้นทาง', 'ประเภทรถ', 'เที่ยว',
          addPeriod('ราคารับ', periodALabel), addPeriod('ราคาจ่าย', periodALabel), addPeriod('สำรองน้ำมัน', periodALabel), addPeriod('ส่วนต่าง', periodALabel), addPeriod('กำไร %', periodALabel),
          addPeriod('ราคารับ', periodBLabel), addPeriod('ราคาจ่าย', periodBLabel), addPeriod('สำรองน้ำมัน', periodBLabel), addPeriod('ส่วนต่าง', periodBLabel), addPeriod('กำไร %', periodBLabel),
          'Δ ส่วนต่าง', 'สถานะ'
        ];
        colCnt2 = 16;
      } else {
        h2 = ['ลูกค้า', 'เส้นทาง', 'ประเภทรถ', 'เที่ยว', 'ราคารับ', 'ราคาจ่าย', 'สำรองน้ำมัน', 'ส่วนต่าง', 'กำไร %', 'สถานะ'];
        colCnt2 = 10;
      }
      ws2Data.push([cCell('รายละเอียดเส้นทาง', { bold: true, sz: 12, color: '111827' })]);
      ws2Data.push([cCell(filterSummaryText(), { color: '6B7280', sz: 9 })]);
      ws2Data.push([cCell(!_isSingleMode && _stB ? ('ช่วงแรก: ' + periodALabel + ' | ช่วงหลัง: ' + periodBLabel) : ('ช่วงข้อมูล: ' + periodALabel), { color: '374151', sz: 9 })]);
      ws2Data.push([]);
      const headerRow2 = ws2Data.length;
      ws2Data.push(h2.map(t => hCell(t)));

      let rowIdx2 = headerRow2 + 1;
      if (!_isSingleMode && _stB) {
        const bMap = {};
        (_stB.routes || []).forEach(r => { bMap[r.customer + '|' + r.route + '|' + r.vtype] = r; });
        const custGroups = {};
        (_stA.routes || []).forEach(ra => { if (!custGroups[ra.customer]) custGroups[ra.customer] = []; custGroups[ra.customer].push(ra); });
        Object.entries(custGroups).sort((a, b) => (custOrder[a[0]] ?? 999) - (custOrder[b[0]] ?? 999)).forEach(([cust, routes]) => {
          const cTrips = routes.reduce((s, r) => s + (r.trips || 0), 0);
          const cRecv = routes.reduce((s, r) => s + (r.recv || 0), 0);
          const cPay = routes.reduce((s, r) => s + (r.pay || 0), 0);
          const cOil = routes.reduce((s, r) => s + (r.oil || 0), 0);
          const cMargin = routes.reduce((s, r) => s + (r.margin || 0), 0);
          const cPct = cRecv > 0 ? (cMargin / cRecv) : 0;
          ws2Data.push([
            cCell(cust, { bold: true, fill: 'DBEAFE' }),
            cCell('รวม ' + routes.length + ' เส้นทาง', { bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }),
            cCell(cTrips, { numFmt: '#,##0', align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cRecv, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cPay, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cOil, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cMargin < 0 ? rCell(cMargin, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }) : gCell(cMargin, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cPct, { numFmt: nPct, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' })
          ]);
          rowIdx2++;
          routes.forEach(ra => {
            const rb = bMap[ra.customer + '|' + ra.route + '|' + ra.vtype];
            const dMar = rb ? (ra.margin - rb.margin) : ra.margin;
            const status = dMar < 0 ? 'ขาดทุนเพิ่ม' : (dMar > 0 ? 'กำไรเพิ่ม' : (ra.margin < 0 ? 'ขาดทุน' : 'ปกติ'));
            const zf = (rowIdx2 % 2 === 0) ? 'F9FAFB' : null;
            const cells = [
              cCell(ra.customer || '-', zf ? { fill: zf } : {}), cCell(ra.route, zf ? { fill: zf } : {}), cCell(ra.vtype, zf ? { fill: zf } : {}), cCell(ra.trips, { numFmt: '#,##0', align: 'right', fill: zf }),
              cCell(ra.recv, { numFmt: nTHB, align: 'right', fill: zf }), cCell(ra.pay, { numFmt: nTHB, align: 'right', fill: zf }), cCell(ra.oil, { numFmt: nTHB, align: 'right', fill: zf }),
              ra.margin < 0 ? rCell(ra.margin, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(ra.margin, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(ra.pct / 100, { numFmt: nPct, align: 'right', fill: zf })
            ];
            if (rb) {
              cells.push(cCell(rb.recv, { numFmt: nTHB, align: 'right', fill: zf }), cCell(rb.pay, { numFmt: nTHB, align: 'right', fill: zf }), cCell(rb.oil, { numFmt: nTHB, align: 'right', fill: zf }));
              cells.push(rb.margin < 0 ? rCell(rb.margin, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(rb.margin, { numFmt: nTHB, align: 'right', fill: zf }));
              cells.push(cCell(rb.pct / 100, { numFmt: nPct, align: 'right', fill: zf }));
            } else {
              cells.push(cCell('', { fill: zf }), cCell('', { fill: zf }), cCell('', { fill: zf }), cCell('', { fill: zf }), cCell('', { fill: zf }));
            }
            cells.push(dMar < 0 ? rCell(dMar, { numFmt: nTHB, align: 'right', fill: zf, bold: true }) : gCell(dMar, { numFmt: nTHB, align: 'right', fill: zf, bold: true }));
            if (status.includes('ขาดทุน')) cells.push(rCell(status, { align: 'center', fill: zf }));
            else if (status.includes('กำไร')) cells.push(gCell(status, { align: 'center', fill: zf }));
            else cells.push(mCell(status, { align: 'center', fill: zf }));
            ws2Data.push(cells);
            rowIdx2++;
          });
        });
        const onlyB = (_stB.routes || []).filter(rb => !(_stA.routes || []).some(ra => ra.customer === rb.customer && ra.route === rb.route && ra.vtype === rb.vtype));
        if (onlyB.length > 0) {
          ws2Data.push([cCell('เส้นทางเฉพาะช่วงหลัง: ' + periodBLabel, { bold: true, fill: '7C3AED', color: 'FFFFFF' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' }), cCell('', { fill: '7C3AED' })]);
          rowIdx2++;
          onlyB.forEach(rb => {
            const zf = (rowIdx2 % 2 === 0) ? 'F9FAFB' : null;
            const cells = [
              cCell(rb.customer, { fill: zf }), cCell(rb.route, { fill: zf }), cCell(rb.vtype, { fill: zf }), cCell(rb.trips, { numFmt: '#,##0', align: 'right', fill: zf }),
              cCell('', { fill: zf }), cCell('', { fill: zf }), cCell('', { fill: zf }), cCell('', { fill: zf }), cCell('', { fill: zf }),
              cCell(rb.recv, { numFmt: nTHB, align: 'right', fill: zf }), cCell(rb.pay, { numFmt: nTHB, align: 'right', fill: zf }), cCell(rb.oil, { numFmt: nTHB, align: 'right', fill: zf }),
              rb.margin < 0 ? rCell(rb.margin, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(rb.margin, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(rb.pct / 100, { numFmt: nPct, align: 'right', fill: zf }),
              gCell(rb.margin, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell('เฉพาะช่วงหลัง', { align: 'center', fill: zf })
            ];
            ws2Data.push(cells);
            rowIdx2++;
          });
        }
      } else {
        const _tripMap = {};
        (_stA.rows || []).forEach(tr => {
          const k = `${tr.customer || '-'}|${tr.route || '-'}|${tr.vtype || '-'}`;
          if (!_tripMap[k]) _tripMap[k] = [];
          _tripMap[k].push(tr);
        });
        const _anomCache = {};
        const getAnomalies = (r) => {
          const k = `${r.customer || '-'}|${r.route || '-'}|${r.vtype || '-'}`;
          if (_anomCache[k]) return _anomCache[k];
          const causes = [];
          const mg = r.margin || 0;
          if (mg < 0) { const lp = r.recv > 0 ? Math.abs(mg / r.recv * 100) : 0; causes.push({ text: `ขาดทุน ${lp.toFixed(0)}%`, color: 'red' }); }
          if ((r.oil || 0) > (r.pay || 0) * 0.5 && (r.pay || 0) > 0) causes.push({ text: 'สำรองน้ำมัน>50%', color: 'orange' });
          const rTrips = _tripMap[k] || [];
          if (rTrips.length > 1) {
            const aPay = rTrips.reduce((s, tr) => s + (tr.pay || 0), 0) / rTrips.length;
            const aOil = rTrips.reduce((s, tr) => s + (tr.oil || 0), 0) / rTrips.length;
            const aRecv = rTrips.reduce((s, tr) => s + (tr.recv || 0), 0) / rTrips.length;
            let hPay = false, hOil = false, lRecv = false;
            rTrips.forEach(tr => {
              if (aPay > 0 && (tr.pay || 0) > aPay * 1.05) hPay = true;
              if (aOil > 0 && (tr.oil || 0) > aOil * 1.10) hOil = true;
              if (aRecv > 0 && (tr.recv || 0) < aRecv * 0.95) lRecv = true;
            });
            if (hPay) causes.push({ text: 'ราคาจ่ายแพงกว่าค่าเฉลี่ย', color: 'purple' });
            if (hOil) causes.push({ text: 'สำรองน้ำมันแพงกว่าค่าเฉลี่ย', color: 'orange' });
            if (lRecv) causes.push({ text: 'ราคารับต่ำกว่าค่าเฉลี่ย', color: 'blue' });
          }
          const priority = { red: 1, orange: 2, purple: 3, blue: 4 };
          causes.sort((a, b) => priority[a.color] - priority[b.color]);
          _anomCache[k] = causes;
          return causes;
        };
        const custGroups = {};
        (_stA.routes || []).forEach(r => { if (!custGroups[r.customer]) custGroups[r.customer] = []; custGroups[r.customer].push(r); });
        Object.entries(custGroups).sort((a, b) => (custOrder[a[0]] ?? 999) - (custOrder[b[0]] ?? 999)).forEach(([cust, routes]) => {
          const cTrips = routes.reduce((s, r) => s + (r.trips || 0), 0);
          const cRecv = routes.reduce((s, r) => s + (r.recv || 0), 0);
          const cPay = routes.reduce((s, r) => s + (r.pay || 0), 0);
          const cOil = routes.reduce((s, r) => s + (r.oil || 0), 0);
          const cMargin = routes.reduce((s, r) => s + (r.margin || 0), 0);
          const cPct = cRecv > 0 ? (cMargin / cRecv) : 0;
          const anomCount = routes.filter(r => getAnomalies(r).length > 0).length;
          ws2Data.push([
            cCell(cust, { bold: true, fill: 'DBEAFE' }),
            cCell('รวม ' + routes.length + ' เส้นทาง' + (anomCount > 0 ? ' (' + anomCount + ' ผิดปกติ)' : ''), { bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }),
            cCell(cTrips, { numFmt: '#,##0', align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cRecv, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cPay, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cOil, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cMargin < 0 ? rCell(cMargin, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }) : gCell(cMargin, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(cPct, { numFmt: nPct, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' })
          ]);
          rowIdx2++;
          routes.forEach(r => {
            const anoms = getAnomalies(r);
            const statusTexts = anoms.map(c => c.text);
            const status = statusTexts.length ? statusTexts.join(', ') : 'ปกติ';
            const firstColor = anoms.length ? anoms[0].color : 'normal';
            const zf = (rowIdx2 % 2 === 0) ? 'F9FAFB' : null;
            const cells = [
              cCell(r.customer, { fill: zf }), cCell(r.route, { fill: zf }), cCell(r.vtype, { fill: zf }), cCell(r.trips, { numFmt: '#,##0', align: 'right', fill: zf }),
              cCell(r.recv, { numFmt: nTHB, align: 'right', fill: zf }), cCell(r.pay, { numFmt: nTHB, align: 'right', fill: zf }), cCell(r.oil, { numFmt: nTHB, align: 'right', fill: zf }),
              r.margin < 0 ? rCell(r.margin, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(r.margin, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(r.pct / 100, { numFmt: nPct, align: 'right', fill: zf })
            ];
            if (firstColor === 'red') cells.push(rCell(status, { align: 'center', fill: zf }));
            else if (firstColor === 'orange') cells.push(oCell(status, { align: 'center', fill: zf }));
            else if (firstColor === 'purple') cells.push(pCell(status, { align: 'center', fill: zf }));
            else if (firstColor === 'blue') cells.push(bCell(status, { align: 'center', fill: zf }));
            else cells.push(mCell(status, { align: 'center', fill: zf }));
            ws2Data.push(cells);
            rowIdx2++;
          });
        });
      }
      if (ws2Data.length === headerRow2 + 1) {
        const noDataRow2 = [mCell('ไม่พบข้อมูลตามเงื่อนไขที่เลือก', { align: 'center', bold: true })];
        for (let i = 1; i < colCnt2; i++) noDataRow2.push(cCell(''));
        ws2Data.push(noDataRow2);
      }
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      const w2cols = !_isSingleMode && _stB
        ? [{ wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }]
        : [{ wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 }];
      ws2['!cols'] = w2cols;
      ws2['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: colCnt2 - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: colCnt2 - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: colCnt2 - 1 } }
      ];
      ws2['!autofilter'] = { ref: 'A5:' + XLSX.utils.encode_cell({ c: colCnt2 - 1, r: 4 }) };
      ws2['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };

      // Sheet 3: รายเที่ยว
      const ws3Data = [];
      const h3 = ['ช่วงเวลา', 'วันที่', 'ลูกค้า', 'เส้นทาง', 'ประเภทรถ', 'ราคารับ', 'ราคาจ่าย', 'สำรองน้ำมัน', 'ส่วนต่าง', 'กำไร %', 'หมายเหตุ'];
      ws3Data.push([cCell('รายเที่ยว', { bold: true, sz: 12, color: '111827' })]);
      ws3Data.push([cCell(filterSummaryText(), { color: '6B7280', sz: 9 })]);
      ws3Data.push([cCell(!_isSingleMode && _stB ? ('ช่วงแรก: ' + periodALabel + ' | ช่วงหลัง: ' + periodBLabel) : ('ช่วงข้อมูล: ' + periodALabel), { color: '374151', sz: 9 })]);
      ws3Data.push([]);
      const headerRow3 = ws3Data.length;
      ws3Data.push(h3.map(t => hCell(t)));

      const allTrips = (_stA.rows || []).map(r => ({ ...r, _src: 'A' }));
      if (!_isSingleMode && _stB && _stB.rows) {
        _stB.rows.forEach(r => { allTrips.push({ ...r, _src: 'B' }); });
      }
      allTrips.sort((a, b) => {
        const da = String(a.date || '');
        const db = String(b.date || '');
        if (da !== db) return da.localeCompare(db);
        const ca = String(a.customer || '').trim().toUpperCase();
        const cb = String(b.customer || '').trim().toUpperCase();
        if ((custOrder[ca] ?? 999) !== (custOrder[cb] ?? 999)) return (custOrder[ca] ?? 999) - (custOrder[cb] ?? 999);
        return String(a.route || '').localeCompare(String(b.route || ''));
      });

      let rowIdx3 = headerRow3 + 1;
      allTrips.forEach(r => {
        const mar = (r.recv || 0) - (r.pay || 0) - (r.oil || 0);
        const pct = (r.recv || 0) ? (mar / r.recv * 100) : 0;
        const reasons = [];
        if (mar < 0) reasons.push('ขาดทุน');
        if ((r.oil || 0) > (r.pay || 0) * 0.5 && (r.pay || 0) > 0) reasons.push('สำรองน้ำมัน>50%');
        const periodLabel = (r._src === 'B') ? periodBLabel : periodALabel;
        const note = reasons.length ? reasons.join(', ') : 'ปกติ';
        const zf = (rowIdx3 % 2 === 0) ? 'F9FAFB' : null;
        const bf = (r._src === 'B') ? 'FEF3C7' : zf;
        const cells = [
          cCell(periodLabel, { fill: bf, align: 'center' }),
          cCell(r.date, { fill: bf }), cCell(r.customer, { fill: bf }), cCell(r.route, { fill: bf }), cCell(r.vtype, { fill: bf }),
          cCell(r.recv, { numFmt: nTHB, align: 'right', fill: bf }), cCell(r.pay, { numFmt: nTHB, align: 'right', fill: bf }), cCell(r.oil, { numFmt: nTHB, align: 'right', fill: bf }),
          mar < 0 ? rCell(mar, { numFmt: nTHB, align: 'right', fill: bf }) : gCell(mar, { numFmt: nTHB, align: 'right', fill: bf }),
          cCell(pct / 100, { numFmt: nPct, align: 'right', fill: bf })
        ];
        if (note.includes('ขาดทุน')) cells.push(rCell(note, { fill: bf }));
        else if (note.includes('สำรองน้ำมัน')) cells.push(oCell(note, { fill: bf }));
        else cells.push(cCell(note, { fill: bf }));
        ws3Data.push(cells);
        rowIdx3++;
      });
      if (allTrips.length === 0) {
        const noDataRow3 = [mCell('ไม่พบข้อมูลตามเงื่อนไขที่เลือก', { align: 'center', bold: true })];
        for (let i = 1; i < 11; i++) noDataRow3.push(cCell(''));
        ws3Data.push(noDataRow3);
      }

      const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
      ws3['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 35 }];
      ws3['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 10 } }
      ];
      ws3['!autofilter'] = { ref: 'A5:K5' };
      ws3['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };

      let ws4 = null, ws5 = null, ws6 = null;
      if (!_isSingleMode && _stB) {
        const anomalyCards = buildAnomalyExportCards(_stA, _stB);
        const ws4Data = [];
        ws4Data.push([cCell('ตรวจหาความผิดปกติรายเส้นทาง', { bold: true, sz: 12, color: '111827' })]);
        ws4Data.push([cCell(filterSummaryText(), { color: '6B7280', sz: 9 })]);
        ws4Data.push([cCell('แสดงเส้นทางที่มีสัญญาณผิดปกติจากข้อมูลเปรียบเทียบทั้งสองช่วง: ' + periodALabel + ' และ ' + periodBLabel, { color: '374151', sz: 9 })]);
        ws4Data.push([]);
        const h4 = [
          'ลูกค้า', 'เส้นทาง', 'ประเภทรถ',
          addPeriod('วันที่', periodALabel), addPeriod('พขร.', periodALabel), addPeriod('ราคาน้ำมัน', periodALabel), addPeriod('ราคารับ', periodALabel), addPeriod('ราคาจ่าย', periodALabel), addPeriod('สำรองน้ำมัน', periodALabel), addPeriod('ส่วนต่าง', periodALabel),
          addPeriod('วันที่', periodBLabel), addPeriod('พขร.', periodBLabel), addPeriod('ราคาน้ำมัน', periodBLabel), addPeriod('ราคารับ', periodBLabel), addPeriod('ราคาจ่าย', periodBLabel), addPeriod('สำรองน้ำมัน', periodBLabel), addPeriod('ส่วนต่าง', periodBLabel),
          'Δ ส่วนต่าง', 'สัญญาณผิดปกติ'
        ];
        const headerRow4 = ws4Data.length;
        ws4Data.push(h4.map(t => hCell(t)));
        let rowIdx4 = headerRow4 + 1;

        anomalyCards.forEach(card => {
          const top = [
            cCell(card.ga.customer || '-', { bold: true, fill: 'DBEAFE' }),
            cCell(card.ga.route || '-', { bold: true, fill: 'DBEAFE' }),
            cCell(card.ga.vtype || '-', { bold: true, fill: 'DBEAFE' }),
            cCell('พบผิดปกติ ' + (card.rows || []).length + ' รายการ', { bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' })
          ];
          ws4Data.push(top);
          rowIdx4++;

          (card.rows || []).forEach(entry => {
            const ra = entry.ra || {};
            const rb = entry.rb || {};
            const mA = (ra.margin == null || isNaN(ra.margin)) ? ((ra.recv || 0) - (ra.pay || 0) - (ra.oil || 0)) : ra.margin;
            const mB = (rb.margin == null || isNaN(rb.margin)) ? ((rb.recv || 0) - (rb.pay || 0) - (rb.oil || 0)) : rb.margin;
            const dM = mA - mB;
            const reasons = (entry.reasons || []).join(', ');
            const oilPriceA = getOilPriceByDate(ra.date);
            const oilPriceB = getOilPriceByDate(rb.date);
            const zf = (rowIdx4 % 2 === 0) ? 'F9FAFB' : null;
            const row = [
              cCell(ra.customer || rb.customer || '-', { fill: zf }),
              cCell(ra.route || rb.route || '-', { fill: zf }),
              cCell(ra.vtype || rb.vtype || '-', { fill: zf }),
              cCell(ra.date || '-', { fill: zf }),
              cCell(ra.driver || '-', { fill: zf }),
              hasNum(oilPriceA) ? cCell(oilPriceA, { numFmt: nTHB, align: 'right', fill: zf }) : cCell('-', { align: 'right', fill: zf }),
              cCell(ra.recv, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(ra.pay, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(ra.oil, { numFmt: nTHB, align: 'right', fill: zf }),
              mA < 0 ? rCell(mA, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(mA, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(rb.date || '-', { fill: zf }),
              cCell(rb.driver || '-', { fill: zf }),
              hasNum(oilPriceB) ? cCell(oilPriceB, { numFmt: nTHB, align: 'right', fill: zf }) : cCell('-', { align: 'right', fill: zf }),
              cCell(rb.recv, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(rb.pay, { numFmt: nTHB, align: 'right', fill: zf }),
              cCell(rb.oil, { numFmt: nTHB, align: 'right', fill: zf }),
              mB < 0 ? rCell(mB, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(mB, { numFmt: nTHB, align: 'right', fill: zf }),
              dM < 0 ? rCell(dM, { numFmt: nTHB, align: 'right', fill: zf, bold: true }) : gCell(dM, { numFmt: nTHB, align: 'right', fill: zf, bold: true }),
              rCell(reasons, { fill: zf })
            ];
            ws4Data.push(row);
            rowIdx4++;
          });
        });

        if (anomalyCards.length === 0) {
          const noData4 = [mCell('ไม่พบความผิดปกติในช่วงเวลาที่เลือก', { align: 'center', bold: true })];
          for (let i = 1; i < 19; i++) noData4.push(cCell(''));
          ws4Data.push(noData4);
        }

        ws4 = XLSX.utils.aoa_to_sheet(ws4Data);
        ws4['!cols'] = [
          { wch: 14 }, { wch: 34 }, { wch: 12 },
          { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
          { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
          { wch: 14 }, { wch: 40 }
        ];
        ws4['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 18 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 18 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: 18 } }
        ];
        ws4['!autofilter'] = { ref: 'A5:S5' };
        ws4['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };

        const unmatchedACards = buildUnmatchedExportCards(_stA.rows, _stB.rows);
        const unmatchedBCards = buildUnmatchedExportCards(_stB.rows, _stA.rows);
        ws5 = buildUnmatchedSheet(
          unmatchedACards,
          'รายเส้นทางที่ไม่ถูกเปรียบเทียบ: ' + periodALabel + ' (พบเฉพาะช่วงแรก และไม่มีคู่เปรียบเทียบในอีกช่วงเวลา)',
          periodALabel,
          periodBLabel
        );
        ws6 = buildUnmatchedSheet(
          unmatchedBCards,
          'รายเส้นทางที่ไม่ถูกเปรียบเทียบ: ' + periodBLabel + ' (พบเฉพาะช่วงหลัง และไม่มีคู่เปรียบเทียบจากช่วงก่อนหน้า)',
          periodBLabel,
          periodALabel
        );
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'สรุปผล');
      XLSX.utils.book_append_sheet(wb, ws2, 'รายละเอียดเส้นทาง');
      XLSX.utils.book_append_sheet(wb, ws3, 'รายเที่ยว');
      if (ws4) XLSX.utils.book_append_sheet(wb, ws4, 'ผิดปกติรายเส้นทาง');
      if (ws5) XLSX.utils.book_append_sheet(wb, ws5, 'ไม่ถูกเทียบช่วงแรก');
      if (ws6) XLSX.utils.book_append_sheet(wb, ws6, 'ไม่ถูกเทียบช่วงหลัง');

      const safeFilePart = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
      const fileName = 'วิเคราะห์ผลการดำเนินงาน_' + safeFilePart(periodALabel) + (_isSingleMode ? '' : '_vs_' + safeFilePart(periodBLabel)) + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
      XLSX.writeFile(wb, fileName, { bookType: 'xlsx', cellStyles: true });
    };

    document.getElementById('dc_compare_btn')?.addEventListener('click', dcRunCompare);
    dcRunCompare();
  }, 50);

  // Animation: add visible class after small delay
  setTimeout(() => {
    document.querySelectorAll('.master-section').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 80);
    });
  }, 50);

  return html;
}

// โ”€โ”€ Oil Price: CSV loader โ”€โ”€
let oilPriceCsvLoaded = false;
async function loadOilPriceCsv(force) {
  if (isApiEnabled()) return false;
  if (oilPriceCsvLoaded && !force) return false;
  try {
    const res = await fetch('data/oil-price.csv');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return false;
    const prices = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 2) continue;
      const date = cols[0].trim();
      const price = parseFloat(cols[1]);
      if (date && !isNaN(price)) {
        const d = new Date(date);
        prices.push({
          period_no: date.replace(/-/g, ''),
          period_name: date,
          year_en: d.getFullYear(),
          update_date: date + 'T00:00:00.000Z',
          price: price
        });
      }
    }
    prices.sort((a, b) => String(a.period_no).localeCompare(String(b.period_no)));
    if (typeof OIL_PRICE_DATA !== 'undefined') {
      OIL_PRICE_DATA.prices = prices;
      OIL_PRICE_DATA.lastFetch = new Date().toISOString();
      OIL_PRICE_DATA.source = 'PTTOR';
      OIL_PRICE_DATA.sourceUrl = 'https://www.pttor.com/news/oil-price';
      OIL_PRICE_DATA.productLabel = 'ดีเซล (ราคาขายปลีก กทม. และปริมณฑล)';
    }
    oilPriceCsvLoaded = true;
    return true;
  } catch (err) {
    console.error('Failed to load CSV:', err);
    return false;
  }
}

/* ─── Page 3: ราคาน้ำมันดีเซลและต้นทุน (Oil Price) ─── */
function buildOilPricePage(d) {
  const op = (typeof OIL_PRICE_DATA !== 'undefined') ? OIL_PRICE_DATA : null;
  const prices = op?.prices || [];
  const latest = prices.length ? prices[prices.length - 1] : null;
  const prev = prices.length >= 2 ? prices[prices.length - 2] : null;
  const trend = prices.slice(-30);

  let changeVal = 0, changePct = 0, changeDir = 'same';
  if (latest && prev && latest.price != null && prev.price != null) {
    changeVal = latest.price - prev.price;
    changePct = prev.price !== 0 ? (changeVal / prev.price) * 100 : 0;
    changeDir = changeVal > 0 ? 'up' : (changeVal < 0 ? 'down' : 'same');
  }

  const fmtThaiDate = iso => {
    if (!iso) return '—';
    const dt = new Date(iso);
    if (isNaN(dt)) return '—';
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()+543}`;
  };

  const allPrices = prices.map(p => p.price).filter(v => v != null);
  const avgPrice = allPrices.length ? allPrices.reduce((a,b)=>a+b,0)/allPrices.length : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 0;
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const totalRecords = prices.length;

  const sparkline = (vals, width=100, height=28) => {
    const clean = vals.filter(v => v != null);
    if (clean.length < 2) return '';
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const points = clean.map((v, i) => {
      const x = (i / (clean.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const lastY = height - ((clean[clean.length-1] - min) / range) * (height - 4) - 2;
    const color = clean[clean.length-1] >= clean[0] ? '#ef4444' : '#22c55e';
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="opacity:0.9;">
      <defs><linearGradient id="spkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>
      <path d="M${points.join(' L')} L${width},${height} L0,${height} Z" fill="url(#spkGrad)" stroke="none" />
      <path d="M${points.join(' L')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${width}" cy="${lastY.toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
  };

  let html = `
  <style>
    .op-page { animation: opFadeIn 0.6s ease-out; }
    @keyframes opFadeIn { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
    .op-hero { display:grid; grid-template-columns: 1.6fr 1fr; gap:20px; margin-bottom:24px; }
    .op-hero-main { background: linear-gradient(145deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.95) 100%); border:1px solid rgba(255,255,255,0.06); border-radius:18px; padding:32px; position:relative; overflow:hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .op-hero-main::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent); }
    .op-hero-accent { position:absolute; top:-60px; right:-60px; width:200px; height:200px; background:radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%); border-radius:50%; pointer-events:none; }
    .op-hero-label { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:1.5px; margin-bottom:12px; }
    .op-hero-price { font-size:56px; font-weight:800; color:#22c55e; line-height:1; letter-spacing:-1px; text-shadow: 0 0 40px rgba(34,197,94,0.15); }
    .op-hero-unit { font-size:16px; font-weight:600; color:var(--muted); margin-left:6px; vertical-align:middle; }
    .op-hero-meta { margin-top:16px; font-size:13px; color:var(--muted); display:flex; align-items:center; gap:8px; }
    .op-hero-dot { width:6px; height:6px; background:#22c55e; border-radius:50%; box-shadow:0 0 8px rgba(34,197,94,0.6); }
    .op-hero-spark { position:absolute; top:50%; right:28px; transform:translateY(-50%); width:62%; opacity:0.7; z-index:1; pointer-events:none; }
    .op-hero-side { display:flex; flex-direction:column; gap:16px; }
    .op-change-card { background: linear-gradient(145deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9)); border:1px solid rgba(255,255,255,0.05); border-radius:16px; padding:24px; position:relative; overflow:hidden; transition: transform 0.3s; }
    .op-change-card:hover { transform: translateY(-2px); }
    .op-change-card.up { border-color: rgba(239,68,68,0.2); background: linear-gradient(145deg, rgba(239,68,68,0.08), rgba(15,23,42,0.9)); }
    .op-change-card.down { border-color: rgba(34,197,94,0.2); background: linear-gradient(145deg, rgba(34,197,94,0.08), rgba(15,23,42,0.9)); }
    .op-change-label { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:1.2px; margin-bottom:10px; }
    .op-change-value { font-size:36px; font-weight:800; line-height:1; letter-spacing:-0.5px; }
    .op-change-value.up { color: #ef4444; }
    .op-change-value.down { color: #22c55e; }
    .op-change-value.same { color: var(--text); }
    .op-change-pill { display:inline-flex; align-items:center; gap:4px; margin-top:10px; font-size:12px; font-weight:700; padding:4px 12px; border-radius:20px; background:rgba(255,255,255,0.04); }
    .op-change-pill.up { color:#ef4444; background:rgba(239,68,68,0.1); }
    .op-change-pill.down { color:#22c55e; background:rgba(34,197,94,0.1); }
    .op-change-pill.same { color:var(--muted); }
    .op-stats-row { display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; margin-bottom:28px; }
    .op-stat { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; display:flex; flex-direction:column; gap:6px; transition: all 0.2s; }
    .op-stat:hover { border-color:rgba(255,255,255,0.12); transform:translateY(-1px); }
    .op-stat-label { font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
    .op-stat-value { font-size:22px; font-weight:800; color:var(--text); line-height:1; }
    .op-stat-sub { font-size:11px; color:var(--muted); margin-top:2px; }
    .op-source-bar { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
    .op-source-info { display:flex; align-items:center; gap:10px; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:8px 16px; font-size:12px; color:var(--muted); }
    .op-source-info a { color:var(--accent); font-weight:600; text-decoration:none; transition:opacity 0.2s; }
    .op-source-info a:hover { opacity:0.8; text-decoration:underline; }
    .op-section-v2 { background:var(--card); border:1px solid var(--border); border-radius:18px; overflow:hidden; opacity:0; transform:translateY(30px) scale(0.98); transition:opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1); }
    .op-section-v2.visible { opacity:1; transform:translateY(0) scale(1); }
    .op-section-v2:nth-child(1) { transition-delay:0.05s; }
    .op-section-v2:nth-child(2) { transition-delay:0.15s; }
    .op-section-v2:nth-child(3) { transition-delay:0.25s; }
    .op-section-header-v2 { padding:20px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:14px; background:linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%); }
    .op-section-icon { width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1)); border:1px solid rgba(59,130,246,0.2); display:flex; align-items:center; justify-content:center; color:var(--accent); font-size:16px; }
    .op-section-title-v2 { font-size:16px; font-weight:700; color:var(--text); letter-spacing:-0.2px; }
    .op-section-count { font-size:12px; font-weight:700; color:var(--muted); background:var(--surface); padding:4px 12px; border-radius:20px; border:1px solid var(--border); margin-left:auto; }
    .op-month-grid-v2 { display:grid; grid-template-columns: repeat(3, 1fr); gap:20px; padding:24px; }
    .op-month-card-v2 { background:linear-gradient(180deg, rgba(30,41,59,0.6) 0%, var(--card) 100%); border:1px solid var(--border); border-radius:16px; overflow:hidden; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); position:relative; }
    .op-month-card-v2:hover { transform:translateY(-4px); box-shadow:0 20px 40px rgba(0,0,0,0.25); border-color:rgba(255,255,255,0.1); }
    .op-month-card-v2::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg, #3b82f6, #8b5cf6); opacity:0.7; }
    .op-month-header-v2 { padding:18px 20px 14px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .op-month-title-v2 { font-size:16px; font-weight:700; color:var(--text); letter-spacing:-0.3px; line-height:1.2; }
    .op-month-year { font-size:12px; font-weight:600; color:var(--muted); margin-top:4px; }
    .op-month-badge-v2 { font-size:11px; font-weight:700; color:var(--accent); background:rgba(59,130,246,0.08); padding:4px 10px; border-radius:20px; border:1px solid rgba(59,130,246,0.15); white-space:nowrap; flex-shrink:0; }
    .op-month-spark { margin-top:8px; height:28px; }
    .op-month-body-v2 { padding:0 8px 12px; }
    .op-price-row-v2 { margin:0 12px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; border-radius:8px; transition:background 0.15s; }
    .op-price-row-v2:hover { background:rgba(59,130,246,0.04); }
    .op-price-row-v2.latest { background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.12); }
    .op-price-date-v2 { font-size:13px; color:var(--muted); font-weight:600; font-family:inherit; }
    .op-price-value-v2 { font-size:15px; font-weight:800; color:var(--text); display:flex; align-items:center; gap:6px; }
    .op-price-unit { font-size:11px; color:var(--muted); font-weight:600; }
    .op-price-change-v2 { font-size:12px; font-weight:700; padding:3px 10px; border-radius:6px; background:rgba(255,255,255,0.04); min-width:52px; text-align:right; }
    .op-price-change-v2.up { color:#ef4444; background:rgba(239,68,68,0.08); }
    .op-price-change-v2.down { color:#22c55e; background:rgba(34,197,94,0.08); }
    .op-price-change-v2.same { color:var(--muted); background:rgba(255,255,255,0.04); }
    .op-divider { height:1px; background:var(--border); margin:0 12px; }
    @media(max-width:1100px) { .op-month-grid-v2 { grid-template-columns: repeat(2, 1fr); } }
    @media(max-width:900px) { .op-hero { grid-template-columns: 1fr; } .op-stats-row { grid-template-columns: repeat(2, 1fr); } }
    @media(max-width:768px) { .op-month-grid-v2 { grid-template-columns: 1fr; padding:16px; } .op-stats-row { grid-template-columns: repeat(2, 1fr); } .op-hero-main { padding:24px; } .op-hero-price { font-size:42px; } }
    @media(max-width:480px) { .op-stats-row { grid-template-columns: 1fr; } .op-hero-price { font-size:36px; } }
  </style>

  <!-- Source Bar -->
  <div class="op-source-bar">
    <div class="op-source-info">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent);flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      <span>แหล่งข้อมูล: <a href="${esc(op?.sourceUrl || 'https://www.pttor.com/news/oil-price')}" target="_blank" rel="noopener noreferrer">${op?.source || 'PTTOR'}</a></span>
    </div>
    <div class="op-source-info">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent);flex-shrink:0"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span>อัปเดตล่าสุด: ${fmtThaiDate(op?.lastFetch)}</span>
    </div>
  </div>

  <!-- Hero Section -->
  <div class="op-hero">
    <div class="op-hero-main">
      <div class="op-hero-accent"></div>
      <div class="op-hero-label">ราคาดีเซลล่าสุด</div>
      <div>
        <span class="op-hero-price">${latest ? fmt(latest.price) : '—'}</span>
        <span class="op-hero-unit">บาท/ลิตร</span>
      </div>
      <div class="op-hero-meta">
        <div class="op-hero-dot"></div>
        <span>วันที่มีผล ${latest ? fmtThaiDate(latest.update_date) : '—'}</span>
      </div>
      <div class="op-hero-spark">${sparkline(trend.map(p=>p.price), 320, 100)}</div>
    </div>
    <div class="op-hero-side">
      <div class="op-change-card ${changeDir}">
        <div class="op-change-label">เปลี่ยนแปลงจากงวดก่อน</div>
        <div class="op-change-value ${changeDir}">${changeVal !== 0 ? (changeVal > 0 ? '+' : '') + fmt(changeVal) : '0.00'}</div>
        <div class="op-change-pill ${changeDir}">
          ${changeDir === 'up' ? '▲' : changeDir === 'down' ? '▼' : '—'} ${changeVal !== 0 ? fmtP(Math.abs(changePct)) : '0.00%'}
        </div>
      </div>
      <div class="op-change-card" style="display:flex;flex-direction:column;justify-content:center;">
        <div class="op-change-label" style="margin-bottom:8px;">หมายเหตุ</div>
        <div style="font-size:15px;font-weight:600;color:var(--muted);line-height:1.6;">
          ราคานี้ไม่รวมภาษีบำรุงท้องที่ <span style="opacity:0.6;">(ถ้ามี)</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Stats Row -->
  <div class="op-stats-row">
    <div class="op-stat">
      <div class="op-stat-label">ราคาเฉลี่ย</div>
      <div class="op-stat-value">${fmt(avgPrice)} <span style="font-size:14px;color:var(--muted);font-weight:600;">บาท</span></div>
      <div class="op-stat-sub">เฉลี่ยจาก ${totalRecords} รายการ</div>
    </div>
    <div class="op-stat">
      <div class="op-stat-label">ราคาสูงสุด</div>
      <div class="op-stat-value" style="color:#ef4444;">${fmt(maxPrice)}</div>
      <div class="op-stat-sub">บาท/ลิตร</div>
    </div>
    <div class="op-stat">
      <div class="op-stat-label">ราคาต่ำสุด</div>
      <div class="op-stat-value" style="color:#22c55e;">${fmt(minPrice)}</div>
      <div class="op-stat-sub">บาท/ลิตร</div>
    </div>
    <div class="op-stat">
      <div class="op-stat-label">จำนวนข้อมูล</div>
      <div class="op-stat-value">${totalRecords}</div>
      <div class="op-stat-sub">งวดที่บันทึก</div>
    </div>
  </div>

  <!-- Monthly Price Cards -->
  <div class="op-section-v2">
    <div class="op-section-header-v2">
      <div class="op-section-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      </div>
      <div class="op-section-title-v2">ประวัติราคาย้อนหลัง</div>
      <div class="op-section-count">${prices.length} รายการ</div>
    </div>
    <div class="op-month-grid-v2">
      ${(() => {
        const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        const sorted = [...prices].sort((a, b) => String(b.period_no).localeCompare(String(a.period_no)));
        const withDiff = sorted.map((p, i, arr) => {
          const prev = arr[i + 1];
          const diff = prev && p.price != null && prev.price != null ? p.price - prev.price : 0;
          return { ...p, diff };
        });
        const groups = {};
        withDiff.forEach(p => {
          const d = new Date(p.update_date || p.period_name);
          if (isNaN(d)) return;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!groups[key]) groups[key] = { monthName: thaiMonths[d.getMonth()], year: d.getFullYear(), items: [] };
          groups[key].items.push(p);
        });
        const keys = Object.keys(groups).sort().reverse();
        return keys.map(key => {
          const g = groups[key];
          const pricesArr = g.items.map(p => p.price).reverse();
          return `
          <div class="op-month-card-v2">
            <div class="op-month-header-v2">
              <div>
                <div class="op-month-title-v2">${g.monthName}</div>
                <div class="op-month-year">${g.year + 543}</div>
                <div class="op-month-spark">${sparkline(pricesArr, 90, 24)}</div>
              </div>
              <span class="op-month-badge-v2">${g.items.length} รายการ</span>
            </div>
            <div class="op-month-body-v2">
              ${g.items.map((p, idx) => {
                const diffClass = p.diff > 0 ? 'up' : p.diff < 0 ? 'down' : 'same';
                const diffSign = p.diff > 0 ? '+' : '';
                const isLatestInMonth = idx === 0;
                return `
                <div class="op-price-row-v2 ${isLatestInMonth ? 'latest' : ''}">
                  <div class="op-price-date-v2">${fmtThaiDate(p.update_date)}</div>
                  <div style="display:flex;align-items:center;gap:12px;">
                    <div class="op-price-value-v2">${fmt(p.price)} <span class="op-price-unit">บาท/ลิตร</span></div>
                    <div class="op-price-change-v2 ${diffClass}">${p.diff !== 0 ? diffSign + fmt(p.diff) : '—'}</div>
                  </div>
                </div>
                ${idx < g.items.length - 1 ? '<div class="op-divider"></div>' : ''}`;
              }).join('')}
            </div>
          </div>`;
        }).join('');
      })()}
    </div>
  </div>

  `;

  setTimeout(() => {
    document.querySelectorAll('.op-section-v2').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 80);
    });
  }, 50);

  return html;
}

function initNav() {
  const nav = document.getElementById('navList');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const sidebar = document.querySelector('.sidebar');
  if (!nav || !sidebar) return;

  let sidebarAnimating = false;
  let pendingSidebarState = null;
  const applySidebarState = (collapsed) => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    updateSidebarMeta();
  };
  const setSidebarState = (collapsed) => {
    pendingSidebarState = collapsed;
    if (sidebarAnimating) return;
    sidebarAnimating = true;
    window.requestAnimationFrame(() => {
      const next = pendingSidebarState;
      pendingSidebarState = null;
      applySidebarState(next);
      const finish = () => {
        sidebar.removeEventListener('transitionend', finish);
        sidebarAnimating = false;
        if (pendingSidebarState !== null && pendingSidebarState !== document.body.classList.contains('sidebar-collapsed')) {
          const queued = pendingSidebarState;
          pendingSidebarState = null;
          setSidebarState(queued);
        }
      };
      sidebar.addEventListener('transitionend', finish);
      window.setTimeout(() => {
        sidebar.removeEventListener('transitionend', finish);
        finish();
      }, 380);
    });
  };

  nav.innerHTML = PAGES.map((p, idx) => `<button type="button" class="nav-item${idx === 0 ? ' active' : ''}" data-idx="${idx}" aria-label="${p.title}">
    <span class="nav-icon" aria-hidden="true">${p.icon}</span>
    <span class="nav-copy">
      <span class="nav-label">${p.title}</span>
    </span>
  </button>`).join('');

  nav.addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    nav.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    showPage(+item.dataset.idx);
    document.body.classList.remove('sidebar-open');
  });

  sidebarToggle?.addEventListener('click', () => {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    setSidebarState(collapsed);
    document.body.classList.remove('sidebar-open');
  });
  sidebarBackdrop?.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.body.classList.remove('sidebar-open');
  });
}

function showPage(idx) {
  currentPage = idx;
  const num = String(idx + 1).padStart(2, '0');
  document.getElementById('pageTitle').innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;padding:4px 0;">
      <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(139,92,246,0.05) 100%);border:1px solid rgba(59,130,246,0.2);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 4px 15px rgba(0,0,0,0.05);position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;width:100%;height:3px;background:linear-gradient(90deg, #3b82f6, #8b5cf6);"></div>
        <span style="font-size:10px;font-weight:800;color:#3b82f6;letter-spacing:1px;margin-bottom:2px;text-transform:uppercase;">Part</span>
        <span style="font-size:22px;font-weight:800;color:var(--text);line-height:1;">${num}</span>
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:24px;font-weight:700;color:var(--text);letter-spacing:-0.3px;line-height:1.2;">${PAGES[idx].title}</div>
      </div>
    </div>`;
  document.getElementById('pageBadge').textContent = `${idx + 1} / ${PAGES.length}`;
  const c = document.getElementById('content');
  // Toggle master-no-scroll class for fixed card grid
  if (idx === 0) {
    c.classList.add('master-no-scroll');
    c.classList.add('page-master');
    c.style.padding = '12px';
    c.style.overflow = 'hidden';
  } else {
    c.classList.remove('master-no-scroll');
    c.classList.remove('page-master');
    c.style.padding = '';
    c.style.overflow = '';
  }
  document.body.classList.remove('sidebar-open');
  const builders = [buildMasterDashboard, buildDailyCompare, buildOilPricePage];
  c.innerHTML = `${renderDataSourceNotice()}${builders[idx](DATA)}`;
  c.scrollTop = 0;

  // Auto-load oil price CSV when opening page 2 for static mode only
  if (idx === 2 && DATA_SOURCE_STATE.oil === 'static') {
    loadOilPriceCsv().then(updated => {
      if (updated) {
        c.innerHTML = `${renderDataSourceNotice()}${builders[2](DATA)}`;
        c.scrollTop = 0;
      }
    });
  }
}

function renderDataSourceNotice() {
  if (!isApiEnabled()) return '';
  const notes = DATA_SOURCE_STATE.notes.slice();
  if (notes.length === 0) return '';
  return `
    <div style="margin:0 0 12px;padding:12px 14px;border:1px solid rgba(245,158,11,0.26);background:linear-gradient(180deg, rgba(245,158,11,0.08), rgba(245,158,11,0.04));border-radius:12px;color:#fcd34d;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.3px;margin-bottom:4px;">กำลังใช้ข้อมูลสำรองบางส่วน</div>
      <div style="font-size:12px;line-height:1.6;color:#f3f4f6;">${esc(notes.join(' | '))}</div>
    </div>`;
}

function updateSidebarMeta() {
  const d = DATA;
  if (!d || !d.routeTrend) return;
  const active = getActiveMonths(d, 'routeTrend');
  const months = active.length > 0 ? active : MONTHS.slice();
  const first = MTH[months[0]] || months[0];
  const last  = MTH[months[months.length - 1]] || months[months.length - 1];
  const total = d.summary?.totalTrips ?? 0;
  const year  = new Date().getFullYear() + 543;
  const label = months.length > 1 ? `${first} - ${last} ${year}` : `${first} ${year}`;
  const el = document.getElementById('sidebarMeta');
  if (el) el.textContent = `${label} | ${fmt(total)} เที่ยว`;
  const titleEl = document.getElementById('sidebarBrand');
  if (titleEl && document.body.classList.contains('sidebar-collapsed')) {
    titleEl.title = `2K Logistics Analytics · ${label} | ${fmt(total)} เที่ยว`;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function loadSummarySource() {
  if (API_CACHE.summary) return deepClone(API_CACHE.summary);
  if (isApiEnabled()) {
    try {
      const payload = await apiGet('summary');
      API_CACHE.summary = payload;
      noteDataSource('summary', 'api');
      return deepClone(payload);
    } catch (err) {
      console.warn('Summary API fallback to static data:', err.message);
      noteDataSource('summary', 'static', `summary fallback: ${err.message}`);
    }
  }
  if (!isApiEnabled()) noteDataSource('summary', 'static');
  return loadLegacySummaryData();
}

async function loadTripsSource() {
  if (API_CACHE.trips) return deepClone(API_CACHE.trips);
  if (isApiEnabled()) {
    try {
      const fields = 'date,customer,route,vtype,driver,plate,payee,recv,pay,oil,margin';
      const pageSize = 5000;
      const maxPages = 100;
      let page = 0;
      let hasMore = true;
      const trips = [];

      while (hasMore && page < maxPages) {
        let payload = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            payload = await apiGet('trips', { page, limit: pageSize, fields }, API_TRIPS_TIMEOUT_MS);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt === 0) {
              await new Promise(resolve => setTimeout(resolve, 700));
            }
          }
        }
        if (!payload) throw lastErr || new Error('trips api failed');
        const batch = Array.isArray(payload?.trips) ? payload.trips : [];
        if (batch.length > 0) trips.push(...batch);
        hasMore = Boolean(payload?.hasMore) && batch.length > 0;
        page += 1;
      }

      if (page >= maxPages) {
        console.warn(`Trips pagination reached safety cap (${maxPages} pages).`);
      }
      API_CACHE.trips = trips;
      noteDataSource('trips', 'api');
      return deepClone(trips);
    } catch (err) {
      console.warn('Trips API fallback to static data:', err.message);
      noteDataSource('trips', 'static', `trips fallback: ${err.message}`);
    }
  }
  if (!isApiEnabled()) noteDataSource('trips', 'static');
  return loadLegacyTripsData();
}

async function ensureTripsReady() {
  if (TRIPS_READY) return deepClone(window.FRAUD_DATA || []);
  if (TRIPS_LOADING_PROMISE) return TRIPS_LOADING_PROMISE;

  TRIPS_LOADING_PROMISE = (async () => {
    const tripsSource = await loadTripsSource();
    const normalized = Array.isArray(tripsSource) ? tripsSource.map(canonicalizeTripRow) : [];
    window.FRAUD_DATA = normalized;
    TRIPS_READY = true;
    return deepClone(normalized);
  })().finally(() => {
    TRIPS_LOADING_PROMISE = null;
  });

  return TRIPS_LOADING_PROMISE;
}

async function loadOilSource() {
  if (API_CACHE.oil) return deepClone(API_CACHE.oil);
  if (isApiEnabled()) {
    try {
      const payload = await apiGet('oil');
      API_CACHE.oil = payload;
      noteDataSource('oil', 'api');
      return deepClone(payload);
    } catch (err) {
      console.warn('Oil API fallback to static data:', err.message);
      noteDataSource('oil', 'static', `oil fallback: ${err.message}`);
    }
  }
  if (!isApiEnabled()) noteDataSource('oil', 'static');
  return loadLegacyOilData();
}

function renderLoadingScreen(statusText = 'โหลดข้อมูลเที่ยววิ่ง...') {
  const c = document.getElementById('content');
  if (!c) return;
  c.classList.remove('master-no-scroll');
  c.style.padding = '0';
  c.style.overflow = 'auto';
  c.innerHTML = `
    <div class="loading-screen">
      <div class="loader-wrap">
        <div class="loader-ring"></div>
        <div class="loader-ring"></div>
      </div>
      <div class="loader-text">กำลังเตรียมแดชบอร์ด<span class="loader-dots"></span></div>
      <div class="loader-sub" id="load-status">${esc(statusText)}</div>
      <div class="loader-progress">
        <div class="loader-progress-bar"><div class="loader-progress-fill" id="load-progress-fill"></div></div>
        <div class="loader-steps">
          <div class="loader-step active" id="load-step-1">โหลดข้อมูลสรุป</div>
          <div class="loader-step" id="load-step-2">โหลดข้อมูลเที่ยววิ่ง</div>
          <div class="loader-step" id="load-step-3">กำลังสร้างแดชบอร์ด</div>
        </div>
      </div>
    </div>
    <div style="padding:0 24px 24px;">
      <div class="skeleton-grid">
        <div class="skeleton-pulse"></div>
        <div class="skeleton-pulse"></div>
        <div class="skeleton-pulse"></div>
        <div class="skeleton-pulse"></div>
      </div>
      <div class="skeleton-pulse skeleton-card"></div>
      <div class="skeleton-pulse skeleton-row"></div>
      <div class="skeleton-pulse skeleton-row"></div>
      <div class="skeleton-pulse skeleton-row"></div>
    </div>`;
}

function setShellLoadingState(loading = true) {
  const sidebarTitle = document.getElementById('sidebarBrand') || document.querySelector('.sidebar-header h1');
  const sidebarMeta = document.getElementById('sidebarMeta');
  const nav = document.getElementById('navList');
  const pageTitle = document.getElementById('pageTitle');
  if (!sidebarTitle || !sidebarMeta || !nav || !pageTitle) return;

  if (loading) {
    sidebarTitle.innerHTML = '<span class="shell-skeleton shell-skeleton-title"></span>';
    sidebarMeta.innerHTML = '<span class="shell-skeleton shell-skeleton-meta"></span>';
    nav.innerHTML = `
      <div class="shell-nav-skeleton">
        <div class="shell-skeleton shell-skeleton-nav"></div>
        <div class="shell-skeleton shell-skeleton-nav"></div>
        <div class="shell-skeleton shell-skeleton-nav"></div>
        <div class="shell-skeleton shell-skeleton-nav"></div>
      </div>`;
    pageTitle.innerHTML = '<span class="shell-skeleton shell-skeleton-topbar"></span>';
    return;
  }

  sidebarTitle.textContent = '2K Logistics Analytics';
  sidebarMeta.textContent = '-';
  nav.innerHTML = '';
  pageTitle.textContent = 'กำลังโหลดข้อมูล...';
}

function setLoadingStatus(msg) {
  const el = document.getElementById('load-status');
  if (el) el.textContent = msg;
  const progress = document.getElementById('load-progress-fill');
  const s1 = document.getElementById('load-step-1');
  const s2 = document.getElementById('load-step-2');
  const s3 = document.getElementById('load-step-3');
  const mark = (step, active) => { if (step) step.classList.toggle('active', active); };
  let width = '14%';
  if (msg === 'Loading summary...' || msg === 'โหลดข้อมูลสรุป...') {
    width = '38%';
    mark(s1, true); mark(s2, false); mark(s3, false);
  } else if (
    msg === 'Loading trip data...' ||
    msg === 'Loading auxiliary data...' ||
    msg === 'โหลดข้อมูลเที่ยววิ่ง...' ||
    msg === 'โหลดข้อมูลเสริม...'
  ) {
    width = '72%';
    mark(s1, true); mark(s2, true); mark(s3, false);
  } else if (msg === 'Building dashboard view...' || msg === 'กำลังสร้างแดชบอร์ด...') {
    width = '100%';
    mark(s1, true); mark(s2, true); mark(s3, true);
  } else {
    mark(s1, true); mark(s2, false); mark(s3, false);
  }
  if (progress) progress.style.width = width;
}

async function init() {
  DATA_SOURCE_STATE.summary = 'pending';
  DATA_SOURCE_STATE.trips = 'pending';
  DATA_SOURCE_STATE.oil = 'pending';
  DATA_SOURCE_STATE.notes = [];
  setShellLoadingState(true);
  renderLoadingScreen('เริ่มต้น...');
  await sleep(80);

  setLoadingStatus('โหลดข้อมูลสรุป...');
  await sleep(80);
  let summarySource;
  try {
    summarySource = await loadSummarySource();
  } catch (err) {
    document.getElementById('content').innerHTML = `<div class="kpi"><div class="kpi-value red">โหลดข้อมูลสรุปไม่สำเร็จ</div><div class="kpi-sub">${esc(err.message)}</div></div>`;
    return;
  }

  setLoadingStatus('โหลดข้อมูลเที่ยววิ่ง...');
  await sleep(80);
  let tripsSource = [];
  try {
    tripsSource = await loadTripsSource();
  } catch (err) {
    console.error('Trip data load failed:', err);
  }

  let oilSource = null;
  try {
    oilSource = await loadOilSource();
  } catch (err) {
    console.error('Oil data load failed:', err);
  }

  const aligned = alignDashboardData(summarySource, tripsSource, {
    rebuildDerived: DATA_SOURCE_STATE.summary === 'api' && DATA_SOURCE_STATE.trips === 'api'
  });
  DATA = aligned.data;
  window.FRAUD_DATA = aligned.trips;
  TRIPS_READY = Array.isArray(window.FRAUD_DATA) && window.FRAUD_DATA.length > 0;
  if (oilSource) {
    window.OIL_PRICE_DATA = oilSource;
  }

  setLoadingStatus('กำลังสร้างแดชบอร์ด...');
  await sleep(100);

  setShellLoadingState(false);
  updateSidebarMeta();
  initNav();
  showPage(0);
}
init();
