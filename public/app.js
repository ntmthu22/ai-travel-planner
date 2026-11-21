// AI Travel Planner: the screens. No framework, no external script. Data is written into the page with
// textContent only (never as markup), and the only server calls are the endpoints in docs/contract/.
const state = {
  token: null,
  userId: null,
  tab: "search",
  groupId: null,
  proposal: null, // { id, places, warning, marks: { [placeId]: "pin" | "remove" } }
  draft: null, // { plan, stops, members, key }
};
const details = new Map(); // place id -> detail, so a menu is fetched once

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => `${Number(n).toLocaleString("vi-VN")} ₫`;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === "object" ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const field = (label, input) => h("label", {}, label, input);

function say(message, ok = false) {
  const el = $("#status");
  el.textContent = message;
  el.className = ok ? "ok" : "";
}

async function api(method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || data.title || `Error ${res.status}`);
    err.status = res.status;
    err.problem = data;
    throw err;
  }
  return data;
}

// Wraps an event handler: errors go to the status line instead of the console.
const act = (fn) => async (event) => {
  event?.preventDefault?.();
  try {
    await fn(event);
  } catch (e) {
    say(e.message);
  }
};

async function placeDetail(id) {
  if (!details.has(id)) details.set(id, await api("GET", `/places/${encodeURIComponent(id)}`));
  return details.get(id);
}

// ---------- header ----------
const TABS = [
  ["search", "Search"],
  ["interests", "My interests"],
  ["group", "Group"],
  ["plan", "Plan"],
];

function go(tab) {
  state.tab = tab;
  say("");
  render();
}

function renderHeader() {
  const nav = $("#nav");
  nav.replaceChildren(
    ...TABS.map(([id, label]) =>
      h(
        "button",
        {
          type: "button",
          "aria-current": state.tab === id ? "page" : false,
          onclick: () => go(id),
        },
        label,
      ),
    ),
  );
  const who = $("#who");
  if (state.userId) {
    who.replaceChildren(
      `Signed in as ${state.userId} `,
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            state.token = null;
            state.userId = null;
            state.proposal = null;
            state.draft = null;
            state.groupId = null;
            go("search");
          },
        },
        "Sign out",
      ),
    );
  } else {
    const user = h("input", { id: "login-user", autocomplete: "username", required: true });
    const pass = h("input", {
      id: "login-pass",
      type: "password",
      autocomplete: "current-password",
      required: true,
    });
    who.replaceChildren(
      h(
        "form",
        {
          class: "row",
          onsubmit: act(async () => {
            const r = await api("POST", "/auth/login", {
              username: user.value,
              password: pass.value,
            });
            state.token = r.token;
            state.userId = r.userId;
            say("Signed in.", true);
            render();
          }),
        },
        field("Username", user),
        field("Password", pass),
        h("button", { class: "primary" }, "Sign in"),
      ),
    );
  }
}

const needSignIn = (root) => {
  root.append(h("p", { class: "card" }, "Sign in (top right) to use this section."));
};

// ---------- search ----------
async function viewSearch(root) {
  const type = h("input", { id: "f-type", placeholder: "cafe, park..." });
  const district = h("input", { id: "f-district", placeholder: "D1" });
  const day = h(
    "select",
    { id: "f-day" },
    h("option", { value: "" }, "any"),
    DAYS.map((d) => h("option", { value: d }, d)),
  );
  const time = h("input", { id: "f-time", type: "time" });
  const level = h(
    "select",
    { id: "f-level" },
    h("option", { value: "" }, "any"),
    [1, 2, 3, 4].map((n) => h("option", { value: n }, n)),
  );
  const results = h("div", { id: "results" });
  const detail = h("div", { id: "detail" });

  const search = act(async () => {
    const q = new URLSearchParams();
    if (type.value.trim()) q.set("type", type.value.trim());
    if (district.value.trim()) q.set("district", district.value.trim());
    if (day.value) q.set("day", day.value);
    if (time.value) q.set("time", time.value);
    if (level.value) q.set("priceLevel", level.value);
    const { places } = await api("GET", `/places?${q}`);
    results.replaceChildren(
      places.length === 0 ? h("p", { class: "muted" }, "No place matches.") : null,
      ...places.map((p) =>
        h(
          "div",
          { class: "card row" },
          h("strong", {}, p.name),
          h(
            "span",
            { class: "muted" },
            `${p.type} · ${p.district} · price level ${p.priceLevel} · ticket ${fmt(p.ticketPrice ?? 0)}${p.outdoor ? " · outdoor" : ""}`,
          ),
          h("button", { type: "button", onclick: act(async () => showDetail(p.id)) }, "Details"),
        ),
      ),
    );
  });

  async function showDetail(id) {
    const p = await placeDetail(id);
    const hours = DAYS.map((d) => [
      d,
      (p.hours?.[d] ?? []).map((x) => `${x.open}–${x.close}`).join(", ") || "closed",
    ]);
    detail.replaceChildren(
      h(
        "section",
        { class: "card", "aria-label": `Details of ${p.name}` },
        h("h2", {}, p.name),
        h("p", { class: "muted" }, `${p.type} · ${p.district} · price level ${p.priceLevel}`),
        h("p", {}, p.description),
        h("h3", {}, "Opening hours"),
        h(
          "table",
          {},
          hours.map(([d, t]) => h("tr", {}, h("th", {}, d), h("td", {}, t))),
        ),
        h("h3", {}, "Menu"),
        p.menu?.length
          ? h(
              "table",
              {},
              p.menu.map((m) => h("tr", {}, h("td", {}, m.name), h("td", {}, fmt(m.price)))),
            )
          : h("p", { class: "muted" }, "No menu."),
        h(
          "p",
          { class: "muted" },
          `Ticket: ${p.ticketPrice === null ? "unknown" : fmt(p.ticketPrice)}`,
        ),
      ),
    );
    detail.scrollIntoView?.();
  }

  root.append(
    h("h2", {}, "Search places"),
    h(
      "form",
      { class: "card", onsubmit: search },
      field("Type", type),
      field("District", district),
      field("Open on", day),
      field("at", time),
      field("Price level", level),
      h("button", { class: "primary" }, "Search"),
    ),
    results,
    detail,
  );
}

// ---------- interests ----------
async function viewInterests(root) {
  if (!state.userId) return needSignIn(root);
  const me = await api("GET", "/me");
  const input = h("input", { id: "interests", value: me.interests.join(", "), size: 40 });
  root.append(
    h("h2", {}, "My interests"),
    h(
      "p",
      { class: "muted" },
      "The agent reads these (never your name or email). At most 10, comma separated.",
    ),
    h(
      "form",
      {
        class: "card row",
        onsubmit: act(async () => {
          const list = input.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const r = await api("PUT", "/me/interests", { interests: list });
          input.value = r.interests.join(", ");
          say("Interests saved.", true);
        }),
      },
      field("Interests", input),
      h("button", { class: "primary" }, "Save"),
    ),
  );
}

// ---------- group ----------
async function loadGroups() {
  const { groups } = await api("GET", "/groups");
  if (!groups.some((g) => g.id === state.groupId)) state.groupId = groups[0]?.id ?? null;
  return groups;
}

function groupPicker(groups, onChange) {
  return h(
    "select",
    {
      id: "group-select",
      "aria-label": "Group",
      onchange: (e) => {
        state.groupId = e.target.value;
        state.proposal = null;
        state.draft = null;
        onChange();
      },
    },
    groups.map((g) => h("option", { value: g.id, selected: g.id === state.groupId }, g.name)),
  );
}

async function viewGroup(root) {
  if (!state.userId) return needSignIn(root);
  const groups = await loadGroups();
  const name = h("input", { id: "g-name", required: true });
  const total = h("input", { id: "g-total", type: "number", min: 0, step: 1000, required: true });
  const token = h("input", {
    id: "g-token",
    value: location.hash.startsWith("#join=") ? location.hash.slice(6) : "",
  });

  root.append(
    h("h2", {}, "Group"),
    h(
      "form",
      {
        class: "card row",
        onsubmit: act(async () => {
          const g = await api("POST", "/groups", { name: name.value, total: Number(total.value) });
          state.groupId = g.id;
          say("Group created. Share the invite link with your members.", true);
          render();
        }),
      },
      field("New group name", name),
      field("Group total (₫)", total),
      h("button", { class: "primary" }, "Create"),
    ),
    h(
      "form",
      {
        class: "card row",
        onsubmit: act(async () => {
          const g = await api("POST", "/groups/join", { token: token.value.trim() });
          state.groupId = g.id;
          history.replaceState(null, "", location.pathname);
          say("You joined the group.", true);
          render();
        }),
      },
      field("Invite code", token),
      h("button", {}, "Join"),
    ),
  );
  if (groups.length === 0)
    return root.append(h("p", { class: "muted" }, "You are not in a group yet."));
  root.append(groupPicker(groups, render));

  const g = await api("GET", `/groups/${state.groupId}`);
  const myCap = h("input", {
    id: "my-cap",
    type: "number",
    min: 0,
    step: 1000,
    placeholder: "no cap",
    value: g.members.find((m) => m.userId === state.userId)?.cap ?? "",
  });
  const newTotal = h("input", {
    id: "new-total",
    type: "number",
    min: 0,
    step: 1000,
    value: g.total,
  });
  root.append(
    h(
      "section",
      { class: "card" },
      h("h3", {}, g.name),
      h("p", {}, `Group total: ${fmt(g.total)}`),
      h(
        "table",
        {},
        h("tr", {}, h("th", {}, "Member"), h("th", {}, "Spending cap")),
        g.members.map((m) =>
          h(
            "tr",
            {},
            h("td", {}, m.userId + (m.userId === g.ownerId ? " (owner)" : "")),
            h("td", {}, m.cap === null ? "no cap" : fmt(m.cap)),
          ),
        ),
      ),
      h(
        "form",
        {
          class: "row",
          onsubmit: act(async () => {
            const cap = myCap.value === "" ? null : Number(myCap.value);
            await api("PUT", `/groups/${g.id}/members/${encodeURIComponent(state.userId)}/cap`, {
              cap,
            });
            say("Your cap is saved. You can only change your own.", true);
            render();
          }),
        },
        field("My cap (₫)", myCap),
        h("button", {}, "Set my cap"),
      ),
      g.ownerId === state.userId
        ? h(
            "div",
            {},
            h(
              "form",
              {
                class: "row",
                onsubmit: act(async () => {
                  await api("PUT", `/groups/${g.id}/total`, { total: Number(newTotal.value) });
                  say("Group total updated.", true);
                  render();
                }),
              },
              field("Group total (₫)", newTotal),
              h("button", {}, "Update total"),
            ),
            field(
              "Invite link",
              h("input", {
                readonly: true,
                size: 60,
                value: `${location.origin}/#join=${g.inviteToken}`,
              }),
            ),
          )
        : null,
    ),
  );
}

// ---------- plan ----------
const warningBox = (w) =>
  w
    ? h(
        "div",
        { class: "red", role: "alert" },
        h("strong", {}, "Warning: "),
        w.message,
        " This is only a draft, and nothing is shared until you press Save.",
      )
    : null;

const violationsBox = (list) =>
  list?.length
    ? h(
        "div",
        { class: "warn" },
        h("strong", {}, "The validator would refuse this schedule:"),
        h(
          "ul",
          {},
          list.map((v) => h("li", {}, `[${v.rule ?? v.code}] ${v.message}`)),
        ),
      )
    : null;

function spendingTable(sp) {
  if (!sp)
    return h(
      "p",
      { class: "muted" },
      "No price: a place or an item in the schedule does not exist.",
    );
  return h(
    "table",
    {},
    h("tr", {}, h("th", {}, "Member"), h("th", {}, "Spends")),
    Object.entries(sp.perMember).map(([m, v]) => h("tr", {}, h("td", {}, m), h("td", {}, fmt(v)))),
    h("tr", {}, h("th", {}, "Group total"), h("th", {}, fmt(sp.total))),
  );
}

async function viewPlan(root) {
  if (!state.userId) return needSignIn(root);
  const groups = await loadGroups();
  root.append(h("h2", {}, "Plan a day"));
  if (groups.length === 0)
    return root.append(h("p", { class: "muted" }, "Create or join a group first."));
  root.append(groupPicker(groups, render));

  const date = h("input", {
    id: "p-date",
    type: "date",
    required: true,
    value: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  });
  const prefs = h("input", { id: "p-prefs", placeholder: "coffee, outdoors", size: 30 });
  const ask = h("button", { class: "primary" }, "Ask the agent");
  root.append(
    h(
      "form",
      {
        class: "card row",
        onsubmit: act(async () => {
          ask.disabled = true;
          say("The agent is working (up to 90 seconds)…", true);
          try {
            const preferences = prefs.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const p = await api("POST", `/groups/${state.groupId}/proposals`, {
              date: date.value,
              preferences,
            });
            state.proposal = { ...p, marks: {} };
            state.draft = null;
            say("");
          } finally {
            ask.disabled = false;
          }
          render();
        }),
      },
      field("Date", date),
      field("Preferences", prefs),
      ask,
    ),
  );

  if (state.draft) await renderDraft(root);
  else if (state.proposal) renderProposal(root);
  await renderSaved(root);
}

function renderProposal(root) {
  const p = state.proposal;
  const mark = (id, what) => {
    p.marks[id] = p.marks[id] === what ? undefined : what;
    render();
  };
  root.append(
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Step 1: choose the places"),
      h(
        "p",
        { class: "muted" },
        `The agent proposes ${p.places.length} places. Pin the ones you want, remove the ones you do not, then confirm. No schedule exists yet.`,
      ),
      warningBox(p.warning),
      p.places.map((pl) =>
        h(
          "div",
          { class: "row" },
          h("strong", {}, pl.name),
          h("span", { class: "muted" }, `${pl.type} · ${pl.district}`),
          h(
            "button",
            {
              type: "button",
              class: p.marks[pl.id] === "pin" ? "on" : "",
              "aria-pressed": p.marks[pl.id] === "pin",
              onclick: () => mark(pl.id, "pin"),
            },
            "Pin",
          ),
          h(
            "button",
            {
              type: "button",
              class: p.marks[pl.id] === "remove" ? "on" : "",
              "aria-pressed": p.marks[pl.id] === "remove",
              onclick: () => mark(pl.id, "remove"),
            },
            "Remove",
          ),
        ),
      ),
      h(
        "button",
        {
          class: "primary",
          type: "button",
          onclick: act(async () => {
            const pinned = Object.keys(p.marks).filter((id) => p.marks[id] === "pin");
            const removed = Object.keys(p.marks).filter((id) => p.marks[id] === "remove");
            say("The agent is building the schedule (up to 90 seconds)…", true);
            const plan = await api("POST", `/proposals/${p.id}/confirm`, { pinned, removed });
            const g = await api("GET", `/groups/${state.groupId}`);
            state.draft = {
              plan,
              stops: structuredClone(plan.stops),
              members: g.memberIds,
              key: crypto.randomUUID(),
            };
            state.proposal = null;
            say("");
            render();
          }),
        },
        "Confirm places",
      ),
    ),
  );
}

async function renderDraft(root) {
  const d = state.draft;
  for (const s of d.stops) await placeDetail(s.placeId).catch(() => null);
  const sync = async () => {
    d.plan = await api("PUT", `/plans/${d.plan.id}/stops`, { stops: d.stops });
    d.stops = structuredClone(d.plan.stops);
  };
  const stopCard = (s, i) => {
    const place = details.get(s.placeId);
    const menu = place?.menu ?? [];
    const start = h("input", {
      type: "time",
      value: s.start,
      "aria-label": "Start",
      onchange: (e) => {
        s.start = e.target.value;
      },
    });
    const end = h("input", {
      type: "time",
      value: s.end,
      "aria-label": "End",
      onchange: (e) => {
        s.end = e.target.value;
      },
    });
    const itemSel = h(
      "select",
      { "aria-label": "Item" },
      menu.map((m) => h("option", { value: m.id }, `${m.name} (${fmt(m.price)})`)),
    );
    const memSel = h(
      "select",
      { "aria-label": "For member" },
      d.members.map((m) => h("option", { value: m }, m)),
    );
    return h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("strong", {}, place?.name ?? s.placeId),
        start,
        "to",
        end,
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              d.stops.splice(i, 1);
              render();
            },
          },
          "Remove stop",
        ),
      ),
      s.items.length
        ? h(
            "table",
            {},
            s.items.map((it, j) =>
              h(
                "tr",
                {},
                h("td", {}, menu.find((m) => m.id === it.itemId)?.name ?? it.itemId),
                h("td", {}, it.memberId),
                h(
                  "td",
                  {},
                  h("input", {
                    type: "number",
                    min: 1,
                    max: 20,
                    value: it.qty,
                    "aria-label": "Quantity",
                    onchange: (e) => {
                      it.qty = Number(e.target.value);
                    },
                  }),
                ),
                h(
                  "td",
                  {},
                  h(
                    "button",
                    {
                      type: "button",
                      onclick: () => {
                        s.items.splice(j, 1);
                        render();
                      },
                    },
                    "Remove",
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "muted" }, "No items."),
      menu.length
        ? h(
            "div",
            { class: "row" },
            itemSel,
            memSel,
            h(
              "button",
              {
                type: "button",
                onclick: () => {
                  s.items.push({ itemId: itemSel.value, memberId: memSel.value, qty: 1 });
                  render();
                },
              },
              "Add item",
            ),
          )
        : null,
    );
  };
  root.append(
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Step 2: review, change, and save"),
      h(
        "p",
        { class: "muted" },
        "This draft is private to you. The other members see nothing until you press Save.",
      ),
      warningBox(d.plan.warning),
      violationsBox(d.plan.violations),
      d.stops.map(stopCard),
      h("h3", {}, "Spending per person"),
      spendingTable(d.plan.spending),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            type: "button",
            onclick: act(async () => {
              await sync();
              say("Recalculated.", true);
              render();
            }),
          },
          "Recalculate",
        ),
        h(
          "button",
          {
            type: "button",
            class: "primary",
            onclick: act(async () => {
              try {
                await sync(); // what you see is exactly what gets checked
                const r = await api(
                  "POST",
                  `/plans/${d.plan.id}/save`,
                  { confirmed: true },
                  { "Idempotency-Key": d.key },
                );
                say(`Saved and shared with ${r.sharedWith.length} members.`, true);
                state.draft = null;
              } catch (e) {
                if (e.status === 422 && e.problem?.violations) {
                  d.plan = { ...d.plan, violations: e.problem.violations };
                  say(
                    "Save refused: the validator found problems (listed above). Nothing was shared.",
                  );
                } else throw e;
              }
              render();
            }),
          },
          "Save and share",
        ),
      ),
    ),
  );
}

async function renderSaved(root) {
  const { plans } = await api("GET", `/groups/${state.groupId}/plans`);
  root.append(h("h2", {}, "Saved plans of this group"));
  if (plans.length === 0)
    return root.append(h("p", { class: "muted" }, "Nothing has been saved and shared yet."));
  for (const p of plans) {
    for (const s of p.stops) await placeDetail(s.placeId).catch(() => null);
    root.append(
      h(
        "section",
        { class: "card" },
        h("h3", {}, `Plan for ${p.date} (by ${p.ownerId})`),
        h(
          "ol",
          {},
          p.stops.map((s) =>
            h("li", {}, `${s.start}–${s.end} ${details.get(s.placeId)?.name ?? s.placeId}`),
          ),
        ),
        spendingTable(p.spending),
      ),
    );
  }
}

const views = { search: viewSearch, interests: viewInterests, group: viewGroup, plan: viewPlan };

async function render() {
  renderHeader();
  const main = $("#main");
  const root = h("div");
  try {
    await views[state.tab](root);
  } catch (e) {
    say(e.message);
  }
  main.replaceChildren(root);
}

if (location.hash.startsWith("#join=")) state.tab = "group";
render();
