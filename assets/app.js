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
    finance: null,
    period: "month",
    form: "",
    moneyKind: "income",
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
    { id: "money", label: "Деньги" },
  ];

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
        state.page = page.id;
        state.form = "";
        try { sessionStorage.setItem("cursiva-page", page.id); } catch (error) { /* приватный режим */ }
        if (!document.getElementById("page")) renderShell();
        else paint();
        load(false);
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
    return article;
  }

  function paint() {
    const slot = document.getElementById("page");
    if (!slot) return;
    const nav = document.querySelector(".nav");
    if (nav) nav.replaceWith(navBar());
    slot.replaceChildren();
    if (state.page === "tasks") paintTasks(slot);
    else if (state.page === "money") paintMoney(slot);
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

  function paintTasks(slot) {
    const head = el("div", "head");
    const count = el("h1", "count");
    count.append(document.createTextNode(String(state.openTasks)));
    const label = el("span");
    label.textContent = plural(state.openTasks, "открытая", "открытые", "открытых");
    count.append(label);
    const add = el("button", "refresh");
    add.type = "button";
    add.textContent = state.form === "task" ? "Закрыть" : "Новая";
    add.addEventListener("click", function () {
      state.form = state.form === "task" ? "" : "task";
      paint();
    });
    head.append(count, add);
    slot.append(head);
    if (state.form === "task") slot.append(taskForm());

    const list = el("div", "list");
    if (!state.tasks.length) {
      const empty = el("section", "empty");
      const heading = el("h1");
      heading.textContent = "Задач пока нет";
      const paragraph = el("p");
      paragraph.textContent = "Добавьте задачу здесь или командой /task в боте. Сделанные остаются в списке.";
      empty.append(heading, paragraph);
      list.append(empty);
    }
    state.tasks.forEach(function (task) { list.append(taskCard(task)); });
    slot.append(list);
  }

  function taskForm() {
    const form = el("form", "sheet");
    form.append(field("Задача", "title", "", "Что сделать"), area("Подробности", "details", "Необязательно"));
    const save = el("button", "refresh");
    save.type = "submit";
    save.textContent = "Добавить задачу";
    form.append(save);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      postJson("api.php?action=task", Object.fromEntries(new FormData(form).entries()), "Задача добавлена").then(function (body) {
        state.form = "";
        if (body && body.task) {
          state.tasks.unshift(body.task);
          state.openTasks = body.open;
        }
        load(false);
      });
    });
    return form;
  }

  function taskCard(task) {
    const article = el("article", "task" + (task.done ? " is-done" : " is-open"));
    const title = el("h2");
    title.textContent = task.title;
    article.append(title);
    if (task.details) {
      const details = el("p", "card__line");
      details.textContent = task.details;
      article.append(details);
    }
    const time = el("p", "card__line");
    time.textContent = task.created_label;
    const actions = el("div", "row");
    const toggle = el("button", "status");
    toggle.type = "button";
    toggle.textContent = task.done ? "Вернуть" : "Сделано";
    toggle.addEventListener("click", function () {
      postJson("api.php?action=task_update", { id: task.id, done: task.done ? 0 : 1 }, task.done ? "Задача снова открыта" : "Задача сделана").then(function () {
        load(false);
      });
    });
    const remove = el("button", "ghost");
    remove.type = "button";
    remove.textContent = "Удалить";
    remove.addEventListener("click", function () {
      if (!window.confirm("Удалить задачу?")) return;
      postJson("api.php?action=task_delete", { id: task.id }, "Задача удалена").then(function () { load(false); });
    });
    actions.append(toggle, remove);
    article.append(time, actions);
    return article;
  }

  function paintMoney(slot) {
    const finance = state.finance || { month: {}, all: {}, projects: [], entries: [], progress_count: 0 };
    const pack = state.period === "all" ? finance.all : finance.month;
    const head = el("div", "head");
    const count = el("h1", "count profit");
    if (pack && pack.profit < 0) count.classList.add("is-down");
    count.append(document.createTextNode(pack && pack.profit_label ? pack.profit_label : "0 ₽"));
    const label = el("span");
    label.textContent = state.period === "all" ? "прибыль за всё время" : "прибыль за " + (finance.month_label || "месяц");
    count.append(label);
    const add = el("button", "refresh");
    add.type = "button";
    add.textContent = state.form === "money" ? "Закрыть" : "Запись";
    add.addEventListener("click", function () {
      state.form = state.form === "money" ? "" : "money";
      paint();
    });
    head.append(count, add);

    const filters = el("div", "filters");
    [{ id: "month", label: "Этот месяц" }, { id: "all", label: "Всё время" }].forEach(function (item) {
      const button = el("button", "filter");
      button.type = "button";
      button.textContent = item.label;
      button.classList.toggle("is-on", state.period === item.id);
      button.addEventListener("click", function () {
        state.period = item.id;
        paint();
      });
      filters.append(button);
    });

    const stats = el("div", "stats");
    stats.append(
      stat("Доход", pack && pack.income_label),
      stat("Расход", pack && pack.expense_label),
      stat("В работе", String(finance.progress_count || 0)),
      stat("Сумма проектов", finance.progress_label || "0 ₽")
    );

    slot.append(head, filters, stats);
    if (state.form === "money") slot.append(moneyForm());
    slot.append(sectionLabel("Проекты"));
    const projectAdd = el("button", "ghost");
    projectAdd.type = "button";
    projectAdd.textContent = state.form === "project" ? "Закрыть форму" : "Новый проект";
    projectAdd.addEventListener("click", function () {
      state.form = state.form === "project" ? "" : "project";
      paint();
    });
    slot.append(projectAdd);
    if (state.form === "project") slot.append(projectForm());

    const projects = el("div", "list");
    (finance.projects || []).forEach(function (project) { projects.append(projectCard(project)); });
    if (!(finance.projects || []).length) {
      const empty = el("p", "card__line");
      empty.textContent = "Проектов пока нет.";
      projects.append(empty);
    }
    slot.append(projects, sectionLabel("Операции"));
    const entries = el("div", "list");
    (finance.entries || []).forEach(function (entry) { entries.append(moneyCard(entry)); });
    if (!(finance.entries || []).length) {
      const empty = el("p", "card__line");
      empty.textContent = "Доходов и расходов пока нет.";
      entries.append(empty);
    }
    slot.append(entries);
  }

  function stat(name, value) {
    const box = el("div", "stat");
    const caption = el("span");
    caption.textContent = name;
    const number = el("b");
    number.textContent = value || "0";
    box.append(caption, number);
    return box;
  }

  function sectionLabel(text) {
    const node = el("p", "section-label");
    node.textContent = text;
    return node;
  }

  function moneyForm() {
    const form = el("form", "sheet");
    const kinds = el("div", "row");
    [["income", "Доход"], ["expense", "Расход"]].forEach(function (item) {
      const button = el("button", "choice is-" + item[0]);
      button.type = "button";
      button.textContent = item[1];
      button.classList.toggle("is-on", state.moneyKind === item[0]);
      button.addEventListener("click", function () {
        state.moneyKind = item[0];
        paint();
      });
      kinds.append(button);
    });
    form.append(kinds, field("Сумма", "amount", "", "15000"), field("За что", "title", "", "Оплата сайта"));
    const save = el("button", "refresh");
    save.type = "submit";
    save.textContent = "Записать";
    form.append(save);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.kind = state.moneyKind;
      postJson("api.php?action=money", data, "Запись сохранена").then(function (body) {
        state.form = "";
        if (body) state.finance = body;
        paint();
      });
    });
    return form;
  }

  function projectForm() {
    const form = el("form", "sheet");
    form.append(
      field("Проект", "name", "", "Сайт для клиента"),
      field("Клиент", "client", "", "Необязательно"),
      field("Сумма", "amount", "", "0, если ещё не известна")
    );
    const amount = form.querySelector("input[name=amount]");
    if (amount) amount.required = false;
    const save = el("button", "refresh");
    save.type = "submit";
    save.textContent = "Добавить проект";
    form.append(save);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.status = "progress";
      postJson("api.php?action=project", data, "Проект добавлен").then(function (body) {
        state.form = "";
        if (body) state.finance = body;
        paint();
      });
    });
    return form;
  }

  function projectCard(project) {
    const article = el("article", "project" + (project.status === "progress" ? " is-progress" : ""));
    const title = el("h2");
    title.textContent = project.name;
    article.append(title);
    const line = el("p", "card__line");
    const bits = [project.status_label, project.amount_label];
    if (project.client) bits.unshift(project.client);
    line.textContent = bits.join(" · ");
    const actions = el("div", "row");
    [{ id: "progress", label: "В работе" }, { id: "paused", label: "Пауза" }, { id: "done", label: "Готов" }].forEach(function (item) {
      const button = el("button", "status");
      button.type = "button";
      button.textContent = item.label;
      button.disabled = project.status === item.id;
      button.classList.toggle("is-current", project.status === item.id);
      button.addEventListener("click", function () {
        postJson("api.php?action=project", {
          id: project.id,
          name: project.name,
          client: project.client,
          amount: (project.amount_cents / 100).toFixed(2),
          status: item.id,
        }, "Статус проекта обновлён").then(function (body) {
          if (body) state.finance = body;
          paint();
        });
      });
      actions.append(button);
    });
    article.append(line, actions);
    return article;
  }

  function moneyCard(entry) {
    const article = el("article", "money is-" + entry.kind);
    const title = el("h2");
    title.textContent = (entry.kind === "expense" ? "−" : "+") + entry.amount_label;
    article.append(title);
    const line = el("p", "card__line");
    line.textContent = [entry.title, entry.project_name, entry.happened_label].filter(Boolean).join(" · ");
    const remove = el("button", "ghost");
    remove.type = "button";
    remove.textContent = "Удалить";
    remove.addEventListener("click", function () {
      if (!window.confirm("Удалить запись?")) return;
      postJson("api.php?action=money_delete", { id: entry.id }, "Запись удалена").then(function (body) {
        if (body) state.finance = body;
        paint();
      });
    });
    article.append(line, remove);
    return article;
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
      } else if (state.page === "money") {
        state.finance = await api("api.php?action=finance");
      } else {
        const query = state.filter ? "&status=" + encodeURIComponent(state.filter) : "";
        const body = await api("api.php?action=leads" + query);
        state.leads = body.leads || [];
        state.counts = Object.assign(state.counts, body.counts || {});
      }
      state.mode = "ready";
      paint();
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
    try {
      const saved = sessionStorage.getItem("cursiva-page");
      if (saved === "leads" || saved === "tasks" || saved === "money") state.page = saved;
    } catch (error) {
      /* приватный режим */
    }
    renderShell();
    load(false);
    setInterval(function () {
      if (state.mode === "ready" && !state.busy && !state.form && !state.saving) load(false);
    }, 20000);
    if (tg) {
      tg.onEvent("activated", function () {
        if (state.mode === "ready") load(false);
      });
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
