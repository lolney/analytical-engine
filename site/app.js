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
};

let state;
let previousState;
let lastInstruction = "No card executed";

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
