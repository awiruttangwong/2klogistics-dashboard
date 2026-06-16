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
const API_TIMEOUT_MS = readPositiveNumber(DASHBOARD_API_CONFIG.timeoutMs, 20000);
const API_SUMMARY_TIMEOUT_MS = readPositiveNumber(DASHBOARD_API_CONFIG.summaryTimeoutMs, 30000);
const API_SUMMARY_RETRY_TIMEOUT_MS = readPositiveNumber(DASHBOARD_API_CONFIG.summaryRetryTimeoutMs, 12000);
const API_TRIPS_TIMEOUT_MS = readPositiveNumber(DASHBOARD_API_CONFIG.tripsTimeoutMs, 45000);
const API_TRIPS_TOTAL_TIMEOUT_MS = readPositiveNumber(DASHBOARD_API_CONFIG.tripsTotalTimeoutMs, 120000);
const API_OIL_TIMEOUT_MS = readPositiveNumber(DASHBOARD_API_CONFIG.oilTimeoutMs, 20000);
const API_RETRY_DELAY_MS = readPositiveNumber(DASHBOARD_API_CONFIG.retryDelayMs, 700);
const XLSX_SCRIPT_SRC = String(DASHBOARD_API_CONFIG.xlsxScriptSrc || 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js').trim();
const FLATPICKR_SCRIPT_SRC = String(DASHBOARD_API_CONFIG.flatpickrScriptSrc || 'https://cdn.jsdelivr.net/npm/flatpickr').trim();
const FLATPICKR_LOCALE_SCRIPT_SRC = String(DASHBOARD_API_CONFIG.flatpickrLocaleScriptSrc || 'https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/th.js').trim();
const FLATPICKR_CSS_HREF = String(DASHBOARD_API_CONFIG.flatpickrCssHref || 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css').trim();
const FLATPICKR_THEME_CSS_HREF = String(DASHBOARD_API_CONFIG.flatpickrThemeCssHref || 'https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css').trim();
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
const PERF_TELEMETRY_ENABLED = DASHBOARD_API_CONFIG.perfTelemetry !== false;
const PERF_MARKS = [];
if (typeof window !== 'undefined') {
  window.DASHBOARD_PERF_MARKS = PERF_MARKS;
}

function isApiEnabled() {
  return API_BASE_URL.length > 0;
}

function readPositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function perfNow() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function perfLog(label, startedAt, meta = {}) {
  if (!PERF_TELEMETRY_ENABLED || !Number.isFinite(startedAt)) return;
  const elapsedMs = Math.round((perfNow() - startedAt) * 10) / 10;
  const entry = { label, elapsedMs, at: new Date().toISOString(), ...meta };
  PERF_MARKS.push(entry);
  if (PERF_MARKS.length > 200) PERF_MARKS.shift();
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[perf]', label, `${elapsedMs}ms`, meta);
  }
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

function isFlashCustomerName(value) {
  const text = String(value || '').trim().toUpperCase();
  return text === 'FASH' || text.startsWith('FLASH');
}

function isSpxCustomerName(value) {
  const text = String(value || '').trim().toUpperCase();
  return text === 'SPX' || text.startsWith('SPX-');
}

function isTimedRouteCustomerName(value) {
  return isFlashCustomerName(value) || isSpxCustomerName(value);
}

function isRouteCodeLike(value) {
  const text = normalizeText(value, '');
  return !!text && text !== '-' && !/[\u0E00-\u0E7F]/.test(text) && /[-_]/.test(text) && /[A-Za-z0-9]/.test(text);
}

function parseTimedRouteParts(route) {
  const rawRoute = normalizeText(route, '');
  if (!rawRoute) return null;
  const parts = rawRoute.split('-').map(part => part.trim()).filter(Boolean);
  const timeIndex = parts.findIndex(part => /^\d{1,2}:\d{2}$/.test(part));
  if (parts.length < 3 || timeIndex <= 2) return null;
  return {
    rawRoute,
    service: parts[0],
    vehicle: parts[1],
    core: parts.slice(2, timeIndex).join('-'),
    routeBeforeTime: parts.slice(0, timeIndex).join('-'),
    suffixAfterTime: parts.slice(timeIndex + 1).join('-'),
    routeWithoutTime: [...parts.slice(0, timeIndex), ...parts.slice(timeIndex + 1)].join('-')
  };
}

function getRouteIdentity(row) {
  const customer = mapCustomer(normalizeText(row?.customer, '-'));
  const route = normalizeText(row?.route, '-');
  const vtype = normalizeText(row?.vtype, '-');
  const routeDesc = normalizeText(row?.routeDesc ?? row?.desc ?? '', '');
  const routeName = normalizeText(row?.routeName ?? row?.name ?? '', '');
  const parsedCandidate = [
    { value: route, source: 'route' },
    { value: routeDesc, source: 'routeDesc' },
    { value: routeName, source: 'routeName' }
  ]
    .map(candidate => ({ ...candidate, parsed: parseTimedRouteParts(candidate.value) }))
    .find(candidate => candidate.parsed);
  const parsed = parsedCandidate?.parsed || null;
  const useFlashCore = parsed && (isTimedRouteCustomerName(customer) || customer === '-');
  const spxRouteCode = isSpxCustomerName(customer)
    ? ([route, routeDesc, routeName].find(isRouteCodeLike) || route)
    : route;
  const routeCore = useFlashCore ? parsed.core : spxRouteCode;
  const routeVehicle = useFlashCore ? parsed.vehicle : vtype;
  const routePrefix = useFlashCore ? `${parsed.service}-${parsed.vehicle}` : '';
  const displayRoute = useFlashCore ? (parsed.routeWithoutTime || parsed.routeBeforeTime) : spxRouteCode;
  const keySuffix = useFlashCore && parsed.suffixAfterTime ? `|${parsed.suffixAfterTime}` : '';
  const routeDescription = useFlashCore
    ? (parsedCandidate.source === 'route'
      ? (cleanRouteDisplayText(routeDesc) || cleanRouteDisplayText(routeName) || displayRoute)
      : (cleanRouteDisplayText(route) || cleanRouteDisplayText(routeName) || displayRoute))
    : spxRouteCode;
  return {
    key: useFlashCore ? `${customer}|${vtype}|${routePrefix}|${routeCore}${keySuffix}` : `${customer}|${vtype}|${spxRouteCode}`,
    customer,
    vtype,
    route,
    routeCore,
    routeVehicle,
    routePrefix,
    displayRoute,
    routeDescription,
    isFlashRoute: !!useFlashCore
  };
}

function routeIdentityKey(row) {
  const identity = getRouteIdentity(row);
  if (identity.isFlashRoute || isSpxCustomerName(identity.customer)) return identity.key;
  if (row && row.routeKey) return String(row.routeKey);
  return identity.key;
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
function normalizeIsoDateTime(value) {
  if (value == null) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    const hh = String(value.getHours()).padStart(2, '0');
    const mi = String(value.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }
  const text = String(value).trim();
  if (!text) return '';
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?/);
  if (m) {
    const yyyy = m[1];
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[3])).padStart(2, '0');
    const hh = String(Number(m[4] ?? 0)).padStart(2, '0');
    const mi = String(Number(m[5] ?? 0)).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
  if (m) {
    let yyyy = Number(m[3]);
    if (yyyy > 2500) yyyy -= 543;
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[1])).padStart(2, '0');
    const hh = String(Number(m[4] ?? 0)).padStart(2, '0');
    const mi = String(Number(m[5] ?? 0)).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return normalizeIsoDateTime(parsed);
  return '';
}

async function fetchJsonWithTimeout(url, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) {
      const httpErr = new Error('HTTP ' + res.status);
      httpErr.code = 'HTTP_STATUS';
      httpErr.status = res.status;
      throw httpErr;
    }
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw createRequestTimeoutError(timeoutMs);
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

async function apiGetWithRetry(action, params = {}, timeouts = [API_TIMEOUT_MS], retryDelayMs = API_RETRY_DELAY_MS) {
  let lastErr = null;
  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    try {
      return await apiGet(action, params, timeouts[attempt]);
    } catch (err) {
      lastErr = err;
      if (attempt < timeouts.length - 1) {
        console.warn(`${action} API retry ${attempt + 1}/${timeouts.length - 1}:`, err.message);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastErr || new Error(`${action} api failed`);
}

function describeDataLoadError(err, sourceLabel = 'API') {
  const msg = String(err?.message || err || 'unknown error');
  const timeoutMs = err?.timeoutMs || Number(msg.match(/request timeout after (\d+)ms/)?.[1]);
  if (err?.code === 'REQUEST_TIMEOUT' || Number.isFinite(timeoutMs)) {
    const seconds = Math.round(timeoutMs / 1000);
    return `${sourceLabel} timeout หลังรอ ${seconds} วินาที`;
  }
  return msg;
}

function createRequestTimeoutError(timeoutMs, message) {
  const timeoutErr = new Error(message || `request timeout after ${timeoutMs}ms`);
  timeoutErr.code = 'REQUEST_TIMEOUT';
  timeoutErr.timeoutMs = timeoutMs;
  return timeoutErr;
}

function isNonRetriableHttpError(err) {
  return err?.code === 'HTTP_STATUS' && Number(err.status) >= 400 && Number(err.status) < 500;
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
function monthRangeLabel(activeMonths, data) {
  if (!activeMonths || activeMonths.length === 0) return '-';
  const first = MTH[activeMonths[0]] || activeMonths[0];
  const last = MTH[activeMonths[activeMonths.length - 1]] || activeMonths[activeMonths.length - 1];
  // Year-aware: derive years from data if available, else fall back to current calendar year
  const years = (data && Array.isArray(data.daily)) ? getYearsFromRows(data.daily) : [];
  const beYears = years.length > 0 ? years.map(y => y + 543) : [new Date().getFullYear() + 543];
  const yearLabel = beYears.length > 1 ? `${beYears[0]}–${beYears[beYears.length - 1]}` : `${beYears[0]}`;
  return activeMonths.length > 1 ? `${first} - ${last} ${yearLabel}` : `${first} ${yearLabel}`;
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
const getCustomerColor = name => {
  const n = String(name || '').toUpperCase();
  if (n.includes('FLASH')) return '#3b82f6'; // Blue
  if (n.includes('J&T')) return '#8b5cf6'; // Indigo/Purple
  if (n.includes('SPX')) return '#f59e0b'; // Orange
  if (n.includes('KEX') || n.includes('KERRY')) return '#f97316'; // Orange/Red
  if (n.includes('BEST')) return '#ef4444'; // Red
  return '#10b981'; // Emerald/Green for others
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
  const base = {
    ...row,
    date: normalizeIsoDate(row?.date),
    dateTime: normalizeIsoDateTime(row?.date),
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
  const identity = getRouteIdentity(base);
  return {
    ...base,
    routeKey: identity.key,
    routeCore: identity.routeCore,
    routeVehicle: identity.routeVehicle,
    routeGroup: identity.displayRoute,
    isFlashRoute: identity.isFlashRoute
  };
}

function cleanRouteDisplayText(value) {
  const text = normalizeText(value, '').trim();
  return text && text !== '-' ? text : '';
}

function routeDisplay(row) {
  if (typeof row === 'string' || typeof row === 'number') {
    return cleanRouteDisplayText(row) || '-';
  }
  const desc = cleanRouteDisplayText(row?.routeDesc) || cleanRouteDisplayText(row?.desc);
  const identity = getRouteIdentity(row || {});
  const routeDescription = cleanRouteDisplayText(identity.routeDescription);
  const identityRouteCode = cleanRouteDisplayText(identity.displayRoute);
  const fallbackRouteCode = cleanRouteDisplayText(row?.routeGroup) ||
    identityRouteCode ||
    cleanRouteDisplayText(row?.displayRoute) ||
    cleanRouteDisplayText(row?.route);
  const routeCode = identity.isFlashRoute
    ? (identityRouteCode || fallbackRouteCode)
    : fallbackRouteCode;
  const routeKeyText = String(row?.routeKey || '');
  const isFlashRouteLike = identity.isFlashRoute ||
    row?.isFlashRoute ||
    /(^|\|)(FD|LH|CPU|SHOP)-/.test(routeKeyText) ||
    /^(FD|LH|CPU|SHOP)-[^-]+-/.test(routeCode || '');
  if (isFlashRouteLike && routeCode) return routeCode;
  return routeDescription ||
    desc ||
    cleanRouteDisplayText(row?.displayName) ||
    cleanRouteDisplayText(row?.routeName) ||
    routeCode ||
    cleanRouteDisplayText(row?.name) ||
    '-';
}

function routeGroupHeaderDisplay(row) {
  if (typeof row === 'string' || typeof row === 'number') return routeDisplay(row);
  const identity = getRouteIdentity(row || {});
  const identityRouteCode = cleanRouteDisplayText(identity.displayRoute);
  const fallbackRouteCode = identityRouteCode ||
    cleanRouteDisplayText(row?.routeGroup) ||
    cleanRouteDisplayText(row?.displayRoute) ||
    cleanRouteDisplayText(row?.routeCore) ||
    cleanRouteDisplayText(row?.route);
  const routeKeyText = String(row?.routeKey || '');
  const isFlashRouteLike = identity.isFlashRoute ||
    row?.isFlashRoute ||
    /(^|\|)(FD|LH|CPU|SHOP)-/.test(routeKeyText) ||
    /^(FD|LH|CPU|SHOP)-[^-]+-/.test(fallbackRouteCode || '');
  if (isFlashRouteLike && fallbackRouteCode) return fallbackRouteCode;
  return routeDisplay(row);
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
  const payee = String(row?.payee || '').trim();
  const driver = String(row?.driver || '').trim();
  const plate = String(row?.plate || '').trim().toUpperCase().replace(/\s+/g, '');
  const vtype = String(row?.vtype || '').trim().toUpperCase();

  if (payee === driver || payee.indexOf('บริษัท') !== -1 || payee === '-' || payee === '') {
    return true;
  }

  const companyPairs = {
    '3บท2757|4W': true,
    '3ฒท2757|4W': true,
    '3บย7931|4WJ': true,
    '3ฒย7931|4WJ': true,
    '3บย7928|4WJ': true,
    '3ฒย7928|4WJ': true,
    '707616|6W': true,
    '707613|6W': true,
    '717486|6W': true,
    '3บท2758|4W': true,
    '3ฒท2758|4W': true,
    '73-2203/73-2204|เทรลเลอร์': true
  };

  return !!companyPairs[plate + '|' + vtype];
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
    const routeKey = routeIdentityKey(trip);
    if (!routeMap[routeKey]) {
      routeMap[routeKey] = { route: trip.routeGroup || trip.route, routeKey, routeDesc: trip.routeDesc, vtype: trip.vtype, trips: 0, margin: 0, recv: 0 };
    } else if (!cleanRouteDisplayText(routeMap[routeKey].routeDesc) && cleanRouteDisplayText(trip.routeDesc)) {
      routeMap[routeKey].routeDesc = trip.routeDesc;
    }
    routeMap[routeKey].trips += 1;
    routeMap[routeKey].margin += trip.margin;
    routeMap[routeKey].recv += trip.recv;
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
    const routeKey = routeIdentityKey(trip);
    const displayRoute = trip.routeGroup || trip.route;
    if (!byRoute[routeKey]) {
      byRoute[routeKey] = { name: displayRoute, route: displayRoute, routeKey, routeDesc: trip.routeDesc, count: 0, loss: 0 };
    } else if (!cleanRouteDisplayText(byRoute[routeKey].routeDesc) && cleanRouteDisplayText(trip.routeDesc)) {
      byRoute[routeKey].routeDesc = trip.routeDesc;
    }
    byRoute[routeKey].count += 1;
    byRoute[routeKey].loss += trip.margin;

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

function regroupRouteRows(rows, sortFn) {
  const groups = {};
  (rows || []).forEach(row => {
    const normalized = {
      ...row,
      customer: mapCustomer(row?.customer || '-'),
      vtype: normalizeText(row?.vtype, '-')
    };
    const identity = getRouteIdentity(normalized);
    const key = identity.key;
    if (!groups[key]) {
      groups[key] = {
        ...normalized,
        route: identity.displayRoute || normalized.route || '-',
        routeKey: key,
        routeCore: identity.routeCore,
        routeVehicle: identity.routeVehicle,
        routePrefix: identity.routePrefix,
        desc: normalized.desc || normalized.routeDesc || '-',
        routeDesc: normalized.routeDesc || normalized.desc || '-',
        trips: 0,
        count: 0,
        margin: 0,
        recv: 0,
        pay: 0,
        oil: 0,
        loss: 0,
        months: {}
      };
    }
    const target = groups[key];
    if (!cleanRouteDisplayText(target.routeDesc) && cleanRouteDisplayText(normalized.routeDesc || normalized.desc)) {
      target.routeDesc = normalized.routeDesc || normalized.desc;
      target.desc = normalized.desc || normalized.routeDesc;
    }
    target.trips += toFiniteNumber(normalized.trips);
    target.count += toFiniteNumber(normalized.count);
    target.margin += toFiniteNumber(normalized.margin);
    target.recv += toFiniteNumber(normalized.recv);
    target.pay += toFiniteNumber(normalized.pay);
    target.oil += toFiniteNumber(normalized.oil);
    target.loss += toFiniteNumber(normalized.loss);
    mergeMonthStats(target.months, normalized.months || {});
  });
  const result = Object.values(groups).map(row => ({
    ...row,
    avgMargin: row.trips > 0 ? row.margin / row.trips : 0,
    pct: row.recv > 0 ? row.margin / row.recv * 100 : toFiniteNumber(row.pct)
  }));
  return sortFn ? result.sort(sortFn) : result;
}

function regroupRouteRanking(ranking) {
  if (!ranking || typeof ranking !== 'object') return ranking;
  const seenRows = new Map();
  [...(ranking.top || []), ...(ranking.bottom || []), ...(ranking.zero || [])].forEach(row => {
    const exactKey = [
      row?.customer || '',
      row?.vtype || '',
      row?.route || '',
      row?.desc || row?.routeDesc || '',
      row?.trips ?? '',
      row?.margin ?? '',
      row?.loss ?? ''
    ].join('|');
    if (!seenRows.has(exactKey)) seenRows.set(exactKey, row);
  });
  const merged = regroupRouteRows([...seenRows.values()]);
  return {
    ...ranking,
    top: merged.filter(row => row.margin > 0).sort((a, b) => b.margin - a.margin),
    bottom: merged.filter(row => row.margin < 0).sort((a, b) => a.margin - b.margin),
    zero: merged.filter(row => row.margin === 0).sort((a, b) => routeDisplay(a).localeCompare(routeDisplay(b), 'th'))
  };
}

function regroupLossRoutes(lossTrip) {
  const rows = Array.isArray(lossTrip?.byRoute)
    ? lossTrip.byRoute
    : Object.entries(lossTrip?.byRoute || {}).map(([name, info]) => ({
      name,
      route: info?.route || name,
      routeKey: info?.routeKey,
      routeDesc: info?.routeDesc || info?.desc,
      count: info?.count,
      loss: info?.loss
    }));
  return regroupRouteRows(rows, (a, b) => a.loss - b.loss);
}

function normalizeSummaryData(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data.routeTrend)) {
    data.routeTrend.forEach(row => { row.customer = mapCustomer(row.customer); });
    data.routeTrend = regroupRouteRows(data.routeTrend, (a, b) => b.margin - a.margin);
  }
  if (data.routeRanking) {
    data.routeRanking = regroupRouteRanking(data.routeRanking);
  }
  if (Array.isArray(data.customerProfit)) {
    data.customerProfit = regroupCustomerProfit(data.customerProfit);
  }
  if (data.revenueConcentration) {
    data.revenueConcentration = regroupRevenueConcentration(data.revenueConcentration);
  }
  if (data.lossTrip) {
    data.lossTrip.byCustomer = regroupLossByCustomer(data.lossTrip);
    data.lossTrip.byRoute = regroupLossRoutes(data.lossTrip);
    data.lossTrip.worstRoutes = data.lossTrip.byRoute.slice(0, 10);
  }
  if (data.ownVsOutsource) {
    ['company', 'outsource'].forEach(side => {
      if (Array.isArray(data.ownVsOutsource?.[side]?.topRoutes)) {
        data.ownVsOutsource[side].topRoutes = regroupRouteRows(data.ownVsOutsource[side].topRoutes, (a, b) => b.trips - a.trips).slice(0, 10);
      }
    });
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
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`timeout loading ${src}`));
    }, 30000);
    const cleanup = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      delete LEGACY_SCRIPT_PROMISES[src];
      reject(err);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (!globalName || typeof window[globalName] !== 'undefined') {
        succeed(globalName ? window[globalName] : true);
      } else {
        fail(new Error(`global ${globalName} not found after loading ${src}`));
      }
    };
    script.onerror = () => fail(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
  return LEGACY_SCRIPT_PROMISES[src];
}

function loadStyleOnce(href) {
  if (!href) return Promise.resolve(true);
  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(link =>
    link.dataset.lazyHref === href || link.getAttribute('href') === href || link.href === href
  );
  if (existing) return Promise.resolve(true);
  if (LEGACY_SCRIPT_PROMISES[href]) return LEGACY_SCRIPT_PROMISES[href];
  LEGACY_SCRIPT_PROMISES[href] = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    let settled = false;
    const timer = setTimeout(() => fail(new Error(`timeout loading ${href}`)), 30000);
    const cleanup = () => {
      clearTimeout(timer);
      link.onload = null;
      link.onerror = null;
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      delete LEGACY_SCRIPT_PROMISES[href];
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(true);
    };
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.lazyHref = href;
    link.onload = succeed;
    link.onerror = () => fail(new Error(`failed to load ${href}`));
    document.head.appendChild(link);
  });
  return LEGACY_SCRIPT_PROMISES[href];
}

async function ensureXlsxLibrary() {
  if (typeof XLSX !== 'undefined') return XLSX;
  if (!XLSX_SCRIPT_SRC) throw new Error('XLSX script source is not configured');
  return loadScriptOnce(XLSX_SCRIPT_SRC, 'XLSX');
}

async function ensureFlatpickrLibrary() {
  if (typeof flatpickr !== 'undefined') return flatpickr;
  await Promise.all([
    loadStyleOnce(FLATPICKR_CSS_HREF),
    loadStyleOnce(FLATPICKR_THEME_CSS_HREF)
  ]);
  await loadScriptOnce(FLATPICKR_SCRIPT_SRC, 'flatpickr');
  if (FLATPICKR_LOCALE_SCRIPT_SRC) {
    await loadScriptOnce(FLATPICKR_LOCALE_SCRIPT_SRC);
  }
  return flatpickr;
}

async function loadLegacySummaryData() {
  await loadScriptOnce('data/data.js');
  if (typeof DATA_JSON === 'undefined') throw new Error('DATA_JSON unavailable');
  return deepClone(DATA_JSON);
}

async function loadLegacyTripsData() {
  await loadScriptOnce('data/fraud_data.js');
  if (typeof FRAUD_DATA === 'undefined' || !Array.isArray(FRAUD_DATA)) throw new Error('FRAUD_DATA unavailable');
  return FRAUD_DATA;
}

async function loadLegacyOilData() {
  await loadScriptOnce('data/oil-price-data.js');
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
function buildLossAuditTableRowsFromTrips(trips) {
  const lossTrips = (Array.isArray(trips) ? trips : [])
    .map(canonicalizeTripRow)
    .filter(t => Number(t.margin) < 0);
  const byMonth = {};
  const byCustomer = {};
  const byRoute = {};
  lossTrips.forEach(trip => {
    const monthKey = getMonthNameFromDate(trip.date);
    if (monthKey) {
      if (!byMonth[monthKey]) byMonth[monthKey] = { count: 0, loss: 0 };
      byMonth[monthKey].count += 1;
      byMonth[monthKey].loss += Number(trip.margin) || 0;
    }
    const customer = mapCustomer(trip.customer || '-');
    if (!byCustomer[customer]) byCustomer[customer] = { name: customer, count: 0, loss: 0 };
    byCustomer[customer].count += 1;
    byCustomer[customer].loss += Number(trip.margin) || 0;

    const routeKey = routeIdentityKey(trip);
    const route = normalizeText(trip.routeGroup || trip.route, '-');
    if (!byRoute[routeKey]) {
      byRoute[routeKey] = { name: route, route, routeKey, routeDesc: trip.routeDesc, count: 0, loss: 0 };
    } else if (!cleanRouteDisplayText(byRoute[routeKey].routeDesc) && cleanRouteDisplayText(trip.routeDesc)) {
      byRoute[routeKey].routeDesc = trip.routeDesc;
    }
    byRoute[routeKey].count += 1;
    byRoute[routeKey].loss += Number(trip.margin) || 0;
  });
  const monthlyRows = MONTHS
    .filter(month => byMonth[month] && ((byMonth[month].count || 0) > 0 || Number(byMonth[month].loss) !== 0))
    .map((month, index) => {
      const info = byMonth[month];
      const count = Number(info.count) || 0;
      const loss = Number(info.loss) || 0;
      return {
        order: index,
        monthKey: month,
        month: MTH[month] || month,
        count,
        loss,
        pct: lossTrips.length > 0 ? (count / lossTrips.length) * 100 : null,
        avgLoss: count > 0 ? Math.abs(loss) / count : null
      };
    });
  const custRows = Object.values(byCustomer)
    .map(row => ({
      name: row.name || '-',
      count: Number(row.count) || 0,
      loss: Number(row.loss) || 0,
      avgLoss: Number(row.count) > 0 ? Math.abs(Number(row.loss) || 0) / Number(row.count) : null
    }))
    .sort((a, b) => a.loss - b.loss);
  const routeRows = Object.values(byRoute)
    .map(row => ({
      name: row.name || '-',
      route: row.route || row.name || '-',
      routeKey: row.routeKey,
      routeDesc: row.routeDesc || '-',
      count: Number(row.count) || 0,
      loss: Number(row.loss) || 0,
      avgLoss: Number(row.count) > 0 ? Math.abs(Number(row.loss) || 0) / Number(row.count) : null
    }))
    .sort((a, b) => a.loss - b.loss);
  return { lossTrips, monthlyRows, custRows, routeRows };
}
function buildLossAuditTableConfigs(rows, drillOptions = {}) {
  const openDrill = (kind, row) => window.openLossDrillModal(kind, row, drillOptions);
  return [
    {
      id: 'audit-loss-monthly',
      csvName: 'loss-monthly-detail',
      rows: rows.monthlyRows,
      cols: [
        { key: 'month', label: 'เดือน', strong: true, sortValue: row => row.order, noFilter: true },
        { key: 'count', label: 'จำนวนเที่ยวขาดทุน', type: 'number', align: 'right', noFilter: true },
        { key: 'loss', label: 'มูลค่าขาดทุน', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
        { key: 'pct', label: '% ของทั้งหมด', type: 'percent', align: 'right' },
        { key: 'avgLoss', label: 'เฉลี่ย/เที่ยว', type: 'currency', align: 'right' }
      ],
      filters: [],
      defaultSort: 'month',
      defaultAsc: true,
      perPage: 12,
      onRowClick: row => openDrill('monthly', row)
    },
    {
      id: 'audit-loss-customer',
      csvName: 'loss-by-customer',
      rows: rows.custRows,
      cols: [
        { key: 'name', label: 'ลูกค้า', strong: true },
        { key: 'count', label: 'จำนวนเที่ยวขาดทุน', type: 'number', align: 'right', noFilter: true },
        { key: 'loss', label: 'มูลค่า', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
        { key: 'avgLoss', label: 'เฉลี่ย/เที่ยว', type: 'currency', align: 'right' }
      ],
      filters: [],
      defaultSort: 'loss',
      defaultAsc: true,
      perPage: 10,
      onRowClick: row => openDrill('customer', row)
    },
    {
      id: 'audit-loss-route',
      csvName: 'loss-by-route',
      rows: rows.routeRows,
      cols: [
        { key: 'name', label: 'ชื่อเส้นทาง', strong: true, value: row => routeDisplay(row), sortValue: row => routeDisplay(row), exportValue: row => routeGroupHeaderDisplay(row) },
        { key: 'count', label: 'จำนวนเที่ยวขาดทุน', type: 'number', align: 'right', noFilter: true },
        { key: 'loss', label: 'มูลค่า', type: 'currency', align: 'right', strong: true, tone: 'sign', noFilter: true },
        { key: 'avgLoss', label: 'เฉลี่ย/เที่ยว', type: 'currency', align: 'right' }
      ],
      filters: [],
      defaultSort: 'loss',
      defaultAsc: true,
      perPage: 10,
      onRowClick: row => openDrill('route', row)
    }
  ];
}
function renderAuditTable(id, config, opts = {}) {
  const shell = document.getElementById(id);
  if (!shell) return;
  const autoFilters = (config.cols || []).slice(0, 3).filter(col => !col.noFilter).map(col => ({
    key: col.key,
    label: col.label,
    value: row => {
      const v = typeof col.searchValue === 'function' ? col.searchValue(row) : auditGetValue(row, col);
      return String(v == null ? '' : v).trim();
    }
  }));
  const configuredFilters = Array.isArray(config.filters) ? config.filters : null;
  const activeFilters = configuredFilters === null ? autoFilters : configuredFilters;
  let state = auditTableStates[id];
  if (!state || !opts.restore) {
    state = auditTableStates[id] = {
      cols: config.cols,
      rows: config.rows,
      filters: activeFilters,
      sortKey: config.defaultSort || config.cols[0]?.key,
      sortAsc: config.defaultAsc !== false,
      page: 0,
      perPage: config.perPage || 12,
      filterValues: Object.fromEntries(activeFilters.map(filterDef => [filterDef.key, ''])),
      csvName: config.csvName || id,
      onRowClick: typeof config.onRowClick === 'function' ? config.onRowClick : null
    };
  } else {
    state.cols = config.cols;
    state.rows = config.rows;
    state.filters = activeFilters;
    state.csvName = config.csvName || id;
    state.onRowClick = typeof config.onRowClick === 'function' ? config.onRowClick : null;
    const keys = new Set(activeFilters.map(filterDef => filterDef.key));
    Object.keys(state.filterValues).forEach(k => { if (!keys.has(k)) delete state.filterValues[k]; });
    activeFilters.forEach(filterDef => {
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
        ${filterHtml ? `<div class="audit-table-filter-row">${filterHtml}</div>` : ''}
      </div>
      <div class="audit-table-toolbar-side">
        <div class="audit-table-actions">
          <button type="button" class="audit-table-button" onclick="auditExportXls('${id}')">Export XLSX</button>
          <button type="button" class="audit-table-button" onclick="auditMovePage('${id}',-1)">‹</button>
          <button type="button" class="audit-table-button" onclick="auditMovePage('${id}',1)">›</button>
          <select id="${id}_perpage" class="audit-table-select audit-table-select-sm">
            ${[10, 12, 25, 50].map(size => `<option value="${size}"${size === state.perPage ? ' selected' : ''}>${size} แถว</option>`).join('')}
          </select>
          <div class="audit-table-status">
            <span class="audit-table-meta">${fmtB(total)} รายการ • หน้า ${state.page + 1}/${pages}${activeFilterCount ? ` • ใช้ตัวกรอง ${activeFilterCount}` : ''}</span>
          </div>
        </div>
      </div>
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
async function auditExportXls(id) {
  const state = auditTableStates[id];
  if (!state) return;
  try {
    await ensureXlsxLibrary();
  } catch (err) {
    alert('โหลดไลบรารี XLSX ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    return;
  }
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

// Year-aware loss filter — detect year(s) from data instead of hardcoding 2026
function getYearsFromRows(rows) {
  const set = new Set();
  (rows || []).forEach(row => {
    const iso = normalizeIsoDate(row?.date);
    const m = iso.match(/^(\d{4})-/);
    if (m) set.add(Number(m[1]));
  });
  return Array.from(set).sort((a, b) => a - b);
}

function getPrimaryYearFromRows(rows) {
  const years = getYearsFromRows(rows);
  if (!years.length) return new Date().getFullYear();
  // Pick the latest year that has data (most recent)
  return years[years.length - 1];
}

function getLossFilterMonthOptions(year) {
  const y = Number(year) || new Date().getFullYear();
  return MONTHS.map((monthName, index) => ({
    value: String(index + 1),
    monthName,
    year: y,
    label: `${String(index + 1).padStart(2, '0')} - ${(MTH[monthName] || monthName)} ${y}`
  }));
}

function lossDrillNorm(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function makeLossDrillKey(kind, row) {
  if (kind === 'monthly') return `monthly:${row?.monthKey || row?.month || ''}`;
  if (kind === 'customer') return `customer:${mapCustomer(row?.name || '-')}`;
  if (kind === 'route') return `route:${lossDrillNorm(row?.routeKey || row?.name || '-')}`;
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

function getMonthDateRange(year, monthNumber) {
  const month = Number(monthNumber);
  if (!Number.isFinite(month) || month < 1 || month > 12) return { start: '', end: '' };
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
  };
}

function getMonthNumberFromIsoDate(dateValue) {
  const iso = normalizeIsoDate(dateValue);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Number(m[2]);
}

function summarizeLossDrillRows(rows) {
  const totalLoss = rows.reduce((sum, row) => sum + (Number(row.margin) || 0), 0);
  const topCauseMap = {};
  rows.forEach(row => {
    (Array.isArray(row.causesRaw) ? row.causesRaw : []).forEach(cause => {
      topCauseMap[cause] = (topCauseMap[cause] || 0) + 1;
    });
  });
  const topCauses = Object.entries(topCauseMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    trips: rows.length,
    totalLoss,
    avgLoss: rows.length > 0 ? Math.abs(totalLoss) / rows.length : 0,
    topCauses
  };
}

function buildLossDrillFilterMeta(rows) {
  const customerOptions = Array.from(new Set(rows.map(row => row.customer).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'th'));
  const routeOptionMap = {};
  rows.forEach(row => {
    const value = String(routeIdentityKey(row)).trim();
    if (!value) return;
    if (!routeOptionMap[value]) routeOptionMap[value] = { value, label: routeDisplay(row) };
  });
  const routeOptions = Object.values(routeOptionMap).sort((a, b) => String(a.label).localeCompare(String(b.label), 'th'));
  const filterYear = getPrimaryYearFromRows(rows);
  const monthCounts = {};
  rows.forEach(row => {
    const iso = normalizeIsoDate(row.date);
    const m = iso.match(/^(\d{4})-(\d{2})-/);
    if (!m || Number(m[1]) !== filterYear) return;
    const monthNum = String(Number(m[2]));
    monthCounts[monthNum] = (monthCounts[monthNum] || 0) + 1;
  });
  return { customerOptions, routeOptions, monthCounts, filterYear };
}

function normalizeLossDrillFilterDates(filters) {
  const next = { ...filters };
  next.dayMode = 'single';
  next.singleDate = '';
  next.startDate = '';
  next.endDate = '';
  return next;
}

function applyLossDrillFilters(rows, filters) {
  const monthNumber = Number(filters.month);
  const hasMonth = Number.isFinite(monthNumber) && monthNumber >= 1 && monthNumber <= 12;
  const filterYear = filters.filterYear || getPrimaryYearFromRows(rows);
  const monthRange = hasMonth ? getMonthDateRange(filterYear, monthNumber) : { start: '', end: '' };
  const filterCustomer = String(filters.customer || '').trim();
  const filterRoute = String(filters.route || '').trim();

  return rows.filter(row => {
    if (filterCustomer && row.customer !== filterCustomer) return false;
    if (filterRoute && routeIdentityKey(row) !== filterRoute) return false;

    const isoDate = normalizeIsoDate(row.date);
    if (hasMonth) {
      if (!isoDate || isoDate < monthRange.start || isoDate > monthRange.end) return false;
    }

    return true;
  });
}

function renderLossDrillFilters(meta, filters, resultCount, totalCount, kind) {
  const showCustomer = kind !== 'customer';
  const showRoute = kind !== 'route';
  const filterYear = meta.filterYear || new Date().getFullYear();
  const monthOptions = getLossFilterMonthOptions(filterYear);
  const monthOptionsHtml = [`<option value="">ทุกเดือน (ปี ${filterYear})</option>`]
    .concat(monthOptions.map(monthOption => {
      const count = Number(meta.monthCounts[monthOption.value] || 0);
      const countLabel = count > 0 ? ` (${fmtB(count)} เที่ยว)` : '';
      return `<option value="${monthOption.value}"${String(filters.month) === monthOption.value ? ' selected' : ''}>${esc(monthOption.label)}${countLabel}</option>`;
    })).join('');
  const customerOptionsHtml = ['<option value="">ลูกค้าทั้งหมด</option>']
    .concat(meta.customerOptions.map(name => `<option value="${esc(name)}"${filters.customer === name ? ' selected' : ''}>${esc(name)}</option>`)).join('');
  const routeOptionsHtml = ['<option value="">เส้นทางทั้งหมด</option>']
    .concat(meta.routeOptions.map(opt => `<option value="${esc(opt.value)}"${filters.route === opt.value ? ' selected' : ''}>${esc(opt.label)}</option>`)).join('');

  return `
    <div class="loss-drill-filter-wrap">
      <div class="loss-drill-filter-head">
        <div class="loss-drill-filter-title">ตัวกรองข้อมูลใน Popup</div>
        <div class="loss-drill-filter-meta">${fmtB(resultCount)} / ${fmtB(totalCount)} เที่ยว</div>
      </div>
      <div class="loss-drill-filter-grid">
        <label class="loss-drill-filter-field">
          <span>วันที่ (เดือน)</span>
          <select id="lossDrillMonth" class="loss-drill-filter-control">${monthOptionsHtml}</select>
        </label>
        ${showCustomer ? `<label class="loss-drill-filter-field">
          <span>ลูกค้า</span>
          <select id="lossDrillCustomer" class="loss-drill-filter-control">${customerOptionsHtml}</select>
        </label>` : ''}
        ${showRoute ? `<label class="loss-drill-filter-field">
          <span>ชื่อเส้นทาง</span>
          <select id="lossDrillRoute" class="loss-drill-filter-control">${routeOptionsHtml}</select>
        </label>` : ''}
      </div>
      <div class="loss-drill-filter-actions">
        <button id="lossDrillResetFilters" type="button" class="loss-drill-filter-btn">ล้างตัวกรอง</button>
      </div>
    </div>
  `;
}

function bindLossDrillFilterEvents(modal, state, rerender) {
  const monthEl = modal.querySelector('#lossDrillMonth');
  const customerEl = modal.querySelector('#lossDrillCustomer');
  const routeEl = modal.querySelector('#lossDrillRoute');
  const resetEl = modal.querySelector('#lossDrillResetFilters');

  const updateState = patch => {
    state.filters = normalizeLossDrillFilterDates({ ...state.filters, ...patch });
    rerender();
  };

  monthEl?.addEventListener('change', () => updateState({ month: monthEl.value }));
  customerEl?.addEventListener('change', () => updateState({ customer: customerEl.value }));
  routeEl?.addEventListener('change', () => updateState({ route: routeEl.value }));
  resetEl?.addEventListener('click', () => {
    state.filters = state.defaultFilters();
    rerender();
  });
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
    const routeKey = lossDrillNorm(row?.routeKey || row?.name || '-');
    matched = lossTrips.filter(t => lossDrillNorm(routeIdentityKey(t)) === routeKey);
    title = `ขาดทุนแยกตามเส้นทาง: ${routeDisplay(row)}`;
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
      route: t.routeGroup || t.route || '-',
      routeKey: routeIdentityKey(t),
      routeDesc: t.routeDesc || '-',
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

async function getLossDrillPayload(kind, row, opts = {}) {
  const scopedTrips = Array.isArray(opts?.trips) ? opts.trips : null;
  if (scopedTrips) {
    return buildLossDrillPayload(kind, row, scopedTrips);
  }
  const cacheKey = makeLossDrillKey(kind, row);
  if (LOSS_DRILL_CACHE.has(cacheKey)) return deepClone(LOSS_DRILL_CACHE.get(cacheKey));
  const trips = await ensureTripsReady();
  const payload = buildLossDrillPayload(kind, row, trips);
  LOSS_DRILL_CACHE.set(cacheKey, payload);
  return deepClone(payload);
}

window.closeLossDrillModal = function () {
  const modal = document.getElementById('lossDrillModal');
  if (modal) modal.style.display = 'none';
};

window.openLossDrillModal = async function (kind, row, opts = {}) {
  let modal = document.getElementById('lossDrillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lossDrillModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:1001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.74);backdrop-filter:blur(6px);';
    modal.onclick = function (e) { if (e.target === modal) window.closeLossDrillModal(); };
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
    const payload = await getLossDrillPayload(kind, row, opts);
    const rowsHtml = payload.rows.length
      ? payload.rows.map(r => `<tr>
          <td>${fmtB(r.idx)}</td>
          <td>${esc(r.date)}</td>
          <td>${esc(r.customer)}</td>
          <td title="${esc(routeDisplay(r))}">${esc(routeDisplay(r))}</td>
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
                  <th>ลำดับ</th><th>วันที่</th><th>ลูกค้า</th><th>ชื่อเส้นทาง</th><th>ประเภทรถ</th><th>พขร.</th><th>ทะเบียน</th>
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


// Override: enhanced loss drill modal with in-popup filters
window.openLossDrillModal = async function (kind, row, opts = {}) {
  let modal = document.getElementById('lossDrillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lossDrillModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:1001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.74);backdrop-filter:blur(6px);';
    modal.onclick = function (e) { if (e.target === modal) window.closeLossDrillModal(); };
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
    const payload = await getLossDrillPayload(kind, row, opts);
    const filterMeta = buildLossDrillFilterMeta(payload.rows);
    const defaultMonth = (() => {
      if (kind === 'monthly' && row?.monthKey) {
        const idx = MONTHS.indexOf(row.monthKey);
        if (idx >= 0) return String(idx + 1);
      }
      const filterYear = filterMeta.filterYear || getPrimaryYearFromRows(payload.rows);
      const inYearRow = payload.rows.find(r => String(r.date || '').startsWith(`${filterYear}-`));
      const monthFromRow = getMonthNumberFromIsoDate(inYearRow?.date);
      return monthFromRow ? String(monthFromRow) : '';
    })();
    const createDefaultFilters = () => normalizeLossDrillFilterDates({
      month: defaultMonth,
      customer: '',
      route: '',
      filterYear: filterMeta.filterYear
    });
    const state = {
      filters: createDefaultFilters(),
      defaultFilters: createDefaultFilters
    };

    const renderDrillModal = () => {
      const filteredRows = applyLossDrillFilters(payload.rows, state.filters);
      const summary = summarizeLossDrillRows(filteredRows);
      const rowsHtml = filteredRows.length
        ? filteredRows.map((r, rowIndex) => `<tr>
            <td>${fmtB(rowIndex + 1)}</td>
            <td>${esc(r.date)}</td>
            <td>${esc(r.customer)}</td>
            <td title="${esc(routeDisplay(r))}">${esc(routeDisplay(r))}</td>
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
        : '<tr><td colspan="13" class="audit-table-empty">ไม่พบเที่ยวขาดทุนตามตัวกรองที่เลือก</td></tr>';

      const topCauseHtml = summary.topCauses.length
        ? summary.topCauses
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
            <div class="loss-drill-kpi metric metric-trips"><span>เที่ยวขาดทุน</span><b>${fmtB(summary.trips)}</b></div>
            <div class="loss-drill-kpi metric metric-loss"><span>มูลค่าขาดทุนรวม</span><b class="neg">${fmt(summary.totalLoss)} <em class="loss-drill-unit">THB</em></b></div>
            <div class="loss-drill-kpi causes"><span>สาเหตุหลัก</span><div class="loss-drill-cause-list">${topCauseHtml}</div></div>
          </div>
          <div class="loss-drill-body">
            ${renderLossDrillFilters(filterMeta, state.filters, filteredRows.length, payload.rows.length, kind)}
            <div class="audit-table-wrap">
              <table class="audit-table loss-drill-table">
                <thead>
                  <tr>
                    <th>ลำดับ</th><th>วันที่</th><th>ลูกค้า</th><th>ชื่อเส้นทาง</th><th>ประเภทรถ</th><th>พขร.</th><th>ทะเบียน</th>
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
      bindLossDrillFilterEvents(modal, state, renderDrillModal);
    };

    renderDrillModal();
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
  const activeMonths = getActiveMonths(d, 'routeTrend');
  const months = activeMonths.length > 0 ? activeMonths : MONTHS;
  // Mini KPIs inside section
  let h = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">จำนวนเที่ยวทั้งหมด</div><div class="master-mini-kpi-value" style="color:#3b82f6">${fmt(s.totalTrips)}</div><div class="master-mini-kpi-sub">เที่ยว</div></div>
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">ราคารับรวม</div><div class="master-mini-kpi-value" style="color:#22c55e">${fmt(s.totalRevenue)}</div><div class="master-mini-kpi-sub">THB</div></div>
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">ส่วนต่างรวม</div><div class="master-mini-kpi-value" style="color:${s.totalMargin >= 0 ? '#22c55e' : '#ef4444'}">${fmt(s.totalMargin)}</div><div class="master-mini-kpi-sub">THB</div></div>
    <div class="master-mini-kpi"><div class="master-mini-kpi-label">กำไร % เฉลี่ย</div><div class="master-mini-kpi-value" style="color:#8b5cf6">${fmtP(s.avgMarginPct)}</div><div class="master-mini-kpi-sub">เฉลี่ยทุกเที่ยว</div></div>
  </div>`;
  const rows = d.routeTrend.map(r => {
    const tot = months.reduce((a, m) => a + (r.months[m]?.trips || 0), 0);
    return [r.customer, r.vtype || '-', routeDisplay(r), tot,
    ...months.flatMap(m => [r.months[m]?.trips || 0, r.months[m]?.margin || 0])
    ];
  });
  const cols = ['ลูกค้า', 'ประเภทรถ', 'ชื่อเส้นทาง', 'จำนวนเที่ยวรวม', ...months.flatMap(m => [MTH[m] + ' (เที่ยว)', MTH[m] + ' (ส่วนต่าง)'])];
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>สรุปผลการดำเนินงานรายเส้นทางและแนวโน้มส่วนต่างกำไรประจำเดือน</h3></div><div class="table-wrap" id="t_trend"></div></div>`;
  setTimeout(() => mkTable('t_trend', cols, rows, { defaultSort: 3, defaultAsc: false }), 0);
  return h;
}

function buildRanking(d) {
  const rk = d.routeRanking;
  const mkRows = arr => arr.map(r => [r.customer, routeDisplay(r), r.trips, r.margin, r.avgMargin, r.pct, r.loss]);
  const cols = ['ลูกค้า', 'ชื่อเส้นทาง', 'จำนวนเที่ยว', 'ส่วนต่างรวม', 'ส่วนต่างเฉลี่ย/เที่ยว', 'กำไร %', 'เที่ยวขาดทุน'];
  // Two highlight KPI cards
  let h = `<div class="master-grid-2" style="margin-bottom:20px;">
    <div class="master-mini-kpi" style="border-left:3px solid #22c55e;">
      <div class="master-mini-kpi-label">เส้นทางดีสุด</div>
      <div class="master-mini-kpi-value" style="color:#22c55e">${fmtB(rk.top[0]?.margin) + ' THB'}</div>
      <div class="master-mini-kpi-sub">${routeDisplay(rk.top[0])}</div>
    </div>
    <div class="master-mini-kpi" style="border-left:3px solid #ef4444;">
      <div class="master-mini-kpi-label">เส้นทางขาดทุนสูงสุด</div>
      <div class="master-mini-kpi-value" style="color:#ef4444">${fmtB(rk.bottom[0]?.margin) + ' THB'}</div>
      <div class="master-mini-kpi-sub">${routeDisplay(rk.bottom[0])}</div>
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

  const months = (function () {
    const a = MONTHS.filter(m => cp.some(c => c.months && c.months[m] && ((c.months[m].trips || 0) > 0 || (c.months[m].margin || 0) !== 0)));
    return a.length > 0 ? a : MONTHS;
  })();
  const rows = cp.map(c => [c.name, c.trips, c.recv, c.margin, c.pct, c.loss, c.oil, ...months.flatMap(m => [c.months[m]?.trips || 0, c.months[m]?.margin || 0])]);
  const cols = ['ลูกค้า', 'จำนวนเที่ยว', 'ราคารับ', 'ส่วนต่าง', 'กำไร %', 'เที่ยวขาดทุน', 'จ่ายสำรองน้ำมัน', ...months.flatMap(m => [MTH[m] + ' (เที่ยว)', MTH[m] + ' (ส่วนต่าง)'])];
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

  const mkR = arr => arr.map(r => [routeDisplay(r), r.trips, r.margin]);
  const cols = ['ชื่อเส้นทาง', 'จำนวนเที่ยว', 'ส่วนต่าง'];
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
    lt.byRoute ? Object.entries(lt.byRoute).map(([k, v]) => ({ name: k, route: v.route || k, routeDesc: v.routeDesc || v.desc, count: v.count, loss: v.loss })) : [];
  const routeRows = routeArr.map(r => [routeDisplay(r), r.count || 0, r.loss || 0]);

  h += `<div class="master-grid-2">`;
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>เที่ยวขาดทุนแยกตามรายลูกค้า</h3></div><div id="t_lc"></div></div>`;
  h += `<div class="table-card" style="margin-bottom:0"><div class="table-card-header"><h3>เที่ยวขาดทุนแยกตามเส้นทาง</h3></div><div id="t_lr"></div></div>`;
  h += `</div>`;

  setTimeout(() => {
    if (document.getElementById('t_lc'))
      mkTable('t_lc', ['ลูกค้า', 'เที่ยวขาดทุน', 'มูลค่าขาดทุน (THB)'], custRows, { defaultSort: 2, defaultAsc: true });
    if (document.getElementById('t_lr'))
      mkTable('t_lr', ['ชื่อเส้นทาง', 'เที่ยวขาดทุน', 'มูลค่าขาดทุน (THB)'], routeRows, { defaultSort: 1, defaultAsc: false });
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
      ${barChart(vt, v => v.type, v => v.trips / maxT * 100, v => fmt(v.trips) + ' เที่ยว', (v, i) => COLORS[i % 10], v => 'สัดส่วน ' + (Number(v.share) || 0).toFixed(2) + '%', true, true)}
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
  if (!values || values.length === 0) return '';
  const max = Math.max(...values, 1);
  const dataMin = Math.min(...values);
  // ALWAYS use 0 as the baseline if all values are non-negative,
  // preventing misleading truncated bar charts.
  const min = dataMin >= 0 ? 0 : dataMin;
  const range = Math.max(max - min, 1);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  // avgH for the average line — clamped to container
  const avgH = Math.min(height - 12, Math.max(4, ((avg - min) / range * (height - 16))));

  const bars = values.map((v, i) => {
    // Bar height relative to container, leaving 8px padding top+bottom
    const barH = Math.max(6, ((v - min) / range * (height - 16)));
    const intensity = (v - min) / range;
    const opacity = 0.45 + (intensity * 0.55);
    const isHigh = v >= avg;
    const opacityHex = Math.round(opacity * 255).toString(16).padStart(2, '0');
    return `<div class="sparkline-bar"
      style="height:${barH}px;
             background:linear-gradient(180deg, ${color}${opacityHex}, ${color}88);
             opacity:${0.75 + intensity * 0.25};
             animation-delay:${i * 80}ms;"
      onmouseover="this.style.background='linear-gradient(180deg,${color},${color}cc)';this.style.opacity='1'"
      onmouseout="this.style.background='linear-gradient(180deg,${color}${opacityHex},${color}88)';this.style.opacity='${(0.75 + intensity * 0.25).toFixed(2)}'">
      <div class="sparkline-tooltip">
        <div style="font-weight:700;color:${color};margin-bottom:2px">${esc(labels[i])}</div>
        <div style="font-size:13px;color:var(--text)">${fmt(v)} ${isHigh ? '▲' : '▼'} <span style="color:var(--muted);font-size:10px">เฉลี่ย ${fmt(Math.round(avg))}</span></div>
      </div>
    </div>`;
  }).join('');

  return `<div class="sparkline-container" style="height:${height}px">
    ${bars}
    <div style="position:absolute;bottom:${8 + avgH}px;left:8px;right:8px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.14),transparent);pointer-events:none;z-index:1"></div>
  </div>`;
}

function progressRing(pct, color, size = 80, stroke = 6) {
  const safePct = Number.isFinite(Number(pct)) ? Math.max(0, Math.min(100, Number(pct))) : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - safePct / 100);
  return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${circ}" stroke-dashoffset="${off}" stroke-linecap="round" style="transition:stroke-dashoffset 1s ease"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" transform="rotate(90 ${size / 2} ${size / 2})" fill="var(--text)" font-size="14" font-weight="800">${safePct.toFixed(1)}%</text>
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
  if (activeMonths.length === 0) {
    return `<div class="mvw-panel"><div class="mvw-panel-body" style="text-align:center;color:rgba(148,163,184,0.85);padding:40px;font-size:13px;">ยังไม่มีข้อมูลรายเดือนสำหรับการแสดงผล</div></div>`;
  }
  const monthCount = activeMonths.length;
  const monthsToShow = activeMonths;

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

  // Build delta HTML helpers
  const deltaHtml = (delta, direction) => {
    if (!Number.isFinite(Number(delta)) || Math.abs(Number(delta)) < 0.05) return '';
    const cls = (Number(delta) >= 0) === (direction === 'up') ? 'up' : 'down';
    const arrow = Number(delta) >= 0 ? '▲' : '▼';
    return `<span class="mvw-kpi-delta ${cls}">${arrow} ${Math.abs(Number(delta)).toFixed(1)}%</span>`;
  };

  const top10 = d.routeTrend.slice().sort((a, b) => {
    const ta = monthsToShow.reduce((s, m) => s + (a.months[m]?.trips || 0), 0);
    const tb = monthsToShow.reduce((s, m) => s + (b.months[m]?.trips || 0), 0);
    return tb - ta;
  }).slice(0, 10);

  // Best/Worst month
  const tripsMaxIdx = monthTrips.length ? monthTrips.indexOf(Math.max(...monthTrips)) : -1;
  const tripsMinIdx = monthTrips.length ? monthTrips.indexOf(Math.min(...monthTrips)) : -1;
  const marginMaxIdx = monthMargins.length ? monthMargins.indexOf(Math.max(...monthMargins)) : -1;
  const marginMinIdx = monthMargins.length ? monthMargins.indexOf(Math.min(...monthMargins)) : -1;
  const avgTripsPerMonth = monthCount > 0 ? Math.round(s.totalTrips / monthCount) : 0;
  const avgRevenuePerMonth = monthCount > 0 ? Math.round(s.totalRevenue / monthCount) : 0;
  const avgMarginPerMonth = monthCount > 0 ? Math.round(s.totalMargin / monthCount) : 0;
  const avgPerTrip = s.totalTrips > 0 ? Math.round(s.totalRevenue / s.totalTrips) : 0;

  const totalTripsTop = top10.reduce((a, r) => a + monthsToShow.reduce((sum, m) => sum + (r.months[m]?.trips || 0), 0), 0);
  const totalTripsAll = s.totalTrips || 1;
  const top10Share = (totalTripsTop / totalTripsAll * 100);

  const marginColor = s.totalMargin >= 0 ? '#22c55e' : '#ef4444';
  const pctColor = s.avgMarginPct >= 0 ? '#8b5cf6' : '#ef4444';
  const monthRange = monthRangeLabel(monthsToShow, d);

  return `
    <!-- Hero -->
    <div class="mvw-hero" style="--mvw-color:#3b82f6;--mvw-rgb:59,130,246;">
      <div>
        <div class="mvw-hero-title">สรุปภาพรวมและดัชนีชี้วัดผลประกอบการหลัก</div>
        <div class="mvw-hero-desc">รายงานสรุปผลประกอบการรายเดือน วิเคราะห์แนวโน้มเที่ยววิ่ง รายได้ ส่วนต่างกำไร และอัตรากำไร พร้อมระบุเดือนที่ทำผลงานสูงสุดและต่ำสุดเพื่อการตัดสินใจเชิงกลยุทธ์</div>
      </div>
      <div class="mvw-hero-meta">
        <span class="mvw-hero-meta-label">ช่วงข้อมูล</span>
        <span class="mvw-hero-meta-value" style="font-size:16px;">${monthRange}</span>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="mvw-kpi-row">
      <div class="mvw-kpi" style="--mvw-kpi-color:#3b82f6;">
        <span class="mvw-kpi-label">จำนวนเที่ยวทั้งหมด</span>
        <span class="mvw-kpi-value">${fmtB(s.totalTrips)}${deltaHtml(tripsDelta, 'up')}</span>
        <span class="mvw-kpi-sub">เที่ยว · เฉลี่ย ${fmtB(avgTripsPerMonth)}/เดือน</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#22c55e;">
        <span class="mvw-kpi-label">ราคารับรวม</span>
        <span class="mvw-kpi-value">${fmt(s.totalRevenue)}${deltaHtml(revenueDelta, 'up')}</span>
        <span class="mvw-kpi-sub">THB · เฉลี่ย ${fmt(avgRevenuePerMonth)}/เดือน</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:${marginColor};">
        <span class="mvw-kpi-label">ส่วนต่างรวม</span>
        <span class="mvw-kpi-value">${fmt(s.totalMargin)}${deltaHtml(marginDelta, 'up')}</span>
        <span class="mvw-kpi-sub">THB · ${s.totalMargin >= 0 ? 'ทำกำไร' : 'ขาดทุน'} ${fmt(avgMarginPerMonth)}/เดือน</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:${pctColor};">
        <span class="mvw-kpi-label">กำไร % เฉลี่ย</span>
        <span class="mvw-kpi-value">${fmtP(s.avgMarginPct)}${deltaHtml(avgPctDelta, 'up')}</span>
        <span class="mvw-kpi-sub">เฉลี่ยทุกเที่ยว · รายได้/เที่ยว ${fmt(avgPerTrip)}</span>
      </div>
    </div>

    <!-- Insight strip -->
    <div class="mvw-insight-strip">
      <div class="mvw-insight" style="--mvw-ins-color:#3b82f6;">
        <span class="mvw-insight-dot"></span>
        <div class="mvw-insight-body">
          <span class="mvw-insight-label">เดือนเที่ยวสูงสุด</span>
          <span class="mvw-insight-value">${tripsMaxIdx >= 0 ? `${monthLabels[tripsMaxIdx]} <b>${fmtB(monthTrips[tripsMaxIdx])} เที่ยว</b>` : '-'}</span>
        </div>
      </div>
      <div class="mvw-insight" style="--mvw-ins-color:#94a3b8;">
        <span class="mvw-insight-dot"></span>
        <div class="mvw-insight-body">
          <span class="mvw-insight-label">เดือนเที่ยวต่ำสุด</span>
          <span class="mvw-insight-value">${tripsMinIdx >= 0 ? `${monthLabels[tripsMinIdx]} <b>${fmtB(monthTrips[tripsMinIdx])} เที่ยว</b>` : '-'}</span>
        </div>
      </div>
      <div class="mvw-insight" style="--mvw-ins-color:#22c55e;">
        <span class="mvw-insight-dot"></span>
        <div class="mvw-insight-body">
          <span class="mvw-insight-label">เดือนกำไรสูงสุด</span>
          <span class="mvw-insight-value">${marginMaxIdx >= 0 ? `${monthLabels[marginMaxIdx]} <b>${fmt(monthMargins[marginMaxIdx])} THB</b>` : '-'}</span>
        </div>
      </div>
      <div class="mvw-insight" style="--mvw-ins-color:#ef4444;">
        <span class="mvw-insight-dot"></span>
        <div class="mvw-insight-body">
          <span class="mvw-insight-label">เดือนกำไรต่ำสุด</span>
          <span class="mvw-insight-value">${marginMinIdx >= 0 ? `${monthLabels[marginMinIdx]} <b>${fmt(monthMargins[marginMinIdx])} THB</b>` : '-'}</span>
        </div>
      </div>
    </div>

    <!-- Trend charts -->
    <div class="mvw-two-col">
      <div class="mvw-panel" style="--mvw-panel-color:#3b82f6;">
        <div class="mvw-panel-head">
          <div class="mvw-panel-title-wrap">
            <span class="mvw-panel-bar"></span>
            <span class="mvw-panel-title">แนวโน้มจำนวนเที่ยวรายเดือน</span>
          </div>
          <span class="mvw-panel-meta">เฉลี่ย ${fmtB(avgTripsPerMonth)} เที่ยว/เดือน</span>
        </div>
        <div class="mvw-panel-body">
          <div class="mvw-spark-wrap">${sparkline(monthTrips, monthLabels, '#3b82f6', 110)}</div>
          <div class="mvw-spark-foot">
            ${monthLabels.map((l, i) => `<div class="mvw-spark-month">
              <div class="mvw-spark-month-label">${l}</div>
              <div class="mvw-spark-month-value" style="color:#3b82f6;">${fmtB(monthTrips[i])}</div>
              ${i > 0 ? renderMoMDelta(monthTrips[i], monthTrips[i - 1], true, false) : '<div style="font-size:9px;color:var(--muted);margin-top:2px">—</div>'}
            </div>`).join('')}
          </div>
          <div class="mvw-spark-total">
            <span>รวม</span>
            <b style="color:#3b82f6;">${fmtB(monthTrips.reduce((a, b) => a + b, 0))} เที่ยว</b>
          </div>
        </div>
      </div>

      <div class="mvw-panel" style="--mvw-panel-color:${marginColor};">
        <div class="mvw-panel-head">
          <div class="mvw-panel-title-wrap">
            <span class="mvw-panel-bar"></span>
            <span class="mvw-panel-title">แนวโน้มส่วนต่างกำไรรายเดือน</span>
          </div>
          <span class="mvw-panel-meta">เฉลี่ย ${fmt(avgMarginPerMonth)} THB/เดือน</span>
        </div>
        <div class="mvw-panel-body">
          <div class="mvw-spark-wrap">${sparkline(monthMargins, monthLabels, marginColor, 110)}</div>
          <div class="mvw-spark-foot">
            ${monthLabels.map((l, i) => `<div class="mvw-spark-month">
              <div class="mvw-spark-month-label">${l}</div>
              <div class="mvw-spark-month-value" style="color:${marginColor};">${fmt(monthMargins[i])}</div>
              ${i > 0 ? renderMoMDelta(monthMargins[i], monthMargins[i - 1], true, true) : '<div style="font-size:9px;color:var(--muted);margin-top:2px">—</div>'}
            </div>`).join('')}
          </div>
          <div class="mvw-spark-total">
            <span>รวม</span>
            <b style="color:${marginColor};">${fmt(monthMargins.reduce((a, b) => a + b, 0))} THB</b>
          </div>
        </div>
      </div>
    </div>

    <!-- Monthly summary table -->
    <div class="mvw-panel" style="--mvw-panel-color:#8b5cf6;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">สรุปผลประกอบการรายเดือน</span>
        </div>
        <span class="mvw-panel-meta">${monthCount} เดือน</span>
      </div>
      <div class="mvw-panel-body" style="padding:0;overflow-x:auto;">
        <table class="mvw-month-table">
          <thead>
            <tr>
              <th>เดือน</th>
              <th>จำนวนเที่ยว</th>
              <th>ราคารับ (THB)</th>
              <th>ส่วนต่าง (THB)</th>
              <th>กำไร %</th>
              <th>รายได้/เที่ยว</th>
            </tr>
          </thead>
          <tbody>
            ${monthsToShow.map((m, i) => {
    const trips = monthTrips[i] || 0;
    const recv = monthRevenue[i] || 0;
    const mg = monthMargins[i] || 0;
    const pct = recv > 0 ? (mg / recv * 100) : 0;
    const perTrip = trips > 0 ? recv / trips : 0;
    const mgCls = mg >= 0 ? 'pos' : 'neg';
    return `<tr>
                <td>${MTH[m] || m}</td>
                <td>${fmtB(trips)}</td>
                <td>${fmt(recv)}</td>
                <td class="${mgCls}">${fmt(mg)}</td>
                <td class="${mgCls}">${fmtP(pct)}</td>
                <td>${fmt(perTrip)}</td>
              </tr>`;
  }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>รวม / เฉลี่ย</td>
              <td>${fmtB(s.totalTrips)}</td>
              <td>${fmt(s.totalRevenue)}</td>
              <td class="${s.totalMargin >= 0 ? 'pos' : 'neg'}">${fmt(s.totalMargin)}</td>
              <td class="${s.avgMarginPct >= 0 ? 'pos' : 'neg'}">${fmtP(s.avgMarginPct)}</td>
              <td>${fmt(avgPerTrip)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Top 10 routes -->
    <div class="mvw-panel" style="--mvw-panel-color:#3b82f6;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">Top 10 เส้นทางที่มีเที่ยววิ่งมากที่สุด</span>
        </div>
        <span class="mvw-panel-meta">รวม ${fmtP(top10Share)} ของเที่ยวทั้งหมด</span>
      </div>
      <div class="mvw-panel-body" style="padding:0;">
        <div class="mvw-rt cols-trips">
          <div class="mvw-rt-head">
            <span class="num">ลำดับ</span>
            <span>ชื่อเส้นทาง</span>
            <span>ลูกค้า</span>
            <span class="right">สัดส่วนเที่ยว</span>
            <span class="right">ส่วนต่างรวม</span>
          </div>
          ${(() => {
      // Compute max trips among top10 for proportional bar scaling
      const top10Trips = top10.map(r => monthsToShow.reduce((sum, m) => sum + (r.months[m]?.trips || 0), 0));
      const maxTop10 = Math.max(...top10Trips, 1);
      return top10.map((r, i) => {
        const tot = top10Trips[i];
        const mg = monthsToShow.reduce((sum, m) => sum + (r.months[m]?.margin || 0), 0);
        const sharePct = totalTripsAll > 0 ? (tot / totalTripsAll * 100) : 0;
        // Bar width proportional to leader (rank 1 = 100%, others scaled)
        const barW = Math.max(2, (tot / maxTop10 * 100));
        const tier = i < 3 ? `tier-${i + 1}` : '';
        const col = getCustomerColor(r.customer);
        const mgCls = mg >= 0 ? 'pos' : 'neg';
        return `<div class="mvw-rt-row ${tier}" style="--mvw-rt-color:${col};">
                <div class="mvw-rt-medal">${String(i + 1).padStart(2, '0')}</div>
                <div class="mvw-rt-info">
                  <span class="mvw-rt-name" title="${esc(routeDisplay(r))}">${esc(routeDisplay(r))}</span>
                  <div class="mvw-rt-meta">
                    <span>${esc(r.vtype || '-')}</span>
                    <span class="mvw-rt-meta-sep"></span>
                    <span>${fmtP(sharePct)} ของเที่ยวทั้งหมด</span>
                  </div>
                </div>
                <div class="mvw-rt-customer" title="${esc(r.customer)}">
                  <span class="mvw-rt-customer-dot"></span>
                  <span class="mvw-rt-customer-text">${esc(r.customer)}</span>
                </div>
                <div class="mvw-rt-mini">
                  <div class="mvw-rt-mini-track"><div class="mvw-rt-mini-fill" style="width:${barW.toFixed(1)}%;"></div></div>
                  <span class="mvw-rt-mini-pct">${fmtB(tot)}<small>เที่ยว</small></span>
                </div>
                <div class="mvw-rt-num ${mgCls}">${fmt(mg)}<small>THB</small></div>
              </div>`;
      }).join('');
    })()}
        </div>
      </div>
    </div>

    ${buildAuditTableSection('audit-overview-routes', 'Top 10 เส้นทางที่มีเที่ยววิ่งมากที่สุด', '&#10148;', '#3b82f6', 'กรองลูกค้า ประเภทรถ และตรวจสอบเที่ยวรายเดือนในตารางเดียว')}
    ${buildAuditTableSection('audit-overview-months', 'สรุปผลประกอบการรายเดือน', '&#8862;', '#8b5cf6', 'ตรวจสอบจำนวนเที่ยว รายได้ ส่วนต่าง และกำไร % รายเดือน')}
  `;
}

function buildFullRanking(d) {
  const rk = d.routeRanking;
  const routeKey = r => routeIdentityKey(r);
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
  const netMargin = totalProfitMargin + totalLossMargin;
  const netCls = netMargin >= 0 ? 'pos' : 'neg';
  const netColor = netMargin >= 0 ? '#22c55e' : '#ef4444';

  const top5Detail = rk.top.slice(0, 5);
  const bot5Detail = rk.bottom.slice(0, 5);
  const maxTopAbs = Math.max(...top5Detail.map(r => Math.abs(r.margin || 0)), 1);
  const maxBotAbs = Math.max(...bot5Detail.map(r => Math.abs(r.margin || 0)), 1);

  return `
    <!-- Hero -->
    <div class="mvw-hero" style="--mvw-color:#8b5cf6;--mvw-rgb:139,92,246;">
      <div>
        <div class="mvw-hero-title">การจัดลำดับเส้นทางตามผลตอบแทนสุทธิ</div>
        <div class="mvw-hero-desc">แสดงเส้นทางที่ทำกำไรและขาดทุนสูงสุด พร้อมวิเคราะห์การกระจายตัวของผลตอบแทนทั่วทั้งเครือข่าย เพื่อระบุจุดแข็งและความเสี่ยงทางธุรกิจ</div>
      </div>
      <div class="mvw-hero-meta">
        <span class="mvw-hero-meta-label">เส้นทางทั้งหมด</span>
        <span class="mvw-hero-meta-value">${fmtB(uniqueRouteCount)}</span>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="mvw-kpi-row">
      <div class="mvw-kpi" style="--mvw-kpi-color:#3b82f6;">
        <span class="mvw-kpi-label">เส้นทางทั้งหมด</span>
        <span class="mvw-kpi-value">${fmtB(uniqueRouteCount)}</span>
        <span class="mvw-kpi-sub">เส้นทางที่มีข้อมูล</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#22c55e;">
        <span class="mvw-kpi-label">กำไรสูงสุด</span>
        <span class="mvw-kpi-value">${fmt(rk.top[0]?.margin || 0)}</span>
        <span class="mvw-kpi-sub" title="${esc(routeDisplay(rk.top[0]))}">THB · ${esc(routeDisplay(rk.top[0]))}</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#ef4444;">
        <span class="mvw-kpi-label">ขาดทุนสูงสุด</span>
        <span class="mvw-kpi-value">${fmt(rk.bottom[0]?.margin || 0)}</span>
        <span class="mvw-kpi-sub" title="${esc(routeDisplay(rk.bottom[0]))}">THB · ${esc(routeDisplay(rk.bottom[0]))}</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:${netColor};">
        <span class="mvw-kpi-label">ส่วนต่างสุทธิ</span>
        <span class="mvw-kpi-value">${fmt(netMargin)}</span>
        <span class="mvw-kpi-sub">THB · จากทุกเส้นทาง</span>
      </div>
    </div>

    <!-- Distribution Panel -->
    <div class="mvw-panel" style="--mvw-panel-color:#8b5cf6;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">ภาพรวมการกระจายตัวผลตอบแทน</span>
        </div>
        <span class="mvw-panel-meta">${fmtB(totalRoutes)} เส้นทางจัดประเภท</span>
      </div>
      <div class="mvw-panel-body">
        <div class="mvw-dist">
          ${profitCount > 0 ? `<div class="mvw-dist-seg pos" style="flex:${profitCount};">${profitPct}% กำไร</div>` : ''}
          ${zeroCount > 0 ? `<div class="mvw-dist-seg zero" style="flex:${zeroCount};">${zeroPct}% เท่าทุน</div>` : ''}
          ${lossCount > 0 ? `<div class="mvw-dist-seg neg" style="flex:${lossCount};">${lossPct}% ขาดทุน</div>` : ''}
        </div>
        <div class="mvw-stat-grid">
          <div class="mvw-stat" style="--mvw-stat-color:#22c55e;">
            <span class="mvw-stat-label">เส้นทางกำไร</span>
            <span class="mvw-stat-value">${fmtB(profitCount)}</span>
            <span class="mvw-stat-sub">${profitPct}% · รวม ${fmt(totalProfitMargin)} THB</span>
          </div>
          <div class="mvw-stat" style="--mvw-stat-color:#ef4444;">
            <span class="mvw-stat-label">เส้นทางขาดทุน</span>
            <span class="mvw-stat-value">${fmtB(lossCount)}</span>
            <span class="mvw-stat-sub">${lossPct}% · รวม ${fmt(totalLossMargin)} THB</span>
          </div>
          <div class="mvw-stat" style="--mvw-stat-color:#8b5cf6;">
            <span class="mvw-stat-label">ส่วนต่างเฉลี่ย</span>
            <span class="mvw-stat-value">${fmt(Math.round(avgM))}</span>
            <span class="mvw-stat-sub">THB · ต่อเส้นทาง</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Top/Bottom side-by-side -->
    <div class="mvw-two-col">
      <div class="mvw-panel" style="--mvw-panel-color:#22c55e;">
        <div class="mvw-panel-head">
          <div class="mvw-panel-title-wrap">
            <span class="mvw-panel-bar"></span>
            <span class="mvw-panel-title">Top 5 เส้นทางทำกำไรสูงสุด</span>
          </div>
          <span class="mvw-panel-meta">เรียงตามส่วนต่าง</span>
        </div>
        <div class="mvw-panel-body" style="padding:0;">
          <div class="mvw-rt cols-rank">
            <div class="mvw-rt-head">
              <span class="num">ลำดับ</span>
              <span>ชื่อเส้นทาง · ลูกค้า</span>
              <span class="right">ส่วนต่าง / เที่ยว</span>
            </div>
            ${top5Detail.map((r, i) => {
    const tier = i < 3 ? `tier-${i + 1}` : '';
    return `<div class="mvw-rt-row ${tier}" style="--mvw-rt-color:#22c55e;">
                <div class="mvw-rt-medal">${String(i + 1).padStart(2, '0')}</div>
                <div class="mvw-rt-info">
                  <span class="mvw-rt-name" title="${esc(routeDisplay(r))}">${esc(routeDisplay(r))}</span>
                  <div class="mvw-rt-meta">
                    <span>${esc(r.customer || '-')}</span>
                    <span class="mvw-rt-meta-sep"></span>
                    <span>${fmtP(r.pct || 0)}</span>
                  </div>
                </div>
                <div class="mvw-rt-num pos">${fmt(r.margin)}<small>${fmtB(r.trips || 0)} เที่ยว</small></div>
              </div>`;
  }).join('')}
          </div>
        </div>
      </div>
      <div class="mvw-panel" style="--mvw-panel-color:#ef4444;">
        <div class="mvw-panel-head">
          <div class="mvw-panel-title-wrap">
            <span class="mvw-panel-bar"></span>
            <span class="mvw-panel-title">Top 5 เส้นทางขาดทุนสูงสุด</span>
          </div>
          <span class="mvw-panel-meta">เรียงตามส่วนต่าง</span>
        </div>
        <div class="mvw-panel-body" style="padding:0;">
          <div class="mvw-rt cols-rank">
            <div class="mvw-rt-head">
              <span class="num">ลำดับ</span>
              <span>ชื่อเส้นทาง · ลูกค้า</span>
              <span class="right">ส่วนต่าง / เที่ยว</span>
            </div>
            ${bot5Detail.map((r, i) => {
    const tier = i < 3 ? `tier-${i + 1}` : '';
    return `<div class="mvw-rt-row ${tier}" style="--mvw-rt-color:#ef4444;">
                <div class="mvw-rt-medal">${String(i + 1).padStart(2, '0')}</div>
                <div class="mvw-rt-info">
                  <span class="mvw-rt-name" title="${esc(routeDisplay(r))}">${esc(routeDisplay(r))}</span>
                  <div class="mvw-rt-meta">
                    <span>${esc(r.customer || '-')}</span>
                    <span class="mvw-rt-meta-sep"></span>
                    <span>${fmtP(r.pct || 0)}</span>
                  </div>
                </div>
                <div class="mvw-rt-num neg">${fmt(r.margin)}<small>${fmtB(r.trips || 0)} เที่ยว</small></div>
              </div>`;
  }).join('')}
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
  const maxM = Math.max(1, ...cp.filter(c => (Number(c.margin) || 0) > 0).map(c => Number(c.margin) || 0));
  const totalRecv = cp.reduce((a, c) => a + (c.recv || 0), 0);
  const totalMargin = cp.reduce((a, c) => a + (c.margin || 0), 0);
  const totalTrips = cp.reduce((a, c) => a + (c.trips || 0), 0);
  const avgPct = totalRecv > 0 ? (totalMargin / totalRecv * 100) : 0;
  const profitCusts = cp.filter(c => (c.margin || 0) > 0).length;
  const lossCusts = cp.filter(c => (c.margin || 0) < 0).length;
  const totalMarginCls = totalMargin >= 0 ? 'pos' : 'neg';
  const totalMarginColor = totalMargin >= 0 ? '#22c55e' : '#ef4444';

  return `
    <!-- Hero -->
    <div class="mvw-hero" style="--mvw-color:#22c55e;--mvw-rgb:34,197,94;">
      <div>
        <div class="mvw-hero-title">อัตราผลตอบแทนและส่วนต่างกำไรรายลูกค้า</div>
        <div class="mvw-hero-desc">ภาพรวมรายได้ ส่วนต่างกำไร และสัดส่วนของลูกค้าแต่ละราย ใช้สำหรับวิเคราะห์ portfolio ลูกค้า ระบุลูกค้าหลักและลูกค้าเสี่ยง</div>
      </div>
      <div class="mvw-hero-meta">
        <span class="mvw-hero-meta-label">ลูกค้าทั้งหมด</span>
        <span class="mvw-hero-meta-value">${fmtB(cp.length)}</span>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="mvw-kpi-row">
      <div class="mvw-kpi" style="--mvw-kpi-color:#3b82f6;">
        <span class="mvw-kpi-label">ลูกค้าทั้งหมด</span>
        <span class="mvw-kpi-value">${fmtB(cp.length)}</span>
        <span class="mvw-kpi-sub">ราย · ${fmtB(totalTrips)} เที่ยว</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#22c55e;">
        <span class="mvw-kpi-label">รายรับรวม</span>
        <span class="mvw-kpi-value">${fmt(totalRecv)}</span>
        <span class="mvw-kpi-sub">THB · จากทุกลูกค้า</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:${totalMarginColor};">
        <span class="mvw-kpi-label">ส่วนต่างรวม</span>
        <span class="mvw-kpi-value">${fmt(totalMargin)}</span>
        <span class="mvw-kpi-sub">THB · กำไรสุทธิ ${fmtP(avgPct)}</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#f59e0b;">
        <span class="mvw-kpi-label">ลูกค้ากำไรสูงสุด</span>
        <span class="mvw-kpi-value" style="font-size:clamp(14px,1.3vw,17px);" title="${esc(cp[0]?.name || '-')}">${esc(cp[0]?.name || '-')}</span>
        <span class="mvw-kpi-sub">ส่วนต่าง ${fmt(cp[0]?.margin || 0)} THB</span>
      </div>
    </div>

    <!-- Distribution -->
    <div class="mvw-panel" style="--mvw-panel-color:#22c55e;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">การกระจายตัวของลูกค้าตามผลตอบแทน</span>
        </div>
        <span class="mvw-panel-meta">${fmtB(cp.length)} ลูกค้า</span>
      </div>
      <div class="mvw-panel-body">
        <div class="mvw-stat-grid">
          <div class="mvw-stat" style="--mvw-stat-color:#22c55e;">
            <span class="mvw-stat-label">ลูกค้าที่ทำกำไร</span>
            <span class="mvw-stat-value">${fmtB(profitCusts)}</span>
            <span class="mvw-stat-sub">${cp.length > 0 ? (profitCusts / cp.length * 100).toFixed(1) : '0'}% ของทั้งหมด</span>
          </div>
          <div class="mvw-stat" style="--mvw-stat-color:#ef4444;">
            <span class="mvw-stat-label">ลูกค้าที่ขาดทุน</span>
            <span class="mvw-stat-value">${fmtB(lossCusts)}</span>
            <span class="mvw-stat-sub">${cp.length > 0 ? (lossCusts / cp.length * 100).toFixed(1) : '0'}% ของทั้งหมด</span>
          </div>
          <div class="mvw-stat" style="--mvw-stat-color:#8b5cf6;">
            <span class="mvw-stat-label">รายรับเฉลี่ย/ลูกค้า</span>
            <span class="mvw-stat-value">${fmt(cp.length > 0 ? Math.round(totalRecv / cp.length) : 0)}</span>
            <span class="mvw-stat-sub">THB · ค่ากลาง</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Top 10 Customer Detail -->
    <div class="mvw-panel" style="--mvw-panel-color:#22c55e;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">Top 10 ลูกค้า · รายได้และส่วนต่างกำไร</span>
        </div>
        <span class="mvw-panel-meta">เรียงตามรายได้</span>
      </div>
      <div class="mvw-panel-body" style="padding:0;">
        <div class="mvw-rt cols-customer">
          <div class="mvw-rt-head">
            <span class="num">ลำดับ</span>
            <span>ลูกค้า</span>
            <span class="right">รายได้</span>
            <span class="right">ส่วนต่าง</span>
            <span class="right">กำไร %</span>
          </div>
          ${top10.map((c, i) => {
    const tier = i < 3 ? `tier-${i + 1}` : '';
    const col = getCustomerColor(c.name);
    const mgPos = (c.margin || 0) >= 0;
    const mgCls = mgPos ? 'pos' : 'neg';
    return `<div class="mvw-rt-row ${tier}" style="--mvw-rt-color:${col};">
              <div class="mvw-rt-medal">${String(i + 1).padStart(2, '0')}</div>
              <div class="mvw-rt-info">
                <span class="mvw-rt-name" title="${esc(c.name)}">${esc(c.name)}</span>
                <div class="mvw-rt-meta">
                  <span>${fmtB(c.trips || 0)} เที่ยว</span>
                  ${maxR > 0 ? `<span class="mvw-rt-meta-sep"></span><span>${fmtP((c.recv || 0) / maxR * 100)} ของลูกค้าสูงสุด</span>` : ''}
                </div>
              </div>
              <div class="mvw-rt-num accent">${fmt(c.recv || 0)}</div>
              <div class="mvw-rt-num ${mgCls}">${fmt(c.margin || 0)}</div>
              <span class="mvw-rt-pill ${mgCls}">${fmtP(c.pct || 0)}</span>
            </div>`;
  }).join('')}
        </div>
      </div>
    </div>

    ${buildAuditTableSection('audit-customer-profit', 'รายละเอียดผลประกอบการรายลูกค้าทั้งหมด', '&#8857;', '#22c55e', 'กรองลูกค้าและสถานะผลตอบแทน พร้อม export เพื่อตรวจสอบต่อได้')}
  `;
}

function buildFullOwnOut(d) {
  const { company: co, outsource: ou, companyTripPct, outsourceTripPct } = getSafeOwnOut(d);
  const coP = companyTripPct.toFixed(1);
  const ouP = outsourceTripPct.toFixed(1);
  const totalTrips = (Number(co.trips) || 0) + (Number(ou.trips) || 0);
  const totalRecv = (Number(co.recv) || 0) + (Number(ou.recv) || 0);
  const totalMargin = (Number(co.margin) || 0) + (Number(ou.margin) || 0);
  const coMargin = Number(co.margin) || 0;
  const ouMargin = Number(ou.margin) || 0;
  const coRecv = Number(co.recv) || 0;
  const ouRecv = Number(ou.recv) || 0;
  const coRecvPct = totalRecv > 0 ? (coRecv / totalRecv * 100) : 0;
  const ouRecvPct = totalRecv > 0 ? (ouRecv / totalRecv * 100) : 0;
  const coMarginPct = Math.abs(totalMargin) > 0 ? (coMargin / totalMargin * 100) : 0;
  const ouMarginPct = Math.abs(totalMargin) > 0 ? (ouMargin / totalMargin * 100) : 0;
  const coAvg = co.trips > 0 ? coRecv / co.trips : 0;
  const ouAvg = ou.trips > 0 ? ouRecv / ou.trips : 0;
  const coRateCls = coMargin >= 0 ? 'pos' : 'neg';
  const ouRateCls = ouMargin >= 0 ? 'pos' : 'neg';
  // Determine winners for compare table
  const winnerTrips = co.trips > ou.trips ? 'co' : 'ou';
  const winnerRecv = coRecv > ouRecv ? 'co' : 'ou';
  const winnerMargin = coMargin > ouMargin ? 'co' : 'ou';
  const winnerPct = (Number(co.pct) || 0) > (Number(ou.pct) || 0) ? 'co' : 'ou';
  const winnerAvg = coAvg > ouAvg ? 'co' : 'ou';

  return `
    <!-- Hero -->
    <div class="mvw-hero" style="--mvw-color:#f59e0b;--mvw-rgb:245,158,11;">
      <div>
        <div class="mvw-hero-title">สัดส่วนการใช้รถบริษัทและรถรับจ้างภายนอก</div>
        <div class="mvw-hero-desc">เปรียบเทียบประสิทธิภาพและสัดส่วนระหว่างรถบริษัทและรถจ้างภายนอก เพื่อวิเคราะห์โครงสร้างต้นทุนและความคุ้มค่าในการบริหารกองรถ</div>
      </div>
      <div class="mvw-hero-meta">
        <span class="mvw-hero-meta-label">เที่ยวรวมทั้งหมด</span>
        <span class="mvw-hero-meta-value">${fmtB(totalTrips)}</span>
      </div>
    </div>

    <!-- Distribution -->
    <div class="mvw-panel" style="--mvw-panel-color:#f59e0b;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">สัดส่วนการใช้รถ (จำนวนเที่ยว)</span>
        </div>
        <span class="mvw-panel-meta">รวม ${fmtB(totalTrips)} เที่ยว</span>
      </div>
      <div class="mvw-panel-body">
        <div class="mvw-dist">
          ${parseFloat(coP) > 0 ? `<div class="mvw-dist-seg" style="background:linear-gradient(180deg,#3b82f6d8,#1d4ed8);flex:${coP};">${coP}% รถบริษัท</div>` : ''}
          ${parseFloat(ouP) > 0 ? `<div class="mvw-dist-seg" style="background:linear-gradient(180deg,#f59e0bd8,#d97706);flex:${ouP};">${ouP}% รถจ้างภายนอก</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Hero Cards (Company vs Outsource) -->
    <div class="mvw-fleet-hero">
      <div class="mvw-fleet-hero-card" style="--mvw-fleet:#3b82f6;--mvw-fleet-rgb:59,130,246;">
        <div class="mvw-fleet-hero-ring">${progressRing(parseFloat(coP), '#3b82f6', 92, 8)}</div>
        <div class="mvw-fleet-hero-info">
          <div class="mvw-fleet-hero-label">รถบริษัท</div>
          <div class="mvw-fleet-hero-value">${fmtB(co.trips)}<small>เที่ยว</small></div>
          <div class="mvw-fleet-hero-stats">
            <span>รายได้ <b>${fmt(coRecv)}</b></span>
            <span>ส่วนต่าง <b class="${coRateCls}">${fmt(coMargin)}</b></span>
            <span>กำไร <b class="${coRateCls}">${fmtP(co.pct || 0)}</b></span>
          </div>
        </div>
      </div>
      <div class="mvw-fleet-hero-card" style="--mvw-fleet:#f59e0b;--mvw-fleet-rgb:245,158,11;">
        <div class="mvw-fleet-hero-ring">${progressRing(parseFloat(ouP), '#f59e0b', 92, 8)}</div>
        <div class="mvw-fleet-hero-info">
          <div class="mvw-fleet-hero-label">รถจ้างภายนอก</div>
          <div class="mvw-fleet-hero-value">${fmtB(ou.trips)}<small>เที่ยว</small></div>
          <div class="mvw-fleet-hero-stats">
            <span>รายได้ <b>${fmt(ouRecv)}</b></span>
            <span>ส่วนต่าง <b class="${ouRateCls}">${fmt(ouMargin)}</b></span>
            <span>กำไร <b class="${ouRateCls}">${fmtP(ou.pct || 0)}</b></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Compare Table -->
    <div class="mvw-panel" style="--mvw-panel-color:#f59e0b;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">เปรียบเทียบตัวชี้วัดหลัก</span>
        </div>
        <span class="mvw-panel-meta">★ = สูงกว่า</span>
      </div>
      <div class="mvw-panel-body" style="padding:0;">
        <table class="mvw-cmp-table">
          <thead>
            <tr>
              <th>ตัวชี้วัด</th>
              <th class="col-co">รถบริษัท</th>
              <th class="col-ou">รถจ้างภายนอก</th>
              <th>รวม</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>จำนวนเที่ยว</td>
              <td class="${winnerTrips === 'co' ? 'winner' : ''}">${fmtB(co.trips)}</td>
              <td class="${winnerTrips === 'ou' ? 'winner' : ''}">${fmtB(ou.trips)}</td>
              <td>${fmtB(totalTrips)}</td>
            </tr>
            <tr>
              <td>ราคารับรวม (THB)</td>
              <td class="${winnerRecv === 'co' ? 'winner' : ''}">${fmt(coRecv)}</td>
              <td class="${winnerRecv === 'ou' ? 'winner' : ''}">${fmt(ouRecv)}</td>
              <td>${fmt(totalRecv)}</td>
            </tr>
            <tr>
              <td>สัดส่วนรายได้</td>
              <td>${fmtP(coRecvPct)}</td>
              <td>${fmtP(ouRecvPct)}</td>
              <td>100.00%</td>
            </tr>
            <tr>
              <td>ส่วนต่างรวม (THB)</td>
              <td class="${coRateCls} ${winnerMargin === 'co' ? 'winner' : ''}">${fmt(coMargin)}</td>
              <td class="${ouRateCls} ${winnerMargin === 'ou' ? 'winner' : ''}">${fmt(ouMargin)}</td>
              <td class="${totalMargin >= 0 ? 'pos' : 'neg'}">${fmt(totalMargin)}</td>
            </tr>
            <tr>
              <td>กำไร %</td>
              <td class="${winnerPct === 'co' ? 'winner' : ''}">${fmtP(co.pct || 0)}</td>
              <td class="${winnerPct === 'ou' ? 'winner' : ''}">${fmtP(ou.pct || 0)}</td>
              <td>${fmtP(totalRecv > 0 ? totalMargin / totalRecv * 100 : 0)}</td>
            </tr>
            <tr>
              <td>รายได้เฉลี่ย/เที่ยว</td>
              <td class="${winnerAvg === 'co' ? 'winner' : ''}">${fmt(coAvg)}</td>
              <td class="${winnerAvg === 'ou' ? 'winner' : ''}">${fmt(ouAvg)}</td>
              <td>${fmt(totalTrips > 0 ? totalRecv / totalTrips : 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-full-grid modal-full-grid-2">
      ${buildAuditTableSection('audit-ownout-company', 'รถบริษัท', '&#9635;', '#3b82f6', 'ตรวจสอบเส้นทางหลักของรถบริษัทตามจำนวนเที่ยวและส่วนต่าง')}
      ${buildAuditTableSection('audit-ownout-outsource', 'รถจ้างภายนอก', '&#9733;', '#f59e0b', 'ตรวจสอบเส้นทางหลักของรถจ้างภายนอกในรูปแบบเดียวกัน')}
    </div>
  `;
}

function buildFullLoss(d) {
  const lt = d.lossTrip;
  if (!lt) return `<div style="text-align:center;padding:40px;color:var(--muted);"><div style="font-size:48px;margin-bottom:12px;">✅</div><div style="font-size:18px;font-weight:700;">ไม่มีข้อมูลการขาดทุน</div><div style="font-size:13px;margin-top:8px;">ทุกเส้นทางทำกำไรในช่วงเวลานี้</div></div>`;

  const validMonths = MONTHS.filter(m => lt.byMonth && lt.byMonth[m]);
  if (validMonths.length === 0) {
    return `<div class="mvw-panel"><div class="mvw-panel-body" style="text-align:center;color:rgba(148,163,184,0.85);padding:40px;font-size:13px;">ยังไม่มีข้อมูลขาดทุนรายเดือนสำหรับการแสดงผล</div></div>`;
  }
  const monthLoss = validMonths.map(m => Math.abs(lt.byMonth[m].loss || 0));
  const monthCounts = validMonths.map(m => lt.byMonth[m].count || 0);
  const monthLabels = validMonths.map(m => MTH[m] || m);
  const activeLossMonths = getActiveMonthsFromLoss(lt);
  const lossMonthCount = activeLossMonths.length || validMonths.length;
  const avgLossPerTrip = lt.total > 0 ? Math.round((lt.totalLoss || 0) / lt.total) : 0;
  const avgPerMonth = lossMonthCount > 0 ? Math.round((lt.totalLoss || 0) / lossMonthCount) : 0;
  const avgCountPerMonth = lossMonthCount > 0 ? Math.round((lt.total || 0) / lossMonthCount) : 0;

  const totalCountAll = monthCounts.reduce((a, b) => a + b, 0);
  const totalLossAll = monthLoss.reduce((a, b) => a + b, 0);

  return `
    <!-- Hero -->
    <div class="mvw-hero" style="--mvw-color:#ef4444;--mvw-rgb:239,68,68;">
      <div>
        <div class="mvw-hero-title">ประสิทธิภาพของกลุ่มเที่ยววิ่งที่มีส่วนต่างขาดทุน</div>
        <div class="mvw-hero-desc">วิเคราะห์เที่ยววิ่งที่ขาดทุนตามมิติเวลา ลูกค้า และเส้นทาง เพื่อระบุจุดที่ต้องเร่งแก้ไข ลดความเสี่ยงทางการเงิน และวางแผนปรับปรุงเชิงรุก</div>
      </div>
      <div class="mvw-hero-meta">
        <span class="mvw-hero-meta-label">มูลค่าขาดทุนรวม</span>
        <span class="mvw-hero-meta-value">${fmt(lt.totalLoss || 0)}</span>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="mvw-kpi-row">
      <div class="mvw-kpi" style="--mvw-kpi-color:#ef4444;">
        <span class="mvw-kpi-label">เที่ยวขาดทุน</span>
        <span class="mvw-kpi-value">${fmtB(lt.total || 0)}</span>
        <span class="mvw-kpi-sub">จาก ${fmtB(lt.totalTrips || 0)} เที่ยว</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#f59e0b;">
        <span class="mvw-kpi-label">อัตราขาดทุน</span>
        <span class="mvw-kpi-value">${fmtP(lt.lossPct || 0)}</span>
        <span class="mvw-kpi-sub">ของเที่ยวทั้งหมด</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#ef4444;">
        <span class="mvw-kpi-label">มูลค่าขาดทุนรวม</span>
        <span class="mvw-kpi-value">${fmt(lt.totalLoss || 0)}</span>
        <span class="mvw-kpi-sub">THB · สะสม ${lossMonthCount} เดือน</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#ef4444;">
        <span class="mvw-kpi-label">ขาดทุนเฉลี่ย/เที่ยว</span>
        <span class="mvw-kpi-value">${fmt(avgLossPerTrip)}</span>
        <span class="mvw-kpi-sub">THB · ค่าเฉลี่ย</span>
      </div>
    </div>

    <!-- Monthly Distribution Stats -->
    <div class="mvw-panel" style="--mvw-panel-color:#ef4444;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">การกระจายตัวของเที่ยวขาดทุนรายเดือน</span>
        </div>
        <span class="mvw-panel-meta">${lossMonthCount} เดือน</span>
      </div>
      <div class="mvw-panel-body">
        <div class="mvw-loss-month-grid">
          ${validMonths.map((m, i) => {
    const bm = lt.byMonth[m];
    return `<div class="mvw-loss-month-tile">
              <div class="mvw-loss-month-name">${MTH[m] || m}</div>
              <div class="mvw-loss-month-count">${fmtB(bm.count || 0)}</div>
              <div class="mvw-loss-month-count-label">เที่ยวขาดทุน</div>
              <div class="mvw-loss-month-amount">${fmt(bm.loss || 0)} THB</div>
            </div>`;
  }).join('')}
        </div>
      </div>
    </div>

    <!-- Charts side by side -->
    <div class="mvw-two-col">
      <div class="mvw-panel" style="--mvw-panel-color:#f59e0b;">
        <div class="mvw-panel-head">
          <div class="mvw-panel-title-wrap">
            <span class="mvw-panel-bar"></span>
            <span class="mvw-panel-title">จำนวนเที่ยวขาดทุนรายเดือน</span>
          </div>
          <span class="mvw-panel-meta">เฉลี่ย ${fmtB(avgCountPerMonth)} เที่ยว/เดือน</span>
        </div>
        <div class="mvw-panel-body">
          <div class="mvw-spark-wrap">${sparkline(monthCounts, monthLabels, '#f59e0b', 100)}</div>
          <div class="mvw-spark-foot">
            ${monthLabels.map((l, i) => `<div class="mvw-spark-month">
              <div class="mvw-spark-month-label">${l}</div>
              <div class="mvw-spark-month-value" style="color:#f59e0b;">${fmtB(monthCounts[i])}</div>
              ${i > 0 ? renderMoMDelta(monthCounts[i], monthCounts[i - 1], false, false) : '<div style="font-size:9px;color:var(--muted);margin-top:2px">—</div>'}
            </div>`).join('')}
          </div>
          <div class="mvw-spark-total">
            <span>รวม</span>
            <b style="color:#f59e0b;">${fmtB(totalCountAll)} เที่ยว</b>
          </div>
        </div>
      </div>
      <div class="mvw-panel" style="--mvw-panel-color:#ef4444;">
        <div class="mvw-panel-head">
          <div class="mvw-panel-title-wrap">
            <span class="mvw-panel-bar"></span>
            <span class="mvw-panel-title">มูลค่าขาดทุนรายเดือน</span>
          </div>
          <span class="mvw-panel-meta">เฉลี่ย ${fmt(avgPerMonth)} THB/เดือน</span>
        </div>
        <div class="mvw-panel-body">
          <div class="mvw-spark-wrap">${sparkline(monthLoss, monthLabels, '#ef4444', 100)}</div>
          <div class="mvw-spark-foot">
            ${monthLabels.map((l, i) => `<div class="mvw-spark-month">
              <div class="mvw-spark-month-label">${l}</div>
              <div class="mvw-spark-month-value" style="color:#ef4444;">${fmt(monthLoss[i])}</div>
              ${i > 0 ? renderMoMDelta(monthLoss[i], monthLoss[i - 1], false, false) : '<div style="font-size:9px;color:var(--muted);margin-top:2px">—</div>'}
            </div>`).join('')}
          </div>
          <div class="mvw-spark-total">
            <span>รวม</span>
            <b style="color:#ef4444;">${fmt(totalLossAll)} THB</b>
          </div>
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
    return '<div class="mvw-panel"><div class="mvw-panel-body" style="text-align:center;color:rgba(148,163,184,0.85);padding:32px;">ไม่มีข้อมูลประเภทรถ</div></div>';
  }

  const maxT = Math.max(1, ...vt.map(v => Number(v.trips) || 0));
  const totalTrips = vt.reduce((a, v) => a + (Number(v.trips) || 0), 0);
  const totalMargin = vt.reduce((a, v) => a + (Number(v.margin) || 0), 0);
  const totalRecv = vt.reduce((a, v) => a + (Number(v.recv) || 0), 0);
  const bestMargin = vt.reduce((b, v) => (Number(v.margin) > Number(b?.margin || -Infinity) ? v : b), vt[0]);
  const bestPct = vt.reduce((b, v) => (Number(v.pct) > Number(b?.pct || -Infinity) ? v : b), vt[0]);
  const dominant = vt[0];
  const overallPct = totalRecv > 0 ? (totalMargin / totalRecv) * 100 : 0;
  const profitTypes = vt.filter(v => (v.margin || 0) > 0).length;
  const lossTypes = vt.filter(v => (v.margin || 0) < 0).length;
  const totalMarginColor = totalMargin >= 0 ? '#22c55e' : '#ef4444';

  return `
    <!-- Hero -->
    <div class="mvw-hero" style="--mvw-color:#06b6d4;--mvw-rgb:6,182,212;">
      <div>
        <div class="mvw-hero-title">ประสิทธิภาพประเภทรถ</div>
        <div class="mvw-hero-desc">วิเคราะห์ประสิทธิภาพแยกตามประเภทรถ ครอบคลุมจำนวนเที่ยว รายได้ ส่วนต่างกำไร และกำไรเปอร์เซ็นต์ เพื่อวางแผนการลงทุนกองรถและเลือกประเภทรถให้เหมาะสมกับเส้นทาง</div>
      </div>
      <div class="mvw-hero-meta">
        <span class="mvw-hero-meta-label">ประเภทรถทั้งหมด</span>
        <span class="mvw-hero-meta-value">${fmtB(vt.length)}</span>
      </div>
    </div>

    <!-- KPI Row -->
    <div class="mvw-kpi-row">
      <div class="mvw-kpi" style="--mvw-kpi-color:#06b6d4;">
        <span class="mvw-kpi-label">ประเภทรถ</span>
        <span class="mvw-kpi-value">${fmtB(vt.length)}</span>
        <span class="mvw-kpi-sub">ประเภท · ${fmtB(totalTrips)} เที่ยวรวม</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#22c55e;">
        <span class="mvw-kpi-label">รายได้รวม</span>
        <span class="mvw-kpi-value">${fmt(totalRecv)}</span>
        <span class="mvw-kpi-sub">THB · จากทุกประเภท</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:${totalMarginColor};">
        <span class="mvw-kpi-label">ส่วนต่างรวม</span>
        <span class="mvw-kpi-value">${fmt(totalMargin)}</span>
        <span class="mvw-kpi-sub">THB · กำไรสุทธิ ${fmtP(overallPct)}</span>
      </div>
      <div class="mvw-kpi" style="--mvw-kpi-color:#8b5cf6;">
        <span class="mvw-kpi-label">ทำกำไรสูงสุด</span>
        <span class="mvw-kpi-value" style="font-size:clamp(14px,1.3vw,17px);" title="${esc(bestMargin?.type || '-')}">${esc(bestMargin?.type || '-')}</span>
        <span class="mvw-kpi-sub">${fmt(bestMargin?.margin || 0)} THB</span>
      </div>
    </div>

    <!-- Insights / Distribution Stats -->
    <div class="mvw-panel" style="--mvw-panel-color:#06b6d4;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">ภาพรวมโครงสร้างประสิทธิภาพประเภทรถ</span>
        </div>
        <span class="mvw-panel-meta">${fmtB(vt.length)} ประเภท</span>
      </div>
      <div class="mvw-panel-body">
        <div class="mvw-stat-grid">
          <div class="mvw-stat" style="--mvw-stat-color:#06b6d4;">
            <span class="mvw-stat-label">ประเภทรถสัดส่วนสูงสุด</span>
            <span class="mvw-stat-value" title="${esc(dominant?.type || '-')}">${esc(dominant?.type || '-')}</span>
            <span class="mvw-stat-sub">${(Number(dominant?.share) || 0).toFixed(2)}% · ${fmtB(dominant?.trips || 0)} เที่ยว</span>
          </div>
          <div class="mvw-stat" style="--mvw-stat-color:#22c55e;">
            <span class="mvw-stat-label">กำไร % สูงสุด</span>
            <span class="mvw-stat-value" title="${esc(bestPct?.type || '-')}">${esc(bestPct?.type || '-')}</span>
            <span class="mvw-stat-sub">${fmtP(bestPct?.pct || 0)} ต่อรายได้</span>
          </div>
          <div class="mvw-stat" style="--mvw-stat-color:#8b5cf6;">
            <span class="mvw-stat-label">ประเภทกำไร / ขาดทุน</span>
            <span class="mvw-stat-value">${fmtB(profitTypes)} / ${fmtB(lossTypes)}</span>
            <span class="mvw-stat-sub">${vt.length} ประเภททั้งหมด</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Vehicle list -->
    <div class="mvw-panel" style="--mvw-panel-color:#06b6d4;">
      <div class="mvw-panel-head">
        <div class="mvw-panel-title-wrap">
          <span class="mvw-panel-bar"></span>
          <span class="mvw-panel-title">รายละเอียดประสิทธิภาพแต่ละประเภทรถ</span>
        </div>
        <span class="mvw-panel-meta">เรียงตามจำนวนเที่ยว</span>
      </div>
      <div class="mvw-panel-body" style="padding:0;">
        <div class="mvw-rt cols-vehicle">
          <div class="mvw-rt-head">
            <span class="num">ลำดับ</span>
            <span>ประเภทรถ</span>
            <span class="right">เที่ยว · สัดส่วน</span>
            <span class="right">รายได้</span>
            <span class="right">ส่วนต่าง</span>
            <span class="right">กำไร %</span>
          </div>
          ${vt.map((v, i) => {
    const col = COLORS[i % 10];
    const tier = i < 3 ? `tier-${i + 1}` : '';
    const sharePct = Number(v.share) || 0;
    const marginCls = (v.margin || 0) >= 0 ? 'pos' : 'neg';
    const pctCls = (v.pct || 0) >= 0 ? 'pos' : 'neg';
    return `<div class="mvw-rt-row ${tier}" style="--mvw-rt-color:${col};">
              <div class="mvw-rt-medal">${String(i + 1).padStart(2, '0')}</div>
              <div class="mvw-rt-info">
                <span class="mvw-rt-name" title="${esc(v.type)}">${esc(v.type)}</span>
                <div class="mvw-rt-meta">
                  <span>เฉลี่ย/เที่ยว ${fmt(v.avgMargin || 0)} THB</span>
                </div>
              </div>
              <div class="mvw-rt-num accent">${fmtB(v.trips || 0)}<small>${sharePct.toFixed(2)}%</small></div>
              <div class="mvw-rt-num">${fmt(v.recv || 0)}</div>
              <div class="mvw-rt-num ${marginCls}">${fmt(v.margin || 0)}</div>
              <span class="mvw-rt-pill ${pctCls}">${fmtP(v.pct || 0)}</span>
            </div>`;
  }).join('')}
        </div>
      </div>
    </div>

    ${buildAuditTableSection('audit-vehicle-performance', 'รายละเอียดประสิทธิภาพแยกตามประเภทรถ', '&#9881;', '#06b6d4', 'กรองประเภทรถตามสถานะผลตอบแทนและตรวจสอบโครงสร้างรายได้ต่อเที่ยว')}
  `;
}
/* Compact Card Builders for Master Dashboard Grid */
function buildTrendCard(d) {
  const s = d.summary;
  const monthsToShow = getActiveMonths(d, 'routeTrend');
  const months = monthsToShow.length > 0 ? monthsToShow : MONTHS;
  const topRoutes = d.routeTrend.slice().sort((a, b) => {
    const ta = months.reduce((sum, m) => sum + (a.months[m]?.trips || 0), 0);
    const tb = months.reduce((sum, m) => sum + (b.months[m]?.trips || 0), 0);
    return tb - ta;
  }).slice(0, 5);
  const maxTrips = Math.max(...topRoutes.map(r => months.reduce((a, m) => a + (r.months[m]?.trips || 0), 0)), 1);
  const marginColor = s.totalMargin >= 0 ? '#22c55e' : '#ef4444';
  const pctColor = s.avgMarginPct >= 0 ? '#8b5cf6' : '#ef4444';
  return `
    <div class="mcr-kpi-row cols-2">
      <div class="mcr-kpi" style="--mcr-accent:#3b82f6;">
        <span class="mcr-kpi-label">จำนวนเที่ยวทั้งหมด</span>
        <span class="mcr-kpi-value">${fmtB(s.totalTrips)}</span>
        <span class="mcr-kpi-sub">เที่ยว</span>
      </div>
      <div class="mcr-kpi" style="--mcr-accent:#22c55e;">
        <span class="mcr-kpi-label">ราคารับรวม</span>
        <span class="mcr-kpi-value">${fmt(s.totalRevenue)}</span>
        <span class="mcr-kpi-sub">THB</span>
      </div>
      <div class="mcr-kpi" style="--mcr-accent:${marginColor};">
        <span class="mcr-kpi-label">ส่วนต่างรวม</span>
        <span class="mcr-kpi-value">${fmt(s.totalMargin)}</span>
        <span class="mcr-kpi-sub">THB</span>
      </div>
      <div class="mcr-kpi" style="--mcr-accent:${pctColor};">
        <span class="mcr-kpi-label">กำไร % เฉลี่ย</span>
        <span class="mcr-kpi-value">${fmtP(s.avgMarginPct)}</span>
        <span class="mcr-kpi-sub">เฉลี่ยทุกเที่ยว</span>
      </div>
    </div>
    <div class="mcr-subhead" style="--mcr-accent:#3b82f6;">
      <span class="mcr-subhead-bar"></span>
      <span class="mcr-subhead-text">Top 5 เส้นทาง</span>
      <span class="mcr-subhead-meta">เรียงตามจำนวนเที่ยว</span>
    </div>
    ${topRoutes.map((r, i) => {
    const tot = months.reduce((a, m) => a + (r.months[m]?.trips || 0), 0);
    const w = (tot / maxTrips * 100).toFixed(1);
    const col = COLORS[i % 10];
    const displayRoute = routeDisplay(r);
    const routeShort = displayRoute.length > 22 ? displayRoute.slice(0, 22) + '…' : displayRoute;
    return `<div class="mcr-rank-row" style="--mcr-rank-color:${col};">
        <div class="mcr-rank-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="mcr-rank-body">
          <div class="mcr-rank-top">
            <span class="mcr-rank-name" title="${esc(r.customer)} — ${esc(displayRoute)}">${esc(r.customer)} · ${esc(routeShort)}</span>
            <span class="mcr-rank-value">${fmtB(tot)} <span class="mcr-rank-meta">เที่ยว</span></span>
          </div>
          <div class="mcr-rank-bar"><div class="mcr-rank-fill" style="width:${w}%;"></div></div>
        </div>
      </div>`;
  }).join('')}
  `;
}

function buildRankingCard(d) {
  const rk = d.routeRanking;
  const top3 = rk.top.slice(0, 3);
  const bot3 = rk.bottom.slice(0, 3);
  const maxTop = Math.max(...top3.map(r => Math.abs(r.margin)), 1);
  const maxBot = Math.max(...bot3.map(r => Math.abs(r.margin)), 1);
  const topRoute = routeDisplay(rk.top[0]);
  const botRoute = routeDisplay(rk.bottom[0]);
  const topRouteShort = topRoute.length > 26 ? topRoute.slice(0, 26) + '…' : topRoute;
  const botRouteShort = botRoute.length > 26 ? botRoute.slice(0, 26) + '…' : botRoute;
  return `
    <div class="mcr-kpi-row cols-2">
      <div class="mcr-kpi" style="--mcr-accent:#22c55e;">
        <span class="mcr-kpi-label">เส้นทางทำกำไรสูงสุด</span>
        <span class="mcr-kpi-value">${fmt(rk.top[0]?.margin || 0)}</span>
        <span class="mcr-kpi-sub" title="${esc(topRoute)}">THB · ${esc(topRouteShort)}</span>
      </div>
      <div class="mcr-kpi" style="--mcr-accent:#ef4444;">
        <span class="mcr-kpi-label">เส้นทางขาดทุนสูงสุด</span>
        <span class="mcr-kpi-value">${fmt(rk.bottom[0]?.margin || 0)}</span>
        <span class="mcr-kpi-sub" title="${esc(botRoute)}">THB · ${esc(botRouteShort)}</span>
      </div>
    </div>
    <div class="mcr-rank-cols">
      <div>
        <div class="mcr-rank-col-head">
          <span class="dot pos"></span>
          <span class="text pos">Top 3 กำไร</span>
        </div>
        ${top3.map((r, i) => {
    const w = (Math.abs(r.margin) / maxTop * 100).toFixed(1);
    const displayRoute = routeDisplay(r);
    const routeShort = displayRoute.length > 18 ? displayRoute.slice(0, 18) + '…' : displayRoute;
    return `<div class="mcr-rank-row" style="--mcr-rank-color:#22c55e;">
            <div class="mcr-rank-num">${String(i + 1).padStart(2, '0')}</div>
            <div class="mcr-rank-body">
              <div class="mcr-rank-top">
                <span class="mcr-rank-name" title="${esc(displayRoute)}">${esc(routeShort)}</span>
                <span class="mcr-rank-value" style="color:#4ade80;">${fmt(r.margin)}</span>
              </div>
              <div class="mcr-rank-bar"><div class="mcr-rank-fill" style="width:${w}%;background:linear-gradient(90deg,rgba(34,197,94,.5),#22c55e);"></div></div>
            </div>
          </div>`;
  }).join('')}
      </div>
      <div>
        <div class="mcr-rank-col-head">
          <span class="dot neg"></span>
          <span class="text neg">Top 3 ขาดทุน</span>
        </div>
        ${bot3.map((r, i) => {
    const w = (Math.abs(r.margin) / maxBot * 100).toFixed(1);
    const displayRoute = routeDisplay(r);
    const routeShort = displayRoute.length > 18 ? displayRoute.slice(0, 18) + '…' : displayRoute;
    return `<div class="mcr-rank-row" style="--mcr-rank-color:#ef4444;">
            <div class="mcr-rank-num">${String(i + 1).padStart(2, '0')}</div>
            <div class="mcr-rank-body">
              <div class="mcr-rank-top">
                <span class="mcr-rank-name" title="${esc(displayRoute)}">${esc(routeShort)}</span>
                <span class="mcr-rank-value" style="color:#f87171;">${fmt(r.margin)}</span>
              </div>
              <div class="mcr-rank-bar"><div class="mcr-rank-fill" style="width:${w}%;background:linear-gradient(90deg,rgba(239,68,68,.5),#ef4444);"></div></div>
            </div>
          </div>`;
  }).join('')}
      </div>
    </div>
  `;
}

function buildCustomerCard(d) {
  const cp = d.customerProfit;
  const top5 = cp.slice(0, 5);
  const maxR = Math.max(...cp.map(c => c.recv), 1);
  const maxM = Math.max(...cp.filter(c => c.margin > 0).map(c => c.margin), 1);
  const totalRecv = top5.reduce((a, c) => a + c.recv, 0);
  const totalMargin = top5.reduce((a, c) => a + c.margin, 0);
  const marginColor = totalMargin >= 0 ? '#22c55e' : '#ef4444';
  return `
    <div class="mcr-kpi-row cols-2">
      <div class="mcr-kpi" style="--mcr-accent:#3b82f6;">
        <span class="mcr-kpi-label">รายได้รวม Top 5</span>
        <span class="mcr-kpi-value">${fmt(totalRecv)}</span>
        <span class="mcr-kpi-sub">THB</span>
      </div>
      <div class="mcr-kpi" style="--mcr-accent:${marginColor};">
        <span class="mcr-kpi-label">ส่วนต่างรวม Top 5</span>
        <span class="mcr-kpi-value">${fmt(totalMargin)}</span>
        <span class="mcr-kpi-sub">THB</span>
      </div>
    </div>
    <div class="mcr-subhead" style="--mcr-accent:#22c55e;">
      <span class="mcr-subhead-bar"></span>
      <span class="mcr-subhead-text">รายได้และส่วนต่างกำไร Top 5 ลูกค้า</span>
    </div>
    ${top5.map((c, i) => {
    const w = (c.recv / maxR * 100).toFixed(1);
    const wm = c.margin > 0 ? (c.margin / maxM * 100).toFixed(1) : 1;
    const col = COLORS[i % 10];
    const mgColor = c.margin >= 0 ? '#4ade80' : '#f87171';
    const mgFill = c.margin >= 0 ? 'linear-gradient(90deg,rgba(34,197,94,.5),#22c55e)' : 'linear-gradient(90deg,rgba(239,68,68,.5),#ef4444)';
    return `<div class="mcr-cust" style="--mcr-cust-color:${col};">
        <div class="mcr-cust-head">
          <span class="mcr-cust-name">
            <span class="mcr-cust-dot"></span>
            <span class="mcr-cust-label-name" title="${esc(c.name)}">${esc(c.name)}</span>
          </span>
          <span class="mcr-cust-trips">${fmtB(c.trips)} เที่ยว</span>
        </div>
        <div class="mcr-cust-bar">
          <span class="mcr-cust-tag">รายได้</span>
          <div class="mcr-cust-track"><div class="mcr-cust-fill" style="width:${w}%;background:linear-gradient(90deg,${col}80,${col});"></div></div>
          <span class="mcr-cust-amount">${fmt(c.recv)}</span>
        </div>
        <div class="mcr-cust-bar">
          <span class="mcr-cust-tag">ส่วนต่าง</span>
          <div class="mcr-cust-track"><div class="mcr-cust-fill" style="width:${wm}%;background:${mgFill};"></div></div>
          <span class="mcr-cust-amount" style="color:${mgColor};">${fmt(c.margin)}</span>
        </div>
      </div>`;
  }).join('')}
  `;
}

function buildOwnOutCard(d) {
  const { company: co, outsource: ou, companyTripPct, outsourceTripPct } = getSafeOwnOut(d);
  const coP = companyTripPct.toFixed(1);
  const ouP = outsourceTripPct.toFixed(1);
  const totalTrips = (Number(co.trips) || 0) + (Number(ou.trips) || 0);
  const totalRecv = (Number(co.recv) || 0) + (Number(ou.recv) || 0);
  const totalMargin = (Number(co.margin) || 0) + (Number(ou.margin) || 0);
  const coMarginCls = co.margin >= 0 ? 'pos' : 'neg';
  const ouMarginCls = ou.margin >= 0 ? 'pos' : 'neg';
  const totalMarginCls = totalMargin >= 0 ? 'pos' : 'neg';

  return `
    <section class="mcr-fleet">
      <div class="mcr-fleet-overview">
        <div class="mcr-fleet-head">
          <span class="mcr-fleet-title">สัดส่วนการใช้รถ</span>
          <span class="mcr-fleet-total">รวม ${fmtB(totalTrips)} เที่ยว</span>
        </div>
        <div class="mcr-fleet-bar">
          <div class="mcr-fleet-seg co" style="width:${coP}%"></div>
          <div class="mcr-fleet-seg ou" style="width:${ouP}%"></div>
        </div>
        <div class="mcr-fleet-legend">
          <span><i class="co"></i>รถบริษัท <b>${coP}%</b></span>
          <span><i class="ou"></i>รถจ้างภายนอก <b>${ouP}%</b></span>
        </div>
      </div>

      <div class="mcr-fleet-grid">
        <div class="mcr-fleet-card co">
          <div class="mcr-fleet-card-head">
            <span class="mcr-fleet-card-name">รถบริษัท</span>
            <span class="mcr-fleet-card-share">${coP}%</span>
          </div>
          <div class="mcr-fleet-card-main">${fmtB(co.trips)}<small>เที่ยว</small></div>
          <div class="mcr-fleet-card-stats">
            <div class="mcr-fleet-stat"><span>รายได้</span><b>${fmt(co.recv)} THB</b></div>
            <div class="mcr-fleet-stat"><span>ส่วนต่าง</span><b class="${coMarginCls}">${fmt(co.margin)} THB</b></div>
          </div>
        </div>

        <div class="mcr-fleet-card ou">
          <div class="mcr-fleet-card-head">
            <span class="mcr-fleet-card-name">รถจ้างภายนอก</span>
            <span class="mcr-fleet-card-share">${ouP}%</span>
          </div>
          <div class="mcr-fleet-card-main">${fmtB(ou.trips)}<small>เที่ยว</small></div>
          <div class="mcr-fleet-card-stats">
            <div class="mcr-fleet-stat"><span>รายได้</span><b>${fmt(ou.recv)} THB</b></div>
            <div class="mcr-fleet-stat"><span>ส่วนต่าง</span><b class="${ouMarginCls}">${fmt(ou.margin)} THB</b></div>
          </div>
        </div>
      </div>

      <div class="mcr-fleet-foot">
        <div class="mcr-fleet-foot-kpi"><span>รายได้รวม</span><b>${fmt(totalRecv)} THB</b></div>
        <div class="mcr-fleet-foot-kpi"><span>ส่วนต่างรวม</span><b class="${totalMarginCls}">${fmt(totalMargin)} THB</b></div>
      </div>
    </section>
  `;
}

function buildLossCard(d) {
  const lt = d.lossTrip;
  if (!lt) return '<div style="text-align:center;color:var(--muted);font-size:11px;padding:20px;">ไม่มีข้อมูลขาดทุน</div>';
  const allValidMonths = MONTHS.filter(m => lt.byMonth && lt.byMonth[m]);
  // Cap compact card preview to last 6 months — full set is in modal "View All"
  const validMonths = allValidMonths.slice(-6);
  const moreCount = allValidMonths.length - validMonths.length;
  const maxL = validMonths.length > 0 ? Math.max(...validMonths.map(m => Math.abs(lt.byMonth[m].loss || 0)), 1) : 1;
  return `
    <div class="mcr-kpi-row cols-2">
      <div class="mcr-kpi" style="--mcr-accent:#ef4444;">
        <span class="mcr-kpi-label">เที่ยวขาดทุน</span>
        <span class="mcr-kpi-value">${fmtB(lt.total)}</span>
        <span class="mcr-kpi-sub">เที่ยว</span>
      </div>
      <div class="mcr-kpi" style="--mcr-accent:#ef4444;">
        <span class="mcr-kpi-label">มูลค่าขาดทุนรวม</span>
        <span class="mcr-kpi-value">${fmt(lt.totalLoss)}</span>
        <span class="mcr-kpi-sub">THB</span>
      </div>
    </div>
    <div class="mcr-subhead" style="--mcr-accent:#ef4444;">
      <span class="mcr-subhead-bar"></span>
      <span class="mcr-subhead-text">ขาดทุนรายเดือน</span>
      ${moreCount > 0 ? `<span class="mcr-subhead-meta">${validMonths.length} เดือนล่าสุด · ดูทั้งหมดที่ View All</span>` : ''}
    </div>
    ${validMonths.map(m => {
    const bm = lt.byMonth[m];
    const w = Math.max(4, (Math.abs(bm.loss || 0) / maxL * 100)).toFixed(1);
    return `<div class="mcr-loss-month">
        <span class="mcr-loss-month-label">${MTH[m] || m}</span>
        <div class="mcr-loss-month-track"><div class="mcr-loss-month-fill" style="width:${w}%;"></div></div>
        <div class="mcr-loss-month-stat">${fmt(bm.loss)} THB<small>${fmtB(bm.count)} เที่ยว</small></div>
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
    <div class="mcr-veh-summary">
      <div class="mcr-veh-summary-box" style="--mcr-veh:#06b6d4;">
        <span class="mcr-veh-summary-label">ประเภทรถนำสัดส่วน</span>
        <span class="mcr-veh-summary-value" title="${esc(lead?.type || '-')}">${esc(lead?.type || '-')}</span>
        <span class="mcr-veh-summary-sub">${(Number(lead?.share) || 0).toFixed(2)}% ของเที่ยวทั้งหมด</span>
      </div>
      <div class="mcr-veh-summary-box" style="--mcr-veh:#22c55e;">
        <span class="mcr-veh-summary-label">ทำกำไรสูงสุด</span>
        <span class="mcr-veh-summary-value" title="${esc(bestMargin?.type || '-')}">${esc(bestMargin?.type || '-')}</span>
        <span class="mcr-veh-summary-sub">${fmt(bestMargin?.margin || 0)} THB</span>
      </div>
    </div>

    <div class="mcr-veh-list">
      ${vt.map((v, i) => {
    const col = COLORS[i % 10];
    const barW = Math.max(4, (Number(v.trips) || 0) / maxT * 100).toFixed(1);
    const marginCls = (v.margin || 0) >= 0 ? 'pos' : 'neg';
    const pctCls = (v.pct || 0) >= 0 ? 'pos' : 'neg';
    return `
          <article class="mcr-veh-row" style="--mcr-veh:${col};">
            <div class="mcr-veh-rank">${String(i + 1).padStart(2, '0')}</div>
            <div class="mcr-veh-main">
              <div class="mcr-veh-top">
                <span class="mcr-veh-type" title="${esc(v.type)}">${esc(v.type)}</span>
                <span class="mcr-veh-share">${(Number(v.share) || 0).toFixed(2)}%</span>
              </div>
              <div class="mcr-veh-track"><div class="mcr-veh-fill" style="width:${barW}%;"></div></div>
              <div class="mcr-veh-stats">
                <span class="mcr-veh-stat"><span>เที่ยว</span><b>${fmtB(v.trips)}</b></span>
                <span class="mcr-veh-stat"><span>ส่วนต่าง</span><b class="${marginCls}">${fmt(v.margin)}</b></span>
                <span class="mcr-veh-stat"><span>กำไร %</span><b class="${pctCls}">${fmtP(v.pct)}</b></span>
              </div>
            </div>
          </article>
        `;
  }).join('')}
    </div>`;
}
function getMasterModalTableConfigs(key, d, opts = {}) {
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
        route: routeDisplay(r),
        totalTrips,
        totalMargin
      };
      monthsToShow.forEach(month => { row[`m_${month}`] = r.months?.[month]?.trips || 0; });
      return row;
    }).filter(row => row.totalTrips > 0);
    const routeCols = [
      { key: 'customer', label: 'ลูกค้า' },
      { key: 'vtype', label: 'ประเภทรถ' },
      { key: 'route', label: 'ชื่อเส้นทาง' },
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
      route: routeDisplay(row),
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
          { key: 'route', label: 'ชื่อเส้นทาง' },
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
          { key: 'route', label: 'ชื่อเส้นทาง' },
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
      route: routeDisplay(row),
      trips: Number(row.trips) || 0,
      margin: Number(row.margin) || 0,
      status: Number(row.margin) > 0 ? 'กำไร' : Number(row.margin) < 0 ? 'ขาดทุน' : 'คงที่'
    }));
    const cols = [
      { key: 'route', label: 'ชื่อเส้นทาง' },
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
    if (Array.isArray(opts.lossTrips)) {
      return buildLossAuditTableConfigs(buildLossAuditTableRowsFromTrips(opts.lossTrips), {
        trips: opts.lossTrips,
        scopeKey: opts.scopeKey || ''
      });
    }
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
    const routeRows = (Array.isArray(lt.byRoute) ? lt.byRoute : Object.entries(lt.byRoute || {}).map(([name, info]) => ({ name, route: info.route || name, routeDesc: info.routeDesc || info.desc, count: info.count, loss: info.loss })))
      .map(row => ({
        name: row.name || '-',
        route: row.route || row.name || '-',
        routeDesc: row.routeDesc || '-',
        displayName: routeDisplay(row),
        count: Number(row.count) || 0,
        loss: Number(row.loss) || 0,
        avgLoss: Number(row.count) > 0 ? Math.abs(Number(row.loss) || 0) / Number(row.count) : null
      }));
    return buildLossAuditTableConfigs({ monthlyRows, custRows, routeRows });
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
    modal.style.cssText = 'position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);';
    modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#1e2235;border:1px solid rgba(58,63,85,0.9);border-radius:14px;width:95%;max-width:1400px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 32px 96px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04);animation:modalIn 0.3s ease;">
      <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid rgba(58,63,85,0.8);flex-shrink:0;background:linear-gradient(180deg,rgba(44,49,69,0.6),transparent);">
        <div style="width:32px;height:32px;border-radius:8px;background:${color}20;border:1px solid ${color}40;display:flex;align-items:center;justify-content:center;color:${color};font-size:14px;font-weight:800;">${String.fromCharCode(0x25CF)}</div>
        <div style="flex:1;font-size:15px;font-weight:700;color:#e8edf5;">${esc(title)}</div>
        <button onclick="document.getElementById('masterModal').style.display='none'" style="background:rgba(255,255,255,0.04);border:1px solid rgba(58,63,85,0.8);border-radius:8px;color:var(--muted);width:32px;height:32px;cursor:pointer;font-size:16px;line-height:1;transition:all .2s;" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)';this.style.background='rgba(239,68,68,0.08)'" onmouseout="this.style.borderColor='rgba(58,63,85,0.8)';this.style.color='var(--muted)';this.style.background='rgba(255,255,255,0.04)'">&times;</button>
      </div>
      <div style="flex:1;overflow:auto;padding:20px;background:rgba(15,17,23,0.35);">${contentHtml}</div>
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

  window._masterModalData = {};
  window._masterModalBuilders = {};
  sections.forEach(sec => {
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
  const allDatesSet = new Set(allDates);
  const rowsByDate = new Map();
  validFd.forEach(r => {
    const list = rowsByDate.get(r.date);
    if (list) list.push(r);
    else rowsByDate.set(r.date, [r]);
  });
  const routeIdentityCache = new WeakMap();
  const dcCachedRouteIdentityKey = row => {
    if (!row || typeof row !== 'object') return routeIdentityKey(row);
    if (!routeIdentityCache.has(row)) routeIdentityCache.set(row, routeIdentityKey(row));
    return routeIdentityCache.get(row);
  };
  const stableFilterKey = values => Array.isArray(values) && values.length
    ? values.map(v => String(v)).sort().join('\u001f')
    : '';
  const rowsForDateRange = (dateStart, dateEnd) => {
    if (!dateStart || !dateEnd) return [];
    const rows = [];
    for (const date of allDates) {
      if (date < dateStart) continue;
      if (date > dateEnd) break;
      const list = rowsByDate.get(date);
      if (list) rows.push(...list);
    }
    return rows;
  };
  const rowsForDateWindows = windows => {
    const rows = [];
    const seen = new Set();
    (windows || []).forEach(([dateStart, dateEnd]) => {
      rowsForDateRange(dateStart, dateEnd).forEach(r => {
        if (seen.has(r)) return;
        seen.add(r);
        rows.push(r);
      });
    });
    return rows;
  };
  const rangeStatsMemo = new Map();
  if (allDates.length === 0) {
    return `
      <div class="dc-card dc-empty">
        <div class="dc-empty-msg">ไม่พบข้อมูลวันที่ที่ใช้งานได้สำหรับการวิเคราะห์</div>
      </div>
    `;
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  const parseIsoDateLocal = iso => {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(v => !Number.isFinite(v))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };
  const formatIsoDateLocal = dateObj => {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const addDaysToIso = (iso, days) => {
    const base = parseIsoDateLocal(iso);
    if (!base) return '';
    const next = new Date(base.getTime());
    next.setDate(next.getDate() + days);
    return formatIsoDateLocal(next);
  };
  const getTodayIsoBangkok = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const getDefaultAnalysisDate = () => {
    const yesterday = addDaysToIso(getTodayIsoBangkok(), -1);
    return [...allDates].reverse().find(date => date <= yesterday) || allDates[allDates.length - 1] || '';
  };
  const defaultAnalysisDate = getDefaultAnalysisDate();
  const getRollingSevenPreset = anchorIso => {
    const latest = anchorIso || defaultAnalysisDate || allDates[allDates.length - 1] || '';
    const aEnd = latest;
    const aStart = addDaysToIso(aEnd, -6);
    const bEnd = addDaysToIso(aStart, -1);
    const bStart = addDaysToIso(bEnd, -6);
    return { aStart, aEnd, bStart, bEnd };
  };
  const custOrder = {
    'FLASH': 0,
    'BEST Express': 1, 'BEST EXPRESS': 1, 'BEST': 1,
    'J&T': 2,
    'KEX': 3,
    'SGT': 4,
    'SPX-FSOC': 5, 'SPX': 5
  };

  let _isSingleMode = true;  // default: single/normal view on startup
  let _viewMode = 'normal';
  let _comparePresetMode = 'manual';
  // _stRef: reference-day stats for single mode cross-day comparison.
  // Computed automatically by dcRunCompare when _isSingleMode is true.
  let _stRef = null;
  let _labelRef = '';
  const _compareStatusFilters = {
    normal: new Set(),
    anomaly: new Set(),
    unmatched_a: new Set(),
    unmatched_b: new Set()
  };
  const _compareStatusRaf = Object.create(null);
  window.dcSetMode = function (mode, skipAutoRun) {
    _isSingleMode = mode === 'single';
    const sSingle = document.getElementById('dc_mode_single').style;
    const sCompare = document.getElementById('dc_mode_compare').style;
    sSingle.background = _isSingleMode ? 'linear-gradient(135deg,#1e3a8a,#1e2554)' : 'transparent';
    sSingle.color = _isSingleMode ? '#dbeafe' : 'var(--muted)';
    sSingle.boxShadow = _isSingleMode ? '0 2px 8px rgba(0,0,0,.4)' : 'none';
    sSingle.border = _isSingleMode ? '1px solid rgba(59,130,246,.2)' : '1px solid transparent';
    sSingle.fontSize = '12px';
    sSingle.fontWeight = '700';
    sSingle.fontFamily = 'inherit';

    sCompare.background = !_isSingleMode ? 'linear-gradient(135deg,#1e3a8a,#1e2554)' : 'transparent';
    sCompare.color = !_isSingleMode ? '#dbeafe' : 'var(--muted)';
    sCompare.boxShadow = !_isSingleMode ? '0 2px 8px rgba(0,0,0,.4)' : 'none';
    sCompare.border = !_isSingleMode ? '1px solid rgba(59,130,246,.2)' : '1px solid transparent';
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
    if (!skipAutoRun && typeof window.dcRunCompare === 'function') {
      window.dcRunCompare();
    }
  };

  // Cascading filter options
  const allCustomers = [...new Set(validFd.map(r => r.customer || '-'))].sort();

  // ── rangeStats: รวมข้อมูลจากหลายวัน ───────────────────────────────
  function rangeStats(dateStart, dateEnd, custF, routeF, vtypeF) {
    if (!dateStart || !dateEnd) return null;
    const memoKey = [
      dateStart,
      dateEnd,
      stableFilterKey(custF),
      stableFilterKey(routeF),
      stableFilterKey(vtypeF)
    ].join('\u0001');
    if (rangeStatsMemo.has(memoKey)) return rangeStatsMemo.get(memoKey);
    const rows = rowsForDateRange(dateStart, dateEnd).filter(r => {
      if (Array.isArray(custF) && custF.length > 0 && !custF.includes(r.customer || '-')) return false;
      if (Array.isArray(routeF) && routeF.length > 0 && !routeF.includes(dcCachedRouteIdentityKey(r))) return false;
      if (Array.isArray(vtypeF) && vtypeF.length > 0 && !vtypeF.includes(r.vtype || '-')) return false;
      return true;
    });
    if (!rows.length) {
      rangeStatsMemo.set(memoKey, null);
      return null;
    }
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
      const identity = getRouteIdentity(r);
      const k = identity.key;
      if (!routeMap[k]) routeMap[k] = { customer: r.customer || '-', route: identity.displayRoute || r.route || '-', routeKey: k, routeCore: identity.routeCore, routeVehicle: identity.routeVehicle, routeDesc: r.routeDesc || '-', vtype: r.vtype || '-', recv: 0, pay: 0, oil: 0, margin: 0, trips: 0 };
      else if (!cleanRouteDisplayText(routeMap[k].routeDesc) && cleanRouteDisplayText(r.routeDesc)) routeMap[k].routeDesc = r.routeDesc;
      routeMap[k].recv += r.recv || 0; routeMap[k].pay += r.pay || 0; routeMap[k].oil += r.oil || 0; routeMap[k].margin += r.margin || 0; routeMap[k].trips++;
    });
    const routes = Object.values(routeMap)
      .map(v => ({ ...v, pct: v.recv ? v.margin / v.recv * 100 : 0 }))
      .sort((a, b) => b.margin - a.margin);
    const result = { dateStart, dateEnd, label, recv, pay, oil, margin, trips, pct, oilRatio, routes, rows };
    rangeStatsMemo.set(memoKey, result);
    return result;
  }

  // ── findRefDate: หาวันอ้างอิงสำหรับ single mode ──────────────────────────
  // คืนวันที่ใน allDates ที่อยู่ก่อน targetDate และใกล้ที่สุด
  // ย้อนหลังสูงสุด maxLookback วัน (นับตามปฏิทิน ไม่ใช่ index)
  function findRefDate(targetDate, maxLookback) {
    if (!targetDate) return null;
    const limit = maxLookback || 3;
    // สร้าง Date object จาก targetDate แล้วลบทีละวัน
    const [y, m, d] = targetDate.split('-').map(Number);
    for (let i = 1; i <= limit; i++) {
      const dt = new Date(y, m - 1, d - i);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      if (allDatesSet.has(iso)) return iso;
    }
    return null;
  }

  // Oil price helper
  let oilPriceCacheSource = null;
  let oilPriceCachePrices = null;
  let oilPriceCacheLength = 0;
  let oilPriceSortedCache = null;
  const oilPriceByDateCache = new Map();
  function getOilPriceByDate(dateStr) {
    const op = (typeof OIL_PRICE_DATA !== 'undefined') ? OIL_PRICE_DATA : null;
    if (!op || !op.prices || !dateStr) return null;
    if (
      oilPriceCacheSource !== op ||
      oilPriceCachePrices !== op.prices ||
      oilPriceCacheLength !== op.prices.length
    ) {
      oilPriceCacheSource = op;
      oilPriceCachePrices = op.prices;
      oilPriceCacheLength = op.prices.length;
      oilPriceSortedCache = [...op.prices].sort((a, b) => String(a.period_no).localeCompare(String(b.period_no)));
      oilPriceByDateCache.clear();
    }
    if (oilPriceByDateCache.has(dateStr)) return oilPriceByDateCache.get(dateStr);
    // หาราคาล่าสุดที่มีวัน <= dateStr (ราคามีผลจนถึงวันที่เปลี่ยนครั้งต่อไป)
    let match = null;
    for (const p of oilPriceSortedCache || []) {
      if (p.period_name <= dateStr) { match = p; } else { break; }
    }
    const price = match ? match.price : null;
    oilPriceByDateCache.set(dateStr, price);
    return price;
  }

  // defaults
  const d1def = defaultAnalysisDate;
  const d2def = findRefDate(d1def, 3) || [...allDates].reverse().find(date => date < d1def) || allDates[0] || '';

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
      padding:6px 10px; background:var(--surface); border:1px solid rgba(255,255,255,.08);
      border-radius:6px; color:var(--text); font-size:11.5px; cursor:pointer;
      display:flex; justify-content:space-between; align-items:center; gap:8px;
      transition:all .2s; height:32px; box-sizing:border-box;
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
      padding:5px 10px; font-size:11.5px; cursor:pointer; color:var(--text);
      display:flex; align-items:flex-start; gap:8px; transition:background .15s;
    }
    .dc-ms-item:hover { background:rgba(59,130,246,.1); }
    .dc-ms-item input[type="checkbox"] { margin-top:2px; cursor:pointer; accent-color:var(--accent); width:14px; height:14px; flex-shrink:0; }
    .dc-ms-item span { flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height:1.4; }
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
    .dc-action-btn {
      width: auto;
      height: 32px;
      box-sizing: border-box;
      padding: 6px 16px;
      border: none;
      border-radius: 6px;
      color: #e8eef8;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: .2px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: transform .2s, box-shadow .2s, filter .2s, opacity .2s, outline-color .2s;
    }
    .dc-action-btn:hover {
      transform: translateY(-1px);
      filter: brightness(1.03);
    }
    .dc-action-btn-7d {
      position: relative;
      background: linear-gradient(135deg, #1e2538, #161b2e);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.4);
      border: 1px solid rgba(99, 102, 241, 0.18);
      z-index: 0;
      overflow: hidden;
    }
    .dc-action-btn-7d:hover {
      border-color: rgba(99, 102, 241, 0.32);
    }
    /* Rotating gradient layer — clipped to border only via inner mask */
    .dc-action-btn-7d::before {
      content: '';
      position: absolute;
      inset: -60%;
      background: linear-gradient(0deg, transparent 30%, rgba(99,102,241,0.55) 50%, rgba(167,139,250,0.4) 55%, transparent 70%);
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.35s ease;
      pointer-events: none;
      will-change: transform;
    }
    /* Inner cutout so only the border ring shows */
    .dc-action-btn-7d::after {
      content: '';
      position: absolute;
      inset: 1px;
      border-radius: 5px;
      background: linear-gradient(135deg, #1a1840, #151230);
      opacity: 0;
      transition: opacity 0.35s ease;
      pointer-events: none;
      z-index: 0;
    }
    .dc-action-btn-7d.is-active {
      border-color: transparent;
    }
    .dc-action-btn-7d.is-active::before {
      opacity: 1;
      animation: dc7d-spin 4s linear infinite;
    }
    .dc-action-btn-7d.is-active::after {
      opacity: 1;
    }
    .dc-action-btn-7d.is-active .dc7d-text {
      color: #c7d2fe;
    }
    .dc7d-text {
      position: relative;
      z-index: 1;
      color: #94a3b8;
      transition: color 0.3s;
    }
    .dc-action-btn-7d:hover .dc7d-text {
      color: #c7d2fe;
    }
    @keyframes dc7d-spin {
      to { transform: rotate(360deg); }
    }
    .dc-action-btn-check {
      position: relative;
      background: linear-gradient(135deg, #0a4f3e, #073a2d);
      border: 1px solid rgba(16, 185, 129, 0.18);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      overflow: hidden;
    }
    .dc-action-btn-check::before {
      content: '';
      position: absolute;
      top: 0; left: -100%;
      width: 60%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
      transition: left 0.5s ease;
      pointer-events: none;
    }
    .dc-action-btn-check:hover {
      background: linear-gradient(135deg, #0c5f4a, #094538);
      border-color: rgba(16, 185, 129, 0.32);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    }
    .dc-action-btn-check:hover::before {
      left: 160%;
    }
    .dc-action-btn-check.is-loading {
      background: linear-gradient(135deg, #07382c, #052821);
      border-color: rgba(16, 185, 129, 0.12);
      box-shadow: none;
    }
    .dc-action-btn-export {
      position: relative;
      background: linear-gradient(135deg, #1f2454, #181c42);
      border: 1px solid rgba(99, 102, 241, 0.2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      overflow: hidden;
    }
    .dc-action-btn-export::before {
      content: '';
      position: absolute;
      top: 0; left: -100%;
      width: 60%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
      transition: left 0.5s ease;
      pointer-events: none;
    }
    .dc-action-btn-export:hover {
      background: linear-gradient(135deg, #272d66, #1e2350);
      border-color: rgba(99, 102, 241, 0.34);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    }
    .dc-action-btn-export:hover::before {
      left: 160%;
    }
    @media (max-width: 720px) {
      .dc-action-btn {
        width: auto;
      }
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

      </div>

      <!-- Row 2: Filters -->
      <div style="border-top:1px solid rgba(255,255,255,.05);padding:8px 20px;display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:12px;align-items:end">

        <div style="position:relative;z-index:50">
          <div style="font-size:10px;font-weight:450;color:#94a3b8;margin-bottom:6px;letter-spacing:0.5px">ลูกค้า</div>
          <div id="ms_btn_cust" class="dc-ms-btn" onclick="dcToggleMs('cust',event)">
            <span id="ms_lbl_cust" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">ทั้งหมด</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div id="ms_pnl_cust" class="dc-ms-panel"></div>
        </div>

        <div style="position:relative;z-index:50">
          <div style="font-size:10px;font-weight:450;color:#94a3b8;margin-bottom:6px;letter-spacing:0.5px">ชื่อเส้นทาง</div>
          <div id="ms_btn_route" class="dc-ms-btn" onclick="dcToggleMs('route',event)">
            <span id="ms_lbl_route" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">ทั้งหมด</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div id="ms_pnl_route" class="dc-ms-panel"></div>
        </div>

        <div style="position:relative;z-index:50">
          <div style="font-size:10px;font-weight:450;color:#94a3b8;margin-bottom:6px;letter-spacing:0.5px">ประเภทรถ</div>
          <div id="ms_btn_vtype" class="dc-ms-btn" onclick="dcToggleMs('vtype',event)">
            <span id="ms_lbl_vtype" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">ทั้งหมด</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div id="ms_pnl_vtype" class="dc-ms-panel"></div>
        </div>

        <div style="display:flex;align-items:center;gap:8px;">
          <div style="display:flex;background:rgba(0,0,0,.2);border-radius:6px;padding:2px;border:1px solid rgba(255,255,255,.05);height:32px;box-sizing:border-box;align-items:center">
            <button id="dc_mode_single" onclick="dcSetMode('single')"
              style="padding:0 16px;background:transparent;color:var(--muted);border:1px solid transparent;border-radius:4px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s;height:100%;display:flex;align-items:center">
              มุมมองปกติ
            </button>
            <button id="dc_mode_compare" onclick="dcSetMode('compare')"
              style="padding:0 16px;background:linear-gradient(135deg,#1e3a8a,#1e2554);color:#dbeafe;border:1px solid rgba(59,130,246,.2);border-radius:4px;font-weight:700;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s;box-shadow:0 2px 8px rgba(0,0,0,.4);height:100%;display:flex;align-items:center">
              เปรียบเทียบ
            </button>
          </div>
          <button id="dc_rolling_toggle_btn" class="dc-action-btn dc-action-btn-7d" type="button" onclick="dcToggleRollingPreset()">
            <span class="dc7d-text">7D vs Previous</span>
          </button>
          <button id="dc_check_btn" class="dc-action-btn dc-action-btn-check" onclick="dcRunCompare()">
            <span id="dc_check_text">ตรวจสอบ</span>
            <svg id="dc_check_spin" style="display:none;width:14px;height:14px;animation:dc-spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          </button>
          <button id="dc_export_btn" class="dc-action-btn dc-action-btn-export" onclick="dcExportXls()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export XLSX
          </button>
          <button onclick="dcClearFilters()"
            style="padding:0 16px;background:transparent;border:1px solid rgba(255,255,255,.08);border-radius:6px;color:#475569;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .2s;height:32px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center"
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
    let _rollingPresetBackup = null;

    // Initialize Flatpickr
    (async () => {
      try {
        await ensureFlatpickrLibrary();
      } catch (err) {
        console.warn('Flatpickr lazy-load failed; using plain date inputs:', err.message);
        return;
      }
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
    })();

    function setRangePicker(id, start, end) {
      const el = document.getElementById(id);
      if (!el || !start || !end) return;
      if (el._flatpickr) {
        el._flatpickr.setDate([start, end], false, "Y-m-d");
      } else {
        el.value = start === end ? start : `${start} to ${end}`;
      }
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

    function syncComparePresetUi() {
      const rollingToggle = document.getElementById('dc_rolling_toggle_btn');
      rollingToggle?.classList.toggle('is-active', _comparePresetMode === 'rolling7');
    }

    function applyCompareRanges(rangeA, rangeB, presetMode) {
      if (!rangeA?.start || !rangeA?.end) return;
      if (!_isSingleMode && (!rangeB?.start || !rangeB?.end)) return;
      if (_isSingleMode && presetMode !== 'manual') window.dcSetMode('compare', true);
      setRangePicker('dc_rangeA', rangeA.start, rangeA.end);
      if (rangeB?.start && rangeB?.end) setRangePicker('dc_rangeB', rangeB.start, rangeB.end);
      _comparePresetMode = presetMode || 'manual';
      syncComparePresetUi();
      if (typeof window.dcUpdateFilters === 'function') window.dcUpdateFilters(false);
      if (typeof window.dcRunCompare === 'function') window.dcRunCompare();
    }

    function restoreRollingPresetBackup() {
      if (!_rollingPresetBackup) return;
      const backup = _rollingPresetBackup;
      _rollingPresetBackup = null;
      if (_isSingleMode !== backup.isSingleMode) {
        window.dcSetMode(backup.isSingleMode ? 'single' : 'compare', true);
      }
      setRangePicker('dc_rangeA', backup.a1, backup.a2);
      setRangePicker('dc_rangeB', backup.b1, backup.b2);
      _comparePresetMode = 'manual';
      syncComparePresetUi();
      if (typeof window.dcUpdateFilters === 'function') window.dcUpdateFilters(false);
      if (typeof window.dcRunCompare === 'function') window.dcRunCompare();
    }

    function wireComparePresetControls() {
      syncComparePresetUi();
    }

    window.dcToggleRollingPreset = function () {
      if (_comparePresetMode === 'rolling7') {
        restoreRollingPresetBackup();
        return;
      }
      const [a1, a2] = getRangeDates('dc_rangeA', d1def, d1def);
      const [b1, b2] = getRangeDates('dc_rangeB', d2def, d2def);
      _rollingPresetBackup = { a1, a2, b1, b2, isSingleMode: _isSingleMode };
      const preset = getRollingSevenPreset(defaultAnalysisDate || '');
      applyCompareRanges(
        { start: preset.aStart, end: preset.aEnd },
        { start: preset.bStart, end: preset.bEnd },
        'rolling7'
      );
    };

    // Multi-select UI Logic (Portal Pattern)
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
        else if (vals.length === 1) lbl.textContent = checked[0]?.closest('label')?.querySelector('span')?.textContent || vals[0];
        else lbl.textContent = `เลือก ${vals.length} รายการ`;
      }
      dcUpdateFilters(false);
    };

    window.dcMsSearch = function (id, query) {
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

    const _msOptionRenderKeys = Object.create(null);
    function buildMsOptions(id, options, currentVals = []) {
      const pnl = document.getElementById('ms_pnl_' + id);
      if (!pnl) return;
      const optionItems = (options || []).map(option => {
        if (option && typeof option === 'object') {
          const value = String(option.value ?? option.route ?? '');
          const label = String(option.label ?? option.routeDesc ?? option.desc ?? value);
          return { value, label, search: String(option.search ?? `${label} ${value}`) };
        }
        const value = String(option ?? '');
        return { value, label: value, search: value };
      }).filter(option => option.value);
      const optionValues = optionItems.map(option => option.value);
      const validVals = currentVals.filter(v => optionValues.includes(v));
      const renderKey = [
        optionItems.map(option => `${option.value}\u001e${option.label}\u001e${option.search}`).join('\u001f'),
        validVals.slice().sort().join('\u001f')
      ].join('\u0001');
      const searchEl = document.getElementById(`ms_search_${id}`);
      if (_msOptionRenderKeys[id] === renderKey && pnl.dataset.dcMsRendered === '1' && !searchEl?.value) return;
      _msOptionRenderKeys[id] = renderKey;
      pnl.dataset.dcMsRendered = '1';
      if (optionItems.length === 0) {
        pnl.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:12px;text-align:center">ไม่มีข้อมูล</div>';
        return;
      }
      const allChecked = validVals.length === 0 || validVals.length === optionItems.length;

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
      ` + optionItems.map(option => `
        <label class="dc-ms-item" data-ms-val="${esc(option.search).toLowerCase()}" style="display:flex;">
          <input type="checkbox" value="${esc(option.value)}" onchange="dcMsChange('${id}')" ${validVals.includes(option.value) ? 'checked' : ''}>
          <span>${esc(option.label)}</span>
        </label>
      `).join('') + `</div>`;
    }

    function getFilters() {
      return { custF: getMsValues('cust'), routeF: getMsValues('route'), vtypeF: getMsValues('vtype') };
    }

    // Cascading filter updater
    window.dcUpdateFilters = function (runNow) {
      const { custF, routeF, vtypeF } = getFilters();
      const [a1, a2] = getRangeDates('dc_rangeA', d1def, d1def);
      const [b1, b2] = getRangeDates('dc_rangeB', d2def, d2def);

      const allRows = rowsForDateWindows([[a1, a2], [b1, b2]]).filter(r => {
        if (custF.length > 0 && !custF.includes(r.customer || '-')) return false;
        return true;
      });

      // Don't rebuild panels that are currently open to avoid destroying the DOM while user is interacting
      const routePanelOpen = document.getElementById('ms_pnl_route')?.classList.contains('show');
      const vtypePanelOpen = document.getElementById('ms_pnl_vtype')?.classList.contains('show');

      if (!routePanelOpen) {
        const routeOptionMap = {};
        allRows.forEach(r => {
          const value = dcCachedRouteIdentityKey(r);
          if (!routeOptionMap[value]) routeOptionMap[value] = { value, label: routeDisplay(r), search: `${routeDisplay(r)} ${r.route || ''} ${value}` };
        });
        const routeOptions = Object.values(routeOptionMap).sort((a, b) => String(a.label).localeCompare(String(b.label), 'th'));
        buildMsOptions('route', routeOptions, routeF);
      }

      if (!vtypePanelOpen) {
        const vtypeOptions = [...new Set(allRows.filter(r => routeF.length === 0 || routeF.includes(dcCachedRouteIdentityKey(r))).map(r => r.vtype || '-'))].sort();
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
    wireComparePresetControls();
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
        const compareStartedAt = perfNow();
        const [a1, a2] = getRangeDates('dc_rangeA', d1def, d1def);
        const [b1, b2] = getRangeDates('dc_rangeB', d2def, d2def);
        const rollingPreset = getRollingSevenPreset(defaultAnalysisDate || '');
        const rollingPresetMatches =
          a1 === rollingPreset.aStart && a2 === rollingPreset.aEnd &&
          b1 === rollingPreset.bStart && b2 === rollingPreset.bEnd;
        if (_comparePresetMode === 'rolling7' && !rollingPresetMatches) {
          _comparePresetMode = 'manual';
        }
        const { custF, routeF, vtypeF } = getFilters();
        _stA = rangeStats(a1, a2, custF, routeF, vtypeF);
        _stB = rangeStats(b1, b2, custF, routeF, vtypeF);
        _labelA = fmtRange(a1, a2 || a1);
        _labelB = fmtRange(b1, b2 || b1);

        // Single mode: auto-find reference days (up to 3 days back) for cross-day comparison.
        // We load ALL 3 candidate days so each route can independently fall back to the
        // nearest day that actually has data for that specific route.
        if (_isSingleMode) {
          const [y, m, d] = a1.split('-').map(Number);
          const refCandidates = [];
          for (let i = 1; i <= 3; i++) {
            const dt = new Date(y, m - 1, d - i);
            const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            if (allDatesSet.has(iso)) refCandidates.push(iso);
          }
          if (refCandidates.length > 0) {
            // Load stats for each candidate day (reuse custF/routeF/vtypeF filters).
            _stRef = refCandidates.map(iso => rangeStats(iso, iso, custF, routeF, vtypeF)).filter(Boolean);
            _labelRef = fmtDate(refCandidates[0]); // label = nearest day (for header badge)
          } else {
            _stRef = [];
            _labelRef = '';
          }
        } else {
          _stRef = [];
          _labelRef = '';
        }
        _viewMode = 'anomaly';
        syncComparePresetUi();
        renderAll({ animate: true });
        perfLog('dcRunCompare', compareStartedAt, {
          mode: _isSingleMode ? 'single' : 'compare',
          routesA: _stA?.routes?.length || 0,
          routesB: _stB?.routes?.length || 0,
          tripsA: _stA?.trips || 0,
          tripsB: _stB?.trips || 0
        });

        if (btn) { btn.style.pointerEvents = ''; btn.style.opacity = ''; }
        if (txt) txt.textContent = 'ตรวจสอบ';
        if (spin) spin.style.display = 'none';
      }, 160);
    }
    let _renderMemo = { key: '', html: '' };
    function renderStateKey() {
      const fNormal = Array.from(_compareStatusFilters.normal || []).sort().join(',');
      const fAn = Array.from(_compareStatusFilters.anomaly || []).sort().join(',');
      const fUa = Array.from(_compareStatusFilters.unmatched_a || []).sort().join(',');
      const fUb = Array.from(_compareStatusFilters.unmatched_b || []).sort().join(',');
      const stAKey = _stA ? `${_stA.rows?.length || 0}|${_stA.routes?.length || 0}|${_stA.trips || 0}|${_stA.recv || 0}|${_stA.margin || 0}` : 'na';
      const stBKey = _stB ? `${_stB.rows?.length || 0}|${_stB.routes?.length || 0}|${_stB.trips || 0}|${_stB.recv || 0}|${_stB.margin || 0}` : 'nb';
      const stRefKey = Array.isArray(_stRef) && _stRef.length > 0
        ? _stRef.map(s => `${s.rows?.length || 0}|${s.dateStart || ''}`).join('+')
        : 'nr';
      return [_isSingleMode ? 1 : 0, _viewMode || 'anomaly', _labelA || '', _labelB || '', stAKey, stBKey, stRefKey, fNormal, fAn, fUa, fUb].join('||');
    }
    // CLEANUP NOTE: Legacy renderers have been removed.
    // The active UI is defined in the "ACTIVE QA RENDER OVERRIDES" block near
    // the bottom of buildDailyCompare(). Only shared helpers remain here.

    function dcAnimateSections() {
      document.querySelectorAll('.master-section').forEach((el, i) => {
        el.classList.remove('visible');
        void el.offsetWidth; // force reflow
        setTimeout(() => el.classList.add('visible'), i * 80);
      });
    }

    function renderSingleTable(stA) {
      // Stub: legacy implementation removed. Active implementation lives in
      // ACTIVE QA RENDER OVERRIDES block below.
      return '';
    }

    window.toggleCustFilterAll = function (cIdx, isChecked) {
      const cbs = document.querySelectorAll('.filter-cb-' + cIdx);
      cbs.forEach(cb => {
        cb.checked = isChecked;
        const toggle = cb.closest('.sf-toggle');
        if (toggle) {
          if (isChecked) {
            toggle.classList.remove('off');
            toggle.classList.add('on');
          } else {
            toggle.classList.remove('on');
            toggle.classList.add('off');
          }
        }
      });
      window.applyCustFilter(cIdx, true);
    };

    window.applyCustFilter = function (cIdx, skipAllUpdate) {
      const cbs = document.querySelectorAll('.filter-cb-' + cIdx);
      const activeStatuses = Array.from(cbs).filter(cb => cb.checked).map(cb => cb.value);

      if (!skipAllUpdate) {
        const allCb = document.getElementById('filter-cb-all-' + cIdx);
        if (allCb) {
          allCb.checked = (activeStatuses.length === cbs.length);
          const allToggle = allCb.closest('.sf-all-btn');
          if (allToggle) {
            if (allCb.checked) {
              allToggle.classList.add('active');
            } else {
              allToggle.classList.remove('active');
            }
          }
        }
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

    window.sfToggleClick = function (el, cIdx) {
      const cb = el.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.checked = !cb.checked;
      if (cb.checked) {
        el.classList.remove('off');
        el.classList.add('on');
      } else {
        el.classList.remove('on');
        el.classList.add('off');
      }
      window.applyCustFilter(cIdx);
    };

    window.sfToggleAllClick = function (el, cIdx) {
      const cb = el.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.checked = !cb.checked;
      if (cb.checked) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
      window.toggleCustFilterAll(cIdx, cb.checked);
    };

    window.sfCmpToggleClick = function (el, modeKey) {
      const cb = el.querySelector('input[type="checkbox"]');
      if (!cb) return;
      const optionKeys = getPanelOptionKeys(modeKey);
      if (optionKeys.length === 0) return;
      const nextValues = new Set(getSelectedCompareStatuses(modeKey, optionKeys));
      if (nextValues.has(cb.value)) nextValues.delete(cb.value);
      else nextValues.add(cb.value);
      window.dcToggleCompareStatus(modeKey, [...nextValues]);
    };

    window.sfCmpToggleAllClick = function (el, modeKey) {
      window.dcToggleCompareStatusAll(modeKey);
    };

    window.sfCmpResetClick = function (el, modeKey) {
      window.dcResetCompareStatusFilter(modeKey);
    };

    function getSelectedCompareStatuses(modeKey, optionKeys) {
      const current = _compareStatusFilters[modeKey] ? Array.from(_compareStatusFilters[modeKey]) : [];
      const filtered = current
        .map(v => v === 'oilHigh' ? 'payHigh' : v)
        .filter(v => optionKeys.includes(v));
      if (filtered.length === 0) return [...optionKeys];
      return [...new Set(filtered)];
    }

    function normalizeCompareStatuses(values, optionKeys) {
      const filtered = (values || [])
        .map(v => v === 'oilHigh' ? 'payHigh' : v)
        .filter(v => optionKeys.includes(v));
      return filtered.length ? [...new Set(filtered)] : [...optionKeys];
    }

    function statusMatchesFilter(status, filterKey) {
      const normStatus = status === 'oilHigh' ? 'payHigh' : status;
      const normFilter = filterKey === 'oilHigh' ? 'payHigh' : filterKey;
      if (normFilter === 'payHigh') return normStatus === 'payHigh' || normStatus === 'payOilChanged';
      if (normFilter === 'recvLow') return normStatus === 'recvLow' || normStatus === 'recvOilChanged';
      return normStatus === normFilter;
    }

    function statusesMatchFilterSet(statuses, selectedSet) {
      return (statuses || []).some(status => Array.from(selectedSet || []).some(filterKey => statusMatchesFilter(status, filterKey)));
    }

    function statusesForFilterDisplay(statuses, filterKey) {
      const values = (statuses && statuses.length) ? statuses : ['normal'];
      if (!filterKey) return values;
      const filtered = values.filter(status => statusMatchesFilter(status, filterKey));
      return filtered.length ? filtered : [filterKey];
    }

    function statusesForFilterSetDisplay(statuses, filterSet) {
      const values = (statuses && statuses.length) ? statuses : ['normal'];
      if (!filterSet || filterSet.size === 0) return values;
      const filtered = values.filter(status => Array.from(filterSet).some(filterKey => statusMatchesFilter(status, filterKey)));
      return filtered.length ? filtered : values;
    }

    function scheduleCompareStatusVisibility(modeKey) {
      if (_compareStatusRaf[modeKey]) {
        cancelAnimationFrame(_compareStatusRaf[modeKey]);
      }
      _compareStatusRaf[modeKey] = requestAnimationFrame(() => {
        _compareStatusRaf[modeKey] = 0;
        updateCompareStatusVisibility(modeKey);
      });
    }

    function updateCompareStatusVisibility(modeKey) {
      const optionKeys = getPanelOptionKeys(modeKey);
      if (optionKeys.length === 0) return;
      const selected = getSelectedCompareStatuses(modeKey, optionKeys);
      const selectedSet = new Set(selected);
      const cards = document.querySelectorAll('.dc-status-card-' + modeKey);
      if (cards.length === 0) return;
      cards.forEach(card => {
        const raw = card.getAttribute('data-status-keys') || '';
        const statuses = raw.split(',').map(v => v.trim()).filter(Boolean).map(v => v === 'oilHigh' ? 'payHigh' : v);
        const visible = statusesMatchFilterSet(statuses, selectedSet);
        card.style.display = visible ? '' : 'none';
      });

      // Lens filter for normal/anomaly mode: when user selects a SUBSET of statuses,
      // hide badges that don't match the selection (focus on the picked status only).
      // When all options are selected (default), show every badge as usual.
      if (modeKey === 'normal' || modeKey === 'anomaly') {
        const isSubset = selected.length > 0 && selected.length < optionKeys.length;
        cards.forEach(card => {
          if (card.style.display === 'none') return;
          const badges = card.querySelectorAll('.dc-qa-badge[data-status-key]');
          badges.forEach(b => {
            const key = b.getAttribute('data-status-key');
            // Treat oilHigh same as payHigh (already collapsed in dcQaStatusBadges).
            const norm = key === 'oilHigh' ? 'payHigh' : key;
            b.style.display = (isSubset && !statusesMatchFilterSet([norm], selectedSet)) ? 'none' : '';
          });
          // If a row's badges are all hidden, also hide the row itself so the table
          // doesn't show empty status cells (keeps the lens consistent).
          card.querySelectorAll('.dc-qa-table tbody tr').forEach(tr => {
            // Skip ref-rows (they don't have status badges by design).
            if (tr.classList.contains('dc-qa-ref-row')) return;
            const visBadges = tr.querySelectorAll('.dc-qa-badge[data-status-key]:not([style*="display: none"])');
            tr.style.display = (isSubset && visBadges.length === 0) ? 'none' : '';
          });
        });
      }

      // Apply lens filter to the open modal if exists
      const modal = document.getElementById('dc_anom_modal');
      if (modal && modeKey === 'anomaly') {
        const isSubset = selected.length > 0 && selected.length < optionKeys.length;
        const badges = modal.querySelectorAll('.dc-qa-badge[data-status-key]');
        badges.forEach(b => {
          const key = b.getAttribute('data-status-key');
          const norm = key === 'oilHigh' ? 'payHigh' : key;
          b.style.display = (isSubset && !statusesMatchFilterSet([norm], selectedSet)) ? 'none' : '';
        });
        modal.querySelectorAll('.dc-qa-table tbody tr').forEach(tr => {
          const visBadges = tr.querySelectorAll('.dc-qa-badge[data-status-key]:not([style*="display: none"])');
          tr.style.display = (isSubset && visBadges.length === 0) ? 'none' : '';
        });
      }

      const visibleCards = Array.from(cards).filter(card => card.style.display !== 'none');
      const includeBaseCounts = !(modeKey === 'normal' || modeKey === 'anomaly')
        || !(selected.length > 0 && selected.length < optionKeys.length);
      // Helper: count trip rows that are still visible inside a card (subset filter
      // may hide some trip rows even when the card itself is shown).
      const countVisibleTripRows = (card) => {
        const rows = card.querySelectorAll('.dc-qa-table tbody tr');
        let n = 0;
        rows.forEach(tr => {
          if (tr.classList.contains('dc-qa-ref-row')) return;
          if (tr.style.display === 'none') return;
          n++;
        });
        return n + (includeBaseCounts ? (Number(card.getAttribute('data-base-count')) || 0) : 0);
      };
      // Helper: count visible trip rows that have at least one anomaly badge visible.
      const countVisibleAnomRows = (card) => {
        const rows = card.querySelectorAll('.dc-qa-table tbody tr');
        let n = 0;
        rows.forEach(tr => {
          if (tr.classList.contains('dc-qa-ref-row')) return;
          if (tr.style.display === 'none') return;
          const visBadges = Array.from(tr.querySelectorAll('.dc-qa-badge[data-status-key]'))
            .filter(b => b.style.display !== 'none');
          const hasAnom = dcQaHasAnomalyStatus(visBadges.map(b => b.getAttribute('data-status-key')));
          if (hasAnom) n++;
        });
        return n;
      };
      if (modeKey === 'normal') {
        const routesEl = document.getElementById('dc-summary-routes-normal');
        const tripsEl = document.getElementById('dc-summary-trips-normal');
        const anomsEl = document.getElementById('dc-summary-anoms-normal');
        // When a SUBSET filter is active we must count visible trip rows inside each card,
        // because some rows may be hidden by the lens-filter while the card stays visible.
        // When ALL options are selected we can use the cheap data-* attributes directly.
        const isSubset = selected.length > 0 && selected.length < optionKeys.length;
        const visibleTrips = isSubset
          ? visibleCards.reduce((sum, card) => sum + countVisibleTripRows(card), 0)
          : visibleCards.reduce((sum, card) => sum + (Number(card.getAttribute('data-trip-count')) || 0), 0);
        const visibleAnoms = isSubset
          ? visibleCards.reduce((sum, card) => sum + countVisibleAnomRows(card), 0)
          : visibleCards.reduce((sum, card) => sum + (Number(card.getAttribute('data-anom-count')) || 0), 0);
        if (routesEl) routesEl.textContent = String(visibleCards.length);
        if (tripsEl) tripsEl.textContent = String(visibleTrips);
        if (anomsEl) anomsEl.textContent = String(visibleAnoms);

        // Per-customer aggregate update: recompute totals from currently visible routes inside.
        document.querySelectorAll('.dc-normal-customer-section').forEach(section => {
          const visibleRoutes = Array.from(section.querySelectorAll('.dc-status-card-normal'))
            .filter(card => card.style.display !== 'none');
          section.style.display = visibleRoutes.length > 0 ? '' : 'none';
          const custCard = section.querySelector('.dc-normal-customer-card');
          if (!custCard) return;
          const sumAttr = (sel) => visibleRoutes.reduce((s, c) => s + (Number(c.getAttribute(sel)) || 0), 0);
          const cTrips = isSubset
            ? visibleRoutes.reduce((s, c) => s + countVisibleTripRows(c), 0)
            : sumAttr('data-trip-count');
          const cRecv = sumAttr('data-recv');
          const cPay = sumAttr('data-pay');
          const cOil = sumAttr('data-oil');
          const cMargin = sumAttr('data-margin');
          const cAnoms = isSubset
            ? visibleRoutes.reduce((s, c) => s + countVisibleAnomRows(c), 0)
            : sumAttr('data-anom-count');
          const cPct = cRecv > 0 ? cMargin / cRecv * 100 : 0;
          const tone = cMargin >= 0 ? '#22c55e' : '#ef4444';
          const setText = (sel, val) => { const el = custCard.querySelector(sel); if (el) el.textContent = val; };
          setText('.js-cust-routes', String(visibleRoutes.length));
          setText('.js-cust-trips', String(cTrips));
          setText('.js-cust-recv', fmt(cRecv));
          setText('.js-cust-pay', fmt(cPay));
          setText('.js-cust-oil', fmt(cOil));
          // Margin/pct also need color update.
          const marginEl = custCard.querySelector('.js-cust-margin');
          if (marginEl) { marginEl.textContent = fmt(cMargin); marginEl.style.color = tone; }
          const pctEl = custCard.querySelector('.js-cust-pct');
          if (pctEl) { pctEl.textContent = cPct.toFixed(1) + '%'; pctEl.style.color = tone; }
          // Anomaly metric: update count in metrics row (same style as recv/pay/oil).
          const anomWrap = custCard.querySelector('.js-cust-anom-wrap');
          if (anomWrap) {
            if (cAnoms > 0) {
              anomWrap.innerHTML = `<span>ความผิดปกติ</span><b class="js-cust-anoms dc-normal-metrics-anom">${cAnoms}</b>`;
            } else {
              anomWrap.innerHTML = `<span>ความผิดปกติ</span><b class="dc-normal-metrics-ok">0</b>`;
            }
          }
        });
      } else if (modeKey === 'anomaly') {
        const routesEl = document.getElementById('dc-summary-routes-anomaly');
        const anomsEl = document.getElementById('dc-summary-anoms-anomaly');
        const isSubset = selected.length > 0 && selected.length < optionKeys.length;
        const visibleAnoms = isSubset
          ? visibleCards.reduce((sum, card) => {
              const idx = Number(card.getAttribute('data-card-idx'));
              const cardData = window._anomalyCardsData?.[idx];
              if (!cardData) return sum;
              const cardAnoms = cardData.anomRows.filter(row => {
                const hasSelectedStatus = statusesMatchFilterSet(row.statuses, selectedSet);
                return hasSelectedStatus && dcQaHasAnomalyStatus(row.statuses);
              }).length;
              return sum + cardAnoms;
            }, 0)
          : visibleCards.reduce((sum, card) => sum + (Number(card.getAttribute('data-anom-count')) || 0), 0);
        if (routesEl) routesEl.textContent = String(visibleCards.length);
        if (anomsEl) anomsEl.textContent = String(visibleAnoms);
      } else if (modeKey === 'unmatched_a' || modeKey === 'unmatched_b') {
        const routesEl = document.getElementById('dc-summary-routes-' + modeKey);
        const tripsEl = document.getElementById('dc-summary-trips-' + modeKey);
        const anomsEl = document.getElementById('dc-summary-anoms-' + modeKey);
        const visibleTrips = visibleCards.reduce((sum, card) => sum + (Number(card.getAttribute('data-trip-count')) || 0), 0);
        const visibleAnoms = visibleCards.reduce((sum, card) => sum + (Number(card.getAttribute('data-anom-count')) || 0), 0);
        if (routesEl) routesEl.textContent = String(visibleCards.length);
        if (tripsEl) tripsEl.textContent = String(visibleTrips);
        if (anomsEl) anomsEl.textContent = String(visibleAnoms);
      }
    }

    function getPanelOptionKeys(modeKey) {
      const panel = document.getElementById('dc-status-panel-' + modeKey);
      if (!panel) return [];
      const raw = panel.getAttribute('data-option-keys') || '';
      return raw.split(',').map(v => v.trim()).filter(Boolean);
    }

    function syncCompareStatusPanel(modeKey) {
      const optionKeys = getPanelOptionKeys(modeKey);
      if (optionKeys.length === 0) return;
      const panel = document.getElementById('dc-status-panel-' + modeKey);
      if (!panel) return;
      const cbs = Array.from(panel.querySelectorAll('.cmp-filter-cb-' + modeKey));
      const checkedNormalized = getSelectedCompareStatuses(modeKey, optionKeys);

      cbs.forEach(cb => {
        const checked = checkedNormalized.includes(cb.value);
        cb.checked = checked;
        const toggle = cb.closest('.sf-toggle');
        if (toggle) {
          toggle.classList.toggle('on', checked);
          toggle.classList.toggle('off', !checked);
        }
      });

      const allCb = document.getElementById('cmp-filter-all-' + modeKey);
      if (allCb) {
        allCb.checked = checkedNormalized.length === optionKeys.length;
        const allBtn = allCb.closest('.sf-all-btn');
        if (allBtn) {
          if (allCb.checked) allBtn.classList.add('active');
          else allBtn.classList.remove('active');
        }
      }
    }

    function commitCompareStatusFilter(modeKey, nextValues, optionKeys = getPanelOptionKeys(modeKey)) {
      if (!optionKeys.length) return;
      const normalized = normalizeCompareStatuses(nextValues, optionKeys);
      _compareStatusFilters[modeKey] = new Set(normalized);
      syncCompareStatusPanel(modeKey);
      scheduleCompareStatusVisibility(modeKey);
    }

    window.dcToggleCompareStatusAll = function (modeKey) {
      const optionKeys = getPanelOptionKeys(modeKey);
      if (!optionKeys.length) return;
      commitCompareStatusFilter(modeKey, optionKeys, optionKeys);
    };

    window.dcToggleCompareStatus = function (modeKey, nextValues) {
      const optionKeys = getPanelOptionKeys(modeKey);
      if (!optionKeys.length) return;
      const values = Array.isArray(nextValues) ? nextValues : getSelectedCompareStatuses(modeKey, optionKeys);
      commitCompareStatusFilter(modeKey, values, optionKeys);
    };

    window.dcResetCompareStatusFilter = function (modeKey) {
      const optionKeys = getPanelOptionKeys(modeKey);
      if (!optionKeys.length) return;
      _compareStatusFilters[modeKey] = new Set(optionKeys);
      syncCompareStatusPanel(modeKey);
      scheduleCompareStatusVisibility(modeKey);
    };

    // Override UI: anomaly/unmatched panel + status filter (formal style)
    function getCompareStatusLabelMap() {
      return {
        loss: 'ขาดทุน',
        oil50: 'สำรองน้ำมัน>50%',
        payHigh: 'ราคาจ่ายผิดปกติ',
        payOilChanged: 'ราคาจ่ายเปลี่ยนแปลงตามราคาน้ำมัน',
        recvLow: 'ราคารับผิดปกติ',
        recvOilChanged: 'ราคารับเปลี่ยนแปลงตามราคาน้ำมัน',
        normal: 'ข้อมูลไม่เปลี่ยนแปลง',
        noRef: 'ไม่มีข้อมูลเปรียบเทียบ'
      };
    }

    function renderCompareStatusFilter(modeKey, optionKeys, selectedKeys, counts = {}) {
      const labels = getCompareStatusLabelMap();
      const selectedSet = new Set(selectedKeys);
      const allChecked = optionKeys.every(k => selectedSet.has(k));
      const order = ['loss', 'oil50', 'payHigh', 'recvLow', 'normal', 'noRef'];
      const orderedKeys = [...optionKeys].sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b, 'th');
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      const getCmpColor = (k) => {
        if (k === 'loss') return 'red';
        if (k === 'oil50') return 'orange';
        if (k === 'payHigh') return 'purple';
        if (k === 'payOilChanged') return 'rose';
        if (k === 'recvLow') return 'blue';
        if (k === 'recvOilChanged') return 'cyan';
        if (k === 'normal') return 'green';
        if (k === 'noRef') return 'slate';
        return 'slate';
      };

      const chips = orderedKeys.map(k => {
        const active = selectedSet.has(k);
        const count = counts[k] || 0;
        return `
          <div class="sf-toggle ${active ? 'on' : 'off'}" data-color="${getCmpColor(k)}" onclick="window.sfCmpToggleClick(this, '${modeKey}')">
            <input type="checkbox" value="${k}" class="cmp-filter-cb-${modeKey}" ${active ? 'checked' : ''} style="display:none">
            <span class="sf-switch"></span>
            <span class="sf-label">${labels[k] || k}</span>
            <span class="sf-count">${count}</span>
          </div>
        `;
      }).join('');

      return `
        <div class="sf-bar" id="dc-status-panel-${modeKey}" data-option-keys="${optionKeys.join(',')}">
          <div class="sf-all-btn ${allChecked ? 'active' : ''}" onclick="window.sfCmpToggleAllClick(this, '${modeKey}')">
            <input type="checkbox" id="cmp-filter-all-${modeKey}" ${allChecked ? 'checked' : ''} style="display:none">
            ดูทั้งหมด
          </div>
          <button type="button" class="sf-all-btn sf-reset-btn" onclick="window.sfCmpResetClick(this, '${modeKey}')">รีเซ็ต</button>
          <div class="sf-sep"></div>
          ${chips}
        </div>
      `;
    }

    function renderQFBarModern() {
      const isAnomaly = _viewMode === 'anomaly';
      const compareAlertIcon = '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#EFEFEF"><path d="M80-560q0-100 44.5-183.5T244-882l47 64q-60 44-95.5 111T160-560H80Zm720 0q0-80-35.5-147T669-818l47-64q75 55 119.5 138.5T880-560h-80ZM160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z"/></svg>';
      return `<section class="dc-qf-panel">
        <div class="dc-qf-head">
          <div class="dc-qf-title-wrap">
            <span class="dc-qf-kicker"></span>
            <h3 class="dc-qf-title">ตรวจสอบความผิดปกติ</h3>
            <p class="dc-qf-caption"></p>
          </div>
        </div>
        <div class="dc-qf-grid">
          <button id="qf_anomaly" class="dc-qf-btn${isAnomaly ? ' active' : ''}">
            <span class="dc-qf-icon" aria-hidden="true">
              ${compareAlertIcon}
            </span>
            <span class="dc-qf-content">
              <span class="dc-qf-label">รายเส้นทางที่ถูกเปรียบเทียบ</span>
              <span class="dc-qf-sub">แสดงเส้นทางที่พบสัญญาณผิดปกติ โดยเปรียบเทียบเที่ยววิ่งบนเส้นทางเดียวกันของ พขร. คนเดียวกันระหว่างสองช่วงเวลา</span>
            </span>
          </button>
        </div>
      </section>`;
    }

    function bindQFEvents() {
      document.getElementById('qf_anomaly')?.addEventListener('click', () => { _viewMode = 'anomaly'; renderAll({ animate: false }); });
    }

    function renderCard(st, side, label) {
      if (!st) return `<div class="dc-card dc-empty"><div class="dc-empty-msg">ไม่มีข้อมูล</div></div>`;
      const pctCls = st.pct >= 0 ? 'green' : 'red';
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
      </div>`;
    }

    // CLEANUP: Legacy renderAnomalyTable / renderUnmatchedTable and their
    // companion modals have been removed. Active versions live inside
    // ACTIVE QA RENDER OVERRIDES (below) and use the per-row peer logic
    // (no avg, no * 1.05).
    function renderAnomalyTable() { /* overridden below */ return ''; }
    function renderUnmatchedTable() { /* overridden below */ return ''; }
    window.dcOpenAnomalyModal = function () { /* overridden below */ };
    window.dcOpenUnmatchedModal = function () { /* overridden below */ };

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

    window.dcExportModalPng = async function (targetId, baseName) {
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
        try { decodedBase = decodeURIComponent(decodedBase); } catch (_) { }
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

    window.dcExportXls = async function () {
      const exportBtn = document.getElementById('dc_export_btn');
      const exportBtnHtml = exportBtn ? exportBtn.innerHTML : '';
      const needsXlsxLoad = typeof XLSX === 'undefined';
      if (needsXlsxLoad && exportBtn) {
        exportBtn.disabled = true;
        exportBtn.style.pointerEvents = 'none';
        exportBtn.style.opacity = '0.7';
        exportBtn.textContent = 'กำลังโหลด XLSX...';
      }
      try {
        await ensureXlsxLibrary();
      } catch (err) {
        alert('โหลดไลบรารี XLSX ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
        return;
      } finally {
        if (needsXlsxLoad && exportBtn) {
          exportBtn.disabled = false;
          exportBtn.style.pointerEvents = '';
          exportBtn.style.opacity = '';
          exportBtn.innerHTML = exportBtnHtml;
        }
      }
      if (!_stA) { alert('ยังไม่มีข้อมูล กรุณากด "ตรวจสอบ" ก่อน Export'); return; }
      if (!_isSingleMode && !_stB) {
        alert('ช่วงเปรียบเทียบไม่มีข้อมูล กรุณาเลือกช่วงวันที่ใหม่ หรือสลับเป็นมุมมองปกติก่อน Export');
        return;
      }

      const { custF, routeF, vtypeF } = getFilters();
      const xlsxRouteDisplay = row => routeGroupHeaderDisplay(row);
      const routeLabelMap = {};
      validFd.forEach(row => {
        const value = routeIdentityKey(row);
        if (!routeLabelMap[value]) routeLabelMap[value] = xlsxRouteDisplay(row);
      });
      const routeFilterLabels = routeF.map(route => routeLabelMap[route] || route);
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
      function xlsxQuoteSheetName(name) {
        return "'" + String(name || '').replace(/'/g, "''") + "'";
      }
      function xlsxAbsCell(rowIdx, colIdx) {
        return '$' + XLSX.utils.encode_col(colIdx) + '$' + (rowIdx + 1);
      }
      function xlsxUsedRangeRef(sheetName, ws) {
        if (!ws || !ws['!ref']) return null;
        const range = XLSX.utils.decode_range(ws['!ref']);
        return xlsxQuoteSheetName(sheetName) + '!' + xlsxAbsCell(range.s.r, range.s.c) + ':' + xlsxAbsCell(range.e.r, range.e.c);
      }
      function xlsxTitleRowsRef(sheetName, printTitlesRow) {
        const match = String(printTitlesRow || '1:3').match(/^\s*\$?(\d+)\s*:\s*\$?(\d+)\s*$/);
        if (!match) return null;
        return xlsxQuoteSheetName(sheetName) + '!$' + match[1] + ':$' + match[2];
      }
      function applySheetPrintLayout(ws) {
        if (!ws) return;
        ws['!margins'] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
        ws['!pageSetup'] = {
          paperSize: 9,
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0
        };
      }
      function patchWorksheetPrintXml(xml, opts = {}) {
        if (!xml) return xml;
        const paperSize = opts.paperSize || 9;
        const orientation = opts.orientation || 'landscape';
        const fitToWidth = opts.fitToWidth ?? 1;
        const fitToHeight = opts.fitToHeight ?? 0;
        const pageSetupXml = `<pageSetup paperSize="${paperSize}" orientation="${orientation}" fitToWidth="${fitToWidth}" fitToHeight="${fitToHeight}"/>`;
        const fitPropXml = '<pageSetUpPr fitToPage="1"/>';
        let out = xml;

        if (/<sheetPr\b[^>]*\/>/.test(out)) {
          out = out.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${fitPropXml}</sheetPr>`);
        } else if (/<sheetPr\b[^>]*>/.test(out)) {
          out = /<pageSetUpPr\b/.test(out)
            ? out.replace(/<pageSetUpPr\b[^>]*\/>/, fitPropXml)
            : out.replace(/<\/sheetPr>/, `${fitPropXml}</sheetPr>`);
        } else {
          out = out.replace(/(<worksheet\b[^>]*>)/, match => `${match}<sheetPr>${fitPropXml}</sheetPr>`);
        }

        if (/<pageSetup\b[^>]*\/>/.test(out)) {
          out = out.replace(/<pageSetup\b[^>]*\/>/, pageSetupXml);
        } else if (/<pageMargins\b[^>]*\/>/.test(out)) {
          out = out.replace(/(<pageMargins\b[^>]*\/>)/, match => `${match}${pageSetupXml}`);
        } else {
          out = out.replace(/<\/worksheet>/, `${pageSetupXml}</worksheet>`);
        }
        return out;
      }
      function xmlAttrEscape(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
      function patchWorksheetDataValidationXml(xml, refs = []) {
        const validRefs = (refs || []).filter(Boolean);
        if (!xml || validRefs.length === 0) return xml;
        const sqref = xmlAttrEscape(validRefs.join(' '));
        const validationXml =
          `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${sqref}"><formula1>"☐,☑"</formula1></dataValidation></dataValidations>`;
        let out = xml.replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/g, '');
        const insertBefore = [
          /<hyperlinks\b/,
          /<printOptions\b/,
          /<pageMargins\b/,
          /<pageSetup\b/,
          /<headerFooter\b/,
          /<drawing\b/,
          /<legacyDrawing\b/,
          /<tableParts\b/,
          /<extLst\b/,
          /<\/worksheet>/
        ];
        for (const pattern of insertBefore) {
          if (pattern.test(out)) {
            return out.replace(pattern, match => validationXml + match);
          }
        }
        return out + validationXml;
      }
      function xlsxRangeRef(rowStart, rowEnd, colStart, colEnd) {
        return XLSX.utils.encode_range({ s: { r: rowStart, c: colStart }, e: { r: rowEnd, c: colEnd } });
      }
      function xlsxCompressRowRefs(rowIndexes, colStart, colEnd) {
        const rows = [...new Set((rowIndexes || []).filter(row => Number.isInteger(row) && row >= 0))].sort((a, b) => a - b);
        const refs = [];
        let start = null;
        let prev = null;
        rows.forEach(row => {
          if (start == null) {
            start = row;
            prev = row;
            return;
          }
          if (row === prev + 1) {
            prev = row;
            return;
          }
          refs.push(xlsxRangeRef(start, prev, colStart, colEnd));
          start = row;
          prev = row;
        });
        if (start != null) refs.push(xlsxRangeRef(start, prev, colStart, colEnd));
        return refs;
      }
      function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      function applyWorkbookPrintSettings(wb, sheetPrintOptions = {}) {
        if (!wb || !Array.isArray(wb.SheetNames)) return;
        if (!wb.Workbook) wb.Workbook = {};
        if (!Array.isArray(wb.Workbook.Names)) wb.Workbook.Names = [];

        const configuredSheets = new Set();
        const printNames = [];
        wb.SheetNames.forEach((sheetName, idx) => {
          const ws = wb.Sheets?.[sheetName];
          if (!ws) return;
          const opts = sheetPrintOptions[sheetName] || {};
          applySheetPrintLayout(ws);
          configuredSheets.add(idx);

          const titlesRef = xlsxTitleRowsRef(sheetName, opts.printTitlesRow || '1:3');
          const areaRef = xlsxUsedRangeRef(sheetName, ws);
          if (titlesRef) printNames.push({ Name: '_xlnm.Print_Titles', Sheet: idx, Ref: titlesRef });
          if (areaRef) printNames.push({ Name: '_xlnm.Print_Area', Sheet: idx, Ref: areaRef });
        });

        wb.Workbook.Names = wb.Workbook.Names.filter(name => {
          if (!name || !configuredSheets.has(name.Sheet)) return true;
          if (name.Name !== '_xlnm.Print_Titles' && name.Name !== '_xlnm.Print_Area') return true;
          return false;
        });
        wb.Workbook.Names.push(...printNames);
      }
      async function writeWorkbookWithPrintSettings(wb, fileName, sheetPrintOptions = {}) {
        applyWorkbookPrintSettings(wb, sheetPrintOptions);
        if (typeof JSZip === 'undefined') {
          XLSX.writeFile(wb, fileName, { bookType: 'xlsx', cellStyles: true });
          alert('ส่งออกสำเร็จ แต่ไม่พบ JSZip จึงไม่ได้ฝังค่า Page Setup และ dropdown สำหรับ checkbox');
          return;
        }

        const workbookData = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
        const zip = await JSZip.loadAsync(workbookData);
        await Promise.all((wb.SheetNames || []).map(async (sheetName, idx) => {
          const entryName = `xl/worksheets/sheet${idx + 1}.xml`;
          const entry = zip.file(entryName);
          if (!entry) return;
          const xml = await entry.async('string');
          const ws = wb.Sheets?.[sheetName];
          const opts = {
            ...(sheetPrintOptions[sheetName] || {}),
            qaCheckboxValidationRefs: ws?.['!qaCheckboxValidationRefs'] || []
          };
          let patchedXml = patchWorksheetPrintXml(xml, opts);
          patchedXml = patchWorksheetDataValidationXml(patchedXml, opts.qaCheckboxValidationRefs);
          zip.file(entryName, patchedXml);
        }));

        const blob = await zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        downloadBlob(blob, fileName);
      }
      function filterSummaryText() {
        return 'ลูกค้า: ' + (custF.length ? custF.join(', ') : 'ทั้งหมด') +
          ' | ชื่อเส้นทาง: ' + (routeFilterLabels.length ? routeFilterLabels.join(', ') : 'ทั้งหมด') +
          ' | ประเภทรถ: ' + (vtypeF.length ? vtypeF.join(', ') : 'ทั้งหมด') +
          ' | โหมด: ' + (_isSingleMode ? 'มุมมองปกติ' : 'เปรียบเทียบ');
      }

      const allBorders = {
        top: { style: 'thin', color: { rgb: 'E5E7EB' } },
        bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
        left: { style: 'thin', color: { rgb: 'E5E7EB' } },
        right: { style: 'thin', color: { rgb: 'E5E7EB' } }
      };
      const routeGroupOuterBorderSide = { style: 'thin', color: { rgb: '595959' } };
      function applyRouteGroupOuterBorder(row) {
        if (!Array.isArray(row) || row.length === 0) return row;
        row.forEach((cell, idx) => {
          if (!cell) return;
          if (!cell.s) cell.s = {};
          const current = cell.s.border || {};
          cell.s.border = {
            ...current,
            top: routeGroupOuterBorderSide,
            bottom: routeGroupOuterBorderSide,
            ...(idx === 0 ? { left: routeGroupOuterBorderSide } : {}),
            ...(idx === row.length - 1 ? { right: routeGroupOuterBorderSide } : {})
          };
        });
        return row;
      }
      function hCell(v, opts) {
        opts = opts || {};
        return { v: v, s: { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: opts.sz || 11 }, fill: { fgColor: { rgb: '1F2937' }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'center', wrapText: opts.wrap !== false }, border: allBorders } };
      }
      function tCell(v) {
        return { v: v, s: { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 13 }, fill: { fgColor: { rgb: '1F2937' }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'center' } } };
      }
      function cCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10 }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.color) s.font.color = { rgb: opts.color };
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      function formulaCell(formula, opts) {
        opts = opts || {};
        const styleOpts = { ...opts };
        delete styleOpts.numFmt;
        const cell = cCell(0, styleOpts);
        if (opts.numFmt) cell.s.numFmt = opts.numFmt;
        cell.t = 'n';
        cell.v = 0;
        cell.f = formula;
        return cell;
      }
      function rCell(v, opts) {
        opts = opts || {};
        if (opts.numFmt === nTHB) v = fmtMoney(v);
        else if (opts.numFmt === nPct) v = fmtPercent(v);
        else if (opts.numFmt === '#,##0') v = fmtInt(v);
        const s = { font: { sz: 10, color: { rgb: 'DC2626' } }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
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
        const s = { font: { sz: 10, color: { rgb: '16A34A' } }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
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
        const s = { font: { sz: 10, color: { rgb: 'EA580C' } }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
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
        const s = { font: { sz: 10, color: { rgb: '6B7280' } }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
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
        const s = { font: { sz: 10, color: { rgb: 'A855F7' } }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
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
        const s = { font: { sz: 10, color: { rgb: '3B82F6' } }, alignment: { vertical: opts.valign || 'center' }, border: allBorders };
        if (opts.numFmt) s.numFmt = opts.numFmt;
        if (opts.align) s.alignment.horizontal = opts.align;
        if (opts.wrap) s.alignment.wrapText = true;
        if (opts.bold) s.font.bold = true;
        if (opts.sz) s.font.sz = opts.sz;
        if (opts.fill) s.fill = { fgColor: { rgb: opts.fill }, patternType: 'solid' };
        return { v: v, s: s };
      }
      const nTHB = '#,##0.00';
      const nPct = '0.00%';
      const periodALabel = _stA ? (_labelA || fmtRange(_stA.dateStart, _stA.dateEnd)) : (_labelA || '-');
      const periodBLabel = !_isSingleMode ? (_labelB || (_stB ? fmtRange(_stB.dateStart, _stB.dateEnd) : '-')) : '';
      const addPeriod = (title, periodLabel) => `${title} (${periodLabel || '-'})`;
      const qaStatusLabels = () => (typeof getCompareStatusLabelMap === 'function')
        ? getCompareStatusLabelMap()
        : { loss: 'ขาดทุน', oil50: 'สำรองน้ำมัน>50%', payHigh: 'ราคาจ่ายผิดปกติ', payOilChanged: 'ราคาจ่ายเปลี่ยนแปลงตามราคาน้ำมัน', recvLow: 'ราคารับผิดปกติ', recvOilChanged: 'ราคารับเปลี่ยนแปลงตามราคาน้ำมัน', normal: 'ข้อมูลไม่เปลี่ยนแปลง', noRef: 'ไม่มีข้อมูลเปรียบเทียบ' };
      const cleanStatuses = statuses => {
        const values = [...new Set((statuses && statuses.length ? statuses : ['normal']).map(s => s === 'oilHigh' ? 'payHigh' : s))];
        return values.some(s => s !== 'normal') ? values.filter(s => s !== 'normal') : values;
      };
      // Priority order matches dcQaStatusRank: loss(4) > oil50(3) > payHigh/recvLow(2) > payOilChanged/recvOilChanged/normal/noRef(0)
      const statusPriorityOrder = ['loss', 'oil50', 'payHigh', 'recvLow', 'payOilChanged', 'recvOilChanged', 'normal', 'noRef'];
      const statusText = statuses => {
        const labels = qaStatusLabels();
        const sorted = [...cleanStatuses(statuses)].sort(
          (a, b) => statusPriorityOrder.indexOf(a) - statusPriorityOrder.indexOf(b)
        );
        // One problem per line so row height can be calculated from line count.
        return sorted.map(k => labels[k] || k).join('\n') || labels.normal || 'ข้อมูลไม่เปลี่ยนแปลง';
      };
      // Returns number of display lines for a status cell (used to compute row height).
      const statusLineCount = statuses => cleanStatuses(statuses).length || 1;
      // Color is determined by the highest-priority (most severe) problem in the list.
      const statusColor = values => {
        if (values.includes('loss')) return 'loss';
        if (values.includes('oil50')) return 'oil50';
        if (values.includes('payHigh')) return 'payHigh';
        if (values.includes('recvLow')) return 'recvLow';
        if (values.includes('payOilChanged')) return 'payOilChanged';
        if (values.includes('recvOilChanged')) return 'recvOilChanged';
        if (values.includes('noRef')) return 'noRef';
        return 'normal';
      };
      // Color map for each status key — used by statusStyledCell.
      const statusColorMap = {
        loss: 'DC2626',
        oil50: 'EA580C',
        payHigh: 'A855F7',
        payOilChanged: 'DB2777',
        recvLow: '3B82F6',
        recvOilChanged: '0891B2',
        normal: '16A34A',
        noRef: '64748B'
      };
      // statusRichCell: xlsx-js-style does NOT support per-run font colors (rich text).
      // Falls back to statusStyledCell using the highest-priority problem color.
      // Kept as alias so call sites don't need changing.
      function statusRichCell(statuses, opts) {
        return statusStyledCell(statuses, opts);
      }
      function statusStyledCell(statuses, opts) {
        const values = cleanStatuses(statuses);
        const text = statusText(values);
        const base = { valign: 'top', wrap: true, ...(opts || {}) };
        if (base.neutralStatusColor) {
          const neutralOpts = { ...base, color: base.color || '111827' };
          delete neutralOpts.neutralStatusColor;
          return cCell(text, neutralOpts);
        }
        const color = statusColor(values);
        let cell;
        if (color === 'loss') cell = rCell(text, base);
        else if (color === 'oil50') cell = oCell(text, base);
        else if (color === 'payHigh') cell = pCell(text, base);
        else if (color === 'payOilChanged') cell = cCell(text, { ...base, color: statusColorMap.payOilChanged });
        else if (color === 'recvLow') cell = bCell(text, base);
        else if (color === 'recvOilChanged') cell = cCell(text, { ...base, color: statusColorMap.recvOilChanged });
        else if (color === 'normal') cell = gCell(text, base);
        else if (color === 'noRef') cell = mCell(text, base);
        else cell = mCell(text, base);

        if (!cell.s) cell.s = {};
        if (!cell.s.alignment) cell.s.alignment = {};
        cell.s.alignment.vertical = base.valign || 'top';
        cell.s.alignment.horizontal = base.align || 'left';
        cell.s.alignment.wrapText = true;
        return cell;
      }
      function signedMoney(n) {
        if (!hasNum(n)) return '-';
        const value = Number(n);
        return (value > 0 ? '+' : '') + fmtMoney(value);
      }
      // Bullet pair text format: "• A\n• B\nΔ ±diff" (Δ omitted when values match exactly).
      // Mirrors the Excel template the team approved (compares two periods stacked in one cell).
      function bulletPairText(a, b) {
        const canDiff = hasNum(a) && hasNum(b);
        const aText = hasNum(a) ? fmtMoney(a) : '-';
        const bText = hasNum(b) ? fmtMoney(b) : '-';
        const lines = ['• ' + aText, '• ' + bText];
        if (canDiff) {
          const diff = Number(a) - Number(b);
          if (Math.abs(diff) >= 0.0001) lines.push('Δ ' + signedMoney(diff));
        }
        return lines.join('\n');
      }
      function bulletPairCell(a, b, opts, invertColor = false) {
        const canDiff = hasNum(a) && hasNum(b);
        const diff = canDiff ? Number(a) - Number(b) : 0;
        const base = { ...(opts || {}), align: 'right', wrap: true };
        // neutralColor: changed values use dark text, unchanged values keep the muted no-change style.
        if (base.neutralColor) {
          delete base.neutralColor;
          if (!canDiff || Math.abs(diff) < 0.0001) return mCell(bulletPairText(a, b), base);
          return cCell(bulletPairText(a, b), { ...base, color: '111827' });
        }
        if (!canDiff || Math.abs(diff) < 0.0001) return mCell(bulletPairText(a, b), base);
        const isGood = invertColor ? (diff < 0) : (diff > 0);
        return isGood ? gCell(bulletPairText(a, b), base) : rCell(bulletPairText(a, b), base);
      }
      // Single-value bullet (used by unmatched sheets where no B counterpart exists).
      function bulletSingleText(a) {
        return '• ' + (hasNum(a) ? fmtMoney(a) : '-');
      }
      function bulletSingleCell(a, opts, isMargin = false) {
        const base = { ...(opts || {}), align: 'right', wrap: true };
        if (!hasNum(a)) return mCell(bulletSingleText(a), base);
        if (!isMargin) return cCell(bulletSingleText(a), base);
        return Number(a) < 0 ? rCell(bulletSingleText(a), base) : gCell(bulletSingleText(a), base);
      }
      // Legacy aliases preserved for any caller still using the old names; both now produce
      // the bullet template.
      const metricPairText = bulletPairText;
      const metricPairCell = bulletPairCell;
      function rowPeerRows(sourceRows, row) {
        return (sourceRows || []).filter(r =>
          r.customer === row.customer && routeIdentityKey(r) === routeIdentityKey(row) && r.vtype === row.vtype
        );
      }

      function buildNormalQaSheet(st, periodLabel) {
        const wsData = [];
        wsData.push([cCell('มุมมองปกติ', { bold: true, sz: 12, color: '111827' })]);
        wsData.push([cCell(filterSummaryText(), { color: '6B7280', sz: 9 })]);
        wsData.push([cCell('ช่วงข้อมูล: ' + (periodLabel || '-'), { color: '374151', sz: 9 })]);
        wsData.push([]);
        const headers = ['ลูกค้า', 'ชื่อเส้นทาง', 'วันที่', 'พขร.', 'ประเภทรถ', 'ทะเบียน', 'ราคาน้ำมัน', 'สำรองน้ำมัน', 'ราคารับ', 'ราคาจ่าย', 'ส่วนต่าง', 'ความผิดปกติ'];
        wsData.push(headers.map(t => hCell(t)));
        let rowIdx = wsData.length;

        const routeCases = (st?.routes || []).map(route => {
          const trips = (st?.rows || []).filter(r => r.customer === route.customer && routeIdentityKey(r) === routeIdentityKey(route) && r.vtype === route.vtype)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
          const rows = trips.map(ra => ({ ra, statuses: dcQaTripStatuses(ra, [ra]) }))
            .sort((a, b) => {
              const rankA = dcQaStatusRank(a.statuses);
              const rankB = dcQaStatusRank(b.statuses);
              if (rankB !== rankA) return rankB - rankA;
              return String(a.ra.date || '').localeCompare(String(b.ra.date || ''));
            });
          const anomCount = rows.filter(row => dcQaHasAnomalyStatus(row.statuses)).length;
          const statusSet = new Set();
          rows.forEach(row => row.statuses.forEach(s => statusSet.add(s)));
          return {
            route,
            rows,
            anomCount,
            statuses: [...statusSet],
            severity: rows.length ? Math.max(...rows.map(row => dcQaStatusRank(row.statuses))) : 0
          };
        }).sort((a, b) => {
          const ca = String(a.route.customer || '').trim().toUpperCase();
          const cb = String(b.route.customer || '').trim().toUpperCase();
          const pa = custOrder[ca] ?? 999;
          const pb = custOrder[cb] ?? 999;
          if (pa !== pb) return pa - pb;
          if (b.severity !== a.severity) return b.severity - a.severity;
          if (b.anomCount !== a.anomCount) return b.anomCount - a.anomCount;
          return xlsxRouteDisplay(a.route).localeCompare(xlsxRouteDisplay(b.route), 'th');
        });

        const grouped = {};
        routeCases.forEach(item => {
          const customer = item.route.customer || '-';
          if (!grouped[customer]) grouped[customer] = [];
          grouped[customer].push(item);
        });

        Object.entries(grouped).forEach(([customer, items]) => {
          const routes = items.map(item => item.route || {});
          const trips = routes.reduce((sum, r) => sum + (r.trips || 0), 0);
          const recv = routes.reduce((sum, r) => sum + (r.recv || 0), 0);
          const pay = routes.reduce((sum, r) => sum + (r.pay || 0), 0);
          const oil = routes.reduce((sum, r) => sum + (r.oil || 0), 0);
          const margin = routes.reduce((sum, r) => sum + (r.margin || 0), 0);
          const anoms = items.reduce((sum, item) => sum + (item.anomCount || 0), 0);
          const customerRow = [
            cCell(customer, { bold: true, fill: 'DBEAFE' }),
            cCell(routes.length + ' เส้นทาง · ' + trips + ' เที่ยว · ' + (anoms ? anoms + ' รายการผิดปกติ' : 'ข้อมูลไม่เปลี่ยนแปลง'), { bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }), cCell('', { fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' }),
            cCell(oil, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(recv, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            cCell(pay, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            margin < 0 ? rCell(margin, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }) : gCell(margin, { numFmt: nTHB, align: 'right', bold: true, fill: 'DBEAFE' }),
            anoms ? rCell(anoms + ' รายการผิดปกติ', { fill: 'DBEAFE', bold: true }) : gCell('ข้อมูลไม่เปลี่ยนแปลง', { fill: 'DBEAFE', bold: true })
          ];
          wsData.push(customerRow);
          rowIdx++;

          items.forEach(item => {
            const route = item.route || {};
            const routeFill = item.anomCount > 0 ? 'FEF2F2' : 'ECFDF5';
            const routeRow = [
              cCell(route.customer || '-', { fill: routeFill, bold: true }),
              cCell(routeGroupHeaderDisplay(route), { fill: routeFill, bold: true }),
              cCell('รวม ' + (item.rows || []).length + ' เที่ยว', { fill: routeFill }),
              cCell('', { fill: routeFill }),
              cCell(route.vtype || '-', { fill: routeFill, bold: true }),
              cCell('', { fill: routeFill }),
              cCell('', { fill: routeFill }),
              cCell(route.oil || 0, { numFmt: nTHB, align: 'right', fill: routeFill }),
              cCell(route.recv || 0, { numFmt: nTHB, align: 'right', fill: routeFill }),
              cCell(route.pay || 0, { numFmt: nTHB, align: 'right', fill: routeFill }),
              (route.margin || 0) < 0 ? rCell(route.margin || 0, { numFmt: nTHB, align: 'right', fill: routeFill }) : gCell(route.margin || 0, { numFmt: nTHB, align: 'right', fill: routeFill }),
              statusStyledCell(item.statuses.length ? item.statuses : ['normal'], { fill: routeFill })
            ];
            wsData.push(routeRow);
            rowIdx++;

            (item.rows || []).forEach(entry => {
              const r = entry.ra || {};
              const margin = hasNum(r.margin) ? r.margin : ((r.recv || 0) - (r.pay || 0) - (r.oil || 0));
              const oilPrice = getOilPriceByDate(r.date);
              const zf = (rowIdx % 2 === 0) ? 'F9FAFB' : null;
              wsData.push([
                cCell(r.customer || '-', { fill: zf }),
                cCell(xlsxRouteDisplay(r), { fill: zf }),
                cCell(r.date || '-', { fill: zf }),
                cCell(r.driver || '-', { fill: zf }),
                cCell(r.vtype || '-', { fill: zf }),
                cCell(r.plate || '-', { fill: zf }),
                hasNum(oilPrice) ? cCell(oilPrice, { numFmt: nTHB, align: 'right', fill: zf }) : cCell('-', { align: 'right', fill: zf }),
                cCell(r.oil || 0, { numFmt: nTHB, align: 'right', fill: zf }),
                cCell(r.recv || 0, { numFmt: nTHB, align: 'right', fill: zf }),
                cCell(r.pay || 0, { numFmt: nTHB, align: 'right', fill: zf }),
                margin < 0 ? rCell(margin, { numFmt: nTHB, align: 'right', fill: zf }) : gCell(margin, { numFmt: nTHB, align: 'right', fill: zf }),
                statusStyledCell(entry.statuses || ['normal'], { fill: zf })
              ]);
              rowIdx++;
            });
          });
        });

        if (!routeCases.length) {
          const noData = [mCell('ไม่พบข้อมูลตามเงื่อนไขที่เลือก', { align: 'center', bold: true })];
          for (let i = 1; i < headers.length; i++) noData.push(cCell(''));
          wsData.push(noData);
        }

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 34 }];
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } }
        ];
        ws['!autofilter'] = { ref: 'A5:' + XLSX.utils.encode_cell({ c: headers.length - 1, r: 4 }) };
        ws['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };
        return ws;
      }

      function buildAnomalyExportCards(stA, stB) {
        const matchedCards = (typeof dcQaBuildAnomalyCards === 'function' ? dcQaBuildAnomalyCards(stA, stB) : []);
        const noRefCards = (typeof dcQaBuildCompareNoRefCards === 'function' ? dcQaBuildCompareNoRefCards(stA, stB) : []);
        return [...matchedCards, ...noRefCards]
          .map(card => ({ ...card, rows: card.anomRows || [] }))
          .filter(card => (card.rows || []).length > 0);
      }

      function buildUnmatchedExportCards(myRows, opRows) {
        const mySt = { rows: myRows || [] };
        const opSt = { rows: opRows || [] };
        return (typeof dcQaBuildUnmatchedCards === 'function' ? dcQaBuildUnmatchedCards(mySt, opSt, 'a') : [])
          .map(card => ({ ...card, rows: card.unRows || [] }));
      }

      function buildUnmatchedSheet(cards, sheetTitle, myPeriodLabel, otherPeriodLabel, statusSelectedRaw) {
        const wsData = [];
        const headers = [
          'ลูกค้า', 'ชื่อเส้นทาง', 'วันที่', 'พขร.', 'ประเภทรถ', 'ทะเบียน',
          'ราคาน้ำมัน', 'สำรองน้ำมัน', 'ราคารับ', 'ราคาจ่าย', 'ส่วนต่าง', 'ความผิดปกติ', 'หมายเหตุ'
        ];
        const titleRowUnm = [tCell(sheetTitle)];
        for (let i = 1; i < headers.length; i++) titleRowUnm.push(tCell(''));
        wsData.push(titleRowUnm);
        wsData.push([cCell(filterSummaryText() + ' | หน้าที่ส่งออก: ' + sheetTitle, { color: '6B7280', sz: 9 })]);
        wsData.push([cCell('สถานะที่เลือก: ' + formatStatusLabels(statusSelectedRaw || []) + ' | ส่งออกเฉพาะข้อมูลที่ผ่านตัวกรองบนหน้าจอ', { color: '374151', sz: 9 })]);
        wsData.push([cCell('ช่วงข้อมูลหลัก: ' + myPeriodLabel + ' | ช่วงข้อมูลเปรียบเทียบ: ' + otherPeriodLabel + ' | (เที่ยวที่ไม่มีคู่เปรียบเทียบในอีกช่วง)', { color: '374151', sz: 9 })]);
        wsData.push([]);
        const headerRow = wsData.length;
        wsData.push(headers.map(t => hCell(t)));
        let rowIdx = headerRow + 1;
        const unmGroupHeaderRows = [];

        cards.forEach(card => {
          // Group header: A=customer, B=route, C+D='ประเภทรถ: <vtype>', E+F='ต้องตรวจสอบ N เที่ยว'
          const cardAnomCount = (card.rows || []).filter(r => dcQaHasAnomalyStatus(r.statuses)).length;
          const summaryText = cardAnomCount > 0
            ? 'ต้องตรวจสอบ ' + cardAnomCount + ' เที่ยว'
            : 'รวม ' + (card.rows || []).length + ' เที่ยว';
          const top = [
            cCell(card.ga.customer || '-', { bold: true, fill: 'DBEAFE' }),
            cCell(routeGroupHeaderDisplay(card.ga), { bold: true, fill: 'DBEAFE' }),
            cCell('ประเภทรถ: ' + (card.ga.vtype || '-'), { bold: true, fill: 'DBEAFE', wrap: false }),
            cCell('', { fill: 'DBEAFE' }),   // D — merged with C
            cCell(summaryText, { bold: true, fill: 'DBEAFE' }),
            cCell('', { fill: 'DBEAFE' })    // F — merged with E
          ];
          while (top.length < headers.length) top.push(cCell('', { fill: 'DBEAFE' }));
          unmGroupHeaderRows.push(wsData.length);
          wsData.push(top);
          rowIdx++;

          (card.rows || []).forEach(entry => {
            const r = entry.ra || {};
            const mar = (r.margin == null || isNaN(r.margin)) ? ((r.recv || 0) - (r.pay || 0) - (r.oil || 0)) : r.margin;
            const oilPrice = getOilPriceByDate(r.date);
            const statuses = entry.statuses || ['normal'];
            const zf = (rowIdx % 2 === 0) ? 'F9FAFB' : null;
            const row = [
              cCell(r.customer || '-', { fill: zf }),
              cCell(xlsxRouteDisplay(r), { fill: zf }),
              cCell(r.date || '-', { fill: zf }),
              cCell(r.driver || '-', { fill: zf }),
              cCell(r.vtype || '-', { fill: zf }),
              cCell(r.plate || '-', { fill: zf }),
              hasNum(oilPrice) ? cCell(fmtMoney(oilPrice), { align: 'right', fill: zf }) : cCell('-', { align: 'right', fill: zf }),
              cCell(fmtMoney(r.oil), { align: 'right', fill: zf }),
              cCell(fmtMoney(r.recv), { align: 'right', fill: zf }),
              cCell(fmtMoney(r.pay), { align: 'right', fill: zf }),
              mar < 0 ? rCell(fmtMoney(mar), { align: 'right', fill: zf }) : gCell(fmtMoney(mar), { align: 'right', fill: zf }),
              statusRichCell(statuses, { fill: zf, align: 'left', wrap: true, valign: 'top' }),
              cCell('', { fill: zf })
            ];
            wsData.push(row);
            rowIdx++;
          });
        });

        if (cards.length === 0) {
          const noData = [mCell('ไม่พบข้อมูลตามเงื่อนไขที่เลือก', { align: 'center', bold: true })];
          for (let i = 1; i < headers.length; i++) noData.push(cCell(''));
          wsData.push(noData);
        }

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        // Column widths: C+D merged in group header shows "ประเภทรถ: 6W7.2" (~18 chars),
        // so C needs wch:18 to avoid truncation when not merged (data rows show date).
        // B=route (~26), D=driver (~18), E=vtype — wch:10 so header "ประเภทรถ" fits on one line, F=plate (~12).
        ws['!cols'] = [
          { wch: 11 }, { wch: 26 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 12 },
          { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 14 }
        ];
        // Row heights: group headers = 20pt, data rows = proportional to status line count.
        const unmGroupHeaderSet = new Set(unmGroupHeaderRows);
        ws['!rows'] = wsData.map((rowData, idx) => {
          if (idx === 0) return { hpt: 32 };
          if (idx <= headerRow) return {};
          if (unmGroupHeaderSet.has(idx)) return { hpt: 20 };
          // Status cell is at col index 11 (col L).
          const statusCell = rowData[11];
          const statusLines = statusCell && statusCell.v
            ? String(statusCell.v).split('\n').length : 1;
          return { hpt: Math.max(statusLines * 14 + 6, 20) };
        });
        ws['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
          { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } },
          { s: { r: 3, c: 0 }, e: { r: 3, c: headers.length - 1 } },
          // Per-card group header: merge C+D (col 2-3) and E+F (col 4-5)
          ...unmGroupHeaderRows.flatMap(r => [
            { s: { r, c: 2 }, e: { r, c: 3 } },
            { s: { r, c: 4 }, e: { r, c: 5 } }
          ])
        ];
        ws['!autofilter'] = { ref: 'A6:' + XLSX.utils.encode_cell({ c: headers.length - 1, r: 5 }) };
        ws['!freeze'] = { xSplit: 0, ySplit: 6, topLeftCell: 'A7', activePane: 'bottomLeft', state: 'frozen' };
        return ws;
      }

      // Compute filter selections + filtered cards FIRST
      // Filter selections from UI status panels (so XLSX matches what user sees on screen).
      // Each panel uses the same option keys; if the user has nothing selected the helper
      // returns the full option list, so cards remain unfiltered by default.
      const exportStatusOptionKeys = ['loss', 'oil50', 'payHigh', 'recvLow', 'normal', 'noRef'];
      const exportLabelMap = qaStatusLabels();
      const anomalySelectedRaw = (typeof getSelectedCompareStatuses === 'function')
        ? getSelectedCompareStatuses('anomaly', exportStatusOptionKeys)
        : exportStatusOptionKeys;
      // Single-mode (normal view) status filter — controls which trips appear in the
      // "รายเส้นทางที่เปรียบเทียบ" sheet (mirrors the on-screen toggle behaviour).
      const normalSelectedRaw = (typeof getSelectedCompareStatuses === 'function')
        ? getSelectedCompareStatuses('normal', exportStatusOptionKeys)
        : exportStatusOptionKeys;
      const anomalySelectedSet = new Set(anomalySelectedRaw);
      const normalSelectedSet = new Set(normalSelectedRaw);
      const matchesStatusFilter = (card, selectedSet) => {
        const statuses = (card && Array.isArray(card.filterStatuses) && card.filterStatuses.length)
          ? card.filterStatuses
          : ((card && Array.isArray(card.statuses) && card.statuses.length) ? card.statuses : ['normal']);
        return statusesMatchFilterSet(statuses, selectedSet);
      };
      const formatStatusLabels = keys => {
        const list = (keys || []).map(k => exportLabelMap[k] || k);
        return list.length ? list.join(', ') : '-';
      };

      let buildSingleCases = null;
      let singleCases = [];
      let singleRefDaysList = [];
      if (_isSingleMode && _stA) {
        const refDays = Array.isArray(_stRef) ? _stRef : (_stRef ? [_stRef] : []);
        singleRefDaysList = refDays.map(st => fmtDate(st.dateStart));
        const refDayMaps = refDays.map(st => {
          const map = {};
          (st.rows || []).forEach(r => {
            const k = dcQaRouteKey(r);
            if (!map[k]) map[k] = [];
            map[k].push(r);
          });
          return { dateLabel: fmtDate(st.dateStart), map };
        });
        const getRefForRoute = (routeKey) => {
          for (const day of refDayMaps) {
            if (day.map[routeKey] && day.map[routeKey].length > 0) {
              return { trips: day.map[routeKey].slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))), dateLabel: day.dateLabel };
            }
          }
          return null;
        };
        buildSingleCases = () => {
          return (_stA.routes || []).map(route => {
            const trips = (_stA.rows || []).filter(r => r.customer === route.customer && routeIdentityKey(r) === routeIdentityKey(route) && r.vtype === route.vtype)
              .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
            const routeKey = trips.length > 0 ? dcQaRouteKey(trips[0]) : null;
            const refResult = routeKey ? getRefForRoute(routeKey) : null;
            const refTripsForRoute = refResult ? refResult.trips : [];
            const analyzedRows = trips.map(ra => {
              const peers = dcQaStatusPeersForTrip(ra, refTripsForRoute);
              const analysis = dcQaAnalyzeTrip(ra, peers, null);
              return {
                ra,
                statuses: analysis.statuses,
                infoStatuses: analysis.infoStatuses,
                matchedRefTrip: analysis.matchedRefTrip
              };
            })
              .sort((a, b) => {
                const rankA = dcQaStatusRank(a.statuses);
                const rankB = dcQaStatusRank(b.statuses);
                if (rankB !== rankA) return rankB - rankA;
                return String(a.ra.date || '').localeCompare(String(b.ra.date || ''));
              });
            const attachResult = dcQaAttachMatchedRefTrips(analyzedRows, refTripsForRoute);
            const pairPatternCtx = dcQaBuildPairPatternContext(
              (attachResult.entries || []).filter(entry => entry?.ra && entry?.matchedRefTrip).map(entry => ({
                ra: entry.ra,
                rb: entry.matchedRefTrip
              }))
            );
            const rows = attachResult.entries.map(entry => {
              const displayedPeer = entry?.matchedRefTrip || null;
              if (!displayedPeer) {
                return {
                  ...entry,
                  pairScopedStatuses: entry?.statuses || ['normal'],
                  pairScopedInfoStatuses: entry?.infoStatuses || []
                };
              }
              const pairScopedAnalysis = dcQaAnalyzeMatchedPair(entry.ra || {}, displayedPeer, pairPatternCtx, { includePeerIntrinsic: false });
              return {
                ...entry,
                statuses: pairScopedAnalysis.statuses || entry?.statuses || ['normal'],
                infoStatuses: pairScopedAnalysis.infoStatuses || entry?.infoStatuses || [],
                pairScopedStatuses: pairScopedAnalysis.statuses || entry?.statuses || ['normal'],
                pairScopedInfoStatuses: pairScopedAnalysis.infoStatuses || entry?.infoStatuses || []
              };
            });
            const basePatternRows = rows.filter(row => !dcQaHasAnomalyStatus(row.statuses) && (row.infoStatuses || []).length).map(row => ({
              ra: row.ra,
              statuses: row.statuses || ['normal'],
              infoStatuses: row.infoStatuses || [],
              matchedRefTrip: row.matchedRefTrip || null
            }));
            const previewRows = rows.filter(dcQaShouldDisplayPrimaryRow);
            const filterStatuses = dcQaCollectDisplayStatuses(rows);
            return {
              route,
              rows,
              previewRows,
              filterStatuses,
              basePatternRows,
              basePatternCount: basePatternRows.length,
              leftoverRefTrips: attachResult.leftoverRefTrips || [],
              refTripsForRoute,
              refDateLabel: refResult ? refResult.dateLabel : null
            };
          }).sort((a, b) => {
            const ca = String(a.route.customer || '').trim().toUpperCase();
            const cb = String(b.route.customer || '').trim().toUpperCase();
            const pa = custOrder[ca] ?? 999;
            const pb = custOrder[cb] ?? 999;
            if (pa !== pb) return pa - pb;
            return xlsxRouteDisplay(a.route).localeCompare(xlsxRouteDisplay(b.route), 'th');
          });
        };
        singleCases = buildSingleCases();
      }

      // Pre-compute filtered cards (used by both Sheet 1 summary and per-view sheets).
      let anomalyCardsAll = [], anomalyCards = [];
      if (!_isSingleMode && _stA) {
        anomalyCardsAll = buildAnomalyExportCards(_stA, _stB || { rows: [] });
        anomalyCards = anomalyCardsAll.filter(card => matchesStatusFilter(card, anomalySelectedSet));
      }

      const sumAnomalyPairs = anomalyCards.reduce((s, c) => s + (c.rows || []).length, 0);
      const sumAnomalyAnoms = anomalyCards.reduce((s, c) => s + (c.rows || []).filter(r => dcQaHasAnomalyStatus(r.statuses)).length, 0);
      const qaCheckboxStatusSheetConfigs = [
        { key: 'loss', name: 'ขาดทุน' },
        { key: 'oil50', name: 'สำรองน้ำมัน > 50%' },
        { key: 'payHigh', name: 'ราคาจ่ายผิดปกติ' },
        { key: 'recvLow', name: 'ราคารับผิดปกติ' }
      ];
      const qaCheckboxSheetNames = new Set(qaCheckboxStatusSheetConfigs.map(s => s.name));
      const qaSourceSheetByStatusKey = {
        loss: qaCheckboxStatusSheetConfigs[0].name,
        oil50: qaCheckboxStatusSheetConfigs[1].name,
        payHigh: qaCheckboxStatusSheetConfigs[2].name,
        payOilChanged: qaCheckboxStatusSheetConfigs[2].name,
        recvLow: qaCheckboxStatusSheetConfigs[3].name,
        recvOilChanged: qaCheckboxStatusSheetConfigs[3].name
      };
      const qaTrackedStatusKeys = ['loss', 'oil50', 'payHigh', 'payOilChanged', 'recvLow', 'recvOilChanged'];
      const qaTrackedStatusConfigs = () => {
        const labels = qaStatusLabels();
        return qaTrackedStatusKeys.map(key => ({
          key,
          name: labels[key] || key,
          sourceSheet: qaSourceSheetByStatusKey[key]
        }));
      };
      const qaCheckboxHeaders = ['โปร', 'ดันราคา/หารถไม่ได้'];
      const qaCheckboxCells = fill => qaCheckboxHeaders.map(() => cCell('☐', { fill, align: 'center', sz: 11 }));
      const qaFormulaSheetName = name => "'" + String(name || '').replace(/'/g, "''") + "'";
      const qaFormulaRange = (sheetName, col) => `${qaFormulaSheetName(sheetName)}!$${col}$4:$${col}$5000`;
      const qaFormulaMeta = _isSingleMode
        ? { routeTypeCol: 'E', statusCol: 'L', qaCols: ['M', 'N'] }
        : { routeTypeCol: 'F', statusCol: 'M', qaCols: ['N', 'O'] };
      const qaHelperSheetName = 'Helper_ตรวจสอบ';
      const qaHelperRows = [];
      const qaHelperSheet = qaFormulaSheetName(qaHelperSheetName);
      const qaHelperRange = col => `${qaHelperSheet}!$${col}$2:$${col}$5000`;
      const qaStatusTotalRoutesFormula = statusName => `COUNTIF(${qaHelperRange('B')},"${statusName}")`;
      const qaStatusCheckedRoutesFormula = statusName => `SUMIF(${qaHelperRange('B')},"${statusName}",${qaHelperRange('G')})`;
      const qaStatusCheckedRowsFormula = statusName => `SUMIF(${qaHelperRange('B')},"${statusName}",${qaHelperRange('H')})`;
      const qaStatusReasonFormula = (statusName, helperCol) => `SUMIF(${qaHelperRange('B')},"${statusName}",${qaHelperRange(helperCol)})`;
      const qaStatusTotalRowsFormula = statusName => `SUMIF(${qaHelperRange('B')},"${statusName}",${qaHelperRange('K')})`;
      const qaAllTotalRoutesFormula = () => `COUNTA(${qaHelperRange('F')})`;
      const qaAllCheckedRoutesFormula = () => `SUM(${qaHelperRange('G')})`;
      const qaAllCheckedRowsFormula = () => `SUM(${qaHelperRange('H')})`;
      const qaAllReasonFormula = helperCol => `SUM(${qaHelperRange(helperCol)})`;
      const qaAllTotalRowsFormula = () => `SUM(${qaHelperRange('K')})`;
      const addQaHelperRoute = (sheetName, statusKey, customer, route, vtype) => {
        if (!qaCheckboxSheetNames.has(sheetName)) return;
        const trackedSourceSheet = qaSourceSheetByStatusKey[statusKey];
        if (trackedSourceSheet !== sheetName) return;
        const labels = qaStatusLabels();
        const statusName = labels[statusKey] || statusKey;
        const key = [sheetName, statusName, customer || '-', route || '-', vtype || '-'].join('|');
        if (qaHelperRows.some(row => row.key === key)) return;
        qaHelperRows.push({ key, sheetName, statusKey, statusName, customer: customer || '-', route: route || '-', vtype: vtype || '-' });
      };

      // ─── Sheet 1: สรุปผลดำเนินงาน (template-driven) ─────────────────────────────
      const ws1Data = [];
      const ws1TitleRow = [tCell('รายงานวิเคราะห์และเปรียบเทียบผลการดำเนินงาน'), tCell(''), tCell(''), tCell('')];
      if (_isSingleMode) ws1TitleRow.push(tCell(''));
      ws1Data.push(ws1TitleRow);
      ws1Data.push([]);

      if (_isSingleMode) {
        // Compute single-mode breakdown using the same logic as renderSingleTable.
        // We need: total routes, total trips, anomaly count, per-status counts, ref days.
        // Walk the same cases/rows used by the single-mode export sheets so summary
        // and detail sheets are based on the exact same displayed pairs.
        const statusCount = { loss: 0, oil50: 0, payHigh: 0, payOilChanged: 0, recvLow: 0, recvOilChanged: 0, normal: 0, noRef: 0 };
        const statusImpact = { loss: 0, oil50: 0, payHigh: 0, payOilChanged: 0, recvLow: 0, recvOilChanged: 0 };
        let totalAnomCount = 0;
        const routesWithRefCount = singleCases.filter(item => (item.refTripsForRoute || []).length > 0).length;
        const calcMarginValue = trip => hasNum(trip?.margin)
          ? Number(trip.margin)
          : ((Number(trip?.recv) || 0) - (Number(trip?.pay) || 0) - (Number(trip?.oil) || 0));
        const calcOilReserveExcess = trip => {
          const pay = Number(trip?.pay) || 0;
          const oil = Number(trip?.oil) || 0;
          if (pay <= 0) return 0;
          return Math.max(oil - (pay * 0.5), 0);
        };
        const absPairDiff = (a, b) => (hasNum(a) && hasNum(b)) ? Math.abs(Number(a) - Number(b)) : 0;
        singleCases.forEach(item => {
          (item.rows || []).forEach(entry => {
            if (!dcQaShouldDisplayPrimaryRow(entry)) return;
            const ra = entry.ra || {};
            const statuses = entry.statuses || [];
            const cleaned = statuses.some(s => s !== 'normal') ? statuses.filter(s => s !== 'normal') : statuses;
            const pairScopedStatuses = entry.pairScopedStatuses || statuses || ['normal'];
            const pairScopedCleaned = pairScopedStatuses.some(s => s !== 'normal') ? pairScopedStatuses.filter(s => s !== 'normal') : pairScopedStatuses;
            if (cleaned.includes('normal')) statusCount.normal++;
            else if (dcQaHasAnomalyStatus(cleaned)) totalAnomCount++;
            if (cleaned.includes('loss')) statusCount.loss++;
            if (cleaned.includes('oil50')) statusCount.oil50++;
            if (pairScopedCleaned.includes('payHigh')) statusCount.payHigh++;
            if (pairScopedCleaned.includes('payOilChanged')) statusCount.payOilChanged++;
            if (pairScopedCleaned.includes('recvLow')) statusCount.recvLow++;
            if (pairScopedCleaned.includes('recvOilChanged')) statusCount.recvOilChanged++;
            if (cleaned.includes('noRef')) statusCount.noRef++;
            if (cleaned.includes('loss')) statusImpact.loss += Math.abs(Math.min(calcMarginValue(ra), 0));
            if (cleaned.includes('oil50')) statusImpact.oil50 += calcOilReserveExcess(ra);
            const displayedPeer = entry.matchedRefTrip || null;
            if (pairScopedCleaned.includes('payHigh')) {
              statusImpact.payHigh += absPairDiff(ra?.pay, displayedPeer?.pay);
            }
            if (pairScopedCleaned.includes('payOilChanged')) {
              statusImpact.payOilChanged += absPairDiff(ra?.pay, displayedPeer?.pay);
            }
            if (pairScopedCleaned.includes('recvLow')) {
              statusImpact.recvLow += absPairDiff(ra?.recv, displayedPeer?.recv);
            }
            if (pairScopedCleaned.includes('recvOilChanged')) {
              statusImpact.recvOilChanged += absPairDiff(ra?.recv, displayedPeer?.recv);
            }
          });
        });

        const [y, m, d] = _stA.dateStart.split('-').map(Number);
        const getDayNum = (offset) => {
          const dt = new Date(y, m - 1, d - offset);
          return dt.getDate();
        };
        const d1 = getDayNum(1);
        const d2 = getDayNum(2);
        const d3 = getDayNum(3);

        // Section 1: Overview
        ws1Data.push([hCell('รายการ'), hCell('ค่า'), hCell(''), hCell(''), hCell('')]);
        const overview = [
          [cCell('ช่วงเวลาหลัก', { bold: true }), cCell(periodALabel), cCell(''), cCell(''), cCell('')],
          [cCell('วันอ้างอิงเพื่อเปรียบเทียบ (ย้อนหลัง 3 วัน)', { bold: true }), cCell(singleRefDaysList.length ? singleRefDaysList.join(', ') + ` (เปรียบเทียบเที่ยววิ่งอดีต: เริ่มหาจากวันที่ ${d1} -> ไม่มีข้อมูล -> หาที่วันที่ ${d2} -> ไม่มีข้อมูล -> หาที่วันที่ ${d3})` : 'ไม่พบข้อมูลย้อนหลัง', { wrap: true }), cCell(''), cCell(''), cCell('')],
          [cCell('จำนวนเส้นทาง', { bold: true }), cCell((_stA.routes || []).length, { numFmt: '#,##0', align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('เส้นทางที่มีข้อมูลเปรียบเทียบ', { bold: true }), cCell(routesWithRefCount, { numFmt: '#,##0', align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('จำนวนเที่ยว', { bold: true }), cCell(_stA.trips || 0, { numFmt: '#,##0', align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('จำนวนรายการที่มีความผิดปกติ', { bold: true }), totalAnomCount > 0 ? rCell(totalAnomCount, { numFmt: '#,##0', align: 'right' }) : gCell(totalAnomCount, { numFmt: '#,##0', align: 'right' }), cCell(''), cCell(''), cCell('')]
        ];
        overview.forEach(r => ws1Data.push(r));

        // Section 2: Financial summary
        ws1Data.push([]);
        ws1Data.push([cCell('สรุปการเงิน', { bold: true, sz: 11, color: '111827' }), cCell(''), cCell(''), cCell(''), cCell('')]);
        const financial = [
          [cCell('ราคารับรวม', { bold: true }), cCell(fmtNum(_stA.recv), { numFmt: nTHB, align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('ราคาจ่ายรวม', { bold: true }), cCell(fmtNum(_stA.pay), { numFmt: nTHB, align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('สำรองน้ำมันรวม', { bold: true }), cCell(fmtNum(_stA.oil), { numFmt: nTHB, align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('ส่วนต่างรวม', { bold: true }), _stA.margin < 0 ? rCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }), cCell(''), cCell(''), cCell('')],
          [cCell('กำไร %', { bold: true }), cCell((_stA.pct || 0) / 100, { numFmt: nPct, align: 'right' }), cCell(''), cCell(''), cCell('')]
        ];
        financial.forEach(r => ws1Data.push(r));

        // Section 3: Anomaly breakdown by status
        ws1Data.push([]);
        ws1Data.push([cCell('แยกตามสถานะที่ตรวจพบ', { bold: true, sz: 11, color: '111827' }), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([cCell('หมายเหตุ: 1 เที่ยวอาจพบได้มากกว่า 1 สถานะ จึงทำให้ผลรวมของสัดส่วนต่อเที่ยวทั้งหมดมากกว่า 100% ได้', { color: '6B7280', wrap: true }), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([hCell('สถานะ'), hCell('จำนวนเที่ยว'), hCell('สัดส่วนต่อเที่ยวทั้งหมด'), hCell('รายงานการเงิน (บาท)'), hCell('หมายเหตุ')]);
        const totalForPct = _stA.trips || 0;
        const pctOf = (n) => totalForPct > 0 ? n / totalForPct : 0;
        const impactNoteMap = {
          loss: 'รวมมูลค่าขาดทุนจากเที่ยวที่ส่วนต่างติดลบ (คำนวณจากค่าส่วนต่างที่ติดลบของแต่ละเที่ยว)',
          oil50: 'รวมเฉพาะส่วนที่สำรองน้ำมันเกิน 50% ของราคาจ่าย (คำนวณจากสำรองน้ำมัน - 50% ของราคาจ่าย)',
          payHigh: 'รวมผลต่างราคาจ่ายระหว่างวันที่หลักกับวันที่อ้างอิง (คำนวณจากผลต่างระหว่างราคาจ่ายวันที่หลักและวันที่อ้างอิง)',
          payOilChanged: 'รวมผลต่างราคาจ่ายของคู่ที่ราคาน้ำมันเปลี่ยนแปลง (คำนวณจากผลต่างระหว่างราคาจ่ายวันที่หลักและวันที่อ้างอิง)',
          recvLow: 'รวมผลต่างราคารับระหว่างวันที่หลักกับวันที่อ้างอิง (คำนวณจากผลต่างระหว่างราคารับวันที่หลักและวันที่อ้างอิง)',
          recvOilChanged: 'รวมผลต่างราคารับของคู่ที่ราคาน้ำมันเปลี่ยนแปลง (คำนวณจากผลต่างระหว่างราคารับวันที่หลักและวันที่อ้างอิง)',
          normal: '-',
          noRef: '-'
        };
        const impactCellFor = key => {
          if (key === 'normal' || key === 'noRef') return mCell('-', { align: 'center' });
          const rawAmount = Number(statusImpact[key] || 0);
          const amount = fmtNum(rawAmount);
          return amount > 0
            ? cCell(amount, { numFmt: nTHB, align: 'right' })
            : cCell(0, { numFmt: nTHB, align: 'right' });
        };
        const breakdown = [
          ['ขาดทุน', statusCount.loss, 'loss'],
          ['สำรองน้ำมัน > 50%', statusCount.oil50, 'oil50'],
          ['ราคาจ่ายผิดปกติ', statusCount.payHigh, 'payHigh'],
          ['ราคาจ่ายเปลี่ยนแปลงตามราคาน้ำมัน', statusCount.payOilChanged, 'payOilChanged'],
          ['ราคารับผิดปกติ', statusCount.recvLow, 'recvLow'],
          ['ราคารับเปลี่ยนแปลงตามราคาน้ำมัน', statusCount.recvOilChanged, 'recvOilChanged'],
          ['ข้อมูลไม่เปลี่ยนแปลง', statusCount.normal, 'normal'],
          ['ไม่มีข้อมูลเปรียบเทียบ', statusCount.noRef, 'noRef']
        ];
        breakdown.forEach(([label, count, key]) => {
          const isInfoImpactStatus = key === 'payOilChanged' || key === 'recvOilChanged';
          const valueCell = key === 'normal'
            ? gCell(count, { numFmt: '#,##0', align: 'right' })
            : key === 'noRef'
              ? mCell(count, { numFmt: '#,##0', align: 'right' })
            : isInfoImpactStatus
              ? cCell(count, { numFmt: '#,##0', align: 'right' })
              : (count > 0 ? rCell(count, { numFmt: '#,##0', align: 'right' }) : cCell(count, { numFmt: '#,##0', align: 'right' }));
          ws1Data.push([
            cCell(label, { bold: true }),
            valueCell,
            cCell(pctOf(count), { numFmt: nPct, align: 'right' }),
            impactCellFor(key),
            cCell(impactNoteMap[key] || '-', { wrap: false, color: key === 'normal' || key === 'noRef' ? '6B7280' : '374151' })
          ]);
        });
        const visualStatusColors = {
          loss: 'DC2626',
          oil50: 'D97706',
          payHigh: '7C3AED',
          payOilChanged: 'DB2777',
          recvLow: '2563EB',
          recvOilChanged: '0891B2',
          normal: '059669',
          noRef: '64748B'
        };
        const visualBarCell = (pct, key) => {
          const safePct = Math.max(0, Math.min(Number(pct) || 0, 1));
          const totalBlocks = 24;
          const filledBlocks = Math.round(safePct * totalBlocks);
          const bar = '█'.repeat(filledBlocks) + '░'.repeat(totalBlocks - filledBlocks);
          return cCell(bar, { color: visualStatusColors[key] || '374151', sz: 9 });
        };
        const pushVisualStatusBlock = (title, rows, denominator) => {
          ws1Data.push([cCell(title, { bold: true, sz: 10, color: '111827', fill: 'E5E7EB' }), cCell(''), cCell(''), cCell(''), cCell('')]);
          ws1Data.push([hCell('ฐานการนับ'), hCell('สถานะ'), hCell('จำนวนเที่ยว'), hCell('สัดส่วน'), hCell('แถบสรุป')]);
          rows.forEach(row => {
            const pct = denominator > 0 ? row.count / denominator : 0;
            const countCell = row.key === 'normal'
              ? gCell(row.count, { numFmt: '#,##0', align: 'right' })
              : row.key === 'noRef'
                ? mCell(row.count, { numFmt: '#,##0', align: 'right' })
                : cCell(row.count, { numFmt: '#,##0', align: 'right', color: visualStatusColors[row.key] || '374151' });
            ws1Data.push([
              cCell(row.viewLabel, { color: '6B7280', sz: 9 }),
              cCell(row.label, { bold: true, color: visualStatusColors[row.key] || '111827' }),
              countCell,
              cCell(pct, { numFmt: nPct, align: 'right' }),
              visualBarCell(pct, row.key)
            ]);
          });
        };
        const statusVisualRows = breakdown.map(([label, count, key]) => ({
          viewLabel: 'นับทุกสถานะที่พบ',
          label,
          count: Number(count) || 0,
          key
        }));
        ws1Data.push([]);
        ws1Data.push([cCell('สรุปเชิงภาพ', { bold: true, sz: 11, color: '111827' }), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([cCell('สรุปตามสถานะ/tag ที่ตรวจพบ เพื่อใช้ตรวจเทียบกับชีทแยกและคอลัมน์ความผิดปกติในไฟล์เดียวกัน', { color: '6B7280', sz: 9, wrap: true }), cCell(''), cCell(''), cCell(''), cCell('')]);
        pushVisualStatusBlock(
          'สัดส่วนต่อเที่ยวทั้งหมด',
          statusVisualRows,
          totalForPct
        );
        ws1Data.push([]);
        ws1Data.push([cCell('หมายเหตุการอ่านกราฟ: สัดส่วนอาจรวมเกิน 100% ได้ เพราะ 1 เที่ยวอาจพบได้มากกว่า 1 สถานะ', { color: '6B7280', sz: 9, wrap: true }), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([]);
        ws1Data.push([cCell('สรุปการตรวจสอบ', { bold: true, sz: 11, color: '111827' }), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([cCell('ผูกกับช่องตรวจสอบในชีท ขาดทุน, สำรองน้ำมัน > 50%, ราคาจ่ายผิดปกติ, ราคารับผิดปกติ โดยแยกนับตาม tag ที่ตรวจพบ รวมถึงราคาจ่าย/ราคารับเปลี่ยนแปลงตามราคาน้ำมัน', { color: '6B7280', sz: 9, wrap: true }), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([hCell('รายการ'), hCell('ค่า'), hCell(''), hCell(''), hCell(''), hCell(''), hCell(''), hCell(''), hCell('')]);
        const qaTotalRoutesFormula = qaAllTotalRoutesFormula();
        const qaTotalRowsFormula = qaAllTotalRowsFormula();
        const qaCheckedRoutesFormula = qaAllCheckedRoutesFormula();
        const qaCheckedRowsFormula = qaAllCheckedRowsFormula();
        const qaPromoFormula = qaAllReasonFormula('I');
        const qaPushOrNoCarFormula = qaAllReasonFormula('J');
        [
          ['งานตรวจสอบตามสถานะทั้งหมด', formulaCell(qaTotalRoutesFormula, { numFmt: '#,##0', align: 'right' })],
          ['จำนวนเที่ยวในสถานะทั้งหมด', formulaCell(qaTotalRowsFormula, { numFmt: '#,##0', align: 'right' })],
          ['ตรวจสอบแล้ว', formulaCell(qaCheckedRoutesFormula, { numFmt: '#,##0', align: 'right', color: '16A34A' })],
          ['ยังไม่เช็ค', formulaCell(`MAX((${qaTotalRoutesFormula})-(${qaCheckedRoutesFormula}),0)`, { numFmt: '#,##0', align: 'right', color: 'DC2626' })],
          ['% ความคืบหน้าการตรวจสอบ', formulaCell(`IFERROR((${qaCheckedRoutesFormula})/(${qaTotalRoutesFormula}),0)`, { numFmt: nPct, align: 'right' })],
          ['เที่ยวที่ตรวจสอบแล้ว', formulaCell(qaCheckedRowsFormula, { numFmt: '#,##0', align: 'right' })],
          ['โปร', formulaCell(qaPromoFormula, { numFmt: '#,##0', align: 'right' })],
          ['ดันราคา/หารถไม่ได้', formulaCell(qaPushOrNoCarFormula, { numFmt: '#,##0', align: 'right' })]
        ].forEach(([label, valueCell]) => {
          ws1Data.push([cCell(label, { bold: true }), valueCell, cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        });
        ws1Data.push([]);
        ws1Data.push([cCell('ความคืบหน้าการตรวจสอบแยกตามสถานะ', { bold: true, sz: 10, color: '111827', fill: 'E5E7EB' }), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([
          hCell('สถานะ', { wrap: false, sz: 10 }),
          hCell('งานตรวจสอบตามสถานะ', { wrap: false, sz: 10 }),
          hCell('เช็คแล้ว', { wrap: false, sz: 10 }),
          hCell('ยังไม่เช็ค', { wrap: false, sz: 10 }),
          hCell('% เช็คแล้ว', { wrap: false, sz: 10 }),
          hCell('จำนวนเที่ยวในสถานะ', { wrap: false, sz: 10 }),
          hCell('เที่ยวที่เช็คแล้ว', { wrap: false, sz: 10 }),
          hCell('โปร', { wrap: false, sz: 10 }),
          hCell('ดันราคา/หารถไม่ได้', { wrap: false, sz: 10 }),
        ]);
        qaTrackedStatusConfigs().forEach(config => {
          const totalRoutesFormula = qaStatusTotalRoutesFormula(config.name);
          const checkedRoutesFormula = qaStatusCheckedRoutesFormula(config.name);
          ws1Data.push([
            cCell(config.name, { bold: true }),
            formulaCell(totalRoutesFormula, { numFmt: '#,##0', align: 'right' }),
            formulaCell(checkedRoutesFormula, { numFmt: '#,##0', align: 'right', color: '16A34A' }),
            formulaCell(`MAX((${totalRoutesFormula})-(${checkedRoutesFormula}),0)`, { numFmt: '#,##0', align: 'right', color: 'DC2626' }),
            formulaCell(`IFERROR((${checkedRoutesFormula})/(${totalRoutesFormula}),0)`, { numFmt: nPct, align: 'right' }),
            formulaCell(qaStatusTotalRowsFormula(config.name), { numFmt: '#,##0', align: 'right' }),
            formulaCell(qaStatusCheckedRowsFormula(config.name), { numFmt: '#,##0', align: 'right' }),
            formulaCell(qaStatusReasonFormula(config.name, 'I'), { numFmt: '#,##0', align: 'right' }),
            formulaCell(qaStatusReasonFormula(config.name, 'J'), { numFmt: '#,##0', align: 'right' })
          ]);
        });
      } else {
        ws1Data.push([hCell('รายการ'), hCell(periodALabel), hCell(periodBLabel), hCell('ผลต่าง (' + periodALabel + ' - ' + periodBLabel + ')')]);
        const dR = _stA.recv - _stB.recv, dP = _stA.pay - _stB.pay, dO = _stA.oil - _stB.oil, dM = _stA.margin - _stB.margin;
        const dT = (_stA.trips || 0) - (_stB.trips || 0);
        const dPct = ((_stA.pct || 0) - (_stB.pct || 0)) / 100;
        // Counts derived from filter-applied sheets so user sees what they actually exported.
        const totalRoutesExported = anomalyCards.length;
        const totalAnomCount = sumAnomalyAnoms;
        const rows = [
          [cCell('จำนวนเส้นทางที่ส่งออก', { bold: true }), cCell(totalRoutesExported, { numFmt: '#,##0', align: 'right' }), cCell('-', { align: 'right' }), cCell('-', { align: 'right' })],
          [cCell('จำนวนคู่/เที่ยวที่ส่งออก', { bold: true }), cCell(sumAnomalyPairs, { numFmt: '#,##0', align: 'right' }), cCell(sumAnomalyPairs, { numFmt: '#,##0', align: 'right' }), cCell('-', { align: 'right' })],
          [cCell('จำนวนรายการที่มีความผิดปกติ', { bold: true }), cCell(totalAnomCount, { numFmt: '#,##0', align: 'right' }), cCell('-', { align: 'right' }), cCell('-', { align: 'right' })],
          [cCell('จำนวนเที่ยว (รวมทั้งช่วง)', { bold: true }), cCell(_stA.trips, { numFmt: '#,##0', align: 'right' }), cCell(_stB.trips, { numFmt: '#,##0', align: 'right' }), gCell(dT, { numFmt: '#,##0', align: 'right' })],
          [cCell('ราคารับรวม', { bold: true }), cCell(fmtNum(_stA.recv), { numFmt: nTHB, align: 'right' }), cCell(fmtNum(_stB.recv), { numFmt: nTHB, align: 'right' }), dR < 0 ? rCell(fmtNum(dR), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dR), { numFmt: nTHB, align: 'right' })],
          [cCell('ราคาจ่ายรวม', { bold: true }), cCell(fmtNum(_stA.pay), { numFmt: nTHB, align: 'right' }), cCell(fmtNum(_stB.pay), { numFmt: nTHB, align: 'right' }), dP < 0 ? rCell(fmtNum(dP), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dP), { numFmt: nTHB, align: 'right' })],
          [cCell('สำรองน้ำมันรวม', { bold: true }), cCell(fmtNum(_stA.oil), { numFmt: nTHB, align: 'right' }), cCell(fmtNum(_stB.oil), { numFmt: nTHB, align: 'right' }), dO < 0 ? rCell(fmtNum(dO), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dO), { numFmt: nTHB, align: 'right' })],
          [cCell('ส่วนต่างรวม', { bold: true }), _stA.margin < 0 ? rCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(_stA.margin), { numFmt: nTHB, align: 'right' }), _stB.margin < 0 ? rCell(fmtNum(_stB.margin), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(_stB.margin), { numFmt: nTHB, align: 'right' }), dM < 0 ? rCell(fmtNum(dM), { numFmt: nTHB, align: 'right' }) : gCell(fmtNum(dM), { numFmt: nTHB, align: 'right' })],
          [cCell('กำไร %', { bold: true }), cCell(_stA.pct / 100, { numFmt: nPct, align: 'right' }), cCell(_stB.pct / 100, { numFmt: nPct, align: 'right' }), dPct < 0 ? rCell(dPct, { numFmt: nPct, align: 'right' }) : gCell(dPct, { numFmt: nPct, align: 'right' })]
        ];
        rows.forEach(r => ws1Data.push(r));
        ws1Data.push([]);
        ws1Data.push([cCell('สรุปการตรวจสอบ', { bold: true, sz: 11, color: '111827' }), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([cCell('ผูกกับช่องตรวจสอบในชีท ขาดทุน, สำรองน้ำมัน > 50%, ราคาจ่ายผิดปกติ, ราคารับผิดปกติ โดยแยกนับตาม tag ที่ตรวจพบ รวมถึงราคาจ่าย/ราคารับเปลี่ยนแปลงตามราคาน้ำมัน', { color: '6B7280', sz: 9, wrap: true }), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([hCell('รายการ'), hCell('ค่า'), hCell(''), hCell(''), hCell(''), hCell(''), hCell(''), hCell(''), hCell('')]);
        const qaTotalRoutesFormula = qaAllTotalRoutesFormula();
        const qaTotalRowsFormula = qaAllTotalRowsFormula();
        const qaCheckedRoutesFormula = qaAllCheckedRoutesFormula();
        const qaCheckedRowsFormula = qaAllCheckedRowsFormula();
        const qaPromoFormula = qaAllReasonFormula('I');
        const qaPushOrNoCarFormula = qaAllReasonFormula('J');
        [
          ['งานตรวจสอบตามสถานะทั้งหมด', formulaCell(qaTotalRoutesFormula, { numFmt: '#,##0', align: 'right' })],
          ['จำนวนเที่ยวในสถานะทั้งหมด', formulaCell(qaTotalRowsFormula, { numFmt: '#,##0', align: 'right' })],
          ['ตรวจสอบแล้ว', formulaCell(qaCheckedRoutesFormula, { numFmt: '#,##0', align: 'right', color: '16A34A' })],
          ['ยังไม่เช็ค', formulaCell(`MAX((${qaTotalRoutesFormula})-(${qaCheckedRoutesFormula}),0)`, { numFmt: '#,##0', align: 'right', color: 'DC2626' })],
          ['% ความคืบหน้าการตรวจสอบ', formulaCell(`IFERROR((${qaCheckedRoutesFormula})/(${qaTotalRoutesFormula}),0)`, { numFmt: nPct, align: 'right' })],
          ['เที่ยวที่ตรวจสอบแล้ว', formulaCell(qaCheckedRowsFormula, { numFmt: '#,##0', align: 'right' })],
          ['โปร', formulaCell(qaPromoFormula, { numFmt: '#,##0', align: 'right' })],
          ['ดันราคา/หารถไม่ได้', formulaCell(qaPushOrNoCarFormula, { numFmt: '#,##0', align: 'right' })]
        ].forEach(([label, valueCell]) => {
          ws1Data.push([cCell(label, { bold: true }), valueCell, cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        });
        ws1Data.push([]);
        ws1Data.push([cCell('ความคืบหน้าการตรวจสอบแยกตามสถานะ', { bold: true, sz: 10, color: '111827', fill: 'E5E7EB' }), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell('')]);
        ws1Data.push([
          hCell('สถานะ', { wrap: false, sz: 10 }),
          hCell('งานตรวจสอบตามสถานะ', { wrap: false, sz: 10 }),
          hCell('เช็คแล้ว', { wrap: false, sz: 10 }),
          hCell('ยังไม่เช็ค', { wrap: false, sz: 10 }),
          hCell('% เช็คแล้ว', { wrap: false, sz: 10 }),
          hCell('จำนวนเที่ยวในสถานะ', { wrap: false, sz: 10 }),
          hCell('เที่ยวที่เช็คแล้ว', { wrap: false, sz: 10 }),
          hCell('โปร', { wrap: false, sz: 10 }),
          hCell('ดันราคา/หารถไม่ได้', { wrap: false, sz: 10 }),
        ]);
        qaTrackedStatusConfigs().forEach(config => {
          const totalRoutesFormula = qaStatusTotalRoutesFormula(config.name);
          const checkedRoutesFormula = qaStatusCheckedRoutesFormula(config.name);
          ws1Data.push([
            cCell(config.name, { bold: true }),
            formulaCell(totalRoutesFormula, { numFmt: '#,##0', align: 'right' }),
            formulaCell(checkedRoutesFormula, { numFmt: '#,##0', align: 'right', color: '16A34A' }),
            formulaCell(`MAX((${totalRoutesFormula})-(${checkedRoutesFormula}),0)`, { numFmt: '#,##0', align: 'right', color: 'DC2626' }),
            formulaCell(`IFERROR((${checkedRoutesFormula})/(${totalRoutesFormula}),0)`, { numFmt: nPct, align: 'right' }),
            formulaCell(qaStatusTotalRowsFormula(config.name), { numFmt: '#,##0', align: 'right' }),
            formulaCell(qaStatusCheckedRowsFormula(config.name), { numFmt: '#,##0', align: 'right' }),
            formulaCell(qaStatusReasonFormula(config.name, 'I'), { numFmt: '#,##0', align: 'right' }),
            formulaCell(qaStatusReasonFormula(config.name, 'J'), { numFmt: '#,##0', align: 'right' })
          ]);
        });
      }
      const bottomStartIdx = ws1Data.length;
      ws1Data.push([]);
      ws1Data.push([cCell('หมายเหตุ', { bold: true, sz: 10, color: '111827' })]);
      ws1Data.push([cCell('ส่งออกตามมุมมองปัจจุบัน', { bold: true, sz: 9 })]);
      ws1Data.push([cCell(filterSummaryText(), { color: '6B7280', sz: 9 })]);
      if (_isSingleMode) {
        ws1Data.push([cCell('สถานะที่เลือก (มุมมองปกติ): ' + formatStatusLabels(normalSelectedRaw), { color: '374151', sz: 9 })]);
      } else {
        ws1Data.push([cCell('สถานะที่เลือก (รายเส้นทางที่ถูกเปรียบเทียบ): ' + formatStatusLabels(anomalySelectedRaw), { color: '374151', sz: 9 })]);
      }
      ws1Data.push([cCell('ส่งออกเฉพาะข้อมูลที่ผ่านตัวกรองบนหน้าจอ', { color: '6B7280', sz: 9 })]);
      ws1Data.push([cCell('สร้างเมื่อ: ' + new Date().toLocaleString('th-TH'), { color: '6B7280', sz: 9 })]);

      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      const ws1ColumnCount = 9;
      ws1['!cols'] = _isSingleMode
        ? [{ wch: 34 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 24 }]
        : [{ wch: 34 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 24 }];
      ws1['!rows'] = ws1Data.map((_, idx) => {
        if (idx === 0) return { hpt: 32 };
        return {};
      });

      const ws1ColHeaderRow = 2;
      const ws1Merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: ws1ColumnCount - 1 } }
      ];
      if (_isSingleMode) {
        const overlapNoteRow = ws1Data.findIndex(row =>
          String(row?.[0]?.v || row?.[0] || '').includes('1 เที่ยวอาจพบได้มากกว่า 1 สถานะ')
        );
        if (overlapNoteRow >= 0) {
          ws1Merges.push({ s: { r: overlapNoteRow, c: 0 }, e: { r: overlapNoteRow, c: ws1ColumnCount - 1 } });
          ws1['!rows'][overlapNoteRow] = { hpt: 18 };
        }
        ws1Data.forEach((row, idx) => {
          const firstText = String(row?.[0]?.v || row?.[0] || '');
          const shouldMergeVisualRow =
            firstText.startsWith('สรุปเชิงภาพ') ||
            firstText.startsWith('สรุปตามสถานะ') ||
            firstText.startsWith('สัดส่วนต่อเที่ยวทั้งหมด') ||
            firstText.startsWith('หมายเหตุการอ่านกราฟ') ||
            firstText.startsWith('สรุปการตรวจสอบ') ||
            firstText.startsWith('ผูกกับช่องตรวจสอบ') ||
            firstText.startsWith('ความคืบหน้าการตรวจสอบแยกตามสถานะ');
          if (!shouldMergeVisualRow) return;
          ws1Merges.push({ s: { r: idx, c: 0 }, e: { r: idx, c: ws1ColumnCount - 1 } });
          ws1['!rows'][idx] = firstText.startsWith('หมายเหตุการอ่านกราฟ')
            ? { hpt: 24 }
            : { hpt: 20 };
        });
        ws1Merges.push({ s: { r: 4, c: 1 }, e: { r: 4, c: ws1ColumnCount - 1 } });
      }
      const bottomEndIdx = ws1Data.length - 1;
      for (let r = bottomStartIdx + 1; r <= bottomEndIdx; r++) {
        ws1Merges.push({ s: { r, c: 0 }, e: { r, c: ws1ColumnCount - 1 } });
      }
      ws1['!merges'] = ws1Merges;
      if (!_isSingleMode) {
        ws1['!autofilter'] = { ref: 'A' + (ws1ColHeaderRow + 1) + ':D' + (ws1ColHeaderRow + 1) };
      }
      ws1['!freeze'] = { xSplit: 0, ySplit: ws1ColHeaderRow + 1, topLeftCell: 'A' + (ws1ColHeaderRow + 2), activePane: 'bottomLeft', state: 'frozen' };

      let ws4 = null;
      const compareStatusSheets = [];
      const compareStatusSheetConfigs = [
        { key: 'loss', name: 'ขาดทุน' },
        { key: 'oil50', name: 'สำรองน้ำมัน > 50%' },
        { key: 'payHigh', name: 'ราคาจ่ายผิดปกติ' },
        { key: 'recvLow', name: 'ราคารับผิดปกติ' },
        { key: 'normal', name: 'ข้อมูลไม่เปลี่ยนแปลง' },
        { key: 'noRef', name: 'ไม่มีข้อมูลเปรียบเทียบ' }
      ];
      if (!_isSingleMode && _stA) {
        const buildCompareSheet = (sourceCards, sheetTitle, selectedRaw, statusFilter = null) => {
          const hasQaCheckboxColumns = qaCheckboxSheetNames.has(sheetTitle);
          const h4 = [
            'ลูกค้า', 'ชื่อเส้นทาง', 'วันที่หลัก', 'วันที่เปรียบเทียบ', 'พขร.',
            'ประเภทรถ', 'ทะเบียน', 'ราคาน้ำมัน', 'สำรองน้ำมัน',
            'ราคารับ', 'ราคาจ่าย', 'ส่วนต่าง', 'ความผิดปกติ',
            ...(hasQaCheckboxColumns ? qaCheckboxHeaders : ['หมายเหตุ'])
          ];
          const isTargetSheet = compareStatusSheetConfigs.some(config => config.name === sheetTitle);
          const cards = statusFilter
            ? (sourceCards || []).map(card => {
              const rows = (card.rows || []).filter(entry => (entry.statuses || ['normal']).some(status => statusMatchesFilter(status, statusFilter)));
              return rows.length ? { ...card, rows, statuses: [statusFilter] } : null;
            }).filter(Boolean)
            : (sourceCards || []);
          let maxStatusLen = isTargetSheet ? 14 : 16;
          const ws4Data = [];
          const titleText = statusFilter ? ('รายงานการเปรียบเทียบข้อมูล: ' + sheetTitle) : 'รายงานการเปรียบเทียบข้อมูลรายเส้นทาง';
          const titleRow4 = [tCell(titleText)];
          for (let i = 1; i < h4.length; i++) titleRow4.push(tCell(''));
          ws4Data.push(titleRow4);
          const statusInfo = statusFilter
            ? 'สถานะที่กรอง: ' + (exportLabelMap[statusFilter] || statusFilter)
            : 'สถานะที่เลือก: ' + formatStatusLabels(selectedRaw);
          const exportScope = statusFilter ? 'ส่งออกเฉพาะสถานะนี้' : 'ส่งออกเฉพาะข้อมูลที่ผ่านตัวกรองบนหน้าจอ';
          const headerRow4 = ws4Data.length;
          ws4Data.push(h4.map(t => hCell(t)));
          let rowIdx4 = headerRow4 + 1;

          // Track group-header rows that need C+D and E+F merges.
          const ws4GroupHeaderRows = [];
          const qaCheckboxRows = [];

          cards.forEach(card => {
            (card.rows || []).forEach(entry => {
              const displayStatuses = statusFilter ? statusesForFilterDisplay(entry.statuses, statusFilter) : (entry.statuses || ['normal']);
              const statusTxt = statusText(displayStatuses);
              if (!statusTxt) return;
              statusTxt.split('\n').forEach(line => {
                if (line.length + 3 > maxStatusLen) maxStatusLen = line.length + 3;
              });
            });
          });
          maxStatusLen = Math.min(Math.max(maxStatusLen, isTargetSheet ? 14 : 16), 18);

          cards.forEach(card => {
            // Group header: A=customer, B=route, C+D='ประเภทรถ: <vtype>', E+F='ต้องตรวจสอบ N คู่'
            const cardAnomCount = (card.rows || []).filter(r => dcQaHasAnomalyStatus(r.statuses)).length;
            const summaryText = cardAnomCount > 0
              ? 'ต้องตรวจสอบ ' + cardAnomCount + ' คู่เปรียบเทียบ'
              : 'รวม ' + (card.rows || []).length + ' คู่เปรียบเทียบ';
            const top = [
              cCell(card.ga.customer || '-', { bold: true, fill: 'DBEAFE' }),
              cCell(routeGroupHeaderDisplay(card.ga), { bold: true, fill: 'DBEAFE' }),
              cCell('ประเภทรถ: ' + (card.ga.vtype || '-'), { bold: true, fill: 'DBEAFE' }),
              cCell('', { fill: 'DBEAFE' }),                                    // D - merged with C
              cCell(summaryText, { bold: true, fill: 'DBEAFE' }),
              cCell('', { fill: 'DBEAFE' })                                     // F - merged with E
            ];
            while (top.length < h4.length) top.push(cCell('', { fill: 'DBEAFE' }));
            applyRouteGroupOuterBorder(top);
            ws4GroupHeaderRows.push(ws4Data.length); // record row index for merge
            ws4Data.push(top);
            rowIdx4++;

            (card.rows || []).forEach(entry => {
              const ra = entry.ra || {};
              const rb = entry.rb || {};
              const mA = (ra.margin == null || isNaN(ra.margin)) ? ((ra.recv || 0) - (ra.pay || 0) - (ra.oil || 0)) : ra.margin;
              const mB = (rb.margin == null || isNaN(rb.margin)) ? ((rb.recv || 0) - (rb.pay || 0) - (rb.oil || 0)) : rb.margin;
              const oilPriceA = getOilPriceByDate(ra.date);
              const oilPriceB = getOilPriceByDate(rb.date);
              const zf = (rowIdx4 % 2 === 0) ? 'F9FAFB' : null;
              // Bullet cells: vertical align top so each line stays aligned in tall rows.
              const bOpts = f => ({ fill: f, align: 'right', wrap: true, valign: 'top' });
              // Neutral bullet: col J/K/L use dark text regardless of Δ direction.
              const bOptsNeutral = f => ({ fill: f, align: 'right', wrap: true, valign: 'top', neutralColor: true });
              const displayStatuses = statusFilter ? statusesForFilterDisplay(entry.statuses, statusFilter) : (entry.statuses || ['normal']);
              const colMValign = isTargetSheet ? 'center' : 'top';
              const qaCustomerVal = ra.customer || rb.customer || '-';
              const qaRouteVal = xlsxRouteDisplay(ra.route || ra.routeDesc ? ra : rb);
              const qaVtypeVal = (ra.vtype || '-') + ' / ' + (rb.vtype || '-');
              const row = [
                cCell(qaCustomerVal, { fill: zf }),
                cCell(qaRouteVal, { fill: zf }),
                cCell(ra.date || '-', { fill: zf }),
                cCell(rb.date || '-', { fill: zf }),
                cCell(ra.driver || rb.driver || '-', { fill: zf }),
                cCell(qaVtypeVal, { fill: zf }),
                cCell((ra.plate || '-') + ' / ' + (rb.plate || '-'), { fill: zf }),
                bulletPairCell(oilPriceA, oilPriceB, bOpts(zf), true),
                bulletPairCell(ra.oil, rb.oil, bOpts(zf), true),
                bulletPairCell(ra.recv, rb.recv, bOptsNeutral(zf), false),   // col J - dark
                bulletPairCell(ra.pay, rb.pay, bOptsNeutral(zf), true),      // col K - dark
                bulletPairCell(mA, mB, bOptsNeutral(zf), false),             // col L - dark
                statusRichCell(displayStatuses, { fill: zf, align: 'left', wrap: true, valign: colMValign }),
                ...(hasQaCheckboxColumns ? qaCheckboxCells(zf) : [cCell('', { fill: zf })])
              ];
              if (hasQaCheckboxColumns) {
                qaCheckboxRows.push(ws4Data.length);
                displayStatuses
                  .filter(statusKey => qaSourceSheetByStatusKey[statusKey] === sheetTitle)
                  .forEach(statusKey => addQaHelperRoute(sheetTitle, statusKey, qaCustomerVal, qaRouteVal, qaVtypeVal));
              }
              ws4Data.push(row);
              rowIdx4++;
            });
          });

          if (cards.length === 0) {
            const noDataText = statusFilter
              ? 'ไม่พบคู่เปรียบเทียบในสถานะ "' + (exportLabelMap[statusFilter] || statusFilter) + '"'
              : 'ไม่พบคู่เปรียบเทียบในช่วงเวลาที่เลือก';
            const noData4 = [mCell(noDataText, { align: 'center', bold: true })];
            for (let i = 1; i < h4.length; i++) noData4.push(cCell(''));
            ws4Data.push(noData4);
          }

          const bottomStartIdx = ws4Data.length;
          ws4Data.push([]);
          const reviewerStartCol = h4.length - qaCheckboxHeaders.length;
          const appendNoteRow = (noteCell, reviewerCell = null) => {
            const row = [noteCell];
            if (isTargetSheet) {
              while (row.length < reviewerStartCol) row.push(cCell(''));
              row.push(reviewerCell || cCell(''));
              while (row.length < h4.length) row.push(cCell(''));
            }
            ws4Data.push(row);
          };
          const reviewerTitleCell = cCell('ผู้ตรวจสอบ', { bold: true, sz: 10, color: '111827', align: 'center', fill: 'EEF2FF' });
          const reviewerSignCell = cCell('(                                      )', { sz: 11, color: '111827', align: 'center', fill: 'FFFFFF' });
          const reviewerNameCell = cCell('ลงชื่อ', { sz: 9, color: '6B7280', align: 'center', fill: 'FFFFFF' });
          const reviewerDateCell = cCell('วันที่ ____ / ____ / ______', { sz: 9, color: '6B7280', align: 'center', fill: 'FFFFFF' });

          appendNoteRow(cCell('หมายเหตุ', { bold: true, sz: 10, color: '111827' }), reviewerTitleCell);
          appendNoteRow(cCell(filterSummaryText() + ' | หน้าที่ส่งออก: ' + sheetTitle, { color: '6B7280', sz: 9 }), reviewerSignCell);
          appendNoteRow(cCell(statusInfo + ' | ' + exportScope, { color: '374151', sz: 9 }), reviewerNameCell);
          appendNoteRow(cCell('ช่วงข้อมูลหลัก: ' + periodALabel + ' | ช่วงข้อมูลเปรียบเทียบ: ' + periodBLabel + ' | Δ = ' + periodALabel + ' - ' + periodBLabel, { color: '374151', sz: 9 }), reviewerDateCell);

          // Row height map: group headers = 20pt, data rows = proportional to content.
          // Excel row height in points: each line of sz:10 font needs ~14pt.
          const ws4GroupHeaderSet = new Set(ws4GroupHeaderRows);
          const ws4RowHeights = ws4Data.map((rowData, idx) => {
            if (idx === 0) return { hpt: 32 };
            if (idx <= headerRow4) return {};
            if (idx >= bottomStartIdx) return {};
            if (ws4GroupHeaderSet.has(idx)) return { hpt: 20 };
            // Count lines in all bullet columns H(7) I(8) J(9) K(10) L(11) and status M(12).
            const countLines = colIdx => {
              const cell = rowData[colIdx];
              return (cell && cell.v) ? String(cell.v).split('\n').length : 1;
            };
            const lines = Math.max(
              countLines(7),   // H ราคาน้ำมัน
              countLines(8),   // I สำรองน้ำมัน
              countLines(9),   // J ราคารับ
              countLines(10),  // K ราคาจ่าย
              countLines(11),  // L ส่วนต่าง
              countLines(12),  // M ความผิดปกติ
              1
            );
            return { hpt: Math.max(lines * 14 + 6, 20) };
          });
          const ws = XLSX.utils.aoa_to_sheet(ws4Data);
          if (hasQaCheckboxColumns) {
            ws['!qaCheckboxValidationRefs'] = xlsxCompressRowRefs(qaCheckboxRows, h4.length - qaCheckboxHeaders.length, h4.length - 1);
          }
          const ws4Cols = [
            { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 18 },
            { wch: 13 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
            { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: maxStatusLen }
          ];
          if (hasQaCheckboxColumns) {
            ws4Cols.push({ wch: 10 }, { wch: 24 });
          } else {
            ws4Cols.push({ wch: 16 });
          }
          ws['!cols'] = ws4Cols;
          ws['!rows'] = ws4RowHeights;
          ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: h4.length - 1 } },
            // Per-card group header: merge C+D (col 2-3) and E+F (col 4-5)
            ...ws4GroupHeaderRows.flatMap(r => [
              { s: { r, c: 2 }, e: { r, c: 3 } },
              { s: { r, c: 4 }, e: { r, c: 5 } }
            ]),
            ...ws4Data.slice(bottomStartIdx + 1).flatMap((_, idx) => {
              const rowIndex = bottomStartIdx + 1 + idx;
              if (isTargetSheet) {
                return [
                  { s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: reviewerStartCol - 1 } },
                  { s: { r: rowIndex, c: reviewerStartCol }, e: { r: rowIndex, c: h4.length - 1 } }
                ];
              }
              return [{ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: h4.length - 1 } }];
            })
          ];
          const headerRowNumber4 = headerRow4 + 1;
          ws['!autofilter'] = { ref: 'A' + headerRowNumber4 + ':' + XLSX.utils.encode_cell({ c: h4.length - 1, r: headerRow4 }) };
          ws['!freeze'] = { xSplit: 0, ySplit: headerRowNumber4, topLeftCell: 'A' + (headerRowNumber4 + 1), activePane: 'bottomLeft', state: 'frozen' };
          return ws;
        };

        ws4 = buildCompareSheet(anomalyCards, 'รายเส้นทางที่ถูกเปรียบเทียบ', anomalySelectedRaw, null);
        compareStatusSheetConfigs.forEach(s => {
          compareStatusSheets.push({
            name: s.name,
            ws: buildCompareSheet(anomalyCardsAll, s.name, [s.key], s.key)
          });
        });

      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'สรุปผลดำเนินงาน');
      if (ws4) XLSX.utils.book_append_sheet(wb, ws4, 'รายเส้นทางที่ถูกเปรียบเทียบ');
      compareStatusSheets.forEach(sheet => {
        if (sheet?.ws) XLSX.utils.book_append_sheet(wb, sheet.ws, sheet.name);
      });

      // ─── Single-mode (มุมมองปกติ) extra sheets ──────────────────────────────
      // 1 sheet for ALL data + 6 sheets each filtered to a single status tag.
      // Reuses the same template, formatting, and column layout as compare mode (ws4).
      if (_isSingleMode && _stA) {
        // Build a single sheet from cases.
        // mode='all'    (statusFilter=null): include trips matching userFilterSet (UI toggles).
        //                                    All status badges visible per row.
        // mode='filter' (statusFilter set):  keep trips that have THIS status; show ONLY this
        //                                    status in the badge column (lens semantics).
        // userFilterSet is ignored when statusFilter is set (per-status sheets always export
        // the requested tag regardless of UI toggle, by design).
        const buildSingleSheet = (cases, sheetTitle, statusFilter, userFilterSet) => {
          const wsData = [];
          const isPairFirstStatusFilter = statusFilter === 'payHigh' || statusFilter === 'recvLow';
          const hasQaCheckboxColumns = qaCheckboxSheetNames.has(sheetTitle);
          const titleMap = {
            'รายเส้นทางที่เปรียบเทียบ': 'รายงานการเปรียบเทียบข้อมูลรายเส้นทาง',
            'ขาดทุน': 'รายการเส้นทางที่มีผลประกอบการขาดทุน',
            'สำรองน้ำมัน > 50%': 'รายการเส้นทางที่มีการสำรองน้ำมันเกินเกณฑ์ >50%',
            'ราคารับผิดปกติ': 'รายการเส้นทางที่มีความผิดปกติของราคารับ',
            'ราคาจ่ายผิดปกติ': 'รายการเส้นทางที่มีความผิดปกติของราคาจ่าย',
            'ข้อมูลไม่เปลี่ยนแปลง': 'รายการเส้นทางที่ข้อมูลไม่เปลี่ยนแปลง',
            'ไม่มีข้อมูลเปรียบเทียบ': 'รายการเส้นทางที่ไม่มีข้อมูลเปรียบเทียบ'
          };
          const displayTitle = titleMap[sheetTitle] || sheetTitle;
          const headers = [
            'ลูกค้า', 'ชื่อเส้นทาง', 'วันที่', 'พขร.',
            'ประเภทรถ', 'ทะเบียน', 'ราคาน้ำมัน', 'สำรองน้ำมัน',
            'ราคารับ', 'ราคาจ่าย', 'ส่วนต่าง', 'ความผิดปกติ',
            ...(hasQaCheckboxColumns ? qaCheckboxHeaders : ['หมายเหตุ'])
          ];
          const titleRow = [tCell(displayTitle)];
          for (let i = 1; i < headers.length; i++) titleRow.push(tCell(''));
          wsData.push(titleRow);

          const labels = qaStatusLabels();
          let statusInfo;
          if (statusFilter) {
            statusInfo = 'สถานะที่กรอง: ' + (labels[statusFilter] || statusFilter);
          } else if (userFilterSet) {
            const arr = Array.from(userFilterSet);
            statusInfo = 'สถานะที่เลือก: ' + (arr.length ? arr.map(k => labels[k] || k).join(', ') : '-');
          } else {
            statusInfo = 'สถานะที่เลือก: ทั้งหมด';
          }
          wsData.push([]);
          const headerRow = wsData.length;
          wsData.push(headers.map(t => hCell(t)));
          let rowIdx = headerRow + 1;
          const groupHeaderRows = [];
          const qaCheckboxRows = [];

          const cleanStatuses = ss => {
            const arr = ss && ss.length ? ss : ['normal'];
            return arr.some(s => s !== 'normal') ? arr.filter(s => s !== 'normal') : arr;
          };
          const exportEntryStatusesForFilter = entry => {
            if (!isPairFirstStatusFilter) return entry?.statuses || ['normal'];
            return entry?.pairScopedStatuses || entry?.statuses || ['normal'];
          };
          const entryMatchesExportStatusFilter = entry => {
            const statuses = exportEntryStatusesForFilter(entry);
            if (statusFilter === 'payHigh') return statuses.includes('payHigh') || statuses.includes('payOilChanged');
            if (statusFilter === 'recvLow') return statuses.includes('recvLow') || statuses.includes('recvOilChanged');
            return (statuses || ['normal']).some(status => statusMatchesFilter(status, statusFilter));
          };

          let maxRouteLen = 10;
          let maxOilLen = 10;     // 'ราคาน้ำมัน' (min 10)
          let maxReserveLen = 11; // 'สำรองน้ำมัน' (min 11)
          let maxRecvLen = 10;    // 'ราคารับ' (min 10)
          let maxPayLen = 10;     // 'ราคาจ่าย' (min 10)
          let maxMarginLen = 10;  // 'ส่วนต่าง' (min 10)

          const isOverviewSheet = sheetTitle === 'รายเส้นทางที่เปรียบเทียบ';
          const isTargetSheet = ['ขาดทุน', 'สำรองน้ำมัน > 50%', 'ราคาจ่ายผิดปกติ', 'ราคารับผิดปกติ', 'ข้อมูลไม่เปลี่ยนแปลง', 'ไม่มีข้อมูลเปรียบเทียบ'].includes(sheetTitle);
          let maxStatusLen = 14;
          cases.forEach(item => {
            let visibleRows;
            if (statusFilter) {
              visibleRows = item.rows.filter(entryMatchesExportStatusFilter);
            } else if (userFilterSet) {
              visibleRows = item.rows.filter(r => {
                const ss = cleanStatuses(r.statuses || []);
                return statusesMatchFilterSet(ss, userFilterSet);
              });
            } else {
              visibleRows = item.rows;
            }
            if (visibleRows.length === 0) return;

            const rDisp = routeGroupHeaderDisplay(item.route);
            if (rDisp && rDisp.length > maxRouteLen) maxRouteLen = rDisp.length;

            visibleRows.forEach(entry => {
              const r = entry.ra || {};
              const raDisp = xlsxRouteDisplay(r);
              if (raDisp && raDisp.length > maxRouteLen) maxRouteLen = raDisp.length;

              const oilPrice = getOilPriceByDate(r.date);
              const oilStr = hasNum(oilPrice) ? fmtMoney(oilPrice) : '-';
              if (oilStr.length > maxOilLen) maxOilLen = oilStr.length;

              const reserveStr = fmtMoney(r.oil);
              if (reserveStr.length > maxReserveLen) maxReserveLen = reserveStr.length;

              const recvStr = fmtMoney(r.recv);
              if (recvStr.length > maxRecvLen) maxRecvLen = recvStr.length;

              const payStr = fmtMoney(r.pay);
              if (payStr.length > maxPayLen) maxPayLen = payStr.length;

              const mar = (r.margin == null || isNaN(r.margin)) ? ((r.recv || 0) - (r.pay || 0) - (r.oil || 0)) : r.margin;
              const marginStr = fmtMoney(mar);
              if (marginStr.length > maxMarginLen) maxMarginLen = marginStr.length;

              if (isOverviewSheet || isTargetSheet) {
                let displayStatuses;
                if (statusFilter) {
                  displayStatuses = statusesForFilterDisplay(exportEntryStatusesForFilter(entry), statusFilter);
                } else if (userFilterSet) {
                  const ss = cleanStatuses(entry.statuses || ['normal']);
                  displayStatuses = statusesForFilterSetDisplay(ss, userFilterSet);
                } else {
                  displayStatuses = entry.statuses || ['normal'];
                }
                const statusTxt = statusText(displayStatuses);
                if (statusTxt) {
                  statusTxt.split('\n').forEach(line => {
                    if (line.length + 3 > maxStatusLen) maxStatusLen = line.length + 3;
                  });
                }
              }
            });

            (item.refTripsForRoute || []).forEach(refTrip => {
              const refDisp = xlsxRouteDisplay(refTrip);
              if (refDisp && refDisp.length > maxRouteLen) maxRouteLen = refDisp.length;

              const oilPrice = getOilPriceByDate(refTrip.date);
              const oilStr = hasNum(oilPrice) ? fmtMoney(oilPrice) : '-';
              if (oilStr.length > maxOilLen) maxOilLen = oilStr.length;

              const reserveStr = fmtMoney(refTrip.oil);
              if (reserveStr.length > maxReserveLen) maxReserveLen = reserveStr.length;

              const recvStr = fmtMoney(refTrip.recv);
              if (recvStr.length > maxRecvLen) maxRecvLen = recvStr.length;

              const payStr = fmtMoney(refTrip.pay);
              if (payStr.length > maxPayLen) maxPayLen = payStr.length;

              const mar = (refTrip.margin == null || isNaN(refTrip.margin)) ? ((refTrip.recv || 0) - (refTrip.pay || 0) - (refTrip.oil || 0)) : refTrip.margin;
              const marginStr = fmtMoney(mar);
              if (marginStr.length > maxMarginLen) maxMarginLen = marginStr.length;
            });
          });

          cases.forEach(item => {
            // Trip filtering rules:
            //   statusFilter set        -> keep trips whose statuses include this key (lens)
            //   userFilterSet provided  -> keep trips whose statuses match user UI toggles
            //                             (mirrors Lens Filter behaviour for the ALL sheet)
            //   neither                 -> keep every trip
            // cleanStatuses: if any non-normal status present, drop 'normal' (so filtering by
            // 'normal' only picks pure-normal trips, matching renderSingleTable semantics).
            let visibleRows;
            if (statusFilter) {
              visibleRows = item.rows.filter(entryMatchesExportStatusFilter);
            } else if (userFilterSet) {
              visibleRows = item.rows.filter(r => {
                const ss = cleanStatuses(r.statuses || []);
                return statusesMatchFilterSet(ss, userFilterSet);
              });
            } else {
              visibleRows = item.rows;
            }
            visibleRows = visibleRows.filter(r => dcQaHasAnomalyStatus(r.statuses) || !(r.infoStatuses || []).length);
            if (visibleRows.length === 0) return; // skip cards with no matching trips

            // Group header row: A=customer, B=route, C+D='ประเภทรถ: <vtype>', E+F='ต้องตรวจสอบ N เที่ยว'
            const anomCount = visibleRows.filter(r => dcQaHasAnomalyStatus(r.statuses)).length;
            const summaryText = anomCount > 0
              ? 'ต้องตรวจสอบ ' + anomCount + ' เที่ยว'
              : 'รวม ' + visibleRows.length + ' เที่ยว';
            const top = [
              cCell(item.route.customer || '-', { bold: true, fill: 'DBEAFE' }),
              cCell(routeGroupHeaderDisplay(item.route), { bold: true, fill: 'DBEAFE' }),
              cCell('ประเภทรถ: ' + (item.route.vtype || '-'), { bold: true, fill: 'DBEAFE' }),
              cCell('', { fill: 'DBEAFE' }),    // D — merged with C
              cCell(summaryText, { bold: true, fill: 'DBEAFE' }),
              cCell('', { fill: 'DBEAFE' })     // F — merged with E
            ];
            while (top.length < headers.length) top.push(cCell('', { fill: 'DBEAFE' }));
            applyRouteGroupOuterBorder(top);
            groupHeaderRows.push(wsData.length);
            wsData.push(top);
            rowIdx++;

            const sequence = dcQaBuildZigzagEntrySequence(visibleRows, item.leftoverRefTrips || []);
            sequence.forEach(part => {
              if (part.kind === 'a') {
                const entry = part.entry || {};
                const r = entry.ra || {};
                const mar = (r.margin == null || isNaN(r.margin)) ? ((r.recv || 0) - (r.pay || 0) - (r.oil || 0)) : r.margin;
                const oilPrice = getOilPriceByDate(r.date);
                let displayStatuses;
                if (statusFilter) {
                  displayStatuses = statusesForFilterDisplay(exportEntryStatusesForFilter(entry), statusFilter);
                } else if (userFilterSet) {
                  const ss = cleanStatuses(entry.statuses || ['normal']);
                  displayStatuses = statusesForFilterSetDisplay(ss, userFilterSet);
                } else {
                  displayStatuses = entry.statuses || ['normal'];
                }
                const zf = (rowIdx % 2 === 0) ? 'F9FAFB' : null;
                const colLValign = isTargetSheet ? 'center' : 'top';
                const qaCustomerVal = r.customer || '-';
                const qaRouteVal = xlsxRouteDisplay(r);
                const qaVtypeVal = r.vtype || '-';
                const row = [
                  cCell(qaCustomerVal, { fill: zf }),
                  cCell(qaRouteVal, { fill: zf }),
                  cCell(r.date || '-', { fill: zf }),
                  cCell(r.driver || '-', { fill: zf }),
                  cCell(qaVtypeVal, { fill: zf }),
                  cCell(r.plate || '-', { fill: zf }),
                  hasNum(oilPrice) ? cCell(fmtMoney(oilPrice), { align: 'right', fill: zf }) : cCell('-', { align: 'right', fill: zf }),
                  cCell(fmtMoney(r.oil), { align: 'right', fill: zf }),
                  cCell(fmtMoney(r.recv), { align: 'right', fill: zf }),
                  cCell(fmtMoney(r.pay), { align: 'right', fill: zf }),
                  mar < 0 ? rCell(fmtMoney(mar), { align: 'right', fill: zf }) : gCell(fmtMoney(mar), { align: 'right', fill: zf }),
                  statusRichCell(displayStatuses, { fill: zf, align: 'left', wrap: true, valign: colLValign, neutralStatusColor: isOverviewSheet }),
                  ...(hasQaCheckboxColumns ? qaCheckboxCells(zf) : [cCell('', { fill: zf })])
                ];
                if (hasQaCheckboxColumns) {
                  qaCheckboxRows.push(wsData.length);
                  displayStatuses
                    .filter(statusKey => qaSourceSheetByStatusKey[statusKey] === sheetTitle)
                    .forEach(statusKey => addQaHelperRoute(sheetTitle, statusKey, qaCustomerVal, qaRouteVal, qaVtypeVal));
                }
                wsData.push(row);
              } else {
                const refTrip = part.trip || {};
                const mar = (refTrip.margin == null || isNaN(refTrip.margin)) ? ((refTrip.recv || 0) - (refTrip.pay || 0) - (refTrip.oil || 0)) : refTrip.margin;
                const oilPrice = getOilPriceByDate(refTrip.date);
                const refFill = 'E5E7EB'; // slightly darker gray tint to distinguish reference-day rows
                const row = [
                  cCell(refTrip.customer || '-', { fill: refFill }),
                  cCell(xlsxRouteDisplay(refTrip), { fill: refFill }),
                  cCell(refTrip.date || '-', { fill: refFill }),
                  cCell(refTrip.driver || '-', { fill: refFill }),
                  cCell(refTrip.vtype || '-', { fill: refFill }),
                  cCell(refTrip.plate || '-', { fill: refFill }),
                  hasNum(oilPrice) ? cCell(fmtMoney(oilPrice), { align: 'right', fill: refFill }) : cCell('-', { align: 'right', fill: refFill }),
                  cCell(fmtMoney(refTrip.oil), { align: 'right', fill: refFill }),
                  cCell(fmtMoney(refTrip.recv), { align: 'right', fill: refFill }),
                  cCell(fmtMoney(refTrip.pay), { align: 'right', fill: refFill }),
                  mar < 0 ? rCell(fmtMoney(mar), { align: 'right', fill: refFill }) : gCell(fmtMoney(mar), { align: 'right', fill: refFill }),
                  cCell('', { fill: refFill }),
                  ...(hasQaCheckboxColumns
                    ? qaCheckboxHeaders.map(() => cCell('', { fill: refFill }))
                    : [cCell('', { fill: refFill })])
                ];
                wsData.push(row);
              }
              rowIdx++;
            });
          });

          if (rowIdx === headerRow + 1) {
            // No data for this filter
            const noData = [mCell('ไม่พบข้อมูลที่ตรงกับสถานะ "' + (labels[statusFilter] || statusFilter || '-') + '"', { align: 'center', bold: true })];
            for (let i = 1; i < headers.length; i++) noData.push(cCell(''));
            wsData.push(noData);
          }

          // Add the bottom Notes section (ย้ายไปด้านล่างสุด)
          const bottomStartIdx = wsData.length;
          wsData.push([]);
          const reviewerStartCol = headers.length - qaCheckboxHeaders.length;
          const appendNoteRow = (noteCell, reviewerCell = null) => {
            const row = [noteCell];
            if (isTargetSheet) {
              while (row.length < reviewerStartCol) row.push(cCell(''));
              row.push(reviewerCell || cCell(''));
              while (row.length < headers.length) row.push(cCell(''));
            }
            wsData.push(row);
          };
          const reviewerTitleCell = cCell('ผู้ตรวจสอบ', { bold: true, sz: 10, color: '111827', align: 'center', fill: 'EEF2FF' });
          const reviewerSignCell = cCell('(                                      )', { sz: 11, color: '111827', align: 'center', fill: 'FFFFFF' });
          const reviewerNameCell = cCell('ลงชื่อ', { sz: 9, color: '6B7280', align: 'center', fill: 'FFFFFF' });
          const reviewerBlankCell = cCell('', { sz: 9, color: '6B7280', align: 'center', fill: 'FFFFFF' });
          const reviewerDateCell = cCell('วันที่ ____ / ____ / ______', { sz: 9, color: '6B7280', align: 'center', fill: 'FFFFFF' });

          appendNoteRow(cCell('หมายเหตุ', { bold: true, sz: 10, color: '111827' }), reviewerTitleCell);
          appendNoteRow(cCell(filterSummaryText() + ' | หน้าที่ส่งออก: ' + sheetTitle, { color: '6B7280', sz: 9 }), reviewerSignCell);
          appendNoteRow(cCell(statusInfo + ' | ส่งออกเฉพาะข้อมูลที่ผ่านตัวกรองบนหน้าจอ', { color: '374151', sz: 9 }), reviewerNameCell);

          const refLabelsList = singleRefDaysList.join(', ') || '-';
          const [refY, refM, refD] = _stA.dateStart.split('-').map(Number);
          const refSearchDay = (offset) => {
            const dt = new Date(refY, refM - 1, refD - offset);
            return dt.getDate();
          };
          const refSearchText = refLabelsList !== '-'
            ? `(เปรียบเทียบเที่ยววิ่งอดีต: เริ่มหาจากวันที่ ${refSearchDay(1)} -> ไม่มีข้อมูล -> หาที่วันที่ ${refSearchDay(2)} -> ไม่มีข้อมูล -> หาที่วันที่ ${refSearchDay(3)})`
            : '';
          if (isTargetSheet && refLabelsList !== '-') {
            appendNoteRow(cCell('ช่วงข้อมูลหลัก: ' + periodALabel, { color: '374151', sz: 9 }), reviewerBlankCell);
            appendNoteRow(cCell('ช่วงข้อมูลเปรียบเทียบ (ย้อนหลัง 3 วัน) ' + refLabelsList, { color: '374151', sz: 9 }), reviewerDateCell);
            appendNoteRow(cCell(refSearchText, { color: '374151', sz: 9 }), reviewerBlankCell);
          } else {
            appendNoteRow(cCell('ช่วงข้อมูลหลัก: ' + periodALabel + ' | ช่วงข้อมูลเปรียบเทียบ (ย้อนหลัง 3 วัน) ' + refLabelsList + (refSearchText ? ' ' + refSearchText : ''), { color: '374151', sz: 9 }), reviewerDateCell);
          }

          const ws = XLSX.utils.aoa_to_sheet(wsData);
          if (hasQaCheckboxColumns) {
            ws['!qaCheckboxValidationRefs'] = xlsxCompressRowRefs(qaCheckboxRows, headers.length - qaCheckboxHeaders.length, headers.length - 1);
          }
          const statusColumnWidth = isOverviewSheet
            ? Math.min(Math.max(maxStatusLen, 36), 46)
            : (isTargetSheet ? maxStatusLen : 24);
          const estimateWrappedLines = value => {
            const text = String(value || '');
            if (!text) return 1;
            const usableChars = Math.max(12, Math.floor(statusColumnWidth * 0.82));
            return text.split('\n').reduce((sum, line) => {
              const len = String(line || '').trim().length;
              return sum + Math.max(1, Math.ceil(len / usableChars));
            }, 0);
          };
          const wsCols = [
            { wch: 12 }, { wch: maxRouteLen }, { wch: 12 }, { wch: 18 },
            { wch: 13 }, { wch: 18 }, { wch: maxOilLen }, { wch: maxReserveLen },
            { wch: maxRecvLen }, { wch: maxPayLen }, { wch: maxMarginLen }, { wch: statusColumnWidth }
          ];
          if (hasQaCheckboxColumns) {
            wsCols.push({ wch: 10 }, { wch: 24 });
          } else {
            wsCols.push({ wch: 16 });
          }
          ws['!cols'] = wsCols;

          // Row heights: header rows = default; group header = 20pt; data row proportional to status lines.
          const groupHeaderSet = new Set(groupHeaderRows);
          ws['!rows'] = wsData.map((rowData, idx) => {
            if (idx === 0) return { hpt: 32 };
            if (idx <= headerRow) return {};
            if (idx >= bottomStartIdx) return {}; // notes rows use default height
            if (groupHeaderSet.has(idx)) return { hpt: 20 };
            const statusCell = rowData[11]; // col L (ความผิดปกติ)
            const statusLines = estimateWrappedLines(statusCell && statusCell.v);
            return { hpt: Math.max(statusLines * 15 + 8, 22) };
          });

          // Build merges: title row (Row 0), group headers, and all bottom notes rows
          const merges = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
            ...groupHeaderRows.flatMap(r => [
              { s: { r, c: 2 }, e: { r, c: 3 } },
              { s: { r, c: 4 }, e: { r, c: 5 } }
            ])
          ];
          const bottomEndIdx = wsData.length - 1;
          for (let r = bottomStartIdx + 1; r <= bottomEndIdx; r++) {
            if (isTargetSheet) {
              merges.push({ s: { r, c: 0 }, e: { r, c: reviewerStartCol - 1 } });
              merges.push({ s: { r, c: reviewerStartCol }, e: { r, c: headers.length - 1 } });
            } else {
              merges.push({ s: { r, c: 0 }, e: { r, c: headers.length - 1 } });
            }
          }
          ws['!merges'] = merges;

          // Autofilter starts at index 2 (Excel Row 3, which is the column header)
          ws['!autofilter'] = { ref: 'A3:' + XLSX.utils.encode_cell({ c: headers.length - 1, r: 2 }) };
          // Freeze top 3 rows (Row 1 Title, Row 2 Blank, Row 3 Column Header)
          ws['!freeze'] = { xSplit: 0, ySplit: 3, topLeftCell: 'A4', activePane: 'bottomLeft', state: 'frozen' };
          return ws;
        };

        // Sheet 2: รายเส้นทางที่เปรียบเทียบ — applies the user's UI status toggles (Lens Filter).
        // If user unchecks 'ข้อมูลไม่เปลี่ยนแปลง', normal trips are excluded from this sheet (matches on-screen).
        const wsAll = buildSingleSheet(singleCases, 'รายเส้นทางที่เปรียบเทียบ', null, normalSelectedSet);
        XLSX.utils.book_append_sheet(wb, wsAll, 'รายเส้นทางที่เปรียบเทียบ');
        // Sheets 3-8: per-status filtered sheets (lens semantics — show only the picked filter).
        // Order matches the on-screen status filter panel: ขาดทุน → สำรองน้ำมัน > 50% → ราคาจ่ายผิดปกติ → ราคารับผิดปกติ → ข้อมูลไม่เปลี่ยนแปลง → ไม่มีข้อมูลเปรียบเทียบ
        // These sheets always export the requested tag regardless of UI toggle (by design).
        const statusSheets = [
          { key: 'loss', name: 'ขาดทุน' },
          { key: 'oil50', name: 'สำรองน้ำมัน > 50%' },
          { key: 'payHigh', name: 'ราคาจ่ายผิดปกติ' },
          { key: 'recvLow', name: 'ราคารับผิดปกติ' },
          { key: 'normal', name: 'ข้อมูลไม่เปลี่ยนแปลง' },
          { key: 'noRef', name: 'ไม่มีข้อมูลเปรียบเทียบ' }
        ];
        statusSheets.forEach(s => {
          const ws = buildSingleSheet(singleCases, s.name, s.key, null);
          XLSX.utils.book_append_sheet(wb, ws, s.name);
        });
      }

      const buildQaHelperSheet = () => {
        const helperData = [[
          hCell('ชีท'),
          hCell('สถานะ'),
          hCell('ลูกค้า'),
          hCell('ชื่อเส้นทาง'),
          hCell('ประเภทรถ'),
          hCell('Route Key'),
          hCell('เช็คแล้ว'),
          hCell('เที่ยวที่เช็คแล้ว'),
          hCell('โปร'),
          hCell('ดันราคา/หารถไม่ได้'),
          hCell('เที่ยวในสถานะ')
        ]];
        qaHelperRows.forEach((item, idx) => {
          const rowNum = idx + 2;
          const sourceSheet = item.sheetName;
          const sourceCustomer = qaFormulaRange(sourceSheet, 'A');
          const sourceRoute = qaFormulaRange(sourceSheet, 'B');
          const sourceVtype = qaFormulaRange(sourceSheet, qaFormulaMeta.routeTypeCol);
          const sourceStatus = qaFormulaRange(sourceSheet, qaFormulaMeta.statusCol);
          const sourcePromo = qaFormulaRange(sourceSheet, qaFormulaMeta.qaCols[0]);
          const sourcePushOrNoCar = qaFormulaRange(sourceSheet, qaFormulaMeta.qaCols[1]);
          const criteria = `${sourceCustomer},$C${rowNum},${sourceRoute},$D${rowNum},${sourceVtype},$E${rowNum},${sourceStatus},"*"&$B${rowNum}&"*"`;
          const checkedTripsFormula =
            `SUMPRODUCT(--(${sourceCustomer}=$C${rowNum}),--(${sourceRoute}=$D${rowNum}),--(${sourceVtype}=$E${rowNum}),--ISNUMBER(SEARCH($B${rowNum},${sourceStatus})),--(((${sourcePromo}="☑")+(${sourcePushOrNoCar}="☑"))>0))`;
          helperData.push([
            cCell(item.sheetName),
            cCell(item.statusName),
            cCell(item.customer),
            cCell(item.route),
            cCell(item.vtype),
            formulaCell(`C${rowNum}&"|"&D${rowNum}&"|"&E${rowNum}`, { align: 'left' }),
            formulaCell(`--((I${rowNum}+J${rowNum})>0)`, { numFmt: '#,##0', align: 'right' }),
            formulaCell(checkedTripsFormula, { numFmt: '#,##0', align: 'right' }),
            formulaCell(`COUNTIFS(${criteria},${sourcePromo},"☑")`, { numFmt: '#,##0', align: 'right' }),
            formulaCell(`COUNTIFS(${criteria},${sourcePushOrNoCar},"☑")`, { numFmt: '#,##0', align: 'right' }),
            formulaCell(`COUNTIFS(${criteria})`, { numFmt: '#,##0', align: 'right' })
          ]);
        });
        if (helperData.length === 1) {
          helperData.push([cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(''), cCell(0), cCell(0), cCell(0), cCell(0), cCell(0)]);
        }
        const ws = XLSX.utils.aoa_to_sheet(helperData);
        ws['!cols'] = [
          { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 34 }, { wch: 16 },
          { wch: 44 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 16 }
        ];
        ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
        return ws;
      };
      XLSX.utils.book_append_sheet(wb, buildQaHelperSheet(), qaHelperSheetName);

      const printSettingsBySheet = {
        'สรุปผลดำเนินงาน': { printTitlesRow: '1:3' },
        'รายเส้นทางที่ถูกเปรียบเทียบ': { printTitlesRow: '$1:$2' },
        'รายเส้นทางที่เปรียบเทียบ': { printTitlesRow: '1:3' },
        'ขาดทุน': { printTitlesRow: '1:3' },
        'สำรองน้ำมัน > 50%': { printTitlesRow: '1:3' },
        'ราคาจ่ายผิดปกติ': { printTitlesRow: '1:3' },
        'ราคารับผิดปกติ': { printTitlesRow: '1:3' },
        'ข้อมูลไม่เปลี่ยนแปลง': { printTitlesRow: '1:3' },
        'ไม่มีข้อมูลเปรียบเทียบ': { printTitlesRow: '1:3' }
      };
      if (!_isSingleMode) {
        compareStatusSheetConfigs.forEach(s => {
          printSettingsBySheet[s.name] = { printTitlesRow: '$1:$2' };
        });
        printSettingsBySheet['รายเส้นทางที่ถูกเปรียบเทียบ'] = { printTitlesRow: '$1:$2' };
      }

      const safeFilePart = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
      const fileName = 'วิเคราะห์ผลการดำเนินงาน_' + safeFilePart(periodALabel) + (_isSingleMode ? '' : '_vs_' + safeFilePart(periodBLabel)) + '.xlsx';
      try {
        await writeWorkbookWithPrintSettings(wb, fileName, printSettingsBySheet);
      } catch (err) {
        console.error(err);
        alert(err?.message || 'Export XLSX ไม่สำเร็จ');
      }
    };

    // ACTIVE QA RENDER OVERRIDES (Daily Compare):
    // These functions are the active UI for:
    // - normal single-period QA route review
    // - matched A/B anomaly comparison
    // - unmatched A/B trip review
    // They intentionally override the legacy functions above before dcRunCompare()
    // runs. Keep export capture ids stable:
    // dc_anom_capture, dc_unm_capture.
    //
    // Cleanup plan after the QA layout is finalized:
    // 1. Keep this block and shared helpers it still calls, such as rangeStats(),
    //    getOilPriceByDate(), renderCompareStatusFilter(), and dcExportModalPng().
    // 2. Remove the legacy renderer/modal block marked above.
    // 3. Re-test normal mode, matched comparison, unmatched A/B, popup opening,
    //    status filters, XLSX export, and PNG export.
    const dcQaExportIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h120v80H240v400h480v-400H600v-80h120q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm200-240v-447l-64 64-56-57 160-160 160 160-56 57-64-64v447h-80Z"/></svg>';
    const dcQaStatusOrder = ['loss', 'oil50', 'payHigh', 'recvLow', 'payOilChanged', 'recvOilChanged', 'normal', 'noRef'];
    const dcQaInfoStatusOrder = ['payBasePattern', 'recvBasePattern'];

    function dcQaStatusLabels() {
      return {
        loss: 'ขาดทุน',
        oil50: 'สำรองน้ำมัน>50%',
        payHigh: 'ราคาจ่ายผิดปกติ',
        payOilChanged: 'ราคาจ่ายเปลี่ยนแปลงตามราคาน้ำมัน',
        recvLow: 'ราคารับผิดปกติ',
        recvOilChanged: 'ราคารับเปลี่ยนแปลงตามราคาน้ำมัน',
        normal: 'ข้อมูลไม่เปลี่ยนแปลง',
        noRef: 'ไม่มีข้อมูลเปรียบเทียบ'
      };
    }

    function getCompareStatusLabelMap() {
      return dcQaStatusLabels();
    }

    function dcQaInfoStatusLabels() {
      return {
        payBasePattern: 'ราคาจ่ายเป็นรูปแบบราคากลางของวัน',
        recvBasePattern: 'ราคารับเป็นรูปแบบราคากลางของวัน'
      };
    }

    function dcQaIsInfoStatus(status) {
      return status === 'payBasePattern' || status === 'recvBasePattern';
    }

    function dcQaIsOilChangeStatus(status) {
      return status === 'payOilChanged' || status === 'recvOilChanged';
    }

    function dcQaStatusRank(statuses) {
      const values = statuses || [];
      if (values.includes('loss')) return 4;
      if (values.includes('oil50')) return 3;
      if (values.includes('payHigh') || values.includes('recvLow')) return 2;
      if (values.includes('payOilChanged')) return 0;
      if (values.includes('recvOilChanged')) return 0;
      if (values.includes('normal')) return 0;
      if (values.includes('noRef')) return 0;
      return 1;
    }

    function dcQaHasAnomalyStatus(statuses) {
      return (statuses || []).some(status =>
        status !== 'normal' &&
        status !== 'noRef' &&
        !dcQaIsInfoStatus(status) &&
        !dcQaIsOilChangeStatus(status)
      );
    }

    function dcQaShouldDisplayPrimaryRow(row) {
      const statuses = row?.statuses || [];
      const infoStatuses = row?.infoStatuses || [];
      return dcQaHasAnomalyStatus(statuses) || infoStatuses.length === 0;
    }

    function dcQaCollectDisplayStatuses(rows = []) {
      const set = new Set();
      (rows || []).filter(dcQaShouldDisplayPrimaryRow).forEach(row => {
        (row?.statuses || []).forEach(status => set.add(status));
      });
      return [...set];
    }

    function dcQaStatusSummaryText(statuses, anomalyCount, anomalyUnit, options = {}) {
      if (anomalyCount > 0) return `ต้องตรวจสอบ ${anomalyCount} ${anomalyUnit || 'รายการ'}`;
      const basePatternCount = Number(options?.basePatternCount) || 0;
      if (basePatternCount > 0) return `มีรูปแบบราคากลางของวัน ${basePatternCount} ${anomalyUnit || 'รายการ'}`;
      const values = new Set(statuses || []);
      if (values.has('payOilChanged')) return 'ราคาจ่ายเปลี่ยนแปลงตามราคาน้ำมัน';
      if (values.has('recvOilChanged')) return 'ราคารับเปลี่ยนแปลงตามราคาน้ำมัน';
      if (values.has('noRef')) return 'ไม่มีข้อมูลเปรียบเทียบ';
      return 'ข้อมูลไม่เปลี่ยนแปลง';
    }

    function dcQaShortDate(iso) {
      const parts = String(iso || '').split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0].slice(-2)}`;
      return iso || '-';
    }

    function dcQaNum(value, mutedDash = true) {
      return hasNum(value) ? fmt(value) : (mutedDash ? '<span class="dc-qa-muted">-</span>' : '-');
    }

    function dcQaOilPrice(date) {
      const price = getOilPriceByDate(date);
      return hasNum(price) ? fmt(price) : '<span class="dc-qa-muted">-</span>';
    }

    function dcQaStatusBadges(statuses, infoStatuses = []) {
      const labels = { ...dcQaStatusLabels(), ...dcQaInfoStatusLabels() };
      const mainStatuses = [...new Set((statuses && statuses.length ? statuses : ['normal']).map(s => s === 'oilHigh' ? 'payHigh' : s))];
      const infoList = [...new Set((infoStatuses || []).filter(Boolean))];
      const values = (infoList.length ? mainStatuses.filter(key => key !== 'normal') : mainStatuses).concat(infoList);
      const unique = [...new Set(values.length ? values : ['normal'])];
      const order = [...dcQaStatusOrder, ...dcQaInfoStatusOrder];
      unique.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      // data-status-key on each badge enables per-badge filtering by the status panel
      // (used in single-mode "Lens" filtering — show only the status the user picked).
      return `<div class="dc-qa-badges">${unique.map(key => `<span class="dc-qa-badge is-${esc(key)}" data-status-key="${esc(key)}">${esc(labels[key] || key)}</span>`).join('')}</div>`;
    }

    function dcQaRouteKey(r) {
      return routeIdentityKey(r);
    }

    function dcQaValidDriver(driver) {
      const d = String(driver || '').trim();
      return d && d !== '-' && !/^null$/i.test(d) && !/^nan$/i.test(d);
    }

    function dcQaDriverKey(driver) {
      return String(driver || '').trim().toUpperCase();
    }

    function dcQaBuildDriverBuckets(trips = []) {
      const buckets = new Map();
      (trips || []).forEach(trip => {
        const key = dcQaDriverKey(trip?.driver);
        if (!dcQaValidDriver(key)) return;
        const list = buckets.get(key);
        if (list) list.push(trip);
        else buckets.set(key, [trip]);
      });
      return buckets;
    }

    function dcQaConsumeDriverMatch(buckets, driver) {
      const key = dcQaDriverKey(driver);
      const list = buckets?.get(key);
      return list && list.length ? list.shift() : null;
    }

    function dcQaStatusPeersForTrip(trip, refTrips = []) {
      const tripDriver = dcQaDriverKey(trip?.driver);
      if (!tripDriver || tripDriver === '-' || !dcQaValidDriver(tripDriver)) return [trip, ...(refTrips || [])];
      const matchedRefs = (refTrips || []).filter(refTrip => dcQaDriverKey(refTrip?.driver) === tripDriver);
      return matchedRefs.length ? [trip, ...matchedRefs] : [trip, ...(refTrips || [])];
    }

    function dcQaAttachMatchedRefTrips(entries = [], refTrips = []) {
      const normalizeDriverKey = trip => String(trip?.driver || '').trim().toUpperCase();
      const refBuckets = {};
      const refFallback = [];
      (refTrips || []).forEach(refTrip => {
        const key = normalizeDriverKey(refTrip);
        if (key && key !== '-') {
          if (!refBuckets[key]) refBuckets[key] = [];
          refBuckets[key].push(refTrip);
        }
        refFallback.push(refTrip);
      });
      const removeFromBucket = trip => {
        const key = normalizeDriverKey(trip);
        if (!key || !refBuckets[key] || !refBuckets[key].length) return;
        const idx = refBuckets[key].indexOf(trip);
        if (idx >= 0) refBuckets[key].splice(idx, 1);
      };
      const consumeSpecificRefTrip = preferredTrip => {
        if (!preferredTrip) return null;
        const idx = refFallback.indexOf(preferredTrip);
        if (idx < 0) return null;
        refFallback.splice(idx, 1);
        removeFromBucket(preferredTrip);
        return preferredTrip;
      };
      const consumeRefTrip = (aTrip, preferredTrip = null) => {
        const preferredPicked = consumeSpecificRefTrip(preferredTrip);
        if (preferredPicked) return preferredPicked;
        const key = normalizeDriverKey(aTrip);
        let picked = null;
        if (key && refBuckets[key] && refBuckets[key].length) picked = refBuckets[key].shift();
        else if (refFallback.length) {
          picked = refFallback[0];
          removeFromBucket(picked);
        }
        if (!picked) return null;
        const idx = refFallback.indexOf(picked);
        if (idx >= 0) refFallback.splice(idx, 1);
        return picked;
      };
      const linkedEntries = (entries || []).map(entry => {
        const clone = { ...(entry || {}) };
        clone.matchedRefTrip = consumeRefTrip(clone?.ra || {}, clone?.matchedRefTrip || null);
        return clone;
      });
      return { entries: linkedEntries, leftoverRefTrips: refFallback.slice() };
    }

    function dcQaBuildZigzagEntrySequence(entries = [], leftoverRefTrips = []) {
      const seq = [];
      (entries || []).forEach(entry => {
        seq.push({ kind: 'a', entry });
        if (entry?.matchedRefTrip) seq.push({ kind: 'ref', trip: entry.matchedRefTrip });
      });
      (leftoverRefTrips || []).forEach(refTrip => seq.push({ kind: 'ref', trip: refTrip }));
      return seq;
    }

    function dcQaPatternDateKey(date) {
      return String(date || '').trim();
    }

    function dcQaPatternValueKey(value) {
      return hasNum(value) ? Number(value).toFixed(4) : '';
    }

    function dcQaPairPatternValueKey(mainValue, peerValue) {
      const mainKey = dcQaPatternValueKey(mainValue);
      const peerKey = dcQaPatternValueKey(peerValue);
      if (!mainKey || !peerKey) return '';
      if (!hasNum(mainValue) || !hasNum(peerValue)) return '';
      if (Math.abs(Number(mainValue) - Number(peerValue)) < 0.0001) return '';
      return `${mainKey}|${peerKey}`;
    }

    function dcQaBuildDominantFieldMap(rows = [], field) {
      const byDate = new Map();
      (rows || []).forEach(row => {
        const dateKey = dcQaPatternDateKey(row?.date);
        const valueKey = dcQaPatternValueKey(row?.[field]);
        if (!dateKey || !valueKey) return;
        let dateBucket = byDate.get(dateKey);
        if (!dateBucket) {
          dateBucket = { total: 0, values: new Map() };
          byDate.set(dateKey, dateBucket);
        }
        dateBucket.total += 1;
        const current = dateBucket.values.get(valueKey) || { value: Number(row?.[field]) || 0, count: 0 };
        current.count += 1;
        dateBucket.values.set(valueKey, current);
      });
      const dominant = new Map();
      byDate.forEach((bucket, dateKey) => {
        const ranked = Array.from(bucket.values.values()).sort((a, b) => b.count - a.count || a.value - b.value);
        if (!ranked.length) return;
        const top = ranked[0];
        const second = ranked[1];
        const hasClearWinner = top.count >= 2 && (!second || top.count > second.count);
        if (!hasClearWinner) return;
        dominant.set(dateKey, { value: top.value, count: top.count, total: bucket.total });
      });
      return dominant;
    }

    function dcQaBuildPatternContext(rows = []) {
      return {
        pay: dcQaBuildDominantFieldMap(rows, 'pay'),
        recv: dcQaBuildDominantFieldMap(rows, 'recv')
      };
    }

    function dcQaBuildPairPatternFieldMap(pairs = [], field) {
      const counts = new Map();
      (pairs || []).forEach(pair => {
        const ra = pair?.ra || pair?.a || null;
        const rb = pair?.rb || pair?.b || null;
        const signature = dcQaPairPatternValueKey(ra?.[field], rb?.[field]);
        if (!signature) return;
        counts.set(signature, (counts.get(signature) || 0) + 1);
      });
      return counts;
    }

    function dcQaBuildPairPatternContext(pairs = []) {
      return {
        pay: dcQaBuildPairPatternFieldMap(pairs, 'pay'),
        recv: dcQaBuildPairPatternFieldMap(pairs, 'recv')
      };
    }

    function dcQaGetPairPatternCount(ctx, field, mainValue, peerValue) {
      const signature = dcQaPairPatternValueKey(mainValue, peerValue);
      if (!signature) return 0;
      return Number(ctx?.[field]?.get(signature) || 0);
    }

    function dcQaIsPairBasePattern(ctx, field, mainValue, peerValue) {
      return dcQaGetPairPatternCount(ctx, field, mainValue, peerValue) >= 2;
    }

    function dcQaGetDominantPatternValue(ctx, field, date) {
      return ctx?.[field]?.get(dcQaPatternDateKey(date)) || null;
    }

    function dcQaValueMatchesPattern(value, pattern) {
      return !!pattern && hasNum(value) && Math.abs(Number(value) - Number(pattern.value)) < 0.0001;
    }

    function dcQaIsBasePatternPair(tripValue, peerValue, tripPattern, peerPattern) {
      if (!dcQaValueMatchesPattern(tripValue, tripPattern)) return false;
      if (!dcQaValueMatchesPattern(peerValue, peerPattern)) return false;
      if (!hasNum(tripValue) || !hasNum(peerValue)) return false;
      return Math.abs(Number(tripValue) - Number(peerValue)) >= 0.0001;
    }

    function dcQaAnalyzeMatchedPair(ra, rb, pairPatternCtx = null, options = {}) {
      const statuses = new Set();
      const infoStatuses = new Set();
      const includePeerIntrinsic = !!options.includePeerIntrinsic;

      const addIntrinsicStatuses = trip => {
        if (!trip) return;
        if ((trip.margin || 0) < 0) statuses.add('loss');
        if ((trip.oil || 0) > (trip.pay || 0) * 0.5 && (trip.pay || 0) > 0) statuses.add('oil50');
      };

      addIntrinsicStatuses(ra);
      if (includePeerIntrinsic) addIntrinsicStatuses(rb);

      const tripOilPrice = getOilPriceByDate(ra?.date);
      const peerOilPrice = getOilPriceByDate(rb?.date);
      const tripPay = ra?.pay || 0;
      const peerPay = rb?.pay || 0;
      const tripRecv = ra?.recv || 0;
      const peerRecv = rb?.recv || 0;

      if (hasNum(tripPay) && hasNum(peerPay) && Math.abs(tripPay - peerPay) >= 0.0001) {
        if (dcQaIsPairBasePattern(pairPatternCtx, 'pay', tripPay, peerPay)) {
          infoStatuses.add('payBasePattern');
        } else if (hasNum(tripOilPrice) && hasNum(peerOilPrice) && Math.abs(tripOilPrice - peerOilPrice) >= 0.0001) {
          statuses.add('payOilChanged');
        } else {
          statuses.add('payHigh');
        }
      }

      if (hasNum(tripRecv) && hasNum(peerRecv) && Math.abs(tripRecv - peerRecv) >= 0.0001) {
        if (dcQaIsPairBasePattern(pairPatternCtx, 'recv', tripRecv, peerRecv)) {
          infoStatuses.add('recvBasePattern');
        } else if (hasNum(tripOilPrice) && hasNum(peerOilPrice)) {
          if (Math.abs(tripOilPrice - peerOilPrice) < 0.0001) {
            statuses.add('recvLow');
          } else {
            statuses.add('recvOilChanged');
          }
        }
      }

      if (!statuses.size) statuses.add('normal');
      return {
        statuses: [...statuses].sort((a, b) => dcQaStatusOrder.indexOf(a) - dcQaStatusOrder.indexOf(b)),
        infoStatuses: [...infoStatuses].sort((a, b) => dcQaInfoStatusOrder.indexOf(a) - dcQaInfoStatusOrder.indexOf(b))
      };
    }

    function dcQaAnalyzeTrip(trip, peers = [], patternCtx = null) {
      const statuses = new Set();
      const infoStatuses = new Set();
      if ((trip.margin || 0) < 0) statuses.add('loss');
      if ((trip.oil || 0) > (trip.pay || 0) * 0.5 && (trip.pay || 0) > 0) statuses.add('oil50');

      const peerRows = (peers || []).filter(peer => peer && peer !== trip);
      const tripDriver = dcQaDriverKey(trip?.driver);
      const sameDriverPeers = peerRows.filter(peer => {
        const peerDriver = dcQaDriverKey(peer?.driver);
        return dcQaValidDriver(tripDriver) && dcQaValidDriver(peerDriver) && tripDriver === peerDriver;
      });
      const comparisonPeers = sameDriverPeers.length ? sameDriverPeers : peerRows;

      const anomalyPairs = [];
      const basePatternPairs = [];

      if (comparisonPeers.length > 0) {
        const tripPay = trip.pay || 0;
        const tripRecv = trip.recv || 0;
        const tripOilPrice = getOilPriceByDate(trip?.date);
        const tripPayPattern = dcQaGetDominantPatternValue(patternCtx?.current, 'pay', trip?.date);
        const tripRecvPattern = dcQaGetDominantPatternValue(patternCtx?.current, 'recv', trip?.date);

        for (const peer of comparisonPeers) {
          const pairStatuses = new Set();
          const pairInfoStatuses = new Set();
          const peerPayPattern = dcQaGetDominantPatternValue(patternCtx?.peer, 'pay', peer?.date);
          const peerRecvPattern = dcQaGetDominantPatternValue(patternCtx?.peer, 'recv', peer?.date);
          const peerPay = peer.pay || 0;
          const peerRecv = peer.recv || 0;

          if (hasNum(tripPay) && hasNum(peerPay) && Math.abs(tripPay - peerPay) >= 0.0001) {
            const peerOilPrice = getOilPriceByDate(peer?.date);
            if (dcQaIsBasePatternPair(tripPay, peerPay, tripPayPattern, peerPayPattern)) {
              pairInfoStatuses.add('payBasePattern');
            } else if (hasNum(tripOilPrice) && hasNum(peerOilPrice) && Math.abs(tripOilPrice - peerOilPrice) >= 0.0001) {
              pairStatuses.add('payOilChanged');
            } else {
              pairStatuses.add('payHigh');
            }
          }

          if (hasNum(tripRecv) && hasNum(peerRecv) && Math.abs(tripRecv - peerRecv) >= 0.0001) {
            const peerOilPrice = getOilPriceByDate(peer?.date);
            if (hasNum(tripOilPrice) && hasNum(peerOilPrice)) {
              if (dcQaIsBasePatternPair(tripRecv, peerRecv, tripRecvPattern, peerRecvPattern)) {
                pairInfoStatuses.add('recvBasePattern');
              } else if (Math.abs(tripOilPrice - peerOilPrice) < 0.0001) {
                pairStatuses.add('recvLow');
              } else {
                pairStatuses.add('recvOilChanged');
              }
            }
          }

          if (pairStatuses.size > 0) {
            pairStatuses.forEach(status => statuses.add(status));
            pairInfoStatuses.forEach(status => infoStatuses.add(status));
            anomalyPairs.push({
              peer,
              statuses: [...pairStatuses].sort((a, b) => dcQaStatusOrder.indexOf(a) - dcQaStatusOrder.indexOf(b)),
              infoStatuses: [...pairInfoStatuses].sort((a, b) => dcQaInfoStatusOrder.indexOf(a) - dcQaInfoStatusOrder.indexOf(b))
            });
          } else if (pairInfoStatuses.size > 0) {
            pairInfoStatuses.forEach(status => infoStatuses.add(status));
            basePatternPairs.push({
              peer,
              infoStatuses: [...pairInfoStatuses].sort((a, b) => dcQaInfoStatusOrder.indexOf(a) - dcQaInfoStatusOrder.indexOf(b))
            });
          }
        }
      }

      if (!statuses.size) statuses.add(comparisonPeers.length > 0 ? 'normal' : 'noRef');
      const orderedStatuses = [...statuses].sort((a, b) => dcQaStatusOrder.indexOf(a) - dcQaStatusOrder.indexOf(b));
      const orderedInfoStatuses = [...infoStatuses].sort((a, b) => dcQaInfoStatusOrder.indexOf(a) - dcQaInfoStatusOrder.indexOf(b));
      return {
        statuses: orderedStatuses,
        infoStatuses: orderedInfoStatuses,
        comparisonPeersCount: comparisonPeers.length,
        matchedRefTrip: anomalyPairs[0]?.peer || basePatternPairs[0]?.peer || comparisonPeers[0] || null,
        anomalyPairs,
        basePatternPairs
      };
    }

    function dcQaTripStatuses(trip, peers = [], patternCtx = null) {
      return dcQaAnalyzeTrip(trip, peers, patternCtx).statuses;
    }

    // Status logic for matched-pair mode (Anomaly view):
    // ใช้ฐานคิดเดียวกับ normal view โดยประเมินทั้งฝั่ง A และ B ด้วยกฎเดียวกัน
    // แล้วรวม tag ที่ได้จากทั้งสองฝั่งเข้าด้วยกัน
    function dcQaAnalyzeComparePair(ra, rb, ctxA = null, ctxB = null) {
      const left = dcQaAnalyzeTrip(ra || {}, [ra || {}, rb || {}], { current: ctxA, peer: ctxB });
      const right = dcQaAnalyzeTrip(rb || {}, [rb || {}, ra || {}], { current: ctxB, peer: ctxA });
      const pairStatuses = [...left.statuses, ...right.statuses];
      const unique = [...new Set(pairStatuses)];
      const cleaned = unique.some(status => status !== 'normal')
        ? unique.filter(status => status !== 'normal')
        : (unique.includes('noRef') ? ['noRef'] : ['normal']);
      const infoSet = new Set([...left.infoStatuses, ...right.infoStatuses]);
      if (cleaned.some(status => status === 'payHigh' || status === 'payOilChanged')) infoSet.delete('payBasePattern');
      if (cleaned.some(status => status === 'recvLow' || status === 'recvOilChanged')) infoSet.delete('recvBasePattern');
      cleaned.sort((a, b) => dcQaStatusOrder.indexOf(a) - dcQaStatusOrder.indexOf(b));
      return {
        statuses: cleaned,
        infoStatuses: [...infoSet].sort((a, b) => dcQaInfoStatusOrder.indexOf(a) - dcQaInfoStatusOrder.indexOf(b)),
        left,
        right
      };
    }

    function dcQaCompareStatuses(ra, rb, ctxA = null, ctxB = null) {
      return dcQaAnalyzeComparePair(ra, rb, ctxA, ctxB).statuses;
    }

    function dcQaPairNotes(ra, rb, statuses) {
      const labels = [];
      if (statuses.includes('loss')) labels.push('ตรวจส่วนต่าง');
      if (statuses.includes('oil50')) labels.push('ตรวจสำรองน้ำมัน');
      if (statuses.includes('payHigh')) labels.push(`ราคาจ่าย A/B ต่างกัน ${fmt(Math.abs((ra.pay || 0) - (rb.pay || 0)))}`);
      if (statuses.includes('payOilChanged')) labels.push(`ราคาจ่าย A/B ต่างกันตามราคาน้ำมัน ${fmt(Math.abs((ra.pay || 0) - (rb.pay || 0)))}`);
      if ((ra.oil || 0) > (rb.oil || 0)) labels.push(`น้ำมัน A สูงกว่า B ${fmt((ra.oil || 0) - (rb.oil || 0))}`);
      if (statuses.includes('recvLow')) labels.push(`ราคารับ A/B ไม่เท่ากัน ${fmt(Math.abs((ra.recv || 0) - (rb.recv || 0)))}`);
      if (statuses.includes('recvOilChanged')) labels.push(`ราคารับ A/B ต่างกันตามราคาน้ำมัน ${fmt(Math.abs((ra.recv || 0) - (rb.recv || 0)))}`);
      if (statuses.includes('noRef')) labels.push('ไม่มีข้อมูลเปรียบเทียบ');
      return labels.length ? labels.join(', ') : 'ไม่มีสัญญาณเพิ่ม';
    }

    function dcQaPairTextCell(a, b, cls = '') {
      return `<div class="dc-qa-pair-cell ${cls}">
        <div class="dc-qa-ab-row"><i class="dc-qa-ab-dot is-a"></i><span>${esc(a || '-')}</span></div>
        <div class="dc-qa-ab-row"><i class="dc-qa-ab-dot is-b"></i><span>${esc(b || '-')}</span></div>
      </div>`;
    }

    function dcQaPairCell(a, b, cls = '', isModal = false, invertColor = false) {
      const canDiff = hasNum(a) && hasNum(b);
      const diff = canDiff ? (Number(a) - Number(b)) : 0;
      let diffClass = 'is-muted';
      if (canDiff) {
        if (Math.abs(diff) < 0.0001) {
          diffClass = 'is-zero';
        } else {
          const isGood = invertColor ? (diff < 0) : (diff > 0);
          diffClass = isGood ? 'is-positive' : 'is-negative';
        }
      }
      const diffText = canDiff ? `${diff > 0 ? '+' : ''}${fmt(diff)}` : '-';
      return `<div class="dc-qa-pair-cell ${cls} ${isModal && canDiff && Math.abs(diff) >= 0.0001 ? 'has-inline-delta' : ''}">
        <div class="dc-qa-ab-row">
          <i class="dc-qa-ab-dot is-a"></i>
          <span>${dcQaNum(a, false)}</span>${isModal && canDiff && Math.abs(diff) >= 0.0001 ? ` <span class="dc-qa-inline-delta ${diffClass}">&Delta;&nbsp;${diffText}</span>` : ''}
        </div>
        <div class="dc-qa-ab-row">
          <i class="dc-qa-ab-dot is-b"></i>
          <span>${dcQaNum(b, false)}</span>
        </div>
      </div>`;
    }

    function dcQaPairDiffCell(a, b) {
      const classA = (a || 0) >= 0 ? 'is-positive' : 'is-negative';
      const classB = (b || 0) >= 0 ? 'is-positive' : 'is-negative';
      return `<div class="dc-qa-pair-cell is-diff">
        <div class="dc-qa-ab-row"><i class="dc-qa-ab-dot is-a"></i><span class="${classA}">${dcQaNum(a, false)}</span></div>
        <div class="dc-qa-ab-row"><i class="dc-qa-ab-dot is-b"></i><span class="${classB}">${dcQaNum(b, false)}</span></div>
      </div>`;
    }

    function dcQaSingleCustomerSummaryCard(customer, items, routeCardsHtml = '') {
      const colors = { 'FLASH': '#3b82f6', 'BEST EXPRESS': '#8b5cf6', 'BEST': '#8b5cf6', 'J&T': '#f59e0b', 'KEX': '#10b981', 'SGT': '#ec4899', 'SPX-FSOC': '#06b6d4', 'SPX': '#06b6d4' };
      const routes = items.map(item => item.route || {});
      const trips = routes.reduce((sum, r) => sum + (r.trips || 0), 0);
      const recv = routes.reduce((sum, r) => sum + (r.recv || 0), 0);
      const pay = routes.reduce((sum, r) => sum + (r.pay || 0), 0);
      const oil = routes.reduce((sum, r) => sum + (r.oil || 0), 0);
      const margin = routes.reduce((sum, r) => sum + (r.margin || 0), 0);
      const pct = recv > 0 ? margin / recv * 100 : 0;
      const anoms = items.reduce((sum, item) => sum + (item.anomCount || 0), 0);
      const color = colors[String(customer || '').trim().toUpperCase()] || '#60a5fa';
      const tone = margin >= 0 ? '#22c55e' : '#ef4444';
      // data-customer-key lets the visibility updater locate this card and recompute
      // its aggregates from the currently-visible route cards inside it.
      const customerKey = String(customer || '').trim();
      return `<section class="dc-normal-customer-card" data-customer-key="${esc(customerKey)}">
        <div class="dc-normal-customer-main">
          <div class="dc-normal-customer-id">
            <span class="dc-normal-dot" style="background:${color};box-shadow:0 0 10px ${color}55"></span>
            <div><h3>${esc(customer)}</h3><p><span class="js-cust-routes">${items.length}</span> เส้นทาง · <span class="js-cust-trips">${trips}</span> เที่ยว</p></div>
          </div>
          <div class="dc-normal-customer-score">
            <div><span>ส่วนต่างรวม</span><b class="js-cust-margin" style="color:${tone}">${fmt(margin)}</b></div>
            <div><span>กำไร %</span><b class="js-cust-pct" style="color:${tone}">${pct.toFixed(1)}%</b></div>
          </div>
        </div>
        <div class="dc-normal-customer-metrics">
          <div><span>ราคารับรวม</span><b class="js-cust-recv">${fmt(recv)}</b></div>
          <div><span>ราคาจ่ายรวม</span><b class="js-cust-pay">${fmt(pay)}</b></div>
          <div><span>สำรองน้ำมัน</span><b class="is-oil js-cust-oil">${fmt(oil)}</b></div>
          <div class="js-cust-anom-wrap">${anoms > 0
          ? `<span>ความผิดปกติ</span><b class="js-cust-anoms dc-normal-metrics-anom">${anoms}</b>`
          : `<span>ความผิดปกติ</span><b class="dc-normal-metrics-ok">0</b>`
        }</div>
        </div>
        ${routeCardsHtml ? `<div class="dc-normal-route-list">${routeCardsHtml}</div>` : ''}
      </section>`;
    }

    function dcQaSingleReportHead(cases, stA, refLabel) {
      const totalAnoms = cases.reduce((sum, item) => sum + (item.anomCount || 0), 0);
      const anomPill = totalAnoms > 0
        ? `<span class="dc-normal-stat-pill is-alert">
             <span class="dc-normal-stat-label">รายการผิดปกติ</span>
             <b id="dc-summary-anoms-normal" class="dc-normal-stat-value">${totalAnoms}</b>
           </span>`
        : `<span class="dc-normal-stat-pill is-ok">
             <span class="dc-normal-stat-label">ข้อมูลไม่เปลี่ยนแปลง</span>
             <b class="dc-normal-stat-value">—</b>
           </span>`;
      return `<header class="dc-normal-summary-head">
        <div class="dc-normal-title-wrap"><span></span><h2>รายงานวิเคราะห์เส้นทางประจำวัน</h2></div>
        <div class="dc-normal-summary-meta">
          ${anomPill}
          <span class="dc-normal-stat-pill">
            <span class="dc-normal-stat-label">เส้นทาง</span>
            <b id="dc-summary-routes-normal" class="dc-normal-stat-value">${cases.length}</b>
          </span>
          <span class="dc-normal-stat-pill">
            <span class="dc-normal-stat-label">เที่ยว</span>
            <b id="dc-summary-trips-normal" class="dc-normal-stat-value">${stA.trips || 0}</b>
          </span>
        </div>
      </header>`;
    }

    function dcQaSingleTripRow(r, statuses, isModal = false, infoStatuses = []) {
      const marginClass = (r.margin || 0) >= 0 ? 'is-positive' : 'is-negative';
      const isCompany = isModal && isCompanyTrip(r);
      const driverClass = isCompany ? 'dc-qa-driver is-company' : 'dc-qa-driver';
      const displayInfoStatuses = dcQaHasAnomalyStatus(statuses) ? [] : infoStatuses;
      return `<tr>
        <td class="dc-qa-date">${esc(dcQaShortDate(r.date))}</td>
        <td class="${driverClass}" title="${esc(r.driver || '-')}">${esc(r.driver || '-')}</td>
        ${isModal ? `<td>${esc(r.vtype || '-')}</td><td>${esc(r.plate || '-')}</td>` : ''}
        <td class="is-right">${dcQaOilPrice(r.date)}</td>
        <td class="is-right is-oil">${dcQaNum(r.oil)}</td>
        <td class="is-right">${dcQaNum(r.recv)}</td>
        <td class="is-right">${dcQaNum(r.pay)}</td>
        <td class="is-right ${marginClass}">${dcQaNum(r.margin)}</td>
        <td>${dcQaStatusBadges(statuses, displayInfoStatuses)}</td>
      </tr>`;
    }

    function dcQaPairRow(row, isModal = false) {
      const { ra, rb, statuses, infoStatuses = [] } = row;
      const isCompany = isModal && (isCompanyTrip(ra) || isCompanyTrip(rb));
      const driverClass = isCompany ? 'dc-qa-driver is-company' : 'dc-qa-driver';
      const displayInfoStatuses = dcQaHasAnomalyStatus(statuses) ? [] : infoStatuses;
      return `<tr>
        <td class="dc-qa-date"><span class="dc-qa-date-chip is-a">${esc(dcQaShortDate(ra.date))}</span></td>
        <td class="dc-qa-date"><span class="dc-qa-date-chip is-b">${esc(dcQaShortDate(rb.date))}</span></td>
        <td class="${driverClass}" title="${esc(ra.driver || rb.driver || '-')}">${esc(ra.driver || rb.driver || '-')}</td>
        ${isModal ? `<td>${dcQaPairTextCell(ra.vtype, rb.vtype)}</td><td>${dcQaPairTextCell(ra.plate, rb.plate)}</td>` : ''}
        <td>${dcQaPairCell(getOilPriceByDate(ra.date), getOilPriceByDate(rb.date), 'is-blue', isModal, true)}</td>
        <td>${dcQaPairCell(ra.oil, rb.oil, 'is-oil', isModal, true)}</td>
        <td>${dcQaPairCell(ra.recv, rb.recv, '', isModal, false)}</td>
        <td>${dcQaPairCell(ra.pay, rb.pay, '', isModal, true)}</td>
        <td class="dc-qa-td-diff">${dcQaPairDiffCell(ra.margin, rb.margin)}</td>
        <td class="dc-qa-td-flag">${dcQaStatusBadges(statuses, displayInfoStatuses)}</td>
      </tr>`;
    }

    function dcQaEmpty(text) {
      return `<div class="dc-qa-empty">${esc(text)}</div>`;
    }

    function dcQaModalShell(modalId, captureId, title, meta, exportBase, bodyHtml) {
      const existing = document.getElementById(modalId);
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'dc-qa-modal-backdrop';
      modal.onclick = e => { if (e.target === modal) modal.remove(); };
      modal.innerHTML = `
        <div id="${captureId}" data-export-root="1" class="dc-qa-modal">
          <div class="dc-qa-modal-head">
            <div class="dc-qa-modal-titleblock">
              <div class="dc-qa-modal-title">${title}</div>
              <div class="dc-qa-modal-meta">${meta}</div>
            </div>
            <div class="dc-qa-modal-actions">
              <button type="button" class="dc-qa-icon-btn" onclick="window.dcExportModalPng('${captureId}', '${exportBase}')" title="Export PNG" aria-label="Export PNG">${dcQaExportIcon}</button>
              <button type="button" class="dc-qa-close-btn" onclick="document.getElementById('${modalId}').remove()" aria-label="Close">&times;</button>
            </div>
          </div>
          <div class="dc-qa-modal-body">${bodyHtml}</div>
        </div>`;
      document.body.appendChild(modal);
    }

    function dcQaBuildAnomalyCards(stA, stB) {
      if (!stA || !stB) return [];
      const groupA = {}, groupB = {};
      (stA.rows || []).filter(r => dcQaValidDriver(r.driver)).forEach(r => {
        const k = dcQaRouteKey(r);
        const identity = getRouteIdentity(r);
        if (!groupA[k]) groupA[k] = { key: k, customer: r.customer || '-', route: identity.displayRoute || r.route || '-', routeKey: k, routeCore: identity.routeCore, routeVehicle: identity.routeVehicle, routeDesc: r.routeDesc || '-', vtype: r.vtype || '-', trips: [] };
        else if (!cleanRouteDisplayText(groupA[k].routeDesc) && cleanRouteDisplayText(r.routeDesc)) groupA[k].routeDesc = r.routeDesc;
        groupA[k].trips.push(r);
      });
      (stB.rows || []).filter(r => dcQaValidDriver(r.driver)).forEach(r => {
        const k = dcQaRouteKey(r);
        const identity = getRouteIdentity(r);
        if (!groupB[k]) groupB[k] = { key: k, customer: r.customer || '-', route: identity.displayRoute || r.route || '-', routeKey: k, routeCore: identity.routeCore, routeVehicle: identity.routeVehicle, routeDesc: r.routeDesc || '-', vtype: r.vtype || '-', trips: [] };
        else if (!cleanRouteDisplayText(groupB[k].routeDesc) && cleanRouteDisplayText(r.routeDesc)) groupB[k].routeDesc = r.routeDesc;
        groupB[k].trips.push(r);
      });

      const cards = [];
      Object.keys(groupA).filter(k => groupB[k]).forEach(key => {
        const ga = groupA[key];
        const gb = groupB[key];
        const gbDriverBuckets = dcQaBuildDriverBuckets(gb.trips);
        const matchedPairs = [];
        ga.trips.forEach(ra => {
          const rb = dcQaConsumeDriverMatch(gbDriverBuckets, ra.driver);
          if (!rb) return;
          matchedPairs.push({ ra, rb });
        });
        const pairPatternCtx = dcQaBuildPairPatternContext(matchedPairs);
        const rows = matchedPairs.map(({ ra, rb }) => {
          const analysis = dcQaAnalyzeMatchedPair(ra, rb, pairPatternCtx, { includePeerIntrinsic: true });
          return { ra, rb, statuses: analysis.statuses, infoStatuses: analysis.infoStatuses };
        });
        if (!rows.length) return;
        const anomRows = rows.filter(row => dcQaHasAnomalyStatus(row.statuses));
        const basePatternRows = rows.filter(row => !dcQaHasAnomalyStatus(row.statuses) && (row.infoStatuses || []).length);
        const previewRows = rows.filter(dcQaShouldDisplayPrimaryRow);
        const filterStatuses = dcQaCollectDisplayStatuses(rows);
        const statusSet = new Set();
        rows.forEach(row => row.statuses.forEach(s => statusSet.add(s)));
        rows.sort((a, b) => {
          const rankA = dcQaStatusRank(a.statuses);
          const rankB = dcQaStatusRank(b.statuses);
          if (rankB !== rankA) return rankB - rankA;
          return String(a.ra.date || '').localeCompare(String(b.ra.date || ''));
        });
        cards.push({
          key,
          ga,
          rows,
          anomRows,
          previewRows,
          basePatternRows,
          basePatternCount: basePatternRows.length,
          filterStatuses,
          statuses: [...statusSet],
          severity: Math.max(...rows.map(r => dcQaStatusRank(r.statuses)))
        });
      });
      cards.sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        const pa = custOrder[String(a.ga.customer || '').trim().toUpperCase()] ?? 999;
        const pb = custOrder[String(b.ga.customer || '').trim().toUpperCase()] ?? 999;
        if (pa !== pb) return pa - pb;
        return a.key.localeCompare(b.key, 'th');
      });
      return cards;
    }

    function dcQaBuildUnmatchedCards(stA, stB, side) {
      const isA = side === 'a';
      const mySt = isA ? stA : stB;
      const opSt = isA ? stB : stA;
      if (!mySt) return [];
      const myGroup = {}, opGroup = {};
      (mySt.rows || []).filter(r => dcQaValidDriver(r.driver)).forEach(r => {
        const k = dcQaRouteKey(r);
        const identity = getRouteIdentity(r);
        if (!myGroup[k]) myGroup[k] = { key: k, customer: r.customer || '-', route: identity.displayRoute || r.route || '-', routeKey: k, routeCore: identity.routeCore, routeVehicle: identity.routeVehicle, routeDesc: r.routeDesc || '-', vtype: r.vtype || '-', trips: [] };
        else if (!cleanRouteDisplayText(myGroup[k].routeDesc) && cleanRouteDisplayText(r.routeDesc)) myGroup[k].routeDesc = r.routeDesc;
        myGroup[k].trips.push(r);
      });
      (opSt?.rows || []).filter(r => dcQaValidDriver(r.driver)).forEach(r => {
        const k = dcQaRouteKey(r);
        if (!opGroup[k]) opGroup[k] = { trips: [] };
        opGroup[k].trips.push(r);
      });

      const cards = [];
      Object.keys(myGroup).forEach(key => {
        const ga = myGroup[key];
        const opTrips = opGroup[key]?.trips || [];
        const opDriverBuckets = dcQaBuildDriverBuckets(opTrips);
        const unmatched = [];
        ga.trips.forEach(rmy => {
          const matched = dcQaConsumeDriverMatch(opDriverBuckets, rmy.driver);
          if (!matched) unmatched.push(rmy);
        });
        if (!unmatched.length) return;
        // Use unmatched-only peer group (same period, same route) for fair comparison
        const unmatchedPatternCtx = dcQaBuildPatternContext(unmatched);
        const unRows = unmatched.map(ra => {
          const analysis = dcQaAnalyzeTrip(ra, unmatched, { current: unmatchedPatternCtx, peer: unmatchedPatternCtx });
          return { ra, statuses: analysis.statuses, infoStatuses: analysis.infoStatuses };
        }).sort((a, b) => {
          const rankA = dcQaStatusRank(a.statuses);
          const rankB = dcQaStatusRank(b.statuses);
          if (rankB !== rankA) return rankB - rankA;
          return String(a.ra.date || '').localeCompare(String(b.ra.date || ''));
        });
        const statusSet = new Set();
        unRows.forEach(row => row.statuses.forEach(s => statusSet.add(s)));
        cards.push({ key, ga, unRows, statuses: [...statusSet], severity: Math.max(...unRows.map(r => dcQaStatusRank(r.statuses))) });
      });
      cards.sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return a.key.localeCompare(b.key, 'th');
      });
      return cards;
    }

    function dcQaBuildCompareNoRefCards(stA, stB) {
      return dcQaBuildUnmatchedCards(stA, stB, 'a')
        .map(card => {
          const anomRows = (card.unRows || []).map(row => ({
            ra: row.ra || {},
            rb: {},
            statuses: ['noRef']
          }));
          return {
            key: `${card.key}|noRef`,
            ga: card.ga,
            anomRows,
            statuses: ['noRef'],
            severity: dcQaStatusRank(['noRef'])
          };
        })
        .filter(card => card.anomRows.length);
    }

    function renderAll(options = {}) {
      const animate = options.animate === true;
      const result = document.getElementById('dc_result');
      if (!result) return;
      const stateKey = renderStateKey();
      let html = '';
      if (_isSingleMode) {
        html = renderSingleTable(_stA, _stRef, _labelRef);
      } else {
        if (_viewMode !== 'anomaly') _viewMode = 'anomaly';
        const qfBar = renderQFBarModern();
        const tbl = renderAnomalyTable(_stA, _stB);
        html = qfBar + tbl;
      }
      const shouldUpdate = _renderMemo.key !== stateKey || _renderMemo.html !== html;
      if (shouldUpdate) {
        result.innerHTML = html;
        _renderMemo = { key: stateKey, html };
        if (!_isSingleMode) bindQFEvents();
        const currentMode = _isSingleMode ? 'normal' : 'anomaly';
        syncCompareStatusPanel(currentMode);
        updateCompareStatusVisibility(currentMode);
      }
      if (shouldUpdate && animate) dcAnimateSections();
    }

    function renderSingleTable(stA, stRef, labelRef) {
      if (!stA || !stA.routes || stA.routes.length === 0) return dcQaEmpty('ไม่มีข้อมูลสำหรับช่วงเวลาที่เลือก');

      // stRef is now an array of rangeStats objects (one per candidate day, nearest first).
      // Build per-day lookup: dateStr -> { routeKey -> trips[] }
      // Each route independently picks the nearest day that has data for it.
      const refDays = Array.isArray(stRef) ? stRef : (stRef ? [stRef] : []);
      const refDayMaps = refDays.map(st => {
        const map = {};
        (st.rows || []).forEach(r => {
          const k = dcQaRouteKey(r);
          if (!map[k]) map[k] = [];
          map[k].push(r);
        });
        return { dateLabel: fmtDate(st.dateStart), map };
      });
      const hasRef = refDayMaps.length > 0;
      const currentRouteRows = new Map();
      (stA.rows || []).forEach(r => {
        const key = `${r.customer || '-'}\u0001${dcCachedRouteIdentityKey(r)}\u0001${r.vtype || '-'}`;
        const list = currentRouteRows.get(key);
        if (list) list.push(r);
        else currentRouteRows.set(key, [r]);
      });
      currentRouteRows.forEach(list => list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))));

      // Per-route: find the nearest ref day that has trips for this route.
      const getRefForRoute = (routeKey) => {
        for (const day of refDayMaps) {
          if (day.map[routeKey] && day.map[routeKey].length > 0) {
            return { trips: day.map[routeKey].slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))), dateLabel: day.dateLabel };
          }
        }
        return null; // no ref data found for this route in any candidate day
      };

      const cases = stA.routes.map(route => {
        const bucketKey = `${route.customer || '-'}\u0001${routeIdentityKey(route)}\u0001${route.vtype || '-'}`;
        const trips = currentRouteRows.get(bucketKey) || [];

        // Per-route: find nearest ref day that has data for this route+vtype.
        const routeKey = trips.length > 0 ? dcQaRouteKey(trips[0]) : null;
        const refResult = (hasRef && routeKey) ? getRefForRoute(routeKey) : null;
        const refTripsForRoute = refResult ? refResult.trips : [];
        const rows = trips.map(ra => {
          const peers = dcQaStatusPeersForTrip(ra, refTripsForRoute);
          const analysis = dcQaAnalyzeTrip(ra, peers, null);
          return {
            ra,
            statuses: analysis.statuses,
            infoStatuses: analysis.infoStatuses,
            matchedRefTrip: analysis.matchedRefTrip,
            hasMatchedDriverRef: peers.length > 1
          };
        })
          .sort((a, b) => {
            const rankA = dcQaStatusRank(a.statuses);
            const rankB = dcQaStatusRank(b.statuses);
            if (rankB !== rankA) return rankB - rankA;
            return String(a.ra.date || '').localeCompare(String(b.ra.date || ''));
          });
        const attachResult = dcQaAttachMatchedRefTrips(rows, refTripsForRoute);
        const pairPatternCtx = dcQaBuildPairPatternContext(
          (attachResult.entries || []).filter(entry => entry?.ra && entry?.matchedRefTrip).map(entry => ({
            ra: entry.ra,
            rb: entry.matchedRefTrip
          }))
        );
        const normalizedRows = attachResult.entries.map(entry => {
          const displayedPeer = entry?.matchedRefTrip || null;
          if (!displayedPeer) return entry;
          const analysis = dcQaAnalyzeMatchedPair(entry.ra || {}, displayedPeer, pairPatternCtx, { includePeerIntrinsic: false });
          return {
            ...entry,
            statuses: analysis.statuses || entry?.statuses || ['normal'],
            infoStatuses: analysis.infoStatuses || entry?.infoStatuses || []
          };
        });
        const anomRows = normalizedRows.filter(r => dcQaHasAnomalyStatus(r.statuses));
        const basePatternRows = normalizedRows.filter(row => !dcQaHasAnomalyStatus(row.statuses) && (row.infoStatuses || []).length).map(row => ({
          ra: row.ra,
          statuses: row.statuses || ['normal'],
          infoStatuses: row.infoStatuses || [],
          matchedRefTrip: row.matchedRefTrip || null
        }));
        const previewRows = normalizedRows.filter(dcQaShouldDisplayPrimaryRow);
        const anomCount = anomRows.length;
        const filterStatuses = dcQaCollectDisplayStatuses(normalizedRows);
        const statusSet = new Set();
        normalizedRows.forEach(r => r.statuses.forEach(s => statusSet.add(s)));
        const statuses = [...statusSet];
        const hasComparedStatus = statuses.some(s => s === 'payHigh' || s === 'payOilChanged' || s === 'recvLow' || s === 'recvOilChanged');
        const hasUnpairedIntrinsicAnomaly = normalizedRows.some(row => {
          const rowStatuses = row.statuses || [];
          const intrinsicOnly = rowStatuses.some(s => s === 'loss' || s === 'oil50') &&
            !rowStatuses.some(s => s === 'payHigh' || s === 'payOilChanged' || s === 'recvLow' || s === 'recvOilChanged');
          return intrinsicOnly && !row.hasMatchedDriverRef;
        });
        const deferUnpairedIntrinsicCard = hasUnpairedIntrinsicAnomaly && !hasComparedStatus;
        return {
          route,
          rows: normalizedRows,
          previewRows,
          anomRows,
          basePatternRows,
          basePatternCount: basePatternRows.length,
          anomCount,
          filterStatuses,
          statuses,
          severity: Math.max(...normalizedRows.map(r => dcQaStatusRank(r.statuses))),
          refTripsForRoute,
          refDateLabel: refResult ? refResult.dateLabel : null,
          leftoverRefTrips: attachResult.leftoverRefTrips || [],
          deferUnpairedIntrinsicCard
        };
      }).sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        if (b.anomCount !== a.anomCount) return b.anomCount - a.anomCount;
        return routeDisplay(a.route).localeCompare(routeDisplay(b.route), 'th');
      });
      window._normalCardsData = cases;

      const normalOptionKeys = ['loss', 'oil50', 'payHigh', 'recvLow', 'normal', 'noRef'];
      const selectedNormalStatuses = getSelectedCompareStatuses('normal', normalOptionKeys);
      const selectedNormalSet = new Set(selectedNormalStatuses);
      const counts = {};
      normalOptionKeys.forEach(k => {
        counts[k] = cases.reduce((sum, item) => {
          return sum + (item.rows || [])
            .filter(row => dcQaShouldDisplayPrimaryRow(row) && (row.statuses || ['normal']).some(status => statusMatchesFilter(status, k)))
            .length;
        }, 0);
      });

      const renderCaseCard = (item) => {
        const { route, rows, anomCount, statuses } = item;
        const previewRows = item.previewRows || rows;
        const basePatternCount = item.basePatternCount || 0;
        const cardIdx = cases.indexOf(item);
        const displayStatuses = (item.filterStatuses && item.filterStatuses.length) ? item.filterStatuses : statuses;
        const displayStyle = statusesMatchFilterSet(displayStatuses, selectedNormalSet) ? '' : 'display:none;';

        // Reference-day trips for this route (already sorted by date in the cases loop).
        // Match key is route+vtype only; drivers are independent — show all ref trips.
        const refTripsForCard = item.refTripsForRoute || [];
        const trailingRefTrips = item.leftoverRefTrips || [];
        const routeHasRefTrips = refTripsForCard.length > 0;

        // Render a reference-day trip row (muted, no status badge).
        const renderRefRow = (refTrip) => {
          const refMarginClass = (refTrip.margin || 0) >= 0 ? 'is-positive' : 'is-negative';
          return `<tr class="dc-qa-ref-row">
            <td class="dc-qa-date">${esc(dcQaShortDate(refTrip.date))}</td>
            <td class="dc-qa-driver" title="${esc(refTrip.driver || '-')}">${esc(refTrip.driver || '-')}</td>
            <td class="is-right">${dcQaOilPrice(refTrip.date)}</td>
            <td class="is-right is-oil">${dcQaNum(refTrip.oil)}</td>
            <td class="is-right">${dcQaNum(refTrip.recv)}</td>
            <td class="is-right">${dcQaNum(refTrip.pay)}</td>
            <td class="is-right ${refMarginClass}">${dcQaNum(refTrip.margin)}</td>
            <td></td>
          </tr>`;
        };

        const buildMainFirstZigzagRowsHtml = (aRows, refRows) => {
          const sequence = dcQaBuildZigzagEntrySequence(aRows || [], refRows || []);
          return sequence.map(part => (
            part.kind === 'a'
              ? dcQaSingleTripRow(part.entry.ra, part.entry.statuses, false, part.entry.infoStatuses || [])
              : renderRefRow(part.trip)
          )).join('');
        };

        // Strip label: show the actual ref date used for THIS route (may differ per route).
        const cardRefLabel = item.refDateLabel || null;
        let stripRefLabel = '';
        if (routeHasRefTrips && cardRefLabel) {
          stripRefLabel = `<span class="dc-qa-ref-arrow">⇄</span><span class="dc-qa-ref-strip-label">${esc(cardRefLabel)} (${refTripsForCard.length} เที่ยว)</span>`;
        } else {
          // No ref data found for this route in any of the 3 candidate days.
          const nearestLabel = labelRef || (refDayMaps.length > 0 ? refDayMaps[0].dateLabel : '');
          const titleText = nearestLabel
            ? `ไม่พบเส้นทางนี้ในช่วงย้อนหลัง 3 วัน (เริ่มค้นหาจาก ${nearestLabel})`
            : 'ไม่พบข้อมูลเปรียบเทียบในช่วงย้อนหลัง 3 วัน';
          stripRefLabel = `<span class="dc-qa-ref-strip-label is-no-match" title="${esc(titleText)}">ไม่มีข้อมูลเปรียบเทียบในช่วงเวลา</span>`;
        }

        // Body rows: alternate A/ref rows for easier visual comparison.
        const rowsHtml = routeHasRefTrips
          ? buildMainFirstZigzagRowsHtml(previewRows, trailingRefTrips)
          : previewRows.map(row => dcQaSingleTripRow(row.ra, row.statuses, false, row.infoStatuses || [])).join('');

        const basePatternDisclosure = basePatternCount > 0
          ? `<div class="dc-qa-more dc-qa-more-base" onclick="event.stopPropagation(); window.dcOpenNormalBasePatternModal && window.dcOpenNormalBasePatternModal(${cardIdx})">มีรูปแบบราคากลางของวันอีก ${basePatternCount} เที่ยว (คลิกเพื่อดูรายละเอียด)</div>`
          : '';

        return `<article class="dc-qa-case dc-status-card dc-status-card-normal" data-severity="${item.severity}" data-status-keys="${esc(displayStatuses.join(','))}" data-anom-count="${anomCount}" data-base-count="${basePatternCount}" data-trip-count="${rows.length}" data-recv="${route.recv || 0}" data-pay="${route.pay || 0}" data-oil="${route.oil || 0}" data-margin="${route.margin || 0}" style="${displayStyle}">
          <header class="dc-qa-case-head">
            <div class="dc-qa-title-block">
              <div class="dc-qa-identity"><span class="dc-qa-customer">${esc(route.customer || '-')}</span><span class="dc-qa-vtype">${esc(route.vtype || '-')}</span></div>
              <h3 title="${esc(routeGroupHeaderDisplay(route))}">${esc(routeGroupHeaderDisplay(route))}</h3>
            </div>
            <div class="dc-qa-head-actions"></div>
          </header>
          <div class="dc-qa-case-strip">
            <span>${esc(fmtRange(stA.dateStart, stA.dateEnd))}</span>
            ${stripRefLabel}
            <span class="${anomCount ? 'dc-qa-anom-badge' : 'dc-qa-normal-badge'}">${dcQaStatusSummaryText(statuses, anomCount, 'เที่ยว', { basePatternCount })}</span>
          </div>
          <div class="dc-qa-table-wrap">
            <table class="dc-qa-table">
              <thead><tr><th>วันที่</th><th>พขร.</th><th class="is-right">ราคาน้ำมัน</th><th class="is-right">สำรองน้ำมัน</th><th class="is-right">ราคารับ</th><th class="is-right">ราคาจ่าย</th><th class="is-right">ส่วนต่าง</th><th>ความผิดปกติ</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          ${basePatternDisclosure}
        </article>`;
      };

      const groupedCases = {};
      cases.forEach(item => {
        const customer = item.route?.customer || '-';
        if (!groupedCases[customer]) groupedCases[customer] = [];
        groupedCases[customer].push(item);
      });
      const displayableCases = cases.filter(item => (item.filterStatuses && item.filterStatuses.length) || !(item.basePatternCount > 0 && (item.previewRows || []).length === 0));
      const body = Object.entries(groupedCases).sort((a, b) => {
        const pa = custOrder[String(a[0] || '').trim().toUpperCase()] ?? 999;
        const pb = custOrder[String(b[0] || '').trim().toUpperCase()] ?? 999;
        return pa !== pb ? pa - pb : String(a[0]).localeCompare(String(b[0]), 'th');
      }).map(([customer, items]) => {
        const sortedItems = items.slice().sort((a, b) => {
          const pa = a.deferUnpairedIntrinsicCard ? 1 : 0;
          const pb = b.deferUnpairedIntrinsicCard ? 1 : 0;
          return pa - pb;
        });
        const visibleItems = sortedItems.filter(item => (item.filterStatuses && item.filterStatuses.length) || !(item.basePatternCount > 0 && (item.previewRows || []).length === 0));
        return `<section class="dc-normal-customer-section" style="${visibleItems.some(item => statusesMatchFilterSet((item.filterStatuses && item.filterStatuses.length) ? item.filterStatuses : item.statuses, selectedNormalSet)) ? '' : 'display:none;'}">
        ${dcQaSingleCustomerSummaryCard(customer, visibleItems, visibleItems.map(renderCaseCard).join(''))}
      </section>`;
      }).join('');

      return `<section class="dc-qa-page">
        <section class="dc-normal-summary">
          ${dcQaSingleReportHead(displayableCases, stA, hasRef ? labelRef : null)}
          <div class="dc-summary-filter dc-normal-filter">${renderCompareStatusFilter('normal', normalOptionKeys, selectedNormalStatuses, counts)}</div>
        </section>
        ${body}
      </section>`;
    }

    function renderAnomalyTable(stA, stB) {
      if (!stA) return dcQaEmpty('กรุณาเลือกช่วงเวลาหลัก');
      const compareSt = stB || { rows: [] };
      const cardsData = [...dcQaBuildAnomalyCards(stA, compareSt), ...dcQaBuildCompareNoRefCards(stA, compareSt)];
      window._anomalyCardsData = cardsData;
      if (!cardsData.length) return dcQaEmpty('ไม่พบเส้นทางที่จับคู่ driver ได้ในช่วงเวลานี้');
      const optionKeys = ['loss', 'oil50', 'payHigh', 'recvLow', 'normal', 'noRef'];
      const selected = getSelectedCompareStatuses('anomaly', optionKeys);
      const selectedSet = new Set(selected);
      const visibleCards = cardsData.filter(card => statusesMatchFilterSet((card.filterStatuses && card.filterStatuses.length) ? card.filterStatuses : card.statuses, selectedSet));
      const visibleAnoms = visibleCards.reduce((sum, card) => sum + card.anomRows.filter(r => dcQaHasAnomalyStatus(r.statuses)).length, 0);
      const counts = {};
      optionKeys.forEach(k => {
        counts[k] = cardsData.reduce((sum, card) => {
          return sum + (card.anomRows || []).filter(row => (row.statuses || ['normal']).some(status => statusMatchesFilter(status, k))).length;
        }, 0);
      });
      const cardsHtml = cardsData.map((card, idx) => {
        const cardFilterStatuses = (card.filterStatuses && card.filterStatuses.length) ? card.filterStatuses : card.statuses;
        const displayStyle = statusesMatchFilterSet(cardFilterStatuses, selectedSet) ? '' : 'display:none;';
        const anomCount = card.anomRows.filter(r => dcQaHasAnomalyStatus(r.statuses)).length;
        const previewRows = (card.previewRows && card.previewRows.length ? card.previewRows : card.anomRows || []);
        const basePatternCount = card.basePatternCount || 0;
        const basePatternDisclosure = basePatternCount > 0
          ? `<div class="dc-qa-more dc-qa-more-base">มีรูปแบบราคากลางของวันอีก ${basePatternCount} คู่ (คลิกเพื่อดูรายละเอียด)</div>`
          : '';
        const overflowDisclosure = previewRows.length > 10
          ? `<div class="dc-qa-more">มีคู่เปรียบเทียบเพิ่มเติมอีก ${previewRows.length - 10} คู่ (คลิกเพื่อดูรายละเอียด)</div>`
          : '';
        return `<article class="dc-qa-case dc-status-card dc-status-card-anomaly" data-card-idx="${idx}" data-status-keys="${esc(cardFilterStatuses.join(','))}" data-anom-count="${anomCount}" data-base-count="${basePatternCount}" style="${displayStyle}" onclick="dcOpenAnomalyModal(${idx})">
          <header class="dc-qa-case-head">
            <div class="dc-qa-title-block">
              <div class="dc-qa-identity"><span class="dc-qa-customer">${esc(card.ga.customer || '-')}</span><span class="dc-qa-vtype">${esc(card.ga.vtype || '-')}</span></div>
              <h3 title="${esc(routeGroupHeaderDisplay(card.ga))}">${esc(routeGroupHeaderDisplay(card.ga))}</h3>
            </div>
            <div class="dc-qa-head-actions"></div>
          </header>
          <div class="dc-qa-case-strip"><span>${esc(_labelA)}</span><span>${esc(_labelB)}</span><span class="${anomCount ? 'dc-qa-anom-badge' : 'dc-qa-normal-badge'}">${dcQaStatusSummaryText(card.statuses, anomCount, 'คู่เปรียบเทียบ', { basePatternCount })}</span></div>
          <div class="dc-qa-table-wrap">
            <table class="dc-qa-table dc-qa-pair-table">
              <thead><tr><th>วันที่หลัก</th><th>วันที่เปรียบเทียบ</th><th>พขร.</th><th>ราคาน้ำมัน</th><th>สำรองน้ำมัน</th><th>ราคารับ</th><th>ราคาจ่าย</th><th class="dc-qa-th-diff">ส่วนต่าง</th><th class="dc-qa-th-flag">ความผิดปกติ</th></tr></thead>
              <tbody>${previewRows.slice(0, 10).map(row => dcQaPairRow(row, false)).join('')}</tbody>
            </table>
          </div>
          ${basePatternDisclosure}
          ${overflowDisclosure}
        </article>`;
      }).join('');
      return `<section class="dc-qa-page">
        <div class="dc-summary-head dc-qa-filter-head" style="flex-direction:column;align-items:flex-start;">
          <div class="dc-summary-copy"><h3 class="dc-summary-title">รายเส้นทางที่ถูกเปรียบเทียบ <span id="dc-summary-routes-anomaly">${visibleCards.length}</span> เส้นทาง</h3></div>
          <div class="dc-summary-filter" style="width:100%;min-width:0;">${renderCompareStatusFilter('anomaly', optionKeys, selected, counts)}</div>
        </div>
        ${cardsHtml}
      </section>`;
    }

    function renderUnmatchedTable(stA, stB, side) {
      return '';
      const isA = side === 'a';
      const myLabel = isA ? _labelA : _labelB;
      const cardsData = dcQaBuildUnmatchedCards(stA, stB, side);
      window._unmatchedCardsData = cardsData;
      if (!cardsData.length) return dcQaEmpty('ไม่พบรายการเที่ยววิ่งที่จับคู่ไม่ได้ในหน้าต่างนี้');
      const optionKeys = ['loss', 'oil50', 'payHigh', 'recvLow', 'normal', 'noRef'];
      const modeKey = isA ? 'unmatched_a' : 'unmatched_b';
      const selected = getSelectedCompareStatuses(modeKey, optionKeys);
      const selectedSet = new Set(selected);
      const visibleCards = cardsData.filter(card => statusesMatchFilterSet(card.statuses, selectedSet));
      const visibleTrips = visibleCards.reduce((sum, card) => sum + card.unRows.length, 0);
      const visibleAnoms = visibleCards.reduce((sum, card) => sum + card.unRows.filter(r => dcQaHasAnomalyStatus(r.statuses)).length, 0);
      const counts = {};
      optionKeys.forEach(k => {
        counts[k] = cardsData.reduce((sum, card) => {
          return sum + (card.unRows || []).filter(row => (row.statuses || ['normal']).some(status => statusMatchesFilter(status, k))).length;
        }, 0);
      });
      const cardsHtml = cardsData.map((card, idx) => {
        const displayStyle = statusesMatchFilterSet(card.statuses, selectedSet) ? '' : 'display:none;';
        const anomCount = card.unRows.filter(r => dcQaHasAnomalyStatus(r.statuses)).length;
        return `<article class="dc-qa-case dc-status-card dc-status-card-${modeKey}" data-status-keys="${esc(card.statuses.join(','))}" data-anom-count="${anomCount}" data-trip-count="${card.unRows.length}" style="${displayStyle}" onclick="dcOpenUnmatchedModal(${idx}, '${side}')">
          <header class="dc-qa-case-head">
            <div class="dc-qa-title-block">
              <div class="dc-qa-identity"><span class="dc-qa-customer">${esc(card.ga.customer || '-')}</span><span class="dc-qa-vtype">${esc(card.ga.vtype || '-')}</span></div>
              <h3 title="${esc(routeGroupHeaderDisplay(card.ga))}">${esc(routeGroupHeaderDisplay(card.ga))}</h3>
            </div>
            <div class="dc-qa-head-actions"></div>
          </header>
          <div class="dc-qa-case-strip"><span>${esc(myLabel)}</span><span>ไม่มีคู่เปรียบเทียบอีกช่วง</span><span class="${anomCount ? 'dc-qa-anom-badge' : 'dc-qa-normal-badge'}">${anomCount ? `ต้องตรวจสอบ ${anomCount} เที่ยว` : 'ไม่พบความผิดปกติเพิ่มเติม'}</span></div>
          <div class="dc-qa-table-wrap">
            <table class="dc-qa-table dc-qa-single-table">
              <colgroup>
                <col style="width:88px">
                <col style="min-width:130px;width:18%">
                <col style="width:96px">
                <col style="width:100px">
                <col style="width:96px">
                <col style="width:96px">
                <col style="width:96px">
                <col style="min-width:160px">
              </colgroup>
              <thead><tr>
                <th>วันที่</th>
                <th>พขร.</th>
                <th class="is-right">ราคาน้ำมัน</th>
                <th class="is-right">สำรองน้ำมัน</th>
                <th class="is-right">ราคารับ</th>
                <th class="is-right">ราคาจ่าย</th>
                <th class="is-right">ส่วนต่าง</th>
                <th class="dc-qa-th-flag">ความผิดปกติ</th>
              </tr></thead>
              <tbody>${card.unRows.slice(0, 6).map(row => dcQaSingleTripRow(row.ra, row.statuses, false, row.infoStatuses || [])).join('')}</tbody>
            </table>
          </div>
          ${card.unRows.length > 6 ? `<div class="dc-qa-more">มีเที่ยววิ่งเพิ่มเติมอีก ${card.unRows.length - 6} เที่ยว (คลิกเพื่อดูรายละเอียด)</div>` : ''}
        </article>`;
      }).join('');
      return `<section class="dc-qa-page">
        <div class="dc-summary-head dc-qa-filter-head" style="flex-direction:column;align-items:flex-start;">
          <div class="dc-summary-copy"><h3 class="dc-summary-title">รายเส้นทางที่ไม่ถูกเปรียบเทียบ: ${esc(myLabel)}</h3><p class="dc-summary-sub">รวม <span id="dc-summary-routes-${modeKey}">${visibleCards.length}</span> เส้นทาง / <span id="dc-summary-trips-${modeKey}">${visibleTrips}</span> เที่ยว · พบความผิดปกติ <span id="dc-summary-anoms-${modeKey}">${visibleAnoms}</span> เที่ยว</p></div>
          <div class="dc-summary-filter" style="width:100%;min-width:0;">${renderCompareStatusFilter(modeKey, optionKeys, selected, counts)}</div>
        </div>
        ${cardsHtml}
      </section>`;
    }

    window.dcOpenAnomalyModal = function (idx) {
      const card = window._anomalyCardsData?.[idx];
      if (!card) return;
      const anomalySection = card.anomRows && card.anomRows.length
        ? `<div class="dc-qa-modal-section dc-qa-modal-section-main"><div class="dc-qa-table-wrap is-modal"><table class="dc-qa-table dc-qa-pair-table"><thead><tr><th>วันที่หลัก</th><th>วันที่เปรียบเทียบ</th><th>พขร.</th><th>ประเภทรถ</th><th>ทะเบียน</th><th>ราคาน้ำมัน</th><th>สำรองน้ำมัน</th><th>ราคารับ</th><th>ราคาจ่าย</th><th class="dc-qa-th-diff">ส่วนต่าง</th><th class="dc-qa-th-flag">ความผิดปกติ</th></tr></thead><tbody>${card.anomRows.map(row => dcQaPairRow(row, true)).join('')}</tbody></table></div></div>`
        : '';
      const basePatternSection = card.basePatternRows && card.basePatternRows.length
        ? `<div class="dc-qa-modal-section"><div class="dc-qa-modal-section-title">มีรูปแบบราคากลางของวัน ${card.basePatternRows.length} คู่</div><div class="dc-qa-table-wrap is-modal"><table class="dc-qa-table dc-qa-pair-table"><thead><tr><th>วันที่หลัก</th><th>วันที่เปรียบเทียบ</th><th>พขร.</th><th>ประเภทรถ</th><th>ทะเบียน</th><th>ราคาน้ำมัน</th><th>สำรองน้ำมัน</th><th>ราคารับ</th><th>ราคาจ่าย</th><th class="dc-qa-th-diff">ส่วนต่าง</th><th class="dc-qa-th-flag">ความผิดปกติ</th></tr></thead><tbody>${card.basePatternRows.map(row => dcQaPairRow(row, true)).join('')}</tbody></table></div></div>`
        : '';
      const body = anomalySection + basePatternSection;
      const titleHtml = `<span class="dc-qa-modal-title-prefix">รายละเอียดการเปรียบเทียบ:</span><span class="dc-qa-modal-title-route">${esc(routeGroupHeaderDisplay(card.ga))}</span>`;
      dcQaModalShell('dc_anom_modal', 'dc_anom_capture', titleHtml, `${esc(card.ga.customer || '-')} · ${esc(card.ga.vtype || '-')} · ${esc(_labelA)} / ${esc(_labelB)}`, encodeURIComponent(`anomaly_${card.ga.route || 'route'}`), body);
      updateCompareStatusVisibility('anomaly');
    };

    window.dcOpenNormalBasePatternModal = function (idx) {
      const card = window._normalCardsData?.[idx];
      if (!card || !card.basePatternRows || card.basePatternRows.length === 0) return;
      const renderRefRow = (refTrip) => {
        const refMarginClass = (refTrip.margin || 0) >= 0 ? 'is-positive' : 'is-negative';
        return `<tr class="dc-qa-ref-row"><td class="dc-qa-date">${esc(dcQaShortDate(refTrip.date))}</td><td class="dc-qa-driver" title="${esc(refTrip.driver || '-')}">${esc(refTrip.driver || '-')}</td><td>${esc(refTrip.vtype || '-')}</td><td>${esc(refTrip.plate || '-')}</td><td class="is-right">${dcQaOilPrice(refTrip.date)}</td><td class="is-right is-oil">${dcQaNum(refTrip.oil)}</td><td class="is-right">${dcQaNum(refTrip.recv)}</td><td class="is-right">${dcQaNum(refTrip.pay)}</td><td class="is-right ${refMarginClass}">${dcQaNum(refTrip.margin)}</td><td></td></tr>`;
      };
      const sequence = dcQaBuildZigzagEntrySequence(card.basePatternRows || [], []);
      const rowsHtml = sequence.map(part => (
        part.kind === 'a'
          ? dcQaSingleTripRow(part.entry.ra, part.entry.statuses, true, part.entry.infoStatuses || [])
          : renderRefRow(part.trip)
      )).join('');
      const body = `<div class="dc-qa-table-wrap is-modal"><table class="dc-qa-table"><thead><tr><th>วันที่</th><th>พขร.</th><th>ประเภทรถ</th><th>ทะเบียน</th><th class="is-right">ราคาน้ำมัน</th><th class="is-right">สำรองน้ำมัน</th><th class="is-right">ราคารับ</th><th class="is-right">ราคาจ่าย</th><th class="is-right">ส่วนต่าง</th><th>ความผิดปกติ</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
      const titleHtml = `<span class="dc-qa-modal-title-prefix">รูปแบบราคากลางของวัน:</span><span class="dc-qa-modal-title-route">${esc(routeGroupHeaderDisplay(card.route || {}))}</span>`;
      dcQaModalShell('dc_norm_base_modal', 'dc_norm_base_capture', titleHtml, `${esc(card.route?.customer || '-')} · ${esc(card.route?.vtype || '-')} · ${esc(_labelA || '')}`, encodeURIComponent(`normal_base_${card.route?.route || 'route'}`), body);
    };

    window.dcOpenUnmatchedModal = function (idx, side) {
      const card = window._unmatchedCardsData?.[idx];
      if (!card) return;
      const isA = side === 'a';
      const myLabel = isA ? _labelA : _labelB;
      const body = `<div class="dc-qa-table-wrap is-modal"><table class="dc-qa-table"><thead><tr><th>วันที่</th><th>พขร.</th><th>ประเภทรถ</th><th>ทะเบียน</th><th class="is-right">ราคาน้ำมัน</th><th class="is-right">สำรองน้ำมัน</th><th class="is-right">ราคารับ</th><th class="is-right">ราคาจ่าย</th><th class="is-right">ส่วนต่าง</th><th>ความผิดปกติ</th></tr></thead><tbody>${card.unRows.map(row => dcQaSingleTripRow(row.ra, row.statuses, true, row.infoStatuses || [])).join('')}</tbody></table></div>`;
      const titleHtml = `<span class="dc-qa-modal-title-prefix">รายละเอียดเที่ยวที่ไม่มีคู่:</span><span class="dc-qa-modal-title-route">${esc(routeGroupHeaderDisplay(card.ga))}</span>`;
      dcQaModalShell('dc_unm_modal', 'dc_unm_capture', titleHtml, `${esc(card.ga.customer || '-')} · ${esc(card.ga.vtype || '-')} · ${esc(myLabel)}`, encodeURIComponent(`unmatched_${card.ga.route || 'route'}`), body);
    };

    document.getElementById('dc_compare_btn')?.addEventListener('click', dcRunCompare);
    // Start in single/normal mode by default.
    window.dcSetMode('single', true);
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

// Oil Price: CSV loader
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
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear() + 543}`;
  };

  const allPrices = prices.map(p => p.price).filter(v => v != null);
  const avgPrice = allPrices.length ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 0;
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const totalRecords = prices.length;

  const sparkline = (vals, width = 100, height = 28) => {
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
    const lastY = height - ((clean[clean.length - 1] - min) / range) * (height - 4) - 2;
    const color = clean[clean.length - 1] >= clean[0] ? '#ef4444' : '#22c55e';
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
      <div class="op-hero-spark">${sparkline(trend.map(p => p.price), 320, 100)}</div>
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
      const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
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
  const sidebarMobileToggle = document.getElementById('sidebarMobileToggle');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const sidebar = document.querySelector('.sidebar');
  if (!nav || !sidebar) return;

  let sidebarAnimating = false;
  let pendingSidebarState = null;
  let sidebarAutoEnabled = false;
  let sidebarHoverOpenTimer = 0;
  let sidebarHoverCloseTimer = 0;
  let sidebarHoverTransitionTimer = 0;
  let sidebarHoverFrame = 0;
  let pendingSidebarHoverExpanded = null;
  let sidebarHoverSuppressedUntilLeave = false;
  let sidebarHoverSuppressX = -1;
  let sidebarHoverSuppressY = -1;
  let sidebarPointerX = -1;
  let sidebarPointerY = -1;
  const SIDEBAR_HOVER_TRANSITION_MS = 240;
  const SIDEBAR_HOVER_SUPPRESS_MOVE_PX = 12;
  const hoverSidebarQuery = window.matchMedia?.('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
  const setMobileSidebarOpen = (open) => {
    document.body.classList.toggle('sidebar-open', open);
    if (sidebarBackdrop) sidebarBackdrop.hidden = !open;
    sidebarMobileToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const closeMobileSidebar = () => setMobileSidebarOpen(false);
  const applySidebarState = (collapsed) => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
  };
  const setSidebarState = (collapsed) => {
    pendingSidebarState = collapsed;
    if (sidebarAnimating) return;
    sidebarAnimating = true;
    document.body.classList.add('sidebar-animating');
    sidebar.style.willChange = 'width, transform';
    window.requestAnimationFrame(() => {
      const next = pendingSidebarState;
      pendingSidebarState = null;
      applySidebarState(next);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        sidebar.removeEventListener('transitionend', onTransitionEnd);
        sidebarAnimating = false;
        sidebar.style.willChange = '';
        document.body.classList.remove('sidebar-animating');
        const updateMeta = () => updateSidebarMeta();
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(updateMeta, { timeout: 500 });
        } else {
          window.setTimeout(updateMeta, 0);
        }
        if (pendingSidebarState !== null && pendingSidebarState !== document.body.classList.contains('sidebar-collapsed')) {
          const queued = pendingSidebarState;
          pendingSidebarState = null;
          setSidebarState(queued);
        }
      };
      const onTransitionEnd = (event) => {
        if (event.target !== sidebar) return;
        if (event.propertyName !== 'width' && event.propertyName !== 'transform') return;
        finish();
      };
      sidebar.addEventListener('transitionend', onTransitionEnd);
      window.setTimeout(() => {
        sidebar.removeEventListener('transitionend', onTransitionEnd);
        finish();
      }, 420);
    });
  };

  const clearSidebarHoverTimers = () => {
    if (sidebarHoverOpenTimer) window.clearTimeout(sidebarHoverOpenTimer);
    if (sidebarHoverCloseTimer) window.clearTimeout(sidebarHoverCloseTimer);
    if (sidebarHoverTransitionTimer) window.clearTimeout(sidebarHoverTransitionTimer);
    if (sidebarHoverFrame) window.cancelAnimationFrame(sidebarHoverFrame);
    sidebarHoverOpenTimer = 0;
    sidebarHoverCloseTimer = 0;
    sidebarHoverTransitionTimer = 0;
    sidebarHoverFrame = 0;
    pendingSidebarHoverExpanded = null;
    document.body.classList.remove('sidebar-hover-transitioning');
  };

  const isPointerInsideSidebar = () => {
    if (!sidebarAutoEnabled) return false;
    return sidebar.matches(':hover');
  };

  const setSidebarHoverExpanded = (expanded) => {
    if (!sidebarAutoEnabled) return;
    const currentExpanded = document.body.classList.contains('sidebar-hover-expanded');
    if (currentExpanded === expanded && pendingSidebarHoverExpanded === null) return;
    if (sidebarHoverOpenTimer) window.clearTimeout(sidebarHoverOpenTimer);
    if (sidebarHoverCloseTimer) window.clearTimeout(sidebarHoverCloseTimer);
    if (sidebarHoverFrame) window.cancelAnimationFrame(sidebarHoverFrame);
    sidebarHoverOpenTimer = 0;
    sidebarHoverCloseTimer = 0;
    sidebarHoverFrame = 0;
    pendingSidebarHoverExpanded = expanded;
    document.body.classList.add('sidebar-hover-transitioning');
    sidebarHoverFrame = window.requestAnimationFrame(() => {
      sidebarHoverFrame = 0;
      document.body.classList.toggle('sidebar-hover-expanded', pendingSidebarHoverExpanded);
      pendingSidebarHoverExpanded = null;
    });
    if (sidebarHoverTransitionTimer) window.clearTimeout(sidebarHoverTransitionTimer);
    sidebarHoverTransitionTimer = window.setTimeout(() => {
      document.body.classList.remove('sidebar-hover-transitioning');
      sidebarHoverTransitionTimer = 0;
      reconcileSidebarHover();
    }, SIDEBAR_HOVER_TRANSITION_MS);
  };

  const scheduleSidebarOpen = (delay = 35) => {
    if (sidebarHoverSuppressedUntilLeave) return;
    if (sidebarHoverCloseTimer) window.clearTimeout(sidebarHoverCloseTimer);
    if (sidebarHoverOpenTimer) window.clearTimeout(sidebarHoverOpenTimer);
    sidebarHoverOpenTimer = window.setTimeout(() => {
      sidebarHoverOpenTimer = 0;
      if (!sidebarHoverSuppressedUntilLeave && isPointerInsideSidebar()) setSidebarHoverExpanded(true);
    }, delay);
  };

  const scheduleSidebarClose = (delay = 120) => {
    if (sidebarHoverOpenTimer) window.clearTimeout(sidebarHoverOpenTimer);
    if (sidebarHoverCloseTimer) window.clearTimeout(sidebarHoverCloseTimer);
    sidebarHoverCloseTimer = window.setTimeout(() => {
      sidebarHoverCloseTimer = 0;
      if (!isPointerInsideSidebar()) setSidebarHoverExpanded(false);
    }, delay);
  };

  function reconcileSidebarHover() {
    if (!sidebarAutoEnabled) return;
    if (isPointerInsideSidebar()) {
      scheduleSidebarOpen(0);
    } else {
      scheduleSidebarClose(document.body.classList.contains('sidebar-hover-expanded') ? 50 : 0);
    }
  }

  const syncSidebarAutoMode = () => {
    sidebarAutoEnabled = Boolean(hoverSidebarQuery?.matches);
    clearSidebarHoverTimers();
    document.body.classList.toggle('sidebar-auto', sidebarAutoEnabled);
    document.documentElement.classList.remove('sidebar-auto-preload');
    sidebarHoverSuppressedUntilLeave = false;
    document.body.classList.remove('sidebar-hover-expanded', 'sidebar-hover-transitioning');
    if (sidebarAutoEnabled) {
      document.body.classList.remove('sidebar-collapsed');
      closeMobileSidebar();
      sidebarAnimating = false;
      pendingSidebarState = null;
      sidebar.style.willChange = '';
    } else {
      closeMobileSidebar();
    }
  };

  syncSidebarAutoMode();
  if (hoverSidebarQuery?.addEventListener) {
    hoverSidebarQuery.addEventListener('change', syncSidebarAutoMode);
  } else if (hoverSidebarQuery?.addListener) {
    hoverSidebarQuery.addListener(syncSidebarAutoMode);
  }

  sidebar.addEventListener('pointerenter', e => {
    if (!sidebarAutoEnabled || e.pointerType === 'touch') return;
    sidebarPointerX = e.clientX;
    sidebarPointerY = e.clientY;
    scheduleSidebarOpen(35);
  });

  sidebar.addEventListener('pointermove', e => {
    if (!sidebarAutoEnabled || e.pointerType === 'touch') return;
    sidebarPointerX = e.clientX;
    sidebarPointerY = e.clientY;
    if (sidebarHoverSuppressedUntilLeave) {
      const dx = sidebarPointerX - sidebarHoverSuppressX;
      const dy = sidebarPointerY - sidebarHoverSuppressY;
      if (Math.hypot(dx, dy) >= SIDEBAR_HOVER_SUPPRESS_MOVE_PX) {
        sidebarHoverSuppressedUntilLeave = false;
        scheduleSidebarOpen(0);
      }
    }
  }, { passive: true });

  sidebar.addEventListener('pointerleave', e => {
    if (!sidebarAutoEnabled || e.pointerType === 'touch') return;
    sidebarPointerX = e.clientX;
    sidebarPointerY = e.clientY;
    sidebarHoverSuppressedUntilLeave = false;
    scheduleSidebarClose(70);
  });

  nav.innerHTML = PAGES.map((p, idx) => `<button type="button" class="nav-item${idx === 0 ? ' active' : ''}" data-idx="${idx}" aria-label="${p.title}"${idx === 0 ? ' aria-current="page"' : ''}>
    <span class="nav-icon" aria-hidden="true">${p.icon}</span>
    <span class="nav-copy">
      <span class="nav-label">${p.title}</span>
    </span>
  </button>`).join('');

  let pendingNavRenderFrame = 0;
  let pendingNavRenderTimer = 0;
  let pendingNavPage = null;
  const scheduleNavRender = idx => {
    pendingNavPage = idx;
    if (pendingNavRenderFrame) window.cancelAnimationFrame(pendingNavRenderFrame);
    if (pendingNavRenderTimer) window.clearTimeout(pendingNavRenderTimer);
    pendingNavRenderFrame = window.requestAnimationFrame(() => {
      pendingNavRenderFrame = 0;
      pendingNavRenderTimer = window.setTimeout(() => {
        pendingNavRenderTimer = 0;
        const nextPage = pendingNavPage;
        pendingNavPage = null;
        if (Number.isInteger(nextPage)) showPage(nextPage);
      }, 0);
    });
  };

  nav.addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    const nextIdx = Number(item.dataset.idx);
    if (nextIdx === currentPage) {
      closeMobileSidebar();
      return;
    }
    nav.querySelectorAll('.nav-item').forEach(n => {
      n.classList.remove('active');
      n.removeAttribute('aria-current');
    });
    item.classList.add('active');
    item.setAttribute('aria-current', 'page');
    closeMobileSidebar();
    if (sidebarAutoEnabled) {
      sidebarHoverSuppressedUntilLeave = true;
      sidebarHoverSuppressX = e.clientX;
      sidebarHoverSuppressY = e.clientY;
      setSidebarHoverExpanded(false);
    }
    scheduleNavRender(nextIdx);
  });

  sidebarMobileToggle?.addEventListener('click', () => {
    if (sidebarAutoEnabled) return;
    const open = !document.body.classList.contains('sidebar-open');
    document.body.classList.remove('sidebar-collapsed');
    setMobileSidebarOpen(open);
  });
  sidebarBackdrop?.addEventListener('click', () => {
    closeMobileSidebar();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileSidebar();
  });
}

function showPage(idx) {
  const pageStartedAt = perfNow();
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
  c.classList.toggle('page-daily', idx === 1);
  c.classList.toggle('page-oil', idx === 2);
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
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if (sidebarBackdrop) sidebarBackdrop.hidden = true;
  document.getElementById('sidebarMobileToggle')?.setAttribute('aria-expanded', 'false');
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
  perfLog('showPage', pageStartedAt, { page: PAGES[idx]?.id || idx });
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
  const last = MTH[months[months.length - 1]] || months[months.length - 1];
  const total = d.summary?.totalTrips ?? 0;
  // Year-aware: derive from daily data, fallback to current calendar year
  const years = Array.isArray(d.daily) ? getYearsFromRows(d.daily) : [];
  const beYears = years.length > 0 ? years.map(y => y + 543) : [new Date().getFullYear() + 543];
  const yearLabel = beYears.length > 1 ? `${beYears[0]}–${beYears[beYears.length - 1]}` : `${beYears[0]}`;
  const label = months.length > 1 ? `${first} - ${last} ${yearLabel}` : `${first} ${yearLabel}`;
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
      const payload = await apiGetWithRetry('summary', {}, [API_SUMMARY_TIMEOUT_MS, API_SUMMARY_RETRY_TIMEOUT_MS]);
      API_CACHE.summary = payload;
      noteDataSource('summary', 'api');
      return deepClone(payload);
    } catch (err) {
      console.warn('Summary API fallback to static data:', err.message);
      noteDataSource('summary', 'static', `summary fallback: ${describeDataLoadError(err, 'summary API')}`);
    }
  }
  if (!isApiEnabled()) noteDataSource('summary', 'static');
  return loadLegacySummaryData();
}

async function loadTripsSource() {
  if (API_CACHE.trips) return deepClone(API_CACHE.trips);
  if (isApiEnabled()) {
    try {
      const fields = 'date,customer,route,routeKey,routeCore,routeVehicle,routePrefix,routeGroup,isFlashRoute,routeDesc,vtype,driver,plate,payee,recv,pay,oil,margin';
      const pageSize = 5000;
      const maxPages = 100;
      let page = 0;
      let hasMore = true;
      const trips = [];
      const tripsStartedAt = perfNow();
      const tripsRemainingMs = () => API_TRIPS_TOTAL_TIMEOUT_MS - (perfNow() - tripsStartedAt);

      while (hasMore && page < maxPages) {
        let payload = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const remainingMs = tripsRemainingMs();
            if (remainingMs <= 1000) {
              throw createRequestTimeoutError(
                API_TRIPS_TOTAL_TIMEOUT_MS,
                `trips API pagination timeout after ${API_TRIPS_TOTAL_TIMEOUT_MS}ms`
              );
            }
            const pageTimeoutMs = Math.max(1000, Math.min(API_TRIPS_TIMEOUT_MS, Math.floor(remainingMs)));
            payload = await apiGet('trips', { page, limit: pageSize, fields }, pageTimeoutMs);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (err?.code === 'REQUEST_TIMEOUT' && tripsRemainingMs() <= 1000) {
              throw createRequestTimeoutError(
                API_TRIPS_TOTAL_TIMEOUT_MS,
                `trips API pagination timeout after ${API_TRIPS_TOTAL_TIMEOUT_MS}ms`
              );
            }
            if (isNonRetriableHttpError(err) || tripsRemainingMs() <= 1000) {
              throw err;
            }
            if (attempt === 0) {
              await new Promise(resolve => setTimeout(resolve, 700));
            }
          }
        }
        if (!payload) throw lastErr || new Error('trips api failed');
        const batch = Array.isArray(payload?.trips) ? payload.trips : [];
        if (batch.length > 0) trips.push(...batch);
        if (payload?.total) {
          setLoadingStatus(`โหลดข้อมูลเที่ยววิ่ง... ${Math.min(trips.length, payload.total).toLocaleString('th-TH')} / ${Number(payload.total).toLocaleString('th-TH')} รายการ`);
        } else if (batch.length > 0) {
          setLoadingStatus(`โหลดข้อมูลเที่ยววิ่ง... ${trips.length.toLocaleString('th-TH')} รายการ`);
        }
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
      noteDataSource('trips', 'static', `trips fallback: ${describeDataLoadError(err, 'trips API')}`);
    }
  }
  if (!isApiEnabled()) noteDataSource('trips', 'static');
  return loadLegacyTripsData();
}

async function ensureTripsReady() {
  if (TRIPS_READY) return window.FRAUD_DATA || [];
  if (TRIPS_LOADING_PROMISE) return TRIPS_LOADING_PROMISE;

  TRIPS_LOADING_PROMISE = (async () => {
    const tripsSource = await loadTripsSource();
    const normalized = Array.isArray(tripsSource) ? tripsSource.map(canonicalizeTripRow) : [];
    window.FRAUD_DATA = normalized;
    TRIPS_READY = true;
    return normalized;
  })().finally(() => {
    TRIPS_LOADING_PROMISE = null;
  });

  return TRIPS_LOADING_PROMISE;
}

async function loadOilSource() {
  if (API_CACHE.oil) return deepClone(API_CACHE.oil);
  if (isApiEnabled()) {
    try {
      const payload = await apiGet('oil', {}, API_OIL_TIMEOUT_MS);
      API_CACHE.oil = payload;
      noteDataSource('oil', 'api');
      return deepClone(payload);
    } catch (err) {
      console.warn('Oil API fallback to static data:', err.message);
      noteDataSource('oil', 'static', `oil fallback: ${describeDataLoadError(err, 'oil API')}`);
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
        ${PAGES.map(() => '<div class="shell-skeleton shell-skeleton-nav"></div>').join('')}
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
  const initStartedAt = perfNow();
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
  const summaryStartedAt = perfNow();
  try {
    summarySource = await loadSummarySource();
  } catch (err) {
    document.getElementById('content').innerHTML = `<div class="kpi"><div class="kpi-value red">โหลดข้อมูลสรุปไม่สำเร็จ</div><div class="kpi-sub">${esc(err.message)}</div></div>`;
    return;
  } finally {
    perfLog('loadSummarySource', summaryStartedAt, { source: DATA_SOURCE_STATE.summary });
  }

  setLoadingStatus('โหลดข้อมูลเที่ยววิ่ง...');
  await sleep(80);
  let tripsSource = [];
  const tripsStartedAt = perfNow();
  try {
    tripsSource = await loadTripsSource();
  } catch (err) {
    console.error('Trip data load failed:', err);
  } finally {
    perfLog('loadTripsSource', tripsStartedAt, {
      source: DATA_SOURCE_STATE.trips,
      rows: Array.isArray(tripsSource) ? tripsSource.length : 0
    });
  }

  let oilSource = null;
  const oilStartedAt = perfNow();
  try {
    oilSource = await loadOilSource();
  } catch (err) {
    console.error('Oil data load failed:', err);
  } finally {
    perfLog('loadOilSource', oilStartedAt, { source: DATA_SOURCE_STATE.oil });
  }

  const alignStartedAt = perfNow();
  const aligned = alignDashboardData(summarySource, tripsSource, {
    rebuildDerived: DATA_SOURCE_STATE.summary === 'api' && DATA_SOURCE_STATE.trips === 'api'
  });
  perfLog('alignDashboardData', alignStartedAt, {
    rebuildDerived: DATA_SOURCE_STATE.summary === 'api' && DATA_SOURCE_STATE.trips === 'api',
    tripRows: Array.isArray(tripsSource) ? tripsSource.length : 0
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
  perfLog('dashboardInit', initStartedAt, {
    summary: DATA_SOURCE_STATE.summary,
    trips: DATA_SOURCE_STATE.trips,
    oil: DATA_SOURCE_STATE.oil
  });
}
init();
