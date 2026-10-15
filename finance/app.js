const STORAGE_KEY = "cursiva-finance-html-v3";
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const WP = { office: true };
const API_ACTIONS = {
  seed: "finance_seed",
  "reset-demo": "finance_reset",
  clear: "finance_clear",
};
let revision = 0;
let saveChain = Promise.resolve();

function initData() {
  if (tg && tg.initData) return tg.initData;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("tgWebAppData")) return params.get("tgWebAppData");
  try {
    const stored = JSON.parse(sessionStorage.getItem("__telegram__initParams") || "{}");
    return stored.tgWebAppData || "";
  } catch {
    return "";
  }
}

async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const action = API_ACTIONS[path] || (method === "POST" ? "finance_save" : "finance_state");
  const res = await fetch(`../api.php?action=${action}`, {
    method,
    body: options.body,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData(),
    },
    credentials: "same-origin",
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (payload && typeof payload.rev === "number") revision = payload.rev;
  if (!res.ok) {
    const error = new Error((payload && payload.message) || `HTTP ${res.status}`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload ? payload.data : null;
}

let pendingSaves = 0;

function pushState() {
  pendingSaves += 1;
  saveChain = saveChain
    .then(() => apiFetch("data", { method: "POST", body: JSON.stringify({ data: state, rev: revision }) }))
    .catch(handleSaveError)
    .finally(() => {
      pendingSaves -= 1;
    });
  return saveChain;
}

function handleSaveError(error) {
  console.error(error);
  if (error.status === 409 && error.payload && error.payload.data) {
    state = normalizeState(error.payload.data);
    render();
    toast(error.payload.message || "Данные обновились, повторите действие");
    return;
  }
  if (error.status === 401 || error.status === 403) {
    toast("Нет доступа к финансам. Откройте офис из бота заново");
    return;
  }
  toast("Не удалось сохранить, проверьте связь");
}

async function refreshFromServer() {
  if (!state || pendingSaves > 0 || saveState.dirty || document.querySelector("dialog[open]")) return;
  const before = revision;
  try {
    const data = await apiFetch("data");
    if (revision !== before) {
      state = normalizeState(data);
      render();
    }
  } catch (error) {
    console.error(error);
  }
}

const NAV = [
  { id: "dashboard", label: "Дашборд" },
  { id: "projects", label: "Проекты" },
  { id: "employees", label: "Сотрудники" },
  { id: "taxes", label: "Налоги" },
  { id: "subscriptions", label: "Подписки" },
  { id: "clients", label: "Клиенты" },
  { id: "invoices", label: "Счета" },
  { id: "cashflow", label: "Движения" },
];

const PROJECT_TYPE = {
  card: "Визитка",
  landing: "Лендинг",
  catalog: "Каталог",
  corporate: "Корпоративный",
  shop: "Интернет-магазин",
  seo: "SEO",
  support: "Поддержка",
  other: "Другое",
};

const PROJECT_STATUS = {
  lead: "Лид",
  in_progress: "В работе",
  review: "Согласование",
  done: "Сдан",
  paused: "Пауза",
};

const CLIENT_STATUS = {
  active: "Активный",
  paused: "Пауза",
  archived: "Архив",
};

const INVOICE_STATUS = {
  draft: "Черновик",
  sent: "Выставлен",
  paid: "Оплачен",
  overdue: "Просрочен",
  cancelled: "Отменён",
};

const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

let seedData = null;
let state = null;
let route = "dashboard";
let routeId = null;
let selectedPeriod = currentPeriod();
let formMode = null;

const $ = (sel, root = document) => root.querySelector(sel);

function uid(prefix) {
  const random = window.crypto?.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `${prefix}-${random}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodRange(period) {
  const [y, m] = period.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(from), to: fmt(to) };
}

function lastMonths(count, fromPeriod = currentPeriod()) {
  const [y, m] = fromPeriod.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function formatPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_RU[m - 1]} ${y}`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateShort(value) {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function inRange(date, from, to) {
  return date >= from && date <= to;
}

function toRub(amount, currency, rates) {
  return amount * (rates[currency] || 1);
}

function formatMoney(amount, currency = "RUB") {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(abs);
  const symbol = currency === "RUB" ? "₽" : currency === "USD" ? "$" : "€";
  return `${amount < 0 ? "−" : ""}${formatted}\u00A0${symbol}`;
}

function moneyHtml(amount, currency = "RUB", tone) {
  return `<span class="money ${tone || ""}">${formatMoney(amount, currency)}</span>`;
}

function badge(status, map) {
  return `<span class="badge ${status}">${map[status] || status}</span>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function activeEmployees() {
  return (state.employees || []).filter((e) => e.status === "active");
}

/** Split project budget: tax first, then employee % of net */
function calcProjectSplit(budget, taxPercent, employees = activeEmployees()) {
  const gross = Number(budget) || 0;
  const taxPct = Number(taxPercent) || 0;
  const taxAmount = round2((gross * taxPct) / 100);
  const netAmount = round2(gross - taxAmount);
  const active = employees.filter((e) => e.status !== "inactive");
  let allocated = 0;
  const shares = active.map((emp, index) => {
    const percent = Number(emp.percent) || 0;
    let amount;
    if (index === active.length - 1) {
      amount = round2(netAmount - allocated);
    } else {
      amount = round2((netAmount * percent) / 100);
      allocated += amount;
    }
    return { employeeId: emp.id, name: emp.name, percent, amount };
  });
  const percentSum = active.reduce((a, e) => a + (Number(e.percent) || 0), 0);
  return { gross, taxPercent: taxPct, taxAmount, netAmount, shares, percentSum };
}

function isFinanceData(value) {
  return (
    value &&
    typeof value === "object" &&
    Array.isArray(value.clients) &&
    Array.isArray(value.projects) &&
    Array.isArray(value.employees)
  );
}

function normalizeState(raw) {
  const data = clone(raw);
  if (typeof data.selfEmployedTaxPercent !== "number") data.selfEmployedTaxPercent = 6;
  if (!data.rates) data.rates = { RUB: 1, USD: 81.5, EUR: 95.2 };
  data.subscriptions = data.subscriptions || [];
  data.taxPayments = data.taxPayments || [];
  data.invoices = data.invoices || [];
  data.accounts = data.accounts || [];
  data.transactions = data.transactions || [];
  data.employees = (data.employees || []).map((e) => ({
    ...e,
    percent: typeof e.percent === "number" ? e.percent : 0,
    status: e.status || "active",
  }));
  data.projects = (data.projects || []).map((p) => {
    if (p.shares && typeof p.taxAmount === "number") return p;
    const split = calcProjectSplit(
      p.budget,
      p.taxPercent ?? data.selfEmployedTaxPercent,
      data.employees,
    );
    return {
      ...p,
      taxPercent: split.taxPercent,
      taxAmount: split.taxAmount,
      netAmount: split.netAmount,
      shares: split.shares.map(({ employeeId, percent, amount }) => ({
        employeeId,
        percent,
        amount,
      })),
    };
  });
  return data;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isFinanceData(parsed)) return normalizeState(parsed);
    }
  } catch {
    /* ignore */
  }
  return normalizeState(seedData);
}

function saveState() {
  if (WP) {
    clearTimeout(saveState._t);
    saveState.dirty = true;
    saveState._t = setTimeout(() => {
      saveState.dirty = false;
      pushState();
    }, 250);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function saveStateNow() {
  if (WP) {
    clearTimeout(saveState._t);
    saveState.dirty = false;
    await pushState();
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function effectiveInvoiceStatus(invoice, today = todayIso()) {
  if (
    invoice.status !== "paid" &&
    invoice.status !== "cancelled" &&
    invoice.status !== "draft" &&
    invoice.dueAt < today
  ) {
    return "overdue";
  }
  return invoice.status;
}

function sumRub(items, rates) {
  return items.reduce((acc, item) => acc + toRub(item.amount, item.currency, rates), 0);
}

function accountBalanceNative(account, transactions) {
  return transactions
    .filter((t) => t.accountId === account.id)
    .reduce((acc, t) => acc + (t.type === "income" ? t.amount : -t.amount), account.openingBalance);
}

function periodTransactions(data, from, to, type) {
  return (data.transactions || []).filter(
    (t) => inRange(t.date, from, to) && (!type || t.type === type),
  );
}

function kpis(data, from, to) {
  const income = sumRub(periodTransactions(data, from, to, "income"), data.rates);
  const expense = sumRub(periodTransactions(data, from, to, "expense"), data.rates);
  const cash = (data.accounts || []).reduce(
    (acc, a) => acc + toRub(accountBalanceNative(a, data.transactions || []), a.currency, data.rates),
    0,
  );
  const openInvoices = (data.invoices || []).filter((i) => {
    const status = effectiveInvoiceStatus(i);
    return status === "sent" || status === "overdue";
  });
  const overdue = (data.invoices || []).filter((i) => effectiveInvoiceStatus(i) === "overdue");
  const taxDue = projectTaxDue(data, from, to);
  return {
    income,
    expense,
    profit: income - expense,
    cash,
    receivables: sumRub(openInvoices, data.rates),
    overdueCount: overdue.length,
    overdueSum: sumRub(overdue, data.rates),
    taxDue,
  };
}

function projectTaxDue(data, from, to) {
  return (data.projects || [])
    .filter((p) => inRange(p.createdAt || p.startDate || "", from, to))
    .reduce((acc, p) => acc + toRub(p.taxAmount || 0, p.currency || "RUB", data.rates), 0);
}

function monthlySeries(data, months = 6) {
  return lastMonths(months).map((period) => {
    const { from, to } = periodRange(period);
    const income = sumRub(periodTransactions(data, from, to, "income"), data.rates);
    const expense = sumRub(periodTransactions(data, from, to, "expense"), data.rates);
    return { period, income, expense };
  });
}

function monthlySubCost(sub) {
  const rub = toRub(sub.amount, sub.currency, state.rates);
  return sub.period === "year" ? rub / 12 : rub;
}

function pageHeader(title, description, actions = "") {
  return `
    <div class="page-header">
      <div>
        <p class="eyebrow">Cursiva</p>
        <h1>${esc(title)}</h1>
        <p>${esc(description)}</p>
      </div>
      <div class="header-actions">${actions}</div>
    </div>`;
}

function bulkBarHtml(entityLabel = "записей") {
  return `
    <div class="bulk-bar" id="bulk-bar" data-entity="${esc(entityLabel)}">
      <div>Выбрано: <strong id="bulk-count">0</strong> ${esc(entityLabel)}</div>
      <div class="bulk-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="bulk-clear">Снять выбор</button>
        <button type="button" class="btn btn-danger btn-sm" id="bulk-delete">Удалить выбранные</button>
      </div>
    </div>`;
}

const DELETE_NAMES = {
  transactions: "движение",
  invoices: "счёт",
  clients: "клиента",
  employees: "сотрудника",
};

function delButton(collection, id, back = "", label = "Удалить") {
  const backAttr = back ? ` data-del-back="${esc(back)}"` : "";
  const size = back ? "" : " btn-sm";
  return `<button type="button" class="btn btn-ghost btn-del${size}" data-del="${esc(collection)}:${esc(id)}"${backAttr}>${esc(label)}</button>`;
}

function checkHead() {
  return `<th class="check"><input type="checkbox" id="select-all" title="Выбрать все" aria-label="Выбрать все" /></th>`;
}

function checkCell(id) {
  return `<td class="check"><input type="checkbox" class="row-check" value="${esc(id)}" aria-label="Выбрать" /></td>`;
}

function emptyData() {
  return {
    rates: { ...(state?.rates || seedData?.rates || { RUB: 1, USD: 81.5, EUR: 95.2 }) },
    selfEmployedTaxPercent:
      state?.selfEmployedTaxPercent ?? seedData?.selfEmployedTaxPercent ?? 6,
    employees: [],
    clients: [],
    projects: [],
    invoices: [],
    accounts: (state?.accounts?.length ? state.accounts : seedData?.accounts || []).map((a) => ({
      ...clone(a),
      openingBalance: 0,
    })),
    transactions: [],
    subscriptions: [],
    taxPayments: [],
  };
}

function getSelectedIds() {
  return [...document.querySelectorAll(".row-check:checked")].map((el) => el.value);
}

function updateBulkBar() {
  const bar = $("#bulk-bar");
  if (!bar) return;
  const ids = getSelectedIds();
  const count = ids.length;
  bar.classList.toggle("is-visible", count > 0);
  const countEl = $("#bulk-count");
  if (countEl) countEl.textContent = String(count);

  const rows = document.querySelectorAll("tbody tr");
  rows.forEach((tr) => {
    const cb = tr.querySelector(".row-check");
    tr.classList.toggle("is-selected", Boolean(cb?.checked));
  });

  const all = document.querySelectorAll(".row-check");
  const selectAll = $("#select-all");
  if (selectAll && all.length) {
    selectAll.checked = count === all.length;
    selectAll.indeterminate = count > 0 && count < all.length;
  }
}

function bindBulkSelect(collectionKey, label) {
  const selectAll = $("#select-all");
  selectAll?.addEventListener("change", () => {
    document.querySelectorAll(".row-check").forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateBulkBar();
  });

  document.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", updateBulkBar);
  });

  $("#bulk-clear")?.addEventListener("click", () => {
    document.querySelectorAll(".row-check").forEach((cb) => {
      cb.checked = false;
    });
    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
    updateBulkBar();
  });

  $("#bulk-delete")?.addEventListener("click", () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    if (!confirm(`Удалить выбранные ${label} (${ids.length})?`)) return;
    const set = new Set(ids);
    if (collectionKey === "employees") {
      state.employees = state.employees.filter((e) => !set.has(e.id));
    } else if (collectionKey === "projects") {
      state.projects = state.projects.filter((p) => !set.has(p.id));
    } else if (collectionKey === "clients") {
      state.clients = state.clients.filter((c) => !set.has(c.id));
    } else if (collectionKey === "subscriptions") {
      state.subscriptions = state.subscriptions.filter((s) => !set.has(s.id));
    } else if (collectionKey === "taxPayments") {
      state.taxPayments = state.taxPayments.filter((t) => !set.has(t.id));
    } else if (collectionKey === "invoices") {
      state.invoices = state.invoices.filter((i) => !set.has(i.id));
    } else if (collectionKey === "transactions") {
      state.transactions = state.transactions.filter((t) => !set.has(t.id));
    }
    saveState();
    toast(`Удалено: ${ids.length}`);
    render();
  });
}

function periodSelectHtml() {
  return `<select class="select" id="period-select" style="width:auto;min-width:12rem">
    ${lastMonths(8)
      .map(
        (p) =>
          `<option value="${p}" ${p === selectedPeriod ? "selected" : ""}>${formatPeriod(p)}</option>`,
      )
      .join("")}
  </select>`;
}

function renderDashboard() {
  const { from, to } = periodRange(selectedPeriod);
  const stats = kpis(state, from, to);
  const series = monthlySeries(state, 6);
  const maxBar = Math.max(1, ...series.flatMap((r) => [r.income, r.expense]));
  const subMonth = (state.subscriptions || [])
    .filter((s) => s.active)
    .reduce((a, s) => a + monthlySubCost(s), 0);

  const overdue = (state.invoices || [])
    .filter((i) => effectiveInvoiceStatus(i) === "overdue")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const openProjects = state.projects
    .filter((p) => p.status === "in_progress" || p.status === "review")
    .sort((a, b) => b.budget - a.budget);

  const kpisHtml = [
    ["income", "Выручка", stats.income, "Оплаты за период", "pos"],
    ["expense", "Расходы", stats.expense, "ФОТ, сервисы, офис", "neg"],
    ["profit", "Прибыль", stats.profit, "Выручка − расходы", stats.profit >= 0 ? "pos" : "neg"],
    ["tax", "Налог НПД", stats.taxDue, `${state.selfEmployedTaxPercent}% с новых проектов`, "warn"],
    ["subs", "Подписки / мес", subMonth, "Средний месячный burn сервисов", "muted"],
    ["cash", "На счетах", stats.cash, "Остатки по кассам", "muted"],
  ]
    .map(
      ([key, title, value, hint, tone]) => `
      <div class="card is-clickable" data-nav="#kpi/${key}">
        <div class="card-body is-clickable">
          <div class="kpi-label"><span>${esc(title)}</span><span class="meta">открыть →</span></div>
          <div class="kpi-value">${moneyHtml(value, "RUB", tone)}</div>
          <p class="kpi-hint">${esc(hint)}</p>
        </div>
      </div>`,
    )
    .join("");

  return `
    ${pageHeader(
      "Сводка студии",
      "Деньги, налог самозанятого, подписки и распределение по проектам. Клик по карточке — детальный разбор.",
      periodSelectHtml(),
    )}
    <div class="kpi-grid">${kpisHtml}</div>
    <div class="grid-3">
      <div class="card is-clickable" data-nav="#cashflow">
        <div class="card-head"><h2>Движение за 6 месяцев</h2></div>
        <div class="legend"><span class="inc">Выручка</span><span class="exp">Расходы</span></div>
        <div class="chart">
          ${series
            .map((row) => {
              const ih = Math.round((row.income / maxBar) * 100);
              const eh = Math.round((row.expense / maxBar) * 100);
              return `<div class="chart-col">
                <div class="chart-bars">
                  <div class="bar income" style="height:${ih}%"></div>
                  <div class="bar expense" style="height:${eh}%"></div>
                </div>
                <div class="chart-label">${formatPeriod(row.period).split(" ")[0].slice(0, 3)}</div>
              </div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="card is-clickable" data-nav="#cashflow">
        <div class="card-head"><h2>Кассы</h2></div>
        <ul class="list">
          ${(state.accounts || [])
            .map(
              (acc) => `<li>
              <div><strong>${esc(acc.name)}</strong><div class="meta">${esc(acc.currency)}</div></div>
              ${moneyHtml(accountBalanceNative(acc, state.transactions || []), acc.currency)}
            </li>`,
            )
            .join("")}
        </ul>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Просроченные счета</h2><a href="#invoices">Все</a></div>
        ${
          overdue.length === 0
            ? `<p class="empty">Просрочки нет.</p>`
            : `<ul class="list">${overdue
                .map((inv) => {
                  const client = state.clients.find((c) => c.id === inv.clientId);
                  return `<li class="is-clickable" data-nav="#invoice/${inv.id}">
                    <div><strong>${esc(inv.number)}</strong>
                      <div class="meta">${esc(client?.company)} · до ${formatDateShort(inv.dueAt)}</div>
                    </div>
                    <div style="text-align:right">${moneyHtml(inv.amount, inv.currency)}
                      <div style="margin-top:6px">${badge("overdue", INVOICE_STATUS)}</div>
                    </div>
                  </li>`;
                })
                .join("")}</ul>`
        }
      </div>
      <div class="card">
        <div class="card-head"><h2>Проекты в работе</h2><a href="#projects">Все</a></div>
        ${
          openProjects.length === 0
            ? `<p class="empty">Нет активных проектов.</p>`
            : `<ul class="list">${openProjects
                .map((p) => {
                  const tax = p.taxAmount ?? 0;
                  return `<li class="is-clickable" data-nav="#project/${p.id}">
                    <div>
                      <strong>${esc(p.name)}</strong>
                      <div class="meta" style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                        ${badge(p.status, PROJECT_STATUS)}
                        <span>бюджет ${formatMoney(p.budget, p.currency)} · налог ${formatMoney(tax)}</span>
                      </div>
                    </div>
                    <div style="text-align:right">
                      <div class="meta">к распределению</div>
                      ${moneyHtml(p.netAmount ?? p.budget - tax)}
                    </div>
                  </li>`;
                })
                .join("")}</ul>`
        }
      </div>
    </div>`;
}

function renderEmployees() {
  const sum = activeEmployees().reduce((a, e) => a + (Number(e.percent) || 0), 0);
  const sumClass = Math.abs(sum - 100) < 0.01 ? "ok" : "bad";

  const rows = state.employees
    .map(
      (e) => `<tr data-emp="${e.id}">
        ${checkCell(e.id)}
        <td>
          <strong>${esc(e.name)}</strong>
          <div class="meta">${esc(e.role || "")}</div>
        </td>
        <td>
          <input class="percent-input emp-percent" type="number" min="0" max="100" step="0.1"
            value="${e.percent}" data-id="${e.id}" ${e.status !== "active" ? "disabled" : ""} /> %
        </td>
        <td>
          <select class="select emp-status" data-id="${e.id}" style="width:auto">
            <option value="active" ${e.status === "active" ? "selected" : ""}>Активный</option>
            <option value="inactive" ${e.status === "inactive" ? "selected" : ""}>Неактивный</option>
          </select>
        </td>
        <td class="num actions-cell">
          <button type="button" class="btn btn-ghost btn-sm" data-edit-emp="${e.id}">Имя</button>
          ${delButton("employees", e.id)}
        </td>
      </tr>`,
    )
    .join("");

  const demo = calcProjectSplit(100000, state.selfEmployedTaxPercent);

  return `
    ${pageHeader(
      "Сотрудники",
      "Проценты с чистой суммы проекта (после НПД). Меняйте доли — они подставятся при добавлении проекта.",
      `<button type="button" class="btn" id="add-employee">+ Сотрудник</button>`,
    )}
    ${bulkBarHtml("сотрудников")}
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>${checkHead()}<th>Сотрудник</th><th>Доля</th><th>Статус</th><th></th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5" class="meta">Нет сотрудников</td></tr>`}</tbody>
      </table>
      <div class="card-body">
        <div class="percent-sum ${sumClass}" id="percent-sum">Сумма долей: ${sum}% ${
          Math.abs(sum - 100) < 0.01 ? "— ок" : "— нужно 100%"
        }</div>
        <div class="header-actions" style="margin-top:0.75rem">
          <button type="button" class="btn" id="save-percents">Сохранить доли</button>
        </div>
      </div>
    </div>
    <div class="split-preview" style="margin-top:1rem">
      <h3>Пример: проект на 100 000 ₽</h3>
      <div class="split-row"><span>Смета</span><strong>${formatMoney(demo.gross)}</strong></div>
      <div class="split-row"><span>НПД ${demo.taxPercent}%</span><span class="tax">− ${formatMoney(demo.taxAmount)}</span></div>
      <div class="split-row"><span>К распределению</span><strong>${formatMoney(demo.netAmount)}</strong></div>
      ${demo.shares
        .map(
          (s) =>
            `<div class="split-row"><span>${esc(s.name)} · ${s.percent}%</span><span>${formatMoney(s.amount)}</span></div>`,
        )
        .join("")}
      <div class="split-row total"><span>Итого сотрудникам</span><span>${formatMoney(
        demo.shares.reduce((a, s) => a + s.amount, 0),
      )}</span></div>
    </div>`;
}

function renderProjects() {
  const rows = state.projects
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .map((p) => {
      const client = state.clients.find((c) => c.id === p.clientId);
      const shareText = (p.shares || [])
        .map((s) => {
          const emp = state.employees.find((e) => e.id === s.employeeId);
          return `${emp?.name || "?"} ${formatMoney(s.amount)}`;
        })
        .join(" · ");
      return `<tr class="is-clickable" data-nav="#project/${p.id}">
        ${checkCell(p.id)}
        <td>
          <strong>${esc(p.name)}</strong>
          <div class="meta">${esc(client?.company || "—")} · ${PROJECT_TYPE[p.type] || p.type}</div>
          <div class="meta" style="margin-top:4px">${esc(shareText)}</div>
        </td>
        <td>${badge(p.status, PROJECT_STATUS)}</td>
        <td class="num">${moneyHtml(p.budget, p.currency)}</td>
        <td class="num">${moneyHtml(p.taxAmount || 0, p.currency, "warn")}</td>
        <td class="num">${moneyHtml(p.netAmount ?? p.budget - (p.taxAmount || 0))}</td>
        <td class="num actions-cell">
          <button type="button" class="btn btn-ghost btn-sm" data-view-split="${p.id}">Доли</button>
          <button type="button" class="btn btn-ghost btn-sm btn-del" data-del-project="${p.id}">Удалить</button>
        </td>
      </tr>`;
    })
    .join("");

  return `
    ${pageHeader(
      "Проекты",
      "При добавлении сразу считается НПД самозанятого и доли сотрудников. Можно выбрать несколько и удалить.",
      `<button type="button" class="btn" id="add-project">+ Проект</button>`,
    )}
    ${bulkBarHtml("проектов")}
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            ${checkHead()}
            <th>Проект</th>
            <th>Статус</th>
            <th class="num">Смета</th>
            <th class="num">Налог</th>
            <th class="num">К распределению</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7" class="meta">Пока нет проектов</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderTaxes() {
  const { from, to } = periodRange(selectedPeriod);
  const income = sumRub(periodTransactions(state, from, to, "income"), state.rates);
  const accrued = round2((income * state.selfEmployedTaxPercent) / 100);
  const fromProjects = projectTaxDue(state, from, to);

  const rows = (state.taxPayments || [])
    .slice()
    .sort((a, b) => b.period.localeCompare(a.period))
    .map(
      (t) => `<tr>
        ${checkCell(t.id)}
        <td>${formatPeriod(t.period)}</td>
        <td class="num">${moneyHtml(t.baseAmount)}</td>
        <td class="num">${t.taxPercent}%</td>
        <td class="num">${moneyHtml(t.taxAmount, "RUB", "warn")}</td>
        <td>${badge(t.status, { paid: "Оплачен", planned: "К оплате" })}</td>
        <td class="meta">${t.paidAt ? formatDate(t.paidAt) : "—"}</td>
        <td class="num actions-cell">
          ${
            t.status !== "paid"
              ? `<button type="button" class="btn btn-sm" data-pay-tax="${t.id}">Отметить оплаченным</button>`
              : ""
          }
          <button type="button" class="btn btn-ghost btn-sm btn-del" data-del-tax="${t.id}">Удалить</button>
        </td>
      </tr>`,
    )
    .join("");

  return `
    ${pageHeader(
      "Налоги",
      `Учёт НПД самозанятого. Сейчас в настройках ${state.selfEmployedTaxPercent}% — удерживается с каждого проекта.`,
      `${periodSelectHtml()}<button type="button" class="btn" id="add-tax">+ Платёж НПД</button>`,
    )}
    <div class="kpi-grid">
      <div class="card"><div class="card-body">
        <div class="kpi-label">База (оплаты)</div>
        <div class="kpi-value">${moneyHtml(income)}</div>
        <p class="kpi-hint">Доходы за ${formatPeriod(selectedPeriod)}</p>
      </div></div>
      <div class="card"><div class="card-body">
        <div class="kpi-label">НПД от оплат</div>
        <div class="kpi-value">${moneyHtml(accrued, "RUB", "warn")}</div>
        <p class="kpi-hint">${state.selfEmployedTaxPercent}% от выручки периода</p>
      </div></div>
      <div class="card"><div class="card-body">
        <div class="kpi-label">Заклады в проектах</div>
        <div class="kpi-value">${moneyHtml(fromProjects, "RUB", "warn")}</div>
        <p class="kpi-hint">Сумма taxAmount новых проектов за период</p>
      </div></div>
    </div>
    ${bulkBarHtml("платежей")}
    <div class="card table-wrap" style="margin-top:1rem">
      <div class="card-head"><h2>Платежи НПД</h2></div>
      <table>
        <thead>
          <tr>
            ${checkHead()}
            <th>Период</th>
            <th class="num">База</th>
            <th class="num">%</th>
            <th class="num">Налог</th>
            <th>Статус</th>
            <th>Оплата</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="8" class="meta">Платежей пока нет</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderSubscriptions() {
  const active = (state.subscriptions || []).filter((s) => s.active);
  const monthBurn = active.reduce((a, s) => a + monthlySubCost(s), 0);
  const yearBurn = monthBurn * 12;

  const rows = (state.subscriptions || [])
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ru"))
    .map((s) => {
      const monthly = monthlySubCost(s);
      return `<tr>
        ${checkCell(s.id)}
        <td>
          <strong>${esc(s.name)}</strong>
          <div class="meta">${esc(s.vendor)} · ${esc(s.category || "")}</div>
        </td>
        <td>${badge(s.period, { month: "Месяц", year: "Год" })}</td>
        <td class="num">${moneyHtml(s.amount, s.currency)}</td>
        <td class="num">${moneyHtml(monthly)}</td>
        <td class="meta">${formatDate(s.nextPayment)}</td>
        <td>${badge(s.active ? "active" : "paused", { active: "Активна", paused: "Пауза" })}</td>
        <td class="num actions-cell">
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-sub="${s.id}">${
            s.active ? "Пауза" : "Вкл"
          }</button>
          <button type="button" class="btn btn-ghost btn-sm" data-edit-sub="${s.id}">Изменить</button>
          <button type="button" class="btn btn-ghost btn-sm btn-del" data-del-sub="${s.id}">Удалить</button>
        </td>
      </tr>`;
    })
    .join("");

  return `
    ${pageHeader(
      "Подписки",
      "Сервисы и софт: помесячно или раз в год. Считаем средний месячный расход.",
      `<button type="button" class="btn" id="add-sub">+ Подписка</button>`,
    )}
    <div class="kpi-grid">
      <div class="card"><div class="card-body">
        <div class="kpi-label">В месяц</div>
        <div class="kpi-value">${moneyHtml(monthBurn, "RUB", "neg")}</div>
        <p class="kpi-hint">Активные сервисы, год / 12</p>
      </div></div>
      <div class="card"><div class="card-body">
        <div class="kpi-label">В год</div>
        <div class="kpi-value">${moneyHtml(yearBurn)}</div>
        <p class="kpi-hint">Прогноз при текущем наборе</p>
      </div></div>
      <div class="card"><div class="card-body">
        <div class="kpi-label">Активных</div>
        <div class="kpi-value">${active.length}</div>
        <p class="kpi-hint">из ${(state.subscriptions || []).length}</p>
      </div></div>
    </div>
    ${bulkBarHtml("подписок")}
    <div class="card table-wrap" style="margin-top:1rem">
      <table>
        <thead>
          <tr>
            ${checkHead()}
            <th>Сервис</th>
            <th>Период</th>
            <th class="num">Платёж</th>
            <th class="num">≈ / мес</th>
            <th>Следующий</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="8" class="meta">Подписок нет</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderClients() {
  const rows = state.clients
    .slice()
    .sort((a, b) => a.company.localeCompare(b.company, "ru"))
    .map((c) => {
      const projects = state.projects.filter((p) => p.clientId === c.id);
      return `<tr class="is-clickable" data-nav="#client/${c.id}">
        ${checkCell(c.id)}
        <td><strong>${esc(c.company)}</strong><div class="meta">${esc(c.name)} · ${esc(c.city)}</div></td>
        <td>${badge(c.status, CLIENT_STATUS)}</td>
        <td class="num">${projects.length}</td>
        <td class="meta">${esc(c.email)}</td>
        <td class="num actions-cell">${delButton("clients", c.id)}</td>
      </tr>`;
    })
    .join("");

  return `
    ${pageHeader("Клиенты", "Заказчики студии. Можно выбрать несколько и удалить.", `<button type="button" class="btn" id="add-client">+ Клиент</button>`)}
    ${bulkBarHtml("клиентов")}
    <div class="card table-wrap">
      <table>
        <thead><tr>${checkHead()}<th>Клиент</th><th>Статус</th><th class="num">Проекты</th><th>Контакт</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="meta">Нет клиентов</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderInvoices() {
  const rows = (state.invoices || [])
    .slice()
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((inv) => {
      const status = effectiveInvoiceStatus(inv);
      const client = state.clients.find((c) => c.id === inv.clientId);
      const project = state.projects.find((p) => p.id === inv.projectId);
      return `<tr class="is-clickable" data-nav="#invoice/${inv.id}">
        ${checkCell(inv.id)}
        <td><strong>${esc(inv.number)}</strong></td>
        <td>${esc(client?.company || "—")}<div class="meta">${esc(project?.name || "")}</div></td>
        <td>${badge(status, INVOICE_STATUS)}</td>
        <td class="num">${moneyHtml(inv.amount, inv.currency)}</td>
        <td class="meta">${formatDate(inv.dueAt)}</td>
        <td class="num actions-cell">${delButton("invoices", inv.id)}</td>
      </tr>`;
    })
    .join("");

  return `
    ${pageHeader(
      "Счета",
      "Выставленные этапы оплаты. Можно выбрать несколько и удалить.",
      `<button type="button" class="btn" id="add-invoice">+ Счёт</button>`,
    )}
    ${bulkBarHtml("счетов")}
    <div class="card table-wrap">
      <table>
        <thead><tr>${checkHead()}<th>Номер</th><th>Клиент</th><th>Статус</th><th class="num">Сумма</th><th>Срок</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="meta">Нет счетов</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderCashflow() {
  const rows = (state.transactions || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => {
      const acc = (state.accounts || []).find((a) => a.id === t.accountId);
      return `<tr>
        ${checkCell(t.id)}
        <td class="meta">${formatDate(t.date)}</td>
        <td><strong>${esc(t.category)}</strong><div class="meta">${esc(t.description || t.counterparty)}</div></td>
        <td>${esc(acc?.name || "—")}</td>
        <td class="num">${moneyHtml(
          t.type === "expense" ? -t.amount : t.amount,
          t.currency,
          t.type === "income" ? "pos" : "neg",
        )}</td>
        <td class="num actions-cell">${delButton("transactions", t.id)}</td>
      </tr>`;
    })
    .join("");

  return `
    ${pageHeader(
      "Движения",
      "Кассы и статьи дохода / расхода. Можно выбрать несколько и удалить.",
      `<button type="button" class="btn btn-ghost" id="add-account">+ Касса</button><button type="button" class="btn" id="add-tx">+ Движение</button>`,
    )}
    ${bulkBarHtml("движений")}
    <div class="card table-wrap">
      <table>
        <thead><tr>${checkHead()}<th>Дата</th><th>Статья</th><th>Касса</th><th class="num">Сумма</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="meta">Нет движений</td></tr>`}</tbody>
      </table>
    </div>`;
}

function backLink(href, label = "Назад") {
  return `<a class="back-link" href="${href}">← ${esc(label)}</a>`;
}

function renderKpiDetail(kpiKey) {
  const { from, to } = periodRange(selectedPeriod);
  const stats = kpis(state, from, to);
  const titles = {
    income: "Выручка",
    expense: "Расходы",
    profit: "Прибыль",
    tax: "Налог НПД",
    subs: "Подписки",
    cash: "Кассы",
  };
  const title = titles[kpiKey] || "Детали";

  if (kpiKey === "income" || kpiKey === "expense") {
    const type = kpiKey === "income" ? "income" : "expense";
    const txs = periodTransactions(state, from, to, type).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    const total = sumRub(txs, state.rates);
    return `
      ${backLink("#dashboard", "К сводке")}
      ${pageHeader(title, `Разбор за ${formatPeriod(selectedPeriod)}`, periodSelectHtml())}
      <div class="card"><div class="card-body">
        <div class="kpi-label">Итого</div>
        <div class="kpi-value">${moneyHtml(total, "RUB", type === "income" ? "pos" : "neg")}</div>
      </div></div>
      <div class="card table-wrap" style="margin-top:1rem">
        <table>
          <thead><tr><th>Дата</th><th>Статья</th><th>Контрагент</th><th class="num">Сумма</th></tr></thead>
          <tbody>
            ${
              txs.length
                ? txs
                    .map((t) => {
                      const acc = (state.accounts || []).find((a) => a.id === t.accountId);
                      return `<tr>
                        <td class="meta">${formatDate(t.date)}</td>
                        <td><strong>${esc(t.category)}</strong><div class="meta">${esc(acc?.name || "")}</div></td>
                        <td class="meta">${esc(t.counterparty || t.description)}</td>
                        <td class="num">${moneyHtml(t.amount, t.currency, type === "income" ? "pos" : "neg")}</td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="4" class="meta">Нет движений за период</td></tr>`
            }
          </tbody>
        </table>
      </div>`;
  }

  if (kpiKey === "profit") {
    return `
      ${backLink("#dashboard", "К сводке")}
      ${pageHeader("Прибыль", `Выручка − расходы за ${formatPeriod(selectedPeriod)}`, periodSelectHtml())}
      <div class="card"><div class="card-body">
        <div class="detail-stat"><span>Выручка</span>${moneyHtml(stats.income, "RUB", "pos")}</div>
        <div class="detail-stat"><span>Расходы</span>${moneyHtml(stats.expense, "RUB", "neg")}</div>
        <div class="detail-stat"><strong>Прибыль</strong><strong>${moneyHtml(
          stats.profit,
          "RUB",
          stats.profit >= 0 ? "pos" : "neg",
        )}</strong></div>
      </div></div>
      <div class="header-actions" style="margin-top:1rem">
        <a class="btn" href="#kpi/income">К выручке</a>
        <a class="btn btn-ghost" href="#kpi/expense">К расходам</a>
      </div>`;
  }

  if (kpiKey === "tax") {
    const projects = state.projects.filter((p) =>
      inRange(p.createdAt || p.startDate || "", from, to),
    );
    return `
      ${backLink("#dashboard", "К сводке")}
      ${pageHeader("Налог НПД", `Заклад в проектах за ${formatPeriod(selectedPeriod)}`, periodSelectHtml())}
      <div class="card"><div class="card-body">
        <div class="kpi-label">Сумма налога в проектах</div>
        <div class="kpi-value">${moneyHtml(stats.taxDue, "RUB", "warn")}</div>
        <p class="kpi-hint">Ставка ${state.selfEmployedTaxPercent}%</p>
      </div></div>
      <div class="card table-wrap" style="margin-top:1rem">
        <table>
          <thead><tr><th>Проект</th><th class="num">Смета</th><th class="num">НПД</th><th class="num">К распределению</th></tr></thead>
          <tbody>
            ${
              projects.length
                ? projects
                    .map(
                      (p) => `<tr class="is-clickable" data-nav="#project/${p.id}">
                        <td><strong>${esc(p.name)}</strong></td>
                        <td class="num">${moneyHtml(p.budget, p.currency)}</td>
                        <td class="num">${moneyHtml(p.taxAmount || 0, p.currency, "warn")}</td>
                        <td class="num">${moneyHtml(p.netAmount || 0)}</td>
                      </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="4" class="meta">Нет проектов за период</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="header-actions" style="margin-top:1rem"><a class="btn" href="#taxes">Все платежи НПД</a></div>`;
  }

  if (kpiKey === "subs") {
    const subs = (state.subscriptions || []).filter((s) => s.active);
    const monthBurn = subs.reduce((a, s) => a + monthlySubCost(s), 0);
    return `
      ${backLink("#dashboard", "К сводке")}
      ${pageHeader("Подписки", "Активные сервисы и средний месячный расход")}
      <div class="card"><div class="card-body">
        <div class="kpi-label">В месяц</div>
        <div class="kpi-value">${moneyHtml(monthBurn, "RUB", "neg")}</div>
      </div></div>
      <div class="card table-wrap" style="margin-top:1rem">
        <table>
          <thead><tr><th>Сервис</th><th>Период</th><th class="num">Платёж</th><th class="num">≈ / мес</th></tr></thead>
          <tbody>
            ${subs
              .map(
                (s) => `<tr>
                  <td><strong>${esc(s.name)}</strong><div class="meta">${esc(s.vendor)}</div></td>
                  <td>${badge(s.period, { month: "Месяц", year: "Год" })}</td>
                  <td class="num">${moneyHtml(s.amount, s.currency)}</td>
                  <td class="num">${moneyHtml(monthlySubCost(s))}</td>
                </tr>`,
              )
              .join("") || `<tr><td colspan="4" class="meta">Нет активных подписок</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="header-actions" style="margin-top:1rem"><a class="btn" href="#subscriptions">Управление подписками</a></div>`;
  }

  // cash
  return `
    ${backLink("#dashboard", "К сводке")}
    ${pageHeader("Кассы", "Остатки по счетам студии")}
    <div class="card"><div class="card-body">
      <div class="kpi-label">Всего в рублях</div>
      <div class="kpi-value">${moneyHtml(stats.cash)}</div>
    </div></div>
    <div class="card table-wrap" style="margin-top:1rem">
      <table>
        <thead><tr><th>Касса</th><th>Валюта</th><th class="num">Остаток</th></tr></thead>
        <tbody>
          ${(state.accounts || [])
            .map((acc) => {
              const bal = accountBalanceNative(acc, state.transactions || []);
              return `<tr>
                <td><strong>${esc(acc.name)}</strong></td>
                <td class="meta">${esc(acc.currency)}</td>
                <td class="num">${moneyHtml(bal, acc.currency)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="header-actions" style="margin-top:1rem"><a class="btn" href="#cashflow">Все движения</a></div>`;
}

function renderProjectDetail(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) {
    return `${backLink("#projects", "К проектам")}<p class="empty">Проект не найден.</p>`;
  }
  const client = state.clients.find((c) => c.id === p.clientId);
  const invoices = (state.invoices || []).filter((i) => i.projectId === p.id);
  const txs = (state.transactions || []).filter((t) => t.projectId === p.id);

  return `
    ${backLink("#projects", "К проектам")}
    ${pageHeader(p.name, `${client?.company || "Без клиента"} · ${PROJECT_TYPE[p.type] || p.type}`)}
    <div class="detail-grid">
      <div class="card"><div class="card-body">
        <div class="detail-stat"><span>Статус</span>${badge(p.status, PROJECT_STATUS)}</div>
        <div class="detail-stat"><span>Смета</span>${moneyHtml(p.budget, p.currency)}</div>
        <div class="detail-stat"><span>НПД ${p.taxPercent ?? state.selfEmployedTaxPercent}%</span>${moneyHtml(
          p.taxAmount || 0,
          p.currency,
          "warn",
        )}</div>
        <div class="detail-stat"><span>К распределению</span><strong>${moneyHtml(
          p.netAmount || 0,
        )}</strong></div>
        <div class="detail-stat"><span>Срок</span><span class="meta">${formatDate(p.dueDate)}</span></div>
        ${p.notes ? `<div class="detail-stat"><span>Заметка</span><span class="meta">${esc(p.notes)}</span></div>` : ""}
      </div></div>
      <div class="split-preview">
        <h3>Распределение</h3>
        ${(p.shares || [])
          .map((s) => {
            const emp = state.employees.find((e) => e.id === s.employeeId);
            return `<div class="split-row"><span>${esc(emp?.name || s.employeeId)} · ${s.percent}%</span><span>${formatMoney(
              s.amount,
              p.currency,
            )}</span></div>`;
          })
          .join("") || `<p class="meta">Доли не заданы</p>`}
      </div>
    </div>
    <div class="grid-2" style="margin-top:1rem">
      <div class="card table-wrap">
        <div class="card-head"><h2>Счета</h2></div>
        <table>
          <thead><tr><th>Номер</th><th>Статус</th><th class="num">Сумма</th></tr></thead>
          <tbody>
            ${
              invoices.length
                ? invoices
                    .map(
                      (inv) => `<tr class="is-clickable" data-nav="#invoice/${inv.id}">
                        <td>${esc(inv.number)}</td>
                        <td>${badge(effectiveInvoiceStatus(inv), INVOICE_STATUS)}</td>
                        <td class="num">${moneyHtml(inv.amount, inv.currency)}</td>
                      </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="3" class="meta">Нет счетов</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="card table-wrap">
        <div class="card-head"><h2>Движения</h2></div>
        <table>
          <thead><tr><th>Дата</th><th>Статья</th><th class="num">Сумма</th></tr></thead>
          <tbody>
            ${
              txs.length
                ? txs
                    .map(
                      (t) => `<tr>
                        <td class="meta">${formatDate(t.date)}</td>
                        <td>${esc(t.category)}</td>
                        <td class="num">${moneyHtml(
                          t.type === "expense" ? -t.amount : t.amount,
                          t.currency,
                          t.type === "income" ? "pos" : "neg",
                        )}</td>
                      </tr>`,
                    )
                    .join("")
                : `<tr><td colspan="3" class="meta">Нет движений</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
    <div class="header-actions" style="margin-top:1rem">
      <select class="select" id="project-status" data-id="${p.id}" style="width:auto">
        ${Object.entries(PROJECT_STATUS)
          .map(([k, v]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${v}</option>`)
          .join("")}
      </select>
      <button type="button" class="btn" data-project-invoice="${p.id}">+ Счёт</button>
      <button type="button" class="btn btn-ghost" data-project-tx="${p.id}">+ Движение</button>
      ${client ? `<a class="btn btn-ghost" href="#client/${client.id}">Карточка клиента</a>` : ""}
    </div>`;
}

function renderClientDetail(id) {
  const c = state.clients.find((x) => x.id === id);
  if (!c) {
    return `${backLink("#clients", "К клиентам")}<p class="empty">Клиент не найден.</p>`;
  }
  const projects = state.projects.filter((p) => p.clientId === c.id);
  const invoices = (state.invoices || []).filter((i) => i.clientId === c.id);

  return `
    ${backLink("#clients", "К клиентам")}
    ${pageHeader(c.company, `${c.name} · ${c.city || "—"}`, delButton("clients", c.id, "#clients", "Удалить клиента"))}
    <div class="card"><div class="card-body">
      <div class="detail-stat"><span>Статус</span>${badge(c.status, CLIENT_STATUS)}</div>
      <div class="detail-stat"><span>Email</span><span class="meta">${esc(c.email || "—")}</span></div>
      <div class="detail-stat"><span>Телефон</span><span class="meta">${esc(c.phone || "—")}</span></div>
      <div class="detail-stat"><span>Проектов</span><strong>${projects.length}</strong></div>
    </div></div>
    <div class="card table-wrap" style="margin-top:1rem">
      <div class="card-head"><h2>Проекты</h2></div>
      <table>
        <thead><tr><th>Проект</th><th>Статус</th><th class="num">Смета</th><th class="num">НПД</th></tr></thead>
        <tbody>
          ${
            projects.length
              ? projects
                  .map(
                    (p) => `<tr class="is-clickable" data-nav="#project/${p.id}">
                      <td><strong>${esc(p.name)}</strong></td>
                      <td>${badge(p.status, PROJECT_STATUS)}</td>
                      <td class="num">${moneyHtml(p.budget, p.currency)}</td>
                      <td class="num">${moneyHtml(p.taxAmount || 0, p.currency, "warn")}</td>
                    </tr>`,
                  )
                  .join("")
              : `<tr><td colspan="4" class="meta">Нет проектов</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <div class="card table-wrap" style="margin-top:1rem">
      <div class="card-head"><h2>Счета</h2></div>
      <table>
        <thead><tr><th>Номер</th><th>Статус</th><th class="num">Сумма</th><th>Срок</th></tr></thead>
        <tbody>
          ${
            invoices.length
              ? invoices
                  .map(
                    (inv) => `<tr class="is-clickable" data-nav="#invoice/${inv.id}">
                      <td>${esc(inv.number)}</td>
                      <td>${badge(effectiveInvoiceStatus(inv), INVOICE_STATUS)}</td>
                      <td class="num">${moneyHtml(inv.amount, inv.currency)}</td>
                      <td class="meta">${formatDate(inv.dueAt)}</td>
                    </tr>`,
                  )
                  .join("")
              : `<tr><td colspan="4" class="meta">Нет счетов</td></tr>`
          }
        </tbody>
      </table>
    </div>`;
}

function renderInvoiceDetail(id) {
  const inv = (state.invoices || []).find((x) => x.id === id);
  if (!inv) {
    return `${backLink("#invoices", "К счетам")}<p class="empty">Счёт не найден.</p>`;
  }
  const client = state.clients.find((c) => c.id === inv.clientId);
  const project = state.projects.find((p) => p.id === inv.projectId);
  const status = effectiveInvoiceStatus(inv);

  return `
    ${backLink("#invoices", "К счетам")}
    ${pageHeader(inv.number, client?.company || "Счёт")}
    <div class="card"><div class="card-body">
      <div class="detail-stat"><span>Статус</span>${badge(status, INVOICE_STATUS)}</div>
      <div class="detail-stat"><span>Сумма</span><strong>${moneyHtml(inv.amount, inv.currency)}</strong></div>
      <div class="detail-stat"><span>Выставлен</span><span class="meta">${formatDate(inv.issuedAt)}</span></div>
      <div class="detail-stat"><span>Срок</span><span class="meta">${formatDate(inv.dueAt)}</span></div>
      <div class="detail-stat"><span>Оплачен</span><span class="meta">${inv.paidAt ? formatDate(inv.paidAt) : "—"}</span></div>
      <div class="detail-stat"><span>Клиент</span>${
        client
          ? `<a href="#client/${client.id}">${esc(client.company)}</a>`
          : "—"
      }</div>
      <div class="detail-stat"><span>Проект</span>${
        project
          ? `<a href="#project/${project.id}">${esc(project.name)}</a>`
          : "—"
      }</div>
    </div></div>
    <div class="header-actions" style="margin-top:1rem">
      ${
        inv.status !== "paid" && inv.status !== "cancelled"
          ? `<button type="button" class="btn" data-pay-invoice="${inv.id}">Оплачен — записать доход</button>`
          : ""
      }
      ${
        inv.status === "draft"
          ? `<button type="button" class="btn btn-ghost" data-send-invoice="${inv.id}">Выставлен</button>`
          : ""
      }
      ${
        inv.status !== "cancelled" && inv.status !== "paid"
          ? `<button type="button" class="btn btn-ghost" data-cancel-invoice="${inv.id}">Отменить</button>`
          : ""
      }
      ${delButton("invoices", inv.id, "#invoices", "Удалить счёт")}
    </div>`;
}

const RENDERERS = {
  dashboard: renderDashboard,
  projects: renderProjects,
  employees: renderEmployees,
  taxes: renderTaxes,
  subscriptions: renderSubscriptions,
  clients: renderClients,
  invoices: renderInvoices,
  cashflow: renderCashflow,
};

function parseHash() {
  const raw = (location.hash.replace("#", "") || "dashboard").trim();
  const [page, id] = raw.split("/");
  return { page: page || "dashboard", id: id || null };
}

function renderNav() {
  const listRoutes = new Set(NAV.map((n) => n.id));
  const active =
    route === "project"
      ? "projects"
      : route === "client"
        ? "clients"
        : route === "invoice"
          ? "invoices"
          : route === "kpi"
            ? "dashboard"
            : route;
  $("#nav").innerHTML = NAV.map(
    (item) =>
      `<a href="#${item.id}" class="${active === item.id && listRoutes.has(item.id) ? "active" : ""}">${item.label}</a>`,
  ).join("");
}

function render() {
  const parsed = parseHash();
  route = parsed.page;
  routeId = parsed.id;

  let html = "";
  if (route === "kpi" && routeId) {
    html = renderKpiDetail(routeId);
  } else if (route === "project" && routeId) {
    html = renderProjectDetail(routeId);
  } else if (route === "client" && routeId) {
    html = renderClientDetail(routeId);
  } else if (route === "invoice" && routeId) {
    html = renderInvoiceDetail(routeId);
  } else if (RENDERERS[route]) {
    html = RENDERERS[route]();
  } else {
    route = "dashboard";
    html = renderDashboard();
  }

  renderNav();
  $("#skeleton").hidden = true;
  const page = $("#page");
  page.hidden = false;
  page.innerHTML = html;
  bindPageEvents();
  closeMobile();
}

function bindPageEvents() {
  const period = $("#period-select");
  if (period) {
    period.addEventListener("change", () => {
      selectedPeriod = period.value;
      render();
    });
  }

  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, select, label, .check, .actions-cell")) return;
      const href = el.getAttribute("data-nav");
      if (!href) return;
      location.hash = href.replace(/^#/, "");
    });
  });

  $("#add-project")?.addEventListener("click", () => openProjectForm());
  $("#add-employee")?.addEventListener("click", () => openEmployeeForm());
  $("#add-client")?.addEventListener("click", () => openClientForm());
  $("#add-sub")?.addEventListener("click", () => openSubForm());
  $("#add-tax")?.addEventListener("click", () => openTaxForm());
  $("#add-tx")?.addEventListener("click", () => openTxForm());
  $("#add-account")?.addEventListener("click", () => openAccountForm());
  $("#add-invoice")?.addEventListener("click", () => openInvoiceForm());
  $("#save-percents")?.addEventListener("click", savePercents);

  document.querySelectorAll("[data-project-tx]").forEach((btn) => {
    btn.addEventListener("click", () => openTxForm({ projectId: btn.dataset.projectTx }));
  });

  document.querySelectorAll("[data-project-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoiceForm({ projectId: btn.dataset.projectInvoice }));
  });

  $("#project-status")?.addEventListener("change", (e) => {
    const project = state.projects.find((p) => p.id === e.target.dataset.id);
    if (!project) return;
    project.status = e.target.value;
    saveState();
    toast("Статус проекта обновлён");
    render();
  });

  document.querySelectorAll("[data-pay-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => payInvoice(btn.dataset.payInvoice));
  });

  document.querySelectorAll("[data-send-invoice], [data-cancel-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.sendInvoice || btn.dataset.cancelInvoice;
      const inv = (state.invoices || []).find((x) => x.id === id);
      if (!inv) return;
      inv.status = btn.dataset.sendInvoice ? "sent" : "cancelled";
      saveState();
      toast(inv.status === "sent" ? "Счёт выставлен" : "Счёт отменён");
      render();
    });
  });

  document.querySelectorAll(".emp-percent, .emp-status").forEach((el) => {
    el.addEventListener("input", updatePercentSumLive);
    el.addEventListener("change", updatePercentSumLive);
  });

  document.querySelectorAll("[data-edit-emp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emp = state.employees.find((e) => e.id === btn.dataset.editEmp);
      if (emp) openEmployeeForm(emp);
    });
  });

  document.querySelectorAll("[data-del-project]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Удалить проект?")) return;
      state.projects = state.projects.filter((p) => p.id !== btn.dataset.delProject);
      saveState();
      toast("Проект удалён");
      render();
    });
  });

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [collection, id] = btn.dataset.del.split(":");
      if (!Array.isArray(state[collection])) return;
      if (!confirm(`Удалить ${DELETE_NAMES[collection] || "запись"}? Вернуть не получится.`)) return;
      state[collection] = state[collection].filter((item) => item.id !== id);
      saveState();
      toast("Удалено");
      if (btn.dataset.delBack) location.hash = btn.dataset.delBack;
      else render();
    });
  });

  document.querySelectorAll("[data-view-split]").forEach((btn) => {
    btn.addEventListener("click", () => showProjectSplit(btn.dataset.viewSplit));
  });

  document.querySelectorAll("[data-toggle-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = state.subscriptions.find((s) => s.id === btn.dataset.toggleSub);
      if (!sub) return;
      sub.active = !sub.active;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-edit-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = state.subscriptions.find((s) => s.id === btn.dataset.editSub);
      if (sub) openSubForm(sub);
    });
  });

  document.querySelectorAll("[data-del-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("Удалить подписку?")) return;
      state.subscriptions = state.subscriptions.filter((s) => s.id !== btn.dataset.delSub);
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-pay-tax]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = state.taxPayments.find((t) => t.id === btn.dataset.payTax);
      if (!row) return;
      row.status = "paid";
      row.paidAt = todayIso();
      saveState();
      toast("НПД отмечен оплаченным");
      render();
    });
  });

  document.querySelectorAll("[data-del-tax]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.taxPayments = state.taxPayments.filter((t) => t.id !== btn.dataset.delTax);
      saveState();
      render();
    });
  });

  const bulkMap = {
    projects: ["projects", "проектов"],
    employees: ["employees", "сотрудников"],
    taxes: ["taxPayments", "платежей"],
    subscriptions: ["subscriptions", "подписок"],
    clients: ["clients", "клиентов"],
    invoices: ["invoices", "счетов"],
    cashflow: ["transactions", "движений"],
  };
  const bulk = bulkMap[route];
  if (bulk) bindBulkSelect(bulk[0], bulk[1]);
}

function updatePercentSumLive() {
  let sum = 0;
  document.querySelectorAll(".emp-percent").forEach((input) => {
    const emp = state.employees.find((e) => e.id === input.dataset.id);
    if (emp?.status === "active" || document.querySelector(`.emp-status[data-id="${input.dataset.id}"]`)?.value === "active") {
      const statusEl = document.querySelector(`.emp-status[data-id="${input.dataset.id}"]`);
      if ((statusEl?.value || emp?.status) === "active") sum += Number(input.value) || 0;
    }
  });
  // recompute using status selects
  sum = 0;
  state.employees.forEach((e) => {
    const statusEl = document.querySelector(`.emp-status[data-id="${e.id}"]`);
    const pctEl = document.querySelector(`.emp-percent[data-id="${e.id}"]`);
    const status = statusEl?.value || e.status;
    if (status === "active") sum += Number(pctEl?.value) || 0;
  });
  const el = $("#percent-sum");
  if (!el) return;
  const ok = Math.abs(sum - 100) < 0.01;
  el.className = `percent-sum ${ok ? "ok" : "bad"}`;
  el.textContent = `Сумма долей: ${round2(sum)}% ${ok ? "— ок" : "— нужно 100%"}`;
}

function savePercents() {
  let sum = 0;
  state.employees.forEach((e) => {
    const pctEl = document.querySelector(`.emp-percent[data-id="${e.id}"]`);
    const statusEl = document.querySelector(`.emp-status[data-id="${e.id}"]`);
    if (pctEl) e.percent = Number(pctEl.value) || 0;
    if (statusEl) e.status = statusEl.value;
    if (e.status === "active") sum += e.percent;
  });
  if (Math.abs(sum - 100) > 0.01) {
    toast(`Сумма долей ${round2(sum)}% — нужно 100%`);
    return;
  }
  saveState();
  toast("Доли сотрудников сохранены");
  render();
}

function showProjectSplit(projectId) {
  const p = state.projects.find((x) => x.id === projectId);
  if (!p) return;
  formMode = null;
  $("#form-eyebrow").textContent = "Распределение";
  $("#form-title").textContent = p.name;
  $("#form-desc").textContent = "Налог самозанятого и доли команды по этому проекту.";
  const shares = (p.shares || [])
    .map((s) => {
      const emp = state.employees.find((e) => e.id === s.employeeId);
      return `<div class="split-row"><span>${esc(emp?.name || s.employeeId)} · ${s.percent}%</span><span>${formatMoney(s.amount, p.currency)}</span></div>`;
    })
    .join("");
  $("#form-body").innerHTML = `
    <div class="split-preview">
      <div class="split-row"><span>Смета</span><strong>${formatMoney(p.budget, p.currency)}</strong></div>
      <div class="split-row"><span>НПД ${p.taxPercent ?? state.selfEmployedTaxPercent}%</span><span class="tax">− ${formatMoney(p.taxAmount || 0, p.currency)}</span></div>
      <div class="split-row"><span>К распределению</span><strong>${formatMoney(p.netAmount ?? 0, p.currency)}</strong></div>
      ${shares}
    </div>`;
  $("#form-submit").hidden = true;
  $("#form-modal").showModal();
}

function openForm({ eyebrow, title, desc, bodyHtml, onSubmit }) {
  formMode = { onSubmit };
  $("#form-eyebrow").textContent = eyebrow;
  $("#form-title").textContent = title;
  $("#form-desc").textContent = desc;
  $("#form-body").innerHTML = bodyHtml;
  $("#form-submit").hidden = false;
  $("#form-modal").showModal();
}

function openProjectForm() {
  const clientOpts = state.clients
    .map((c) => `<option value="${c.id}">${esc(c.company)}</option>`)
    .join("");
  const typeOpts = Object.entries(PROJECT_TYPE)
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join("");

  openForm({
    eyebrow: "Новый проект",
    title: "Добавить проект",
    desc: "Смета → НПД → доли сотрудников. Расчёт обновляется сразу.",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Название<input id="f-name" required placeholder="Лендинг «Мотор»" /></label>
        <label>Клиент<select class="select" id="f-client">${clientOpts}</select></label>
        <label>Тип<select class="select" id="f-type">${typeOpts}</select></label>
        <label>Статус
          <select class="select" id="f-status">
            ${Object.entries(PROJECT_STATUS)
              .map(([k, v]) => `<option value="${k}" ${k === "in_progress" ? "selected" : ""}>${v}</option>`)
              .join("")}
          </select>
        </label>
        <label>Смета, ₽<input id="f-budget" type="number" min="0" step="100" value="100000" /></label>
        <label>НПД, %
          <input id="f-tax" type="number" min="0" max="100" step="0.1" value="${state.selfEmployedTaxPercent}" />
          <span class="field-hint">По умолчанию из настроек (самозанятый)</span>
        </label>
      </div>
      <div id="project-split-live"></div>
    `,
    onSubmit: () => {
      const budget = Number($("#f-budget").value) || 0;
      const taxPercent = Number($("#f-tax").value) || 0;
      const split = calcProjectSplit(budget, taxPercent);
      if (Math.abs(split.percentSum - 100) > 0.01) {
        toast(`Доли сотрудников = ${split.percentSum}%. Исправьте во вкладке «Сотрудники».`);
        return false;
      }
      const name = $("#f-name").value.trim();
      if (!name) {
        toast("Укажите название");
        return false;
      }
      state.projects.unshift({
        id: uid("pr"),
        clientId: $("#f-client").value,
        name,
        type: $("#f-type").value,
        status: $("#f-status").value,
        budget,
        currency: "RUB",
        taxPercent: split.taxPercent,
        taxAmount: split.taxAmount,
        netAmount: split.netAmount,
        shares: split.shares.map(({ employeeId, percent, amount }) => ({
          employeeId,
          percent,
          amount,
        })),
        startDate: todayIso(),
        dueDate: todayIso(),
        notes: "",
        createdAt: todayIso(),
      });
      // sync tax payment suggestion for current month
      ensureTaxPeriod(currentPeriod());
      saveState();
      toast("Проект добавлен с налогом и долями");
      return true;
    },
  });

  const refresh = () => {
    const budget = Number($("#f-budget")?.value) || 0;
    const taxPercent = Number($("#f-tax")?.value) || 0;
    const split = calcProjectSplit(budget, taxPercent);
    const box = $("#project-split-live");
    if (!box) return;
    const sumOk = Math.abs(split.percentSum - 100) < 0.01;
    box.innerHTML = `
      <div class="split-preview">
        <h3>Кто сколько получит</h3>
        <div class="split-row"><span>Смета</span><strong>${formatMoney(split.gross)}</strong></div>
        <div class="split-row"><span>Налог самозанятого ${split.taxPercent}%</span><span class="tax">− ${formatMoney(split.taxAmount)}</span></div>
        <div class="split-row"><span>К распределению</span><strong>${formatMoney(split.netAmount)}</strong></div>
        ${split.shares
          .map(
            (s) =>
              `<div class="split-row"><span>${esc(s.name)} · ${s.percent}%</span><span>${formatMoney(s.amount)}</span></div>`,
          )
          .join("")}
        <div class="split-row total"><span>Итого команде</span><span>${formatMoney(
          split.shares.reduce((a, s) => a + s.amount, 0),
        )}</span></div>
        <p class="percent-sum ${sumOk ? "ok" : "bad"}" style="margin:0.75rem 0 0">
          Доли сотрудников: ${round2(split.percentSum)}% ${sumOk ? "" : "— настройте во вкладке «Сотрудники»"}
        </p>
      </div>`;
  };
  $("#f-budget")?.addEventListener("input", refresh);
  $("#f-tax")?.addEventListener("input", refresh);
  refresh();
}

function currencyOptions(selected = "RUB") {
  return ["RUB", "USD", "EUR"]
    .map((c) => `<option value="${c}" ${selected === c ? "selected" : ""}>${c}</option>`)
    .join("");
}

function projectOptions(selected = "") {
  return `<option value="">Без проекта</option>${state.projects
    .map((p) => `<option value="${p.id}" ${selected === p.id ? "selected" : ""}>${esc(p.name)}</option>`)
    .join("")}`;
}

function openTxForm(preset = {}) {
  const accounts = state.accounts || [];
  if (!accounts.length) {
    toast("Сначала добавьте кассу");
    openAccountForm();
    return;
  }
  const project = state.projects.find((p) => p.id === preset.projectId);
  const client = project ? state.clients.find((c) => c.id === project.clientId) : null;
  openForm({
    eyebrow: "Движения",
    title: "Новое движение",
    desc: "Оплата от клиента, зарплата, реклама, сервисы — всё, что пришло на кассу или ушло с неё.",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Тип
          <select class="select" id="f-type">
            <option value="income">Доход</option>
            <option value="expense">Расход</option>
          </select>
        </label>
        <label>Сумма<input id="f-amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="15000" /></label>
        <label>Валюта<select class="select" id="f-currency">${currencyOptions()}</select></label>
        <label>Дата<input id="f-date" type="date" value="${todayIso()}" /></label>
        <label>Касса
          <select class="select" id="f-account">
            ${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
          </select>
        </label>
        <label>Проект<select class="select" id="f-project">${projectOptions(preset.projectId || "")}</select></label>
        <label>Статья<input id="f-category" placeholder="Оплата, зарплата, реклама" /></label>
        <label>Контрагент<input id="f-counterparty" value="${esc(client?.company || "")}" /></label>
      </div>
      <label>Комментарий<input id="f-desc" placeholder="Аванс по лендингу" /></label>
    `,
    onSubmit: () => {
      const amount = Number($("#f-amount").value) || 0;
      if (amount <= 0) {
        toast("Укажите сумму больше нуля");
        return false;
      }
      const type = $("#f-type").value === "expense" ? "expense" : "income";
      state.transactions.push({
        id: uid("tx"),
        type,
        accountId: $("#f-account").value,
        projectId: $("#f-project").value,
        category: $("#f-category").value.trim() || (type === "income" ? "Оплата" : "Расход"),
        amount: round2(amount),
        currency: $("#f-currency").value,
        date: $("#f-date").value || todayIso(),
        counterparty: $("#f-counterparty").value.trim(),
        description: $("#f-desc").value.trim(),
      });
      saveState();
      toast(type === "income" ? "Доход записан" : "Расход записан");
      return true;
    },
  });
}

function openAccountForm() {
  openForm({
    eyebrow: "Кассы",
    title: "Новая касса",
    desc: "Карта, расчётный счёт или наличные. Остаток на старте — сколько там было до учёта.",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Название<input id="f-name" placeholder="Карта Тинькофф" /></label>
        <label>Тип
          <select class="select" id="f-type">
            <option value="card">Карта</option>
            <option value="bank">Расчётный счёт</option>
            <option value="cash">Наличные</option>
          </select>
        </label>
        <label>Валюта<select class="select" id="f-currency">${currencyOptions()}</select></label>
        <label>Остаток на старте<input id="f-opening" type="number" step="0.01" value="0" /></label>
      </div>
    `,
    onSubmit: () => {
      const name = $("#f-name").value.trim();
      if (!name) {
        toast("Укажите название кассы");
        return false;
      }
      state.accounts.push({
        id: uid("acc"),
        name,
        type: $("#f-type").value,
        currency: $("#f-currency").value,
        openingBalance: Number($("#f-opening").value) || 0,
      });
      saveState();
      toast("Касса добавлена");
      return true;
    },
  });
}

function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `CV-${year}-`;
  const max = (state.invoices || []).reduce((acc, inv) => {
    const n = String(inv.number || "").startsWith(prefix) ? Number(String(inv.number).slice(prefix.length)) : 0;
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function openInvoiceForm(preset = {}) {
  const project = state.projects.find((p) => p.id === preset.projectId);
  const clientOpts = `<option value="">Без клиента</option>${state.clients
    .map(
      (c) =>
        `<option value="${c.id}" ${project?.clientId === c.id ? "selected" : ""}>${esc(c.company)}</option>`,
    )
    .join("")}`;
  const due = new Date();
  due.setDate(due.getDate() + 7);
  openForm({
    eyebrow: "Счета",
    title: "Новый счёт",
    desc: "Этап оплаты по проекту. Когда клиент заплатит — отметьте счёт оплаченным, доход запишется сам.",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Номер<input id="f-number" value="${esc(nextInvoiceNumber())}" /></label>
        <label>Этап
          <select class="select" id="f-stage">
            <option value="advance">Аванс</option>
            <option value="final">Финальный</option>
            <option value="full">Полная оплата</option>
          </select>
        </label>
        <label>Клиент<select class="select" id="f-client">${clientOpts}</select></label>
        <label>Проект<select class="select" id="f-project">${projectOptions(preset.projectId || "")}</select></label>
        <label>Сумма<input id="f-amount" type="number" min="0" step="0.01" inputmode="decimal" value="${
          project ? round2(project.budget / 2) : ""
        }" /></label>
        <label>Валюта<select class="select" id="f-currency">${currencyOptions(project?.currency || "RUB")}</select></label>
        <label>Выставлен<input id="f-issued" type="date" value="${todayIso()}" /></label>
        <label>Оплатить до<input id="f-due" type="date" value="${due.toISOString().slice(0, 10)}" /></label>
        <label>Статус
          <select class="select" id="f-status">
            <option value="sent">Выставлен</option>
            <option value="draft">Черновик</option>
          </select>
        </label>
      </div>
    `,
    onSubmit: () => {
      const amount = Number($("#f-amount").value) || 0;
      if (amount <= 0) {
        toast("Укажите сумму счёта");
        return false;
      }
      const projectId = $("#f-project").value;
      const linked = state.projects.find((p) => p.id === projectId);
      state.invoices.push({
        id: uid("inv"),
        number: $("#f-number").value.trim() || nextInvoiceNumber(),
        clientId: $("#f-client").value || linked?.clientId || "",
        projectId,
        stage: $("#f-stage").value,
        amount: round2(amount),
        currency: $("#f-currency").value,
        status: $("#f-status").value,
        issuedAt: $("#f-issued").value || todayIso(),
        dueAt: $("#f-due").value || todayIso(),
        paidAt: "",
      });
      saveState();
      toast("Счёт добавлен");
      return true;
    },
  });
}

function payInvoice(id) {
  const inv = (state.invoices || []).find((x) => x.id === id);
  if (!inv) return;
  const client = state.clients.find((c) => c.id === inv.clientId);
  inv.status = "paid";
  inv.paidAt = todayIso();
  state.transactions.push({
    id: uid("tx"),
    type: "income",
    accountId: state.accounts?.[0]?.id || "",
    projectId: inv.projectId || "",
    category: "Оплата",
    amount: inv.amount,
    currency: inv.currency,
    date: inv.paidAt,
    counterparty: client?.company || "",
    description: `Счёт ${inv.number}`,
  });
  saveState();
  toast("Счёт оплачен, доход записан");
  render();
}

function openEmployeeForm(existing) {
  openForm({
    eyebrow: existing ? "Редактирование" : "Команда",
    title: existing ? "Сотрудник" : "Новый сотрудник",
    desc: "Имя и роль. Долю задайте в таблице процентов.",
    bodyHtml: `
      <label>Имя<input id="f-name" value="${esc(existing?.name || "")}" /></label>
      <label>Роль<input id="f-role" value="${esc(existing?.role || "")}" /></label>
      ${
        existing
          ? ""
          : `<label>Стартовая доля, %
              <input id="f-percent" type="number" min="0" max="100" step="0.1" value="0" />
              <span class="field-hint">После добавления подгоните сумму долей до 100%.</span>
            </label>`
      }
    `,
    onSubmit: () => {
      const name = $("#f-name").value.trim();
      if (!name) {
        toast("Укажите имя");
        return false;
      }
      if (existing) {
        existing.name = name;
        existing.role = $("#f-role").value.trim();
      } else {
        state.employees.push({
          id: uid("em"),
          name,
          role: $("#f-role").value.trim(),
          percent: Number($("#f-percent")?.value) || 0,
          status: "active",
        });
      }
      saveState();
      toast("Сохранено");
      return true;
    },
  });
}

function openClientForm() {
  openForm({
    eyebrow: "Клиенты",
    title: "Новый клиент",
    desc: "",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Компания<input id="f-company" /></label>
        <label>Контакт<input id="f-name" /></label>
        <label>Email<input id="f-email" type="email" /></label>
        <label>Город<input id="f-city" /></label>
      </div>
    `,
    onSubmit: () => {
      const company = $("#f-company").value.trim();
      if (!company) {
        toast("Укажите компанию");
        return false;
      }
      state.clients.push({
        id: uid("cl"),
        name: $("#f-name").value.trim() || company,
        company,
        email: $("#f-email").value.trim(),
        phone: "",
        city: $("#f-city").value.trim(),
        status: "active",
        createdAt: todayIso(),
      });
      saveState();
      toast("Клиент добавлен");
      return true;
    },
  });
}

function openSubForm(existing) {
  openForm({
    eyebrow: "Подписки",
    title: existing ? "Изменить подписку" : "Новая подписка",
    desc: "Figma, хостинг, домены — помесячно или раз в год.",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Название<input id="f-name" value="${esc(existing?.name || "")}" /></label>
        <label>Поставщик<input id="f-vendor" value="${esc(existing?.vendor || "")}" /></label>
        <label>Сумма<input id="f-amount" type="number" min="0" step="0.01" value="${existing?.amount ?? ""}" /></label>
        <label>Валюта
          <select class="select" id="f-currency">
            ${["RUB", "USD", "EUR"]
              .map(
                (c) =>
                  `<option value="${c}" ${
                    (existing?.currency || "RUB") === c ? "selected" : ""
                  }>${c}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>Период
          <select class="select" id="f-period">
            <option value="month" ${existing?.period !== "year" ? "selected" : ""}>Каждый месяц</option>
            <option value="year" ${existing?.period === "year" ? "selected" : ""}>Раз в год</option>
          </select>
        </label>
        <label>Следующий платёж<input id="f-next" type="date" value="${existing?.nextPayment || todayIso()}" /></label>
        <label>Категория<input id="f-category" value="${esc(existing?.category || "")}" /></label>
        <label class="inline-check" style="align-content:end">
          <input type="checkbox" id="f-active" ${existing?.active !== false ? "checked" : ""} />
          Активна
        </label>
      </div>
    `,
    onSubmit: () => {
      const name = $("#f-name").value.trim();
      if (!name) {
        toast("Укажите название");
        return false;
      }
      const payload = {
        name,
        vendor: $("#f-vendor").value.trim(),
        amount: Number($("#f-amount").value) || 0,
        currency: $("#f-currency").value,
        period: $("#f-period").value,
        nextPayment: $("#f-next").value,
        category: $("#f-category").value.trim(),
        active: $("#f-active").checked,
        notes: existing?.notes || "",
      };
      if (existing) Object.assign(existing, payload);
      else state.subscriptions.push({ id: uid("sub"), ...payload });
      saveState();
      toast("Подписка сохранена");
      return true;
    },
  });
}

function ensureTaxPeriod(period) {
  if (!state.taxPayments.some((t) => t.period === period)) {
    const { from, to } = periodRange(period);
    const base = sumRub(periodTransactions(state, from, to, "income"), state.rates);
    state.taxPayments.push({
      id: uid("tax"),
      period,
      baseAmount: base,
      taxPercent: state.selfEmployedTaxPercent,
      taxAmount: round2((base * state.selfEmployedTaxPercent) / 100),
      status: "planned",
      paidAt: null,
      note: "Авто из проектов / оплат",
    });
  }
}

function openTaxForm() {
  const { from, to } = periodRange(selectedPeriod);
  const base = sumRub(periodTransactions(state, from, to, "income"), state.rates);
  const tax = round2((base * state.selfEmployedTaxPercent) / 100);
  openForm({
    eyebrow: "НПД",
    title: "Платёж налога",
    desc: "Фиксируем начисление или оплату самозанятого.",
    bodyHtml: `
      <div class="form-grid cols-2">
        <label>Период<input id="f-period" value="${selectedPeriod}" placeholder="2026-09" /></label>
        <label>Ставка, %<input id="f-tax" type="number" step="0.1" value="${state.selfEmployedTaxPercent}" /></label>
        <label>База, ₽<input id="f-base" type="number" step="0.01" value="${base}" /></label>
        <label>Налог, ₽<input id="f-amount" type="number" step="0.01" value="${tax}" /></label>
        <label>Статус
          <select class="select" id="f-status">
            <option value="planned">К оплате</option>
            <option value="paid">Оплачен</option>
          </select>
        </label>
        <label>Дата оплаты<input id="f-paid" type="date" value="${todayIso()}" /></label>
      </div>
    `,
    onSubmit: () => {
      const period = $("#f-period").value.trim();
      const taxPercent = Number($("#f-tax").value) || 0;
      let baseAmount = Number($("#f-base").value) || 0;
      let taxAmount = Number($("#f-amount").value);
      if (!Number.isFinite(taxAmount)) taxAmount = round2((baseAmount * taxPercent) / 100);
      const status = $("#f-status").value;
      state.taxPayments.unshift({
        id: uid("tax"),
        period,
        baseAmount,
        taxPercent,
        taxAmount,
        status,
        paidAt: status === "paid" ? $("#f-paid").value : null,
        note: "",
      });
      saveState();
      toast("Платёж НПД добавлен");
      return true;
    },
  });

  const syncTax = () => {
    const baseAmount = Number($("#f-base").value) || 0;
    const taxPercent = Number($("#f-tax").value) || 0;
    $("#f-amount").value = round2((baseAmount * taxPercent) / 100);
  };
  $("#f-base")?.addEventListener("input", syncTax);
  $("#f-tax")?.addEventListener("input", syncTax);
}

function closeMobile() {
  $("#sidebar").classList.remove("open");
  $("#overlay").hidden = true;
}

function openMobile() {
  $("#sidebar").classList.add("open");
  $("#overlay").hidden = false;
}

function openSettings() {
  $("#tax-percent").value = state.selfEmployedTaxPercent;
  $("#rate-usd").value = state.rates.USD;
  $("#rate-eur").value = state.rates.EUR;
  const { from, to } = periodRange(currentPeriod());
  const k = kpis(state, from, to);
  $("#settings-kpi").textContent = `Этот месяц: выручка ${formatMoney(k.income)}, НПД в проектах ${formatMoney(k.taxDue)}`;
  $("#settings-modal").showModal();
}

function wireUi() {
  window.addEventListener("hashchange", render);
  $("#menu-toggle").addEventListener("click", openMobile);
  $("#overlay").addEventListener("click", closeMobile);
  $("#open-settings").addEventListener("click", openSettings);
  $("#open-settings-mobile").addEventListener("click", openSettings);
  document.querySelectorAll("[data-office]").forEach((link) => {
    link.addEventListener("click", () => {
      try {
        sessionStorage.setItem("cursiva-page", link.dataset.office);
      } catch {
        /* приватный режим */
      }
    });
  });

  $("#form-cancel").addEventListener("click", () => $("#form-modal").close());
  $("#form-submit").addEventListener("click", () => {
    if (!formMode?.onSubmit) {
      $("#form-modal").close();
      return;
    }
    const ok = formMode.onSubmit();
    if (ok !== false) {
      $("#form-modal").close();
      render();
    }
  });

  $("#save-settings").addEventListener("click", () => {
    state.selfEmployedTaxPercent = Number($("#tax-percent").value) || 6;
    state.rates = {
      RUB: 1,
      USD: Number($("#rate-usd").value) || state.rates.USD,
      EUR: Number($("#rate-eur").value) || state.rates.EUR,
    };
    saveState();
    toast("Настройки сохранены");
    $("#settings-modal").close();
    render();
  });

  $("#download-backup").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cursiva-finance-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Резерв скачан");
  });

  $("#import-backup").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!isFinanceData(parsed)) throw new Error("bad");
        state = normalizeState(parsed);
        saveState();
        $("#settings-modal").close();
        toast("Данные загружены");
        render();
      } catch {
        toast("Неверный файл резервной копии");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  $("#reset-demo").addEventListener("click", async () => {
    if (!confirm("Восстановить демо-данные? Текущие данные будут заменены.")) return;
    try {
      if (WP) {
        await saveChain;
        state = normalizeState(await apiFetch("reset-demo", { method: "POST", body: "{}" }));
      } else {
        state = normalizeState(seedData);
        saveState();
      }
      $("#settings-modal").close();
      toast("Демо восстановлено");
      render();
    } catch (err) {
      console.error(err);
      toast("Ошибка восстановления демо");
    }
  });

  $("#clear-all-data").addEventListener("click", async () => {
    if (
      !confirm(
        "Удалить ВСЕ данные: клиенты, проекты, счета, подписки, налоги и движения?\nЭто нельзя отменить.",
      )
    ) {
      return;
    }
    if (!confirm("Точно удалить всё? Останутся только пустые кассы и настройки НПД/курсов.")) return;
    try {
      if (WP) {
        await saveChain;
        state = normalizeState(await apiFetch("clear", { method: "POST", body: "{}" }));
      } else {
        state = normalizeState(emptyData());
        saveState();
      }
      $("#settings-modal").close();
      toast("Все данные удалены");
      render();
    } catch (err) {
      console.error(err);
      toast("Ошибка очистки данных");
    }
  });
}

function goOffice() {
  location.href = "../";
}

function wireTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#fff7f0");
    tg.setBackgroundColor("#fff7f0");
  } catch {
    /* старые клиенты Telegram */
  }
  if (tg.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => {
      if (document.querySelector("dialog[open]")) {
        document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
        return;
      }
      if (location.hash.includes("/")) {
        history.back();
        return;
      }
      goOffice();
    });
  }
  tg.onEvent("activated", refreshFromServer);
}

async function waitForInitData() {
  for (let i = 0; i < 20 && !initData(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  wireTelegram();
  await waitForInitData();
  seedData = await apiFetch("seed");
  state = normalizeState(await apiFetch("data"));
  wireUi();
  render();
  setInterval(refreshFromServer, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshFromServer();
  });
}

main().catch((err) => {
  console.error(err);
  const sk = document.querySelector("#skeleton");
  if (sk) {
    const denied = err.status === 401 || err.status === 403;
    sk.innerHTML = `<p class="empty">${
      denied
        ? "Нет доступа. Финансы открыты только команде Cursiva — откройте офис кнопкой в боте."
        : "Не удалось загрузить финансы. Проверьте связь и откройте ещё раз."
    }</p><p><a class="btn btn-ghost" href="../">← В офис</a></p>`;
  }
});
