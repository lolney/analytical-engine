import init, {
  wasm_initial_program_state_json,
  wasm_step_instruction_json,
} from "./pkg/analytical_engine.js";

const examples = {
  sum: `# Sum 4 + 3 + 2 + 1 using reversed card motion controlled by the run-up lever.
N 4
V NUMBER -> V0
N 0
V NUMBER -> V1
N 1
V NUMBER -> V2
O +
V V1 -> I1
V V0 -> I2
V E -> V1
O -
V V0 -> I1
V V2 -> I2
JUMP_IF_RUNUP 3
V E -> V0
JUMP -9
PRINT V1
HALT`,
  division: `# Babbage-style division example: 10000 / 28.
# Primed egress receives the quotient; main egress receives the remainder.
N 10000
V NUMBER -> V1
N 28
V NUMBER -> V2
O /
V V1 -> I1
V V2 -> I2
V EP -> V3
V E -> V4
PRINT V3
PRINT V4
HALT`,
};

const fields = [
  ["pointer", "Pointer"],
  ["steps", "Steps"],
  ["halted", "Halted"],
  ["runUp", "Run-up"],
  ["operation", "Operation"],
  ["ingress1", "Ingress 1"],
  ["primedIngress1", "Primed ingress"],
  ["ingress2", "Ingress 2"],
  ["egress", "Egress"],
  ["primedEgress", "Primed egress"],
  ["pending", "Number reader"],
  ["output", "Output"],
];

const els = {
  deck: document.querySelector("#deck-input"),
  step: document.querySelector("#step"),
  run: document.querySelector("#run"),
  reset: document.querySelector("#reset"),
  loadSum: document.querySelector("#load-sum"),
  loadDivision: document.querySelector("#load-division"),
  status: document.querySelector("#run-status"),
  metrics: document.querySelector("#metrics"),
  instruction: document.querySelector("#instruction"),
  diff: document.querySelector("#diff-grid"),
  store: document.querySelector("#store-grid"),
  storeCount: document.querySelector("#store-count"),
  cardList: document.querySelector("#card-list"),
  cardCount: document.querySelector("#card-count"),
  mechanismSummary: document.querySelector("#mechanism-summary"),
  mechanismTicks: document.querySelector("#mechanism-ticks"),
  mechanismCount: document.querySelector("#mechanism-count"),
  machineNodes: [...document.querySelectorAll(".machine-node")],
};

let state;
let previousState;
let lastInstruction = "No card executed";
let lastMechanism = {
  summary: "Execute a card to see the reader, barrels, axes, figure wheels, and card chain.",
  ticks: [],
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function executableCards() {
  return els.deck.value
    .split("\n")
    .map((line, sourceLine) => ({
      sourceLine,
      text: line.split("#")[0].trim(),
    }))
    .filter((entry) => entry.text.length > 0);
}

function resetState() {
  state = JSON.parse(wasm_initial_program_state_json());
  previousState = structuredClone(state);
  lastInstruction = "No card executed";
  lastMechanism = {
    summary:
      "Execute a card to see the reader, barrels, axes, figure wheels, and card chain.",
    ticks: [],
  };
  render();
}

function readMachineSummary(programState) {
  const mill = programState.machine.mill;
  return {
    pointer: String(programState.pointer),
    steps: String(programState.steps),
    halted: programState.halted ? "yes" : "no",
    runUp: mill.run_up ? "set" : "clear",
    operation: mill.operation ?? "-",
    ingress1: mill.ingress_1 ?? "-",
    primedIngress1: mill.primed_ingress_1 ?? "-",
    ingress2: mill.ingress_2 ?? "-",
    egress: mill.egress ?? "-",
    primedEgress: mill.primed_egress ?? "-",
    pending: programState.machine.pending_number ?? "-",
    output: programState.machine.output.length
      ? programState.machine.output.join(", ")
      : "-",
  };
}

function storeMap(programState) {
  const map = new Map();
  for (const cell of programState.machine.store) {
    map.set(cell.column, cell.value);
  }
  return map;
}

function changedStoreColumns(before, after) {
  const beforeMap = storeMap(before);
  const afterMap = storeMap(after);
  const columns = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  return [...columns]
    .filter((column) => (beforeMap.get(column) ?? "0") !== (afterMap.get(column) ?? "0"))
    .sort((a, b) => a - b);
}

function renderMetrics() {
  const summary = readMachineSummary(state);
  els.metrics.innerHTML = `
    <div class="metric"><label>Pointer</label><strong>${summary.pointer}</strong></div>
    <div class="metric"><label>Steps</label><strong>${summary.steps}</strong></div>
    <div class="metric"><label>Run-up</label><strong>${summary.runUp}</strong></div>
    <div class="metric"><label>Halted</label><strong>${summary.halted}</strong></div>
  `;
  els.instruction.textContent = lastInstruction;
}

function renderDiff() {
  const before = readMachineSummary(previousState);
  const after = readMachineSummary(state);
  els.diff.innerHTML = fields
    .map(([key, label]) => {
      const changed = before[key] !== after[key];
      return `<div class="diff-card ${changed ? "changed" : ""}">
        <label>${escapeHtml(label)}</label>
        <strong>${escapeHtml(after[key])}</strong>
      </div>`;
    })
    .join("");
}

function renderStore() {
  const afterMap = storeMap(state);
  const changed = new Set(changedStoreColumns(previousState, state));
  const visibleColumns = new Set([...afterMap.keys(), ...changed]);
  const sorted = [...visibleColumns].sort((a, b) => a - b);
  els.storeCount.textContent = `${sorted.length} visible`;
  els.store.innerHTML = sorted.length
    ? sorted
        .map((column) => {
          const value = afterMap.get(column) ?? "0";
          return `<div class="store-cell ${changed.has(column) ? "changed" : ""}">
            <span>V${column}</span>${escapeHtml(value)}
          </div>`;
        })
        .join("")
    : `<div class="store-cell"><span>Store</span>All visible columns are zero</div>`;
}

function renderCards() {
  const cards = executableCards();
  els.cardCount.textContent = `${cards.length} cards`;
  els.cardList.innerHTML = cards
    .map((card, index) => {
      const active = index === state.pointer && !state.halted;
      const done = index < state.pointer || state.halted;
      return `<li class="${active ? "active" : ""} ${done ? "done" : ""}">
        ${escapeHtml(card.text)}
      </li>`;
    })
    .join("");
}

function activeMechanismParts() {
  const parts = new Set();
  for (const tick of lastMechanism.ticks) {
    for (const part of tick.active ?? []) {
      parts.add(part);
    }
  }
  return parts;
}

function tickVisual(tick) {
  const kind = tick.kind ?? tick.station;
  if (kind === "reader") {
    return readerDiagram(tick);
  }
  if (kind === "stopping_lever") {
    return stoppingLeverDiagram(tick);
  }
  if (kind === "card_chain") {
    return cardChainDiagram(tick);
  }
  if (kind === "store_to_mill") {
    return storeToMillDiagram(tick);
  }
  if (kind === "mill") {
    return millDiagram(tick);
  }
  if (kind === "run_up") {
    return runUpDiagram(tick);
  }
  if (kind === "mill_to_store") {
    return millToStoreDiagram(tick);
  }
  if (kind === "number_reader") {
    return numberReaderDiagram(tick);
  }
  if (kind === "store_ingress") {
    return numberToStoreDiagram(tick);
  }
  if (kind === "operation_barrel") {
    return operationBarrelDiagram(tick);
  }
  if (kind === "directive" || kind === "run_up_feeler") {
    return directiveDiagram(tick);
  }
  if (kind === "output") {
    return outputDiagram(tick);
  }
  return genericMechanismDiagram(tick);
}

function tracePointer() {
  const firstTick = lastMechanism.ticks[0];
  return firstTick ? firstTick.before_pointer : state.pointer;
}

function cardWindow() {
  const cards = executableCards();
  const center = Math.max(0, Math.min(tracePointer(), cards.length - 1));
  const start = Math.max(0, center - 2);
  return cards.slice(start, start + 5).map((card, offset) => ({
    index: start + offset,
    text: card.text,
    active: start + offset === center,
  }));
}

function punchedCard(card) {
  const holes = [0, 1, 2, 3, 4, 5]
    .map((hole) => `<span class="${card.active && hole % 2 === 0 ? "punched" : ""}"></span>`)
    .join("");
  return `<div class="trace-card ${card.active ? "active" : ""}">
    <div class="trace-holes" aria-hidden="true">${holes}</div>
    <b>${card.index}</b>
  </div>`;
}

function cardStrip() {
  return `<div class="card-strip" aria-label="Card chain around current pointer">
    ${cardWindow().map(punchedCard).join("")}
  </div>`;
}

function mechanismAsset(asset, label) {
  return `<figure class="asset-plate">
    <img src="./assets/mechanism-${asset}.webp" alt="" aria-hidden="true" />
    <figcaption>${escapeHtml(label)}</figcaption>
  </figure>`;
}

function flowArrow(label, mode = "") {
  return `<div class="flow-arrow ${mode}">
    <span>${escapeHtml(label)}</span>
  </div>`;
}

function valuePanel(title, rows, extraClass = "") {
  const values = rows.length
    ? rows
        .map(
          ([label, value]) => `<div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>`,
        )
        .join("")
    : `<p>No wheel values exposed.</p>`;
  return `<div class="value-panel ${extraClass}">
    <h3>${escapeHtml(title)}</h3>
    <div class="value-grid">${values}</div>
  </div>`;
}

function wheelRows(tick) {
  return (tick.wheels ?? []).map((wheel) => [
    wheel.label,
    `${wheel.sign}${wheel.digits}`,
  ]);
}

function cardFamily(tick) {
  return tick.active?.find((part) => part.endsWith("-card")) ?? tick.active?.[1] ?? "card";
}

function cardPanel(tick, title = "Card") {
  return valuePanel(title, [
    ["Index", String(tick.before_pointer)],
    ["Kind", cardFamily(tick)],
  ]);
}

function mechanismVisual(tick, nodes) {
  const aria = `${tick.station}: ${tick.action}. ${tick.detail}`;
  return `<div class="mechanism-visual" role="group" aria-label="${escapeHtml(aria)}">
    <div class="flow-grid">${nodes.join("")}</div>
  </div>`;
}

function readerDiagram(tick) {
  return mechanismVisual(tick, [
    `<div class="flow-node wide">
      <h3>Card ${tracePointer()} in</h3>
      ${cardStrip()}
      <p>Card chain presents the selected ${escapeHtml(cardFamily(tick))} to the reader.</p>
    </div>`,
    flowArrow("read"),
    mechanismAsset("reader", "card-reader feelers"),
    flowArrow("pattern"),
    valuePanel("Read values", wheelRows(tick).length ? wheelRows(tick) : [["Pattern", cardFamily(tick)]]),
  ]);
}

function stoppingLeverDiagram(tick) {
  return mechanismVisual(tick, [
    cardPanel(tick, "Directive card"),
    flowArrow("trips"),
    mechanismAsset("card-chain", "stopping lever and clutch"),
    flowArrow("disengages", "held"),
    valuePanel("Effect", [["Drive", "disengaged"], ["Chain", "held after turn"]], "effect-panel"),
  ]);
}

function cardChainDiagram(tick) {
  const held = tick.before_pointer === tick.after_pointer;
  return mechanismVisual(tick, [
    mechanismAsset("card-chain", "drive sprocket and stop"),
    flowArrow(held ? "held" : "moves", held ? "held" : ""),
    `<div class="flow-node wide">
      <h3>Card chain</h3>
      ${cardStrip()}
      <p>${held ? "The stopping lever prevents the next advance." : "The chain indexes to the next selected card."}</p>
    </div>`,
    flowArrow("pointer"),
    valuePanel("Pointer", [
      ["Current", String(tick.before_pointer)],
      ["Next", String(tick.after_pointer)],
    ], held ? "effect-panel held-panel" : "effect-panel"),
  ]);
}

function storeToMillDiagram(tick) {
  return mechanismVisual(tick, [
    valuePanel("Store column", wheelRows(tick)),
    flowArrow("turns"),
    mechanismAsset("axis", "ingress transfer axis"),
    flowArrow("couples"),
    valuePanel("Mill ingress", [["Control", "variable card"], ["Axis", "selected"]]),
  ]);
}

function millDiagram(tick) {
  return mechanismVisual(tick, [
    mechanismAsset("barrel", "operation barrel"),
    flowArrow("drives"),
    mechanismAsset("mill", "figure wheels and carry train"),
    flowArrow("sets egress"),
    valuePanel("Mill output", wheelRows(tick)),
  ]);
}

function runUpDiagram(tick) {
  const raised = tick.action === "Lever raised";
  return mechanismVisual(tick, [
    mechanismAsset("mill", "carry train"),
    flowArrow("tests"),
    valuePanel("Run-up lever", [["State", raised ? "raised" : "clear"]], raised ? "effect-panel" : ""),
    flowArrow("controls"),
    valuePanel("Card-chain control", [["Directive", raised ? "may branch" : "falls through"]]),
  ]);
}

function millToStoreDiagram(tick) {
  return mechanismVisual(tick, [
    valuePanel("Mill egress", wheelRows(tick)),
    flowArrow("turns"),
    mechanismAsset("axis", "egress transfer axis"),
    flowArrow("writes"),
    mechanismAsset("store", "store column"),
  ]);
}

function numberToStoreDiagram(tick) {
  return mechanismVisual(tick, [
    valuePanel("Number reader", wheelRows(tick)),
    flowArrow("couples"),
    mechanismAsset("reader", "number-reader axis"),
    flowArrow("writes"),
    mechanismAsset("store", "store column"),
  ]);
}

function numberReaderDiagram(tick) {
  return mechanismVisual(tick, [
    cardPanel(tick, "Number card"),
    flowArrow("sets"),
    mechanismAsset("reader", "number-reader axis"),
    flowArrow("holds"),
    valuePanel("Pending constant", wheelRows(tick)),
  ]);
}

function operationBarrelDiagram(tick) {
  return mechanismVisual(tick, [
    cardPanel(tick, "Operation card"),
    flowArrow("selects"),
    mechanismAsset("barrel", "studded operation barrel"),
    flowArrow("prepares"),
    mechanismAsset("mill", "mill control"),
  ]);
}

function directiveDiagram(tick) {
  return mechanismVisual(tick, [
    cardPanel(tick, "Directive card"),
    flowArrow("selects"),
    mechanismAsset("barrel", "directive control"),
    flowArrow("commands"),
    mechanismAsset("card-chain", "card-chain motion"),
  ]);
}

function outputDiagram(tick) {
  return mechanismVisual(tick, [
    valuePanel("Store column", wheelRows(tick)),
    flowArrow("presents"),
    mechanismAsset("store", "store wheels"),
    flowArrow("impresses"),
    valuePanel("Output apparatus", [["Printed", wheelRows(tick)[0]?.[1] ?? "-"]], "effect-panel"),
  ]);
}

function genericMechanismDiagram(tick) {
  return mechanismVisual(tick, [
    mechanismAsset("axis", tick.station),
    flowArrow("acts"),
    valuePanel(tick.action, wheelRows(tick)),
  ]);
}

function wheelList(tick) {
  return (tick.wheels ?? [])
    .map((wheel) => `${escapeHtml(wheel.label)} ${escapeHtml(wheel.sign)}${escapeHtml(wheel.digits)}`)
    .join(" / ");
}

function renderMechanism() {
  const active = activeMechanismParts();
  for (const node of els.machineNodes) {
    node.classList.toggle("active", active.has(node.dataset.part));
  }

  els.mechanismSummary.textContent = lastMechanism.summary;
  els.mechanismCount.textContent = `${lastMechanism.ticks.length} ticks`;
  els.mechanismTicks.innerHTML = lastMechanism.ticks.length
    ? lastMechanism.ticks
        .map((tick) => {
          const wheels = (tick.wheels ?? [])
            .map(
              (wheel) => `<span class="wheel">
                <span>${escapeHtml(wheel.label)}</span>
                ${escapeHtml(wheel.sign)}${escapeHtml(wheel.digits)}
              </span>`,
            )
            .join("");
          const tags = (tick.active ?? [])
            .map((part) => `<span class="tag">${escapeHtml(part)}</span>`)
            .join("");
          return `<li>
            <div class="tick-head">
              <span>${tick.tick}</span>
              <strong>${escapeHtml(tick.station)}</strong>
            </div>
              <div class="tick-body">
                <b>${escapeHtml(tick.action)}</b>
                <p>${escapeHtml(tick.detail)}</p>
                <div class="tag-row">${tags}</div>
                <div class="wheel-row">${wheels}</div>
                ${tickVisual(tick)}
              </div>
          </li>`;
        })
        .join("")
    : `<li class="empty-trace">No crank-turn phases yet.</li>`;
}

function render() {
  const cards = executableCards();
  const outOfDeck = state.pointer >= cards.length;
  els.status.textContent = state.halted
    ? "Halted"
    : outOfDeck
      ? "Deck ended"
      : "Ready";
  els.step.disabled = state.halted || outOfDeck;
  els.run.disabled = state.halted || outOfDeck;
  renderMetrics();
  renderDiff();
  renderStore();
  renderCards();
  renderMechanism();
}

function executeStep() {
  const cards = executableCards();
  if (state.halted || state.pointer < 0 || state.pointer >= cards.length) {
    render();
    return false;
  }

  previousState = structuredClone(state);
  const card = cards[state.pointer];
  try {
    const result = JSON.parse(
      wasm_step_instruction_json(card.text, JSON.stringify(state)),
    );
    state = result.state;
    lastInstruction = `${result.instruction}  ->  ${result.advance}`;
    lastMechanism = result.mechanism;
    render();
    return true;
  } catch (error) {
    els.status.textContent = "Error";
    els.instruction.innerHTML = `<span class="error">${escapeHtml(error)}</span>`;
    els.step.disabled = true;
    els.run.disabled = true;
    return false;
  }
}

function runUntilStop() {
  let guard = 0;
  while (guard < 500 && executeStep()) {
    guard += 1;
  }
  if (guard === 500) {
    els.status.textContent = "Limit";
  }
}

async function main() {
  await init();
  els.deck.value = examples.sum;
  resetState();

  els.step.addEventListener("click", executeStep);
  els.run.addEventListener("click", runUntilStop);
  els.reset.addEventListener("click", resetState);
  els.loadSum.addEventListener("click", () => {
    els.deck.value = examples.sum;
    resetState();
  });
  els.loadDivision.addEventListener("click", () => {
    els.deck.value = examples.division;
    resetState();
  });
  els.deck.addEventListener("input", resetState);
}

main().catch((error) => {
  els.status.textContent = "Load error";
  els.instruction.innerHTML = `<span class="error">${escapeHtml(error)}</span>`;
});
