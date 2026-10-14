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
    filter: "active",
    leads: [],
    counts: { all: 0, active: 0, progress: 0, closed: 0, cancelled: 0 },
    mode: "loading",
    message: "",
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
    return tg && tg.initData ? tg.initData : "";
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

  function renderShell() {
    root.replaceChildren();
    const app = el("main", "app");

    const brand = el("p", "brand");
    brand.textContent = "Cursiva";

    const head = el("div", "head");
    const count = el("h1", "count");
    count.id = "count";
    const refresh = el("button", "refresh");
    refresh.type = "button";
    refresh.id = "refresh";
    refresh.textContent = "Обновить";
    refresh.addEventListener("click", function () {
      load(true);
    });
    head.append(count, refresh);

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

    app.append(brand, head, filters, list);
    root.append(app);
    paint();
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
      paragraph.textContent = "Новая заявка с cursiva.ru появится в этом списке и придёт сообщением в бот.";
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
    paintCount();
    paintFilters();
    paintList();
    const refresh = document.getElementById("refresh");
    if (refresh) refresh.disabled = state.busy;
  }

  async function load(manual) {
    if (state.saving) return;
    state.busy = true;
    if (document.getElementById("count")) paint();
    try {
      const query = state.filter ? "&status=" + encodeURIComponent(state.filter) : "";
      const body = await api("api.php?action=leads" + query);
      state.leads = body.leads || [];
      state.counts = Object.assign(state.counts, body.counts || {});
      state.mode = "ready";
      if (!document.getElementById("count")) renderShell();
      else paint();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.mode = "denied";
        renderGate(
          "Откройте из бота",
          "Напишите боту /start и нажмите «Открыть заявки». Список видят только те, кто запустил бота."
        );
        return;
      }
      state.mode = "error";
      if (!document.getElementById("count")) {
        renderGate("Не удалось загрузить заявки", "Проверьте соединение и нажмите «Обновить» в боте ещё раз.");
      } else if (manual) {
        showToast("Не удалось обновить список");
      }
    } finally {
      state.busy = false;
      const refresh = document.getElementById("refresh");
      if (refresh) refresh.disabled = false;
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

  if (!initData()) {
    renderGate(
      "Откройте из бота",
      "Это мини-приложение Cursiva. Напишите боту /start и нажмите «Открыть заявки»."
    );
    return;
  }

  renderShell();
  load(false);
  setInterval(function () {
    if (state.mode === "ready" && !state.busy) load(false);
  }, 20000);

  if (tg) {
    tg.onEvent("activated", function () {
      if (state.mode === "ready") load(false);
    });
  }
})();
