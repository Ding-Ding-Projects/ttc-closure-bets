const lineColors = { 1: "#f8c300", 2: "#00a651", 4: "#b51f8d", 5: "#f36c21", 6: "#8d1b60" };
const lineTextColors = { 1: "#111318", 2: "#07150c", 4: "#ffffff", 5: "#16100c", 6: "#ffffff" };
const $ = (selector) => document.querySelector(selector);
let state;
let selectedLine;
let serverOffset = 0;
let refreshing = false;

async function json(url, options) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request returned ${response.status}`);
  return body;
}

function lineStatus(line) {
  return state.statuses.find((status) => status.line === line);
}

function renderLines() {
  const host = $("#lines");
  host.replaceChildren();
  for (const item of state.lines) {
    const label = document.createElement("label");
    label.className = "line-card";
    label.style.setProperty("--accent", lineColors[item.line]);
    label.style.setProperty("--on-accent", lineTextColors[item.line]);
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "line";
    input.value = item.line;
    input.checked = selectedLine === item.line;
    input.disabled = state.locked || !state.eligible;
    input.addEventListener("change", () => { selectedLine = item.line; renderLines(); });
    const number = document.createElement("span");
    number.className = "line-number";
    number.textContent = item.line;
    const copy = document.createElement("span");
    const prediction = document.createElement("span");
    prediction.className = "line-prediction";
    prediction.textContent = item.line === "6" ? "Normal all day" : "Disrupted today";
    const selected = document.createElement("span");
    selected.className = "selected-label";
    selected.textContent = input.checked ? "Selected" : "";
    const status = document.createElement("span");
    status.className = "line-status";
    status.textContent = lineStatus(item.line)?.title || "waiting";
    copy.append(prediction, status, selected);
    label.append(input, number, copy);
    host.append(label);
  }
}

function renderBoard() {
  const board = $("#board");
  board.hidden = !state.locked;
  const list = $("#board-list");
  list.replaceChildren();
  for (const item of state.board) {
    const row = document.createElement("li");
    const who = document.createElement("span");
    const badge = document.createElement("span");
    badge.className = "mini-line";
    badge.style.background = lineColors[item.line];
    badge.style.color = lineTextColors[item.line];
    badge.textContent = item.line;
    who.append(badge, document.createTextNode(item.nickname));
    const result = document.createElement("span");
    result.textContent = item.result;
    row.append(who, result);
    list.append(row);
  }
  const newest = state.statuses.reduce((value, item) => Math.max(value, Number(item.checked_at || 0)), 0);
  $("#freshness").textContent = newest ? `Updated ${new Date(newest).toLocaleTimeString("en-CA", { timeZone: "America/Toronto" })}` : "No status update yet";
}

async function renderHistory() {
  if (!state.profile) return;
  const { history } = await json("/api/history");
  const section = $("#history");
  section.hidden = history.length === 0;
  const list = $("#history-list");
  list.replaceChildren();
  for (const item of history) {
    const row = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = `${item.day} · Line ${item.line}`;
    const right = document.createElement("span");
    right.textContent = item.result;
    row.append(left, right);
    list.append(row);
  }
}

function renderResult() {
  const card = $("#result");
  const result = state.bet?.result !== "pending" ? state.bet?.result : state.latestResult?.result;
  card.hidden = !result || result === "pending";
  card.classList.toggle("won", result === "won");
  $("#result-copy").textContent = result === "won" ? "good job you have won" : result === "lost" ? "Not today." : "Result unavailable";
}

function render() {
  $("#date").textContent = `TORONTO · ${state.torontoDay}`;
  $("#clock").textContent = state.torontoTime;
  $("#identity").hidden = Boolean(state.profile);
  $("#game").hidden = !state.profile;
  if (state.profile) {
    $("#hello").textContent = state.profile.nickname;
    selectedLine = selectedLine || state.bet?.line;
    renderLines();
    const button = $("#lock-button");
    button.disabled = state.locked || !state.eligible;
    button.textContent = state.locked ? "Locked" : state.eligible ? "Lock it in" : "Tomorrow";
  }
  renderResult();
  renderBoard();
  void renderHistory();
}

function updateCountdown() {
  if (!state) return;
  const now = new Date(Date.now() + serverOffset);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const [hour, minute, second] = [values.hour, values.minute, values.second].map(Number);
  $("#clock").textContent = `${values.hour}:${values.minute}:${values.second}`;
  const current = hour * 3600 + minute * 60 + second;
  if (state.torontoDay !== new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date())) {
    $("#countdown").textContent = "tomorrow";
    return;
  }
  if (current >= state.lockSeconds) { $("#countdown").textContent = "locked"; return; }
  const remaining = state.lockSeconds - current;
  $("#countdown").textContent = `${String(Math.floor(remaining / 3600)).padStart(2, "0")}:${String(Math.floor(remaining % 3600 / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await json("/api/today");
    serverOffset = Date.parse(next.serverTime) - Date.now();
    state = next;
    $("#connection-message").hidden = true;
    render();
    updateCountdown();
  } catch (error) {
    $("#connection-copy").textContent = error instanceof Error ? `Could not refresh: ${error.message}` : "Could not refresh.";
    $("#connection-message").hidden = false;
  } finally { refreshing = false; }
}

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#profile-message");
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    await json("/api/profile", { method: "PUT", body: JSON.stringify({ nickname: $("#nickname").value }) });
    message.textContent = "";
    await refresh();
  } catch (error) { message.textContent = error.message; message.className = "message error"; }
  finally { if (button) button.disabled = false; }
});

$("#rename").addEventListener("click", () => {
  $("#identity").hidden = false;
  $("#nickname").value = state.profile.nickname;
  $("#nickname").focus();
});

$("#lock-button").addEventListener("click", async () => {
  const message = $("#bet-message");
  if (!selectedLine) { message.textContent = "Pick one."; return; }
  const button = $("#lock-button");
  button.disabled = true;
  try {
    await json("/api/bet", { method: "PUT", body: JSON.stringify({ line: selectedLine }) });
    message.textContent = `Line ${selectedLine}.`;
    message.className = "message";
    await refresh();
  } catch (error) { message.textContent = error.message; message.className = "message error"; }
  finally { button.disabled = state.locked || !state.eligible; }
});

$("#retry").addEventListener("click", () => void refresh());
await refresh();
setInterval(() => void refresh(), 30_000);
setInterval(updateCountdown, 1_000);
