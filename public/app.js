const lineColors = { 1: "#f8c300", 2: "#00a651", 4: "#b51f8d", 5: "#f36c21", 6: "#8d1b60" };
const $ = (selector) => document.querySelector(selector);
let state;
let selectedLine;

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
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "line";
    input.value = item.line;
    input.checked = selectedLine === item.line;
    input.disabled = state.locked || !state.eligible;
    input.addEventListener("change", () => { selectedLine = item.line; });
    const number = document.createElement("span");
    number.className = "line-number";
    number.textContent = item.line;
    const copy = document.createElement("span");
    const prediction = document.createElement("span");
    prediction.className = "line-prediction";
    prediction.textContent = item.line === "6" ? "Normal all day" : "Disrupted today";
    const status = document.createElement("span");
    status.className = "line-status";
    status.textContent = lineStatus(item.line)?.title || "waiting";
    copy.append(prediction, status);
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
    badge.textContent = item.line;
    who.append(badge, document.createTextNode(item.nickname));
    const result = document.createElement("span");
    result.textContent = item.result;
    row.append(who, result);
    list.append(row);
  }
  const newest = state.statuses.reduce((value, item) => Math.max(value, Number(item.checked_at || 0)), 0);
  $("#freshness").textContent = newest ? new Date(newest).toLocaleTimeString("en-CA", { timeZone: "America/Toronto" }) : "waiting";
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
  const result = state.bet?.result;
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
  const [hour, minute, second] = state.torontoTime.split(":").map(Number);
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
  state = await json("/api/today");
  render();
  updateCountdown();
}

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#profile-message");
  try {
    await json("/api/profile", { method: "PUT", body: JSON.stringify({ nickname: $("#nickname").value }) });
    message.textContent = "";
    await refresh();
  } catch (error) { message.textContent = error.message; message.className = "message error"; }
});

$("#rename").addEventListener("click", () => {
  $("#identity").hidden = false;
  $("#nickname").value = state.profile.nickname;
  $("#nickname").focus();
});

$("#lock-button").addEventListener("click", async () => {
  const message = $("#bet-message");
  if (!selectedLine) { message.textContent = "Pick one."; return; }
  try {
    await json("/api/bet", { method: "PUT", body: JSON.stringify({ line: selectedLine }) });
    message.textContent = `Line ${selectedLine}.`;
    message.className = "message";
    await refresh();
  } catch (error) { message.textContent = error.message; message.className = "message error"; }
});

await refresh();
setInterval(() => void refresh(), 30_000);
