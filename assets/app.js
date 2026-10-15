(function () {
  const STATUSES = [
    { id: "active", label: "Активный" },
    { id: "progress", label: "В работе" },
    { id: "closed", label: "Закрыт" },
    { id: "cancelled", label: "Отменен" },
  ];

  const FILTERS = [
    { id: "", label: "Все", key: "all" },
    { id: "active", label: "Активные", key: "active" },
    { id: "progress", label: "В работе", key: "progress" },
    { id: "closed", label: "Закрытые", key: "closed" },
    { id: "cancelled", label: "Отмененные", key: "cancelled" },
  ];

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const root = document.getElementById("app");
  const state = {
    page: "leads",
    filter: "active",
    leads: [],
    counts: { all: 0, active: 0, progress: 0, closed: 0, cancelled: 0 },
    tasks: [],
    openTasks: 0,
    users: [],
    groups: [],
    me: 0,
    today: "",
    board: {
      filter: "all",
      search: "",
      sort: "priority",
      group: "",
      assignee: "",
      hideDone: false,
    },
    sheet: null,
    form: "",
    mode: "loading",
    busy: false,
    saving: false,
  };

  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#fff7f0");
      tg.setBackgroundColor("#fff7f0");
    } catch (error) {
      /* старые клиенты Telegram */
    }
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function initData() {
    if (tg && tg.initData) return tg.initData;
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    const params = new URLSearchParams(hash);
    return params.get("tgWebAppData") || "";
  }

  window.cursivaInitData = initData;

  async function api(path, options) {
    const headers = Object.assign(
      { "X-Telegram-Init-Data": initData() },
      (options && options.headers) || {}
    );
    const response = await fetch(path, Object.assign({}, options, { headers }));
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok) {
      const error = new Error("request");
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function pageLabel(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname === "/" ? "" : parsed.pathname;
      return (parsed.host + path).replace(/\/$/, "");
    } catch (error) {
      return url;
    }
  }

  function metaLine(lead) {
    const parts = [lead.source, lead.service, lead.city, lead.messenger].filter(Boolean);
    if (lead.promo) parts.push("промокод " + lead.promo);
    if (lead.traffic && lead.traffic.indexOf("платн") !== -1) parts.push(lead.traffic);
    return parts.join(" · ");
  }

  function showToast(text) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const toast = el("div", "toast");
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 2400);
  }

  function renderGate(title, text) {
    root.replaceChildren();
    const app = el("main", "app");
    const gate = el("section", "gate");
    const brand = el("p", "brand");
    brand.textContent = "Cursiva";
    const heading = el("h1");
    heading.textContent = title;
    const paragraph = el("p");
    paragraph.textContent = text;
    gate.append(brand, heading, paragraph);
    app.append(gate);
    root.append(app);
  }

  const PAGES = [
    { id: "leads", label: "Заявки" },
    { id: "tasks", label: "Задачи" },
    { id: "finance", label: "Финансы" },
  ];

  let financeBox = null;

  function financeView(show) {
    if (!financeBox) {
      financeBox = el("div", "finance-box");
      const frame = el("iframe", "finance-frame");
      frame.src = "finance/?embed=1&v=5";
      frame.title = "Финансы";
      financeBox.append(frame);
      document.body.append(financeBox);
    }
    financeBox.classList.toggle("is-on", show);
    document.body.classList.toggle("is-finance", show);
    if (show) {
      const win = financeWindow();
      window.cursivaFinanceDepth(!!(win && win.location.hash.indexOf("/") !== -1));
    }
  }

  function financeWindow() {
    const frame = financeBox && financeBox.querySelector("iframe");
    try {
      return frame ? frame.contentWindow : null;
    } catch (error) {
      return null;
    }
  }

  function refreshFinance() {
    const win = financeWindow();
    if (win && typeof win.refreshFromServer === "function") win.refreshFromServer();
  }

  window.cursivaFinanceDepth = function (deep) {
    if (!tg || !tg.BackButton || state.page !== "finance") return;
    if (deep) tg.BackButton.show();
    else tg.BackButton.hide();
  };

  function financeBack() {
    const win = financeWindow();
    if (!win) return false;
    const dialogs = win.document.querySelectorAll("dialog[open]");
    if (dialogs.length) {
      dialogs.forEach(function (dialog) { dialog.close(); });
      window.cursivaFinanceDepth(win.location.hash.indexOf("/") !== -1);
      return true;
    }
    if (win.location.hash.indexOf("/") !== -1) {
      const page = win.location.hash.slice(1).split("/")[0];
      const list = { project: "projects", client: "clients", invoice: "invoices", kpi: "dashboard" };
      win.location.hash = list[page] || "dashboard";
      return true;
    }
    return false;
  }

  function renderShell() {
    root.replaceChildren();
    const app = el("main", "app");
    const brand = el("p", "brand");
    brand.textContent = "Cursiva";
    const slot = el("div");
    slot.id = "page";
    app.append(brand, slot, navBar());
    root.append(app);
    paint();
  }

  function navBar() {
    const nav = el("nav", "nav");
    PAGES.forEach(function (page) {
      const button = el("button");
      button.type = "button";
      button.textContent = page.label;
      button.classList.toggle("is-on", state.page === page.id);
      button.addEventListener("click", function () {
        if (state.page === page.id && page.id !== "finance") return;
        closeSheet();
        state.page = page.id;
        state.form = "";
        try { sessionStorage.setItem("cursiva-page", page.id); } catch (error) { /* приватный режим */ }
        if (!document.getElementById("page")) renderShell();
        else paint();
        window.scrollTo(0, 0);
        if (page.id === "finance") refreshFinance();
        else load(false);
      });
      nav.append(button);
    });
    return nav;
  }

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function countLabel(filter, count) {
    if (filter === "active") return plural(count, "активная", "активные", "активных");
    if (filter === "progress") return "в работе";
    if (filter === "closed") return plural(count, "закрытая", "закрытые", "закрытых");
    if (filter === "cancelled") return plural(count, "отмененная", "отмененные", "отмененных");
    return plural(count, "заявка", "заявки", "заявок");
  }

  function paintCount() {
    const count = document.getElementById("count");
    if (!count) return;
    const key = state.filter || "all";
    const value = state.counts[key] || 0;
    count.replaceChildren();
    count.append(document.createTextNode(String(value)));
    const label = el("span");
    label.textContent = countLabel(state.filter, value);
    count.append(label);
  }

  function paintFilters() {
    document.querySelectorAll(".filter").forEach(function (button) {
      const id = button.dataset.filter;
      const filter = FILTERS.filter(function (item) { return item.id === id; })[0];
      const total = filter ? state.counts[filter.key] || 0 : 0;
      button.textContent = filter.label + " " + total;
      button.classList.toggle("is-on", id === state.filter);
      button.setAttribute("aria-pressed", id === state.filter ? "true" : "false");
    });
  }

  function paintList() {
    const list = document.getElementById("list");
    if (!list) return;
    list.replaceChildren();

    if (!state.leads.length) {
      const empty = el("section", "empty");
      const heading = el("h1");
      heading.textContent = state.filter === "active" ? "Активных заявок нет" : "Здесь пусто";
      const paragraph = el("p");
      paragraph.textContent = "Заявка с cursiva.ru или добавленная вручную появится здесь и придёт в бот.";
      empty.append(heading, paragraph);
      list.append(empty);
      return;
    }

    state.leads.forEach(function (lead) {
      list.append(leadCard(lead));
    });
  }

  function leadCard(lead) {
    const article = el("article", "lead");
    article.dataset.status = lead.status;
    article.dataset.id = String(lead.id);

    const top = el("div", "lead__top");
    const name = el("h2", "lead__name");
    name.textContent = lead.name || "Клиент";
    const num = el("span", "lead__num");
    num.textContent = "№ " + lead.id;
    top.append(name, num);

    const phone = el("a", "lead__phone");
    phone.href = lead.phone_href || "tel:";
    phone.textContent = lead.phone || "Телефон не указан";

    article.append(top, phone);

    const meta = metaLine(lead);
    if (meta) {
      const line = el("p", "lead__meta");
      line.textContent = meta;
      article.append(line);
    }

    if (lead.created_label) {
      const time = el("p", "lead__time");
      time.textContent = lead.updated_label
        ? lead.created_label + " · статус " + lead.updated_label
        : lead.created_label;
      article.append(time);
    }

    if (lead.description) {
      const text = el("p", "lead__text");
      text.textContent = lead.description;
      article.append(text);
    }

    if (lead.note) {
      const note = el("p", "lead__meta");
      note.textContent = "Заметка: " + lead.note;
      article.append(note);
    }

    if (lead.page) {
      const link = el("a", "lead__page");
      link.href = lead.page;
      link.textContent = pageLabel(lead.page);
      link.addEventListener("click", function (event) {
        if (!tg) return;
        event.preventDefault();
        tg.openLink(lead.page);
      });
      article.append(link);
    }

    const statuses = el("div", "statuses");
    STATUSES.forEach(function (item) {
      const button = el("button", "status");
      button.type = "button";
      button.textContent = item.label;
      button.disabled = lead.status === item.id;
      button.classList.toggle("is-current", lead.status === item.id);
      button.addEventListener("click", function () {
        setStatus(lead, item.id, article);
      });
      statuses.append(button);
    });
    article.append(statuses);

    const remove = el("button", "lead__delete");
    remove.type = "button";
    remove.textContent = "Удалить заявку";
    remove.addEventListener("click", function () {
      deleteLead(lead);
    });
    article.append(remove);
    return article;
  }

  function deleteLead(lead) {
    if (!window.confirm("Удалить заявку № " + lead.id + (lead.name ? " (" + lead.name + ")" : "") + "? Вернуть её не получится.")) return;
    postJson("api.php?action=lead_delete", { id: lead.id }, "Заявка удалена").then(function (body) {
      if (!body) return;
      if (body.counts) state.counts = Object.assign(state.counts, body.counts);
      state.leads = state.leads.filter(function (item) { return item.id !== lead.id; });
      paint();
    });
  }

  function paint() {
    const slot = document.getElementById("page");
    if (!slot) return;
    const nav = document.querySelector(".nav");
    if (nav) nav.replaceWith(navBar());
    financeView(state.page === "finance");
    if (state.page === "finance") return;
    slot.replaceChildren();
    if (state.page === "tasks") paintTasks(slot);
    else paintLeads(slot);
  }

  function paintLeads(slot) {
    const head = el("div", "head");
    const count = el("h1", "count");
    count.id = "count";
    const actions = el("div", "row");
    const add = el("button", "refresh");
    add.type = "button";
    add.textContent = state.form === "lead" ? "Закрыть" : "Новая";
    add.addEventListener("click", function () {
      state.form = state.form === "lead" ? "" : "lead";
      paint();
    });
    const refresh = el("button", "ghost");
    refresh.type = "button";
    refresh.textContent = "Обновить";
    refresh.disabled = state.busy;
    refresh.addEventListener("click", function () { load(true); });
    actions.append(add, refresh);
    head.append(count, actions);

    const filters = el("div", "filters");
    filters.id = "filters";
    FILTERS.forEach(function (filter) {
      const button = el("button", "filter");
      button.type = "button";
      button.dataset.filter = filter.id;
      button.addEventListener("click", function () {
        state.filter = filter.id;
        paint();
        load(false);
      });
      filters.append(button);
    });

    const list = el("div", "list");
    list.id = "list";
    slot.append(head, filters);
    if (state.form === "lead") slot.append(leadForm());
    slot.append(list);
    paintCount();
    paintFilters();
    paintList();
  }

  function field(label, name, value, placeholder) {
    const wrap = el("label", "field");
    wrap.textContent = label;
    const input = el("input");
    input.name = name;
    input.value = value || "";
    input.placeholder = placeholder || "";
    input.required = name === "name" || name === "phone" || name === "title" || name === "amount";
    wrap.append(input);
    return wrap;
  }

  function area(label, name, placeholder) {
    const wrap = el("label", "field");
    wrap.textContent = label;
    const input = el("textarea");
    input.name = name;
    input.placeholder = placeholder || "";
    wrap.append(input);
    return wrap;
  }

  function leadForm() {
    const form = el("form", "sheet");
    form.append(
      field("Имя", "name", "", "Как обращаться"),
      field("Телефон", "phone", "", "+7…"),
      field("Услуга", "service", "", "Сайт, бот, реклама"),
      area("Комментарий", "description", "Что нужно сделать")
    );
    const save = el("button", "refresh");
    save.type = "submit";
    save.textContent = "Сохранить заявку";
    form.append(save);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.source = "вручную";
      postJson("api.php?action=lead_manual", data, "Заявка сохранена").then(function () {
        state.form = "";
        state.filter = "active";
        load(false);
      });
    });
    return form;
  }

  const TASK_STATUSES = [
    { id: "backlog", label: "Бэклог", next: "in_progress" },
    { id: "in_progress", label: "В работе", next: "review" },
    { id: "review", label: "На проверке", next: "done" },
    { id: "done", label: "Завершена", next: "" },
  ];

  const TASK_PRIORITIES = [
    { id: "low", label: "Низкий", weight: 0 },
    { id: "normal", label: "Обычный", weight: 1 },
    { id: "high", label: "Высокий", weight: 2 },
    { id: "urgent", label: "Срочный", weight: 3 },
  ];

  const BOARD_FILTERS = [
    { id: "all", label: "Все" },
    { id: "mine", label: "Мои" },
    { id: "overdue", label: "Просроченные" },
    { id: "unassigned", label: "Без исполнителя" },
    { id: "urgent", label: "Срочные" },
  ];

  const BOARD_SORTS = [
    { id: "priority", label: "По приоритету" },
    { id: "deadline", label: "По сроку" },
    { id: "newest", label: "Сначала новые" },
    { id: "oldest", label: "Сначала старые" },
  ];

  const SHORT_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  function text(tag, className, value) {
    const node = el(tag, className);
    node.textContent = value;
    return node;
  }

  function statusInfo(id) {
    return TASK_STATUSES.filter(function (item) { return item.id === id; })[0] || TASK_STATUSES[0];
  }

  function priorityInfo(id) {
    return TASK_PRIORITIES.filter(function (item) { return item.id === id; })[0] || TASK_PRIORITIES[1];
  }

  function userName(id) {
    const user = state.users.filter(function (item) { return item.telegram_id === id; })[0];
    return user ? user.name || "Участник" : "Участник";
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?").charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
  }

  function shortDate(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return iso || "";
    return Number(parts[2]) + " " + SHORT_MONTHS[Number(parts[1]) - 1];
  }

  function boardTasks() {
    const board = state.board;
    const query = board.search.trim().toLowerCase();
    const list = state.tasks.filter(function (task) {
      if (board.hideDone && task.status === "done") return false;
      if (board.group && task.group !== board.group) return false;
      if (board.assignee && task.assignees.indexOf(Number(board.assignee)) === -1) return false;
      if (board.filter === "mine" && task.assignees.indexOf(state.me) === -1 && task.created_by !== state.me) return false;
      if (board.filter === "overdue" && !task.overdue) return false;
      if (board.filter === "unassigned" && task.assignees.length) return false;
      if (board.filter === "urgent" && task.priority !== "urgent" && task.priority !== "high") return false;
      if (query) {
        const hay = (task.title + " " + task.details + " " + task.group).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    list.sort(function (a, b) {
      if (board.sort === "newest") return b.created_at - a.created_at;
      if (board.sort === "oldest") return a.created_at - b.created_at;
      if (board.sort === "deadline") {
        if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
        if (a.deadline !== b.deadline) return a.deadline ? -1 : 1;
        return b.updated_at - a.updated_at;
      }
      const weight = priorityInfo(b.priority).weight - priorityInfo(a.priority).weight;
      if (weight) return weight;
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return b.updated_at - a.updated_at;
    });
    return list;
  }

  function paintTasks(slot) {
    const head = el("div", "head");
    const count = el("h1", "count");
    count.append(document.createTextNode(String(state.openTasks)));
    count.append(text("span", "", plural(state.openTasks, "открытая задача", "открытые задачи", "открытых задач")));
    const add = el("button", "refresh");
    add.type = "button";
    add.textContent = "Новая";
    add.addEventListener("click", function () { openTaskEditor(null, "backlog"); });
    head.append(count, add);

    slot.append(head, boardMetrics(), boardToolbar());
    const board = el("div", "board");
    board.id = "board";
    slot.append(board);
    paintBoard();
  }

  function boardMetrics() {
    const total = state.tasks.length;
    const done = state.tasks.filter(function (task) { return task.status === "done"; }).length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const box = el("section", "metrics");
    const top = el("div", "metrics__top");
    top.append(text("span", "", "Выполнено"), text("strong", "", percent + "%"));
    const bar = el("div", "metrics__bar");
    const fill = el("span");
    fill.style.width = percent + "%";
    bar.append(fill);
    const grid = el("div", "metrics__grid");
    [
      ["Активные", total - done, ""],
      ["В работе", state.tasks.filter(function (task) { return task.status === "in_progress"; }).length, ""],
      ["На проверке", state.tasks.filter(function (task) { return task.status === "review"; }).length, ""],
      ["Просрочено", state.tasks.filter(function (task) { return task.overdue; }).length, "is-warn"],
    ].forEach(function (item) {
      const cell = el("div", "metrics__item " + item[2]);
      cell.append(text("span", "", item[0]), text("b", "", String(item[1])));
      grid.append(cell);
    });
    box.append(top, bar, grid);
    return box;
  }

  function selectBox(className, options, value, onChange) {
    const select = el("select", className);
    options.forEach(function (option) {
      const node = el("option");
      node.value = option[0];
      node.textContent = option[1];
      node.selected = option[0] === value;
      select.append(node);
    });
    select.addEventListener("change", function () { onChange(select.value); });
    return select;
  }

  function boardToolbar() {
    const wrap = el("div", "toolbar");
    const search = el("input", "search");
    search.type = "search";
    search.placeholder = "Поиск по задачам";
    search.value = state.board.search;
    search.addEventListener("input", function () {
      state.board.search = search.value;
      paintBoard();
    });

    const filters = el("div", "filters");
    BOARD_FILTERS.forEach(function (filter) {
      const button = el("button", "filter");
      button.type = "button";
      button.textContent = filter.label;
      button.classList.toggle("is-on", state.board.filter === filter.id);
      button.addEventListener("click", function () {
        state.board.filter = filter.id;
        paint();
      });
      filters.append(button);
    });

    const row = el("div", "toolbar__row");
    row.append(
      selectBox("pick", BOARD_SORTS.map(function (item) { return [item.id, item.label]; }), state.board.sort, function (value) {
        state.board.sort = value;
        paintBoard();
      }),
      selectBox("pick", [["", "Все исполнители"]].concat(state.users.map(function (user) {
        return [String(user.telegram_id), user.name || "Участник"];
      })), state.board.assignee, function (value) {
        state.board.assignee = value;
        paintBoard();
      })
    );
    if (state.groups.length) {
      row.append(selectBox("pick", [["", "Все группы"]].concat(state.groups.map(function (group) {
        return [group, group];
      })), state.board.group, function (value) {
        state.board.group = value;
        paintBoard();
      }));
    }
    const hide = el("label", "toggle");
    const box = el("input");
    box.type = "checkbox";
    box.checked = state.board.hideDone;
    box.addEventListener("change", function () {
      state.board.hideDone = box.checked;
      paintBoard();
    });
    hide.append(box, document.createTextNode("Скрыть завершённые"));
    row.append(hide);

    wrap.append(search, filters, row);
    return wrap;
  }

  function paintBoard() {
    const board = document.getElementById("board");
    if (!board) return;
    board.replaceChildren();
    const tasks = boardTasks();
    const lanes = TASK_STATUSES.filter(function (status) {
      return !(state.board.hideDone && status.id === "done");
    });

    const tabs = el("div", "lane-tabs");
    const track = el("div", "lanes");
    lanes.forEach(function (status) {
      const items = tasks.filter(function (task) { return task.status === status.id; });
      const tab = el("button", "lane-tab");
      tab.type = "button";
      tab.append(document.createTextNode(status.label + " "), text("b", "", String(items.length)));
      const lane = el("section", "lane lane--" + status.id);
      tab.addEventListener("click", function () {
        track.scrollTo({ left: lane.offsetLeft - track.offsetLeft, behavior: "smooth" });
      });
      tabs.append(tab);

      const head = el("div", "lane__head");
      head.append(text("h2", "", status.label), text("span", "lane__count", String(items.length)));
      lane.append(head);
      items.forEach(function (task) { lane.append(taskCard(task)); });
      if (!items.length) lane.append(text("p", "lane__empty", "Пусто"));
      const add = el("button", "lane__add");
      add.type = "button";
      add.textContent = "+ Добавить";
      add.addEventListener("click", function () { openTaskEditor(null, status.id); });
      lane.append(add);
      track.append(lane);
    });
    board.append(tabs, track);
  }

  function taskCard(task) {
    const card = el("article", "tcard tcard--" + task.priority + (task.status === "done" ? " is-done" : ""));
    const top = el("div", "tcard__top");
    if (task.group) top.append(text("span", "chip", task.group));
    if (task.priority !== "normal") top.append(text("span", "prio prio--" + task.priority, task.priority_label));
    if (task.comments) top.append(text("span", "tcard__badge", "💬 " + task.comments));
    if (task.links.length) top.append(text("span", "tcard__badge", "🔗 " + task.links.length));
    if (top.childNodes.length) card.append(top);

    card.append(text("h3", "tcard__title", task.title));
    if (task.details) card.append(text("p", "tcard__desc", task.details));

    const meta = el("div", "tcard__meta");
    if (task.deadline) {
      meta.append(text("span", "deadline" + (task.overdue ? " is-overdue" : ""), (task.overdue ? "просрочено " : "до ") + shortDate(task.deadline)));
    } else if (task.status === "done" && task.closed_label) {
      meta.append(text("span", "tcard__date", "закрыта " + task.closed_label));
    } else {
      meta.append(text("span", "tcard__date", task.created_label));
    }
    const people = el("div", "people");
    task.assignees.slice(0, 3).forEach(function (id) {
      const name = userName(id);
      const avatar = text("span", "avatar" + (id === state.me ? " is-me" : ""), initials(name));
      avatar.title = name;
      people.append(avatar);
    });
    if (task.assignees.length > 3) people.append(text("span", "avatar", "+" + (task.assignees.length - 3)));
    meta.append(people);
    card.append(meta);

    const next = statusInfo(task.status).next;
    if (next) {
      const move = el("button", "tcard__move");
      move.type = "button";
      move.textContent = statusInfo(next).label + " →";
      move.addEventListener("click", function (event) {
        event.stopPropagation();
        updateTask(task, { status: next }, "Задача: " + statusInfo(next).label.toLowerCase());
      });
      card.append(move);
    }

    card.addEventListener("click", function () { openTaskView(task.id, "info"); });
    return card;
  }

  function updateTask(task, changes, success) {
    return postJson("api.php?action=task_update", Object.assign({ id: task.id }, changes), success).then(function (body) {
      if (body && body.task) {
        const index = state.tasks.findIndex(function (item) { return item.id === body.task.id; });
        if (index >= 0) state.tasks[index] = body.task;
        state.openTasks = body.open;
        if (state.sheet && state.sheet.id === body.task.id) renderSheet();
        if (state.page === "tasks") paint();
      }
      return body;
    });
  }

  function closeSheet() {
    state.sheet = null;
    const old = document.querySelector(".overlay");
    if (old) old.remove();
    document.body.classList.remove("is-locked");
    if (tg && tg.BackButton) tg.BackButton.hide();
  }

  function openSheetFrame(title) {
    const old = document.querySelector(".overlay");
    if (old) old.remove();
    const overlay = el("div", "overlay");
    const panel = el("section", "panel");
    const head = el("div", "panel__head");
    head.append(text("h2", "", title));
    const close = el("button", "ghost");
    close.type = "button";
    close.textContent = "Закрыть";
    close.addEventListener("click", closeSheet);
    head.append(close);
    panel.append(head);
    overlay.append(panel);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeSheet();
    });
    document.body.append(overlay);
    document.body.classList.add("is-locked");
    if (tg && tg.BackButton) tg.BackButton.show();
    return panel;
  }

  function openTaskView(id, tab) {
    state.sheet = { id: id, tab: tab || "info", comments: null };
    renderSheet();
  }

  function openTaskEditor(task, status) {
    state.sheet = { id: task ? task.id : 0, tab: "edit", status: status || "backlog" };
    renderSheet();
  }

  function renderSheet() {
    const sheet = state.sheet;
    if (!sheet) return;
    const task = state.tasks.filter(function (item) { return item.id === sheet.id; })[0] || null;
    if (sheet.tab === "edit") {
      const panel = openSheetFrame(task ? "Редактировать задачу" : "Новая задача");
      panel.append(taskEditor(task, sheet.status));
      return;
    }
    if (!task) {
      closeSheet();
      return;
    }

    const panel = openSheetFrame("Задача № " + task.id);
    panel.append(text("h3", "panel__title", task.title));
    const badges = el("div", "row");
    badges.append(text("span", "chip chip--status-" + task.status, task.status_label));
    badges.append(text("span", "prio prio--" + task.priority, task.priority_label));
    if (task.group) badges.append(text("span", "chip", task.group));
    if (task.deadline) badges.append(text("span", "deadline" + (task.overdue ? " is-overdue" : ""), "до " + shortDate(task.deadline)));
    panel.append(badges);

    const moves = el("div", "quick");
    TASK_STATUSES.forEach(function (status) {
      const button = el("button", "status");
      button.type = "button";
      button.textContent = status.label;
      button.disabled = task.status === status.id;
      button.classList.toggle("is-current", task.status === status.id);
      button.addEventListener("click", function () {
        updateTask(task, { status: status.id }, "Статус: " + status.label.toLowerCase());
      });
      moves.append(button);
    });
    panel.append(moves);

    const actions = el("div", "row");
    if (state.me && task.assignees.indexOf(state.me) === -1) {
      actions.append(actionButton("Взять себе", function () {
        updateTask(task, { assignees: task.assignees.concat([state.me]) }, "Вы исполнитель");
      }));
    }
    actions.append(
      actionButton("Изменить", function () { openTaskEditor(task, task.status); }),
      actionButton("Дублировать", function () { duplicateTask(task); }),
      actionButton("Удалить", function () { deleteTask(task); })
    );
    panel.append(actions);

    const tabs = el("div", "filters tabs");
    [["info", "Инфо"], ["chat", "Чат" + (task.comments ? " " + task.comments : "")]].forEach(function (item) {
      const button = el("button", "filter");
      button.type = "button";
      button.textContent = item[1];
      button.classList.toggle("is-on", sheet.tab === item[0]);
      button.addEventListener("click", function () {
        sheet.tab = item[0];
        renderSheet();
      });
      tabs.append(button);
    });
    panel.append(tabs);

    if (sheet.tab === "chat") panel.append(taskChat(task));
    else panel.append(taskInfo(task));
  }

  function actionButton(label, onClick) {
    const button = el("button", "ghost");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function taskInfo(task) {
    const box = el("div", "info");
    if (task.details) box.append(text("p", "info__text", task.details));
    const rows = [
      ["Исполнители", task.assignees.length ? task.assignees.map(userName).join(", ") : "не назначены"],
      ["Автор", task.created_by ? userName(task.created_by) : "бот"],
      ["Создана", task.created_label],
      ["Обновлена", task.updated_label],
    ];
    if (task.closed_label) rows.push(["Закрыта", task.closed_label]);
    rows.forEach(function (row) {
      const line = el("p", "info__row");
      line.append(text("span", "", row[0]), text("b", "", row[1]));
      box.append(line);
    });
    task.links.forEach(function (url) {
      const link = text("a", "lead__page", pageLabel(url));
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.addEventListener("click", function (event) {
        if (!tg) return;
        event.preventDefault();
        tg.openLink(url);
      });
      box.append(link);
    });
    return box;
  }

  function taskChat(task) {
    const box = el("div", "chat");
    const list = el("div", "chat__list");
    box.append(list);
    const sheet = state.sheet;

    function paintComments() {
      list.replaceChildren();
      if (!sheet.comments) {
        list.append(text("p", "card__line", "Загружаю…"));
        return;
      }
      if (!sheet.comments.length) {
        list.append(text("p", "card__line", "Комментариев пока нет. Напишите первым."));
        return;
      }
      sheet.comments.forEach(function (comment) {
        const item = el("div", "msg" + (comment.author_id === state.me ? " is-me" : ""));
        item.append(text("b", "", comment.author), text("p", "", comment.body), text("span", "", comment.created_label));
        list.append(item);
      });
      list.scrollTop = list.scrollHeight;
    }

    paintComments();
    if (!sheet.comments) {
      api("api.php?action=task_comments&id=" + task.id).then(function (body) {
        if (state.sheet !== sheet) return;
        sheet.comments = body.comments || [];
        paintComments();
      }).catch(function () {
        showToast("Комментарии не загрузились");
      });
    }

    const form = el("form", "chat__form");
    const input = el("textarea");
    input.placeholder = "Комментарий";
    input.rows = 2;
    const send = el("button", "refresh");
    send.type = "submit";
    send.textContent = "Отправить";
    form.append(input, send);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      send.disabled = true;
      postJson("api.php?action=task_comment", { id: task.id, body: body }, "Комментарий добавлен").then(function (result) {
        send.disabled = false;
        if (!result) return;
        input.value = "";
        sheet.comments = result.comments || [];
        task.comments = sheet.comments.length;
        paintComments();
        if (state.page === "tasks") paintBoard();
      });
    });
    box.append(form);
    return box;
  }

  function choiceGroup(name, items, value) {
    const wrap = el("div", "row");
    const hidden = el("input");
    hidden.type = "hidden";
    hidden.name = name;
    hidden.value = value;
    wrap.append(hidden);
    items.forEach(function (item) {
      const button = el("button", "choice");
      button.type = "button";
      button.textContent = item.label;
      button.classList.toggle("is-on", item.id === value);
      button.addEventListener("click", function () {
        hidden.value = item.id;
        wrap.querySelectorAll(".choice").forEach(function (node) { node.classList.remove("is-on"); });
        button.classList.add("is-on");
      });
      wrap.append(button);
    });
    return wrap;
  }

  function labeled(label, node) {
    const wrap = el("div", "field");
    wrap.append(document.createTextNode(label), node);
    return wrap;
  }

  function taskEditor(task, status) {
    const form = el("form", "sheet editor");
    form.append(field("Задача", "title", task ? task.title : "", "Что нужно сделать"));
    const details = area("Описание", "details", "Подробности, ссылки, договорённости");
    details.querySelector("textarea").value = task ? task.details : "";
    form.append(details);
    form.append(labeled("Статус", choiceGroup("status", TASK_STATUSES, task ? task.status : status)));
    form.append(labeled("Приоритет", choiceGroup("priority", TASK_PRIORITIES, task ? task.priority : "normal")));

    const deadline = field("Срок", "deadline", task ? task.deadline : "", "");
    deadline.querySelector("input").type = "date";
    form.append(deadline);

    const group = field("Группа", "group", task ? task.group : "", "Сайт, реклама, клиент…");
    const groupInput = group.querySelector("input");
    groupInput.setAttribute("list", "task-groups");
    const groups = el("datalist");
    groups.id = "task-groups";
    state.groups.forEach(function (name) {
      const option = el("option");
      option.value = name;
      groups.append(option);
    });
    group.append(groups);
    form.append(group);

    const people = el("div", "people-pick");
    const selected = task ? task.assignees.slice() : (state.me ? [state.me] : []);
    state.users.forEach(function (user) {
      const label = el("label", "person");
      const box = el("input");
      box.type = "checkbox";
      box.name = "assignees";
      box.value = String(user.telegram_id);
      box.checked = selected.indexOf(user.telegram_id) !== -1;
      label.classList.toggle("is-on", box.checked);
      box.addEventListener("change", function () { label.classList.toggle("is-on", box.checked); });
      label.append(box, text("span", "avatar", initials(user.name)), document.createTextNode(user.name || "Участник"));
      people.append(label);
    });
    if (state.users.length) form.append(labeled("Исполнители", people));

    const links = area("Ссылки", "links", "https://… — по одной в строке");
    links.querySelector("textarea").value = task ? task.links.join("\n") : "";
    form.append(links);

    const save = el("button", "refresh");
    save.type = "submit";
    save.textContent = task ? "Сохранить" : "Создать задачу";
    form.append(save);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const data = new FormData(form);
      const payload = {
        title: String(data.get("title") || ""),
        details: String(data.get("details") || ""),
        status: String(data.get("status") || "backlog"),
        priority: String(data.get("priority") || "normal"),
        deadline: String(data.get("deadline") || ""),
        group: String(data.get("group") || ""),
        assignees: data.getAll("assignees").map(Number),
        links: String(data.get("links") || "").split(/\s+/).filter(Boolean),
      };
      save.disabled = true;
      const request = task
        ? postJson("api.php?action=task_update", Object.assign({ id: task.id }, payload), "Задача сохранена")
        : postJson("api.php?action=task", payload, "Задача создана");
      request.then(function (body) {
        save.disabled = false;
        if (!body || !body.task) return;
        const index = state.tasks.findIndex(function (item) { return item.id === body.task.id; });
        if (index >= 0) state.tasks[index] = body.task;
        else state.tasks.unshift(body.task);
        state.openTasks = body.open;
        if (body.task.group && state.groups.indexOf(body.task.group) === -1) state.groups.push(body.task.group);
        openTaskView(body.task.id, "info");
        paint();
      });
    });
    return form;
  }

  function duplicateTask(task) {
    postJson("api.php?action=task", {
      title: task.title + " (копия)",
      details: task.details,
      status: "backlog",
      priority: task.priority,
      deadline: task.deadline,
      group: task.group,
      assignees: task.assignees,
      links: task.links,
    }, "Копия создана").then(function (body) {
      if (!body || !body.task) return;
      state.tasks.unshift(body.task);
      state.openTasks = body.open;
      openTaskView(body.task.id, "info");
      paint();
    });
  }

  function deleteTask(task) {
    if (!window.confirm("Удалить задачу «" + task.title + "»?")) return;
    postJson("api.php?action=task_delete", { id: task.id }, "Задача удалена").then(function (body) {
      if (!body) return;
      state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; });
      state.openTasks = body.open;
      closeSheet();
      paint();
    });
  }

  function postJson(path, data, success) {
    state.saving = true;
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(function (body) {
      showToast(success);
      return body;
    }).catch(function (error) {
      const message = error.body && error.body.message ? error.body.message : "Не сохранились данные";
      showToast(message);
      return null;
    }).finally(function () {
      state.saving = false;
    });
  }

  async function load(manual) {
    state.busy = true;
    if (!document.getElementById("page")) renderShell();
    try {
      if (state.page === "tasks") {
        const body = await api("api.php?action=tasks");
        state.tasks = body.tasks || [];
        state.openTasks = body.open || 0;
        state.users = body.users || [];
        state.groups = body.groups || [];
        state.me = body.me || 0;
        state.today = body.today || "";
      } else {
        const query = state.filter ? "&status=" + encodeURIComponent(state.filter) : "";
        const body = await api("api.php?action=leads" + query);
        state.leads = body.leads || [];
        state.counts = Object.assign(state.counts, body.counts || {});
      }
      state.mode = "ready";
      const typing = document.activeElement && document.activeElement.classList.contains("search");
      if (typing && state.page === "tasks") paintBoard();
      else paint();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.mode = "denied";
        renderGate(
          "Нет доступа",
          "Офис открыт только команде Cursiva. Если вас добавили, нажмите /start в боте и откройте «Офис» слева от поля ввода."
        );
        return;
      }
      state.mode = "error";
      if (!document.getElementById("page")) {
        renderGate("Не удалось загрузить данные", "Проверьте соединение и откройте офис ещё раз.");
      } else if (manual) {
        showToast("Не удалось обновить список");
      }
    } finally {
      state.busy = false;
    }
  }

  async function setStatus(lead, status, article) {
    const previous = lead.status;
    state.saving = true;
    lead.status = status;
    article.replaceWith(leadCard(lead));
    try {
      const body = await api("api.php?action=status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id, status: status }),
      });
      if (body.counts) state.counts = Object.assign(state.counts, body.counts);
      if (body.lead) {
        const index = state.leads.findIndex(function (item) { return item.id === lead.id; });
        if (index >= 0) state.leads[index] = body.lead;
      }
      if (state.filter && state.filter !== status) {
        state.leads = state.leads.filter(function (item) { return item.id !== lead.id; });
      }
      paint();
    } catch (error) {
      lead.status = previous;
      paint();
      showToast("Статус не сохранился");
    } finally {
      state.saving = false;
    }
  }

  function begin() {
    if (!initData()) {
      renderGate(
        "Откройте кнопкой «Заявки»",
        "Нижняя кнопка открыла страницу без входа Telegram. Нажмите «Офис» слева от поля ввода или «Открыть офис» под сообщением бота."
      );
      return;
    }
    const startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
    const asked = new URLSearchParams(window.location.search).get("page") || startParam;
    const known = ["leads", "tasks", "finance"];
    let launch = "";
    try {
      launch = sessionStorage.getItem("cursiva-launch") || "";
      sessionStorage.setItem("cursiva-launch", initData());
      const saved = sessionStorage.getItem("cursiva-page");
      if (known.indexOf(saved) !== -1) state.page = saved;
    } catch (error) {
      /* приватный режим */
    }
    if (launch !== initData() && known.indexOf(asked) !== -1) state.page = asked;
    renderShell();
    load(false);
    setInterval(function () {
      if (state.page === "finance") return;
      if (state.mode === "ready" && !state.busy && !state.form && !state.saving && !state.sheet) load(false);
    }, 20000);
    if (tg) {
      tg.onEvent("activated", function () {
        if (state.page === "finance") refreshFinance();
        else if (state.mode === "ready" && !state.sheet) load(false);
      });
      if (tg.BackButton) {
        tg.BackButton.onClick(function () {
          if (state.page === "finance") financeBack();
          else closeSheet();
        });
      }
    }
  }

  let tries = 0;
  const timer = setInterval(function () {
    tries += 1;
    if (initData() || tries > 20) {
      clearInterval(timer);
      begin();
    }
  }, 100);
})();
