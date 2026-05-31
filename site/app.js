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
let visualId = 0;

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

function cardRects(baseY = 38, startX = 106) {
  return cardWindow()
    .map((card, offset) => {
      const x = startX + offset * 58;
      const holeTop = baseY + 12;
      const holes = [0, 1, 2, 3, 4, 5]
        .map((hole) => {
          const hx = x + 16 + (hole % 3) * 15;
          const hy = holeTop + Math.floor(hole / 3) * 16;
          const filled = card.active && hole % 2 === 0;
          return `<circle cx="${hx}" cy="${hy}" r="3" class="${filled ? "filled-hole" : "hole"}" />`;
        })
        .join("");
      return `<g>
        <rect x="${x}" y="${baseY}" width="50" height="48" rx="3" class="card-plate ${card.active ? "active" : ""}" />
        ${holes}
        <text x="${x + 25}" y="${baseY + 66}" text-anchor="middle">${card.index}</text>
      </g>`;
    })
    .join("");
}

function mechanismAsset(asset, x, y, width, height, label) {
  const caption = label
    ? `<text x="${x + width / 2}" y="${y + height + 14}" text-anchor="middle" class="svg-caption">${escapeHtml(label)}</text>`
    : "";
  return `<g class="asset-node">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" class="asset-frame" />
    <image href="./assets/mechanism-${asset}.webp" x="${x + 4}" y="${y + 4}" width="${width - 8}" height="${height - 8}" preserveAspectRatio="xMidYMid meet" class="mechanism-asset-svg" />
    ${caption}
  </g>`;
}

function svgShell(title, body, tick, side = "") {
  visualId += 1;
  const arrowId = `trace-arrow-${visualId}`;
  const scopedBody = body.replaceAll("url(#arrow)", `url(#${arrowId})`);
  const aria = `${title}: ${tick.action}. ${tick.detail}`;
  return `<div class="mechanism-visual">
    <svg viewBox="0 0 760 168" role="img" aria-label="${escapeHtml(aria)}">
      <title>${escapeHtml(title)}</title>
      <desc>${escapeHtml(`${tick.action}. ${tick.detail}`)}</desc>
      <defs>
        <marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="svg-fill" />
        </marker>
      </defs>
      ${scopedBody}
    </svg>
    ${side}
  </div>`;
}

function readerDiagram(tick) {
  const body = `
    <text x="24" y="64" class="svg-label">Card ${tracePointer()} in</text>
    <line x1="84" y1="64" x2="102" y2="64" class="shaft" marker-end="url(#arrow)" />
    ${cardRects()}
    <line x1="408" y1="64" x2="446" y2="64" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("reader", 456, 22, 104, 104, "card-reader feelers")}
    <line x1="568" y1="64" x2="602" y2="64" class="shaft" marker-end="url(#arrow)" />
    <rect x="610" y="38" width="120" height="62" rx="4" class="bit-box" />
    <text x="670" y="26" text-anchor="middle" class="svg-label">${escapeHtml(tick.active?.[1] ?? "card pattern")}</text>
    <circle cx="644" cy="66" r="6" class="lit" />
    <circle cx="674" cy="66" r="4" class="unlit" />
    <circle cx="704" cy="66" r="6" class="lit" />
    <text x="670" y="140" text-anchor="middle" class="svg-caption">Card-reader feeler array</text>`;
  return svgShell("Card reader", body, tick);
}

function stoppingLeverDiagram(tick) {
  const body = `
    <text x="98" y="24" text-anchor="middle" class="svg-label">Directive trips stop</text>
    ${mechanismAsset("card-chain", 28, 34, 154, 96, "stopping lever")}
    <line x1="194" y1="82" x2="280" y2="82" class="shaft" marker-end="url(#arrow)" />
    <text x="328" y="34" class="svg-label">Latch lifts drive pawl</text>
    <rect x="330" y="86" width="48" height="38" class="base" />
    <line x1="356" y1="86" x2="412" y2="54" class="lever" />
    <path d="M 408 52 l 28 0 l -12 20 z" class="svg-fill" />
    <line x1="452" y1="86" x2="510" y2="86" class="shaft" marker-end="url(#arrow)" />
    <text x="584" y="34" class="svg-label">Clutch disengages</text>
    <rect x="550" y="76" width="132" height="28" rx="4" class="clutch" />
    <line x1="572" y1="68" x2="572" y2="112" class="pin" />
    <line x1="604" y1="68" x2="604" y2="112" class="pin" />
    <line x1="636" y1="68" x2="636" y2="112" class="pin" />`;
  return svgShell("Stopping lever", body, tick);
}

function cardChainDiagram(tick) {
  const held = tick.before_pointer === tick.after_pointer;
  const body = `
    ${mechanismAsset("card-chain", 30, 30, 132, 98, "drive / stop")}
    <line x1="168" y1="84" x2="190" y2="84" class="chain" />
    ${cardRects(66, 198)}
    <path d="M 334 126 L 350 82 L 366 126 Z" class="pointer" />
    <text x="350" y="150" text-anchor="middle" class="svg-caption">Index pointer</text>
    <line x1="492" y1="90" x2="616" y2="90" class="chain ${held ? "held" : ""}" />
    <rect x="622" y="60" width="46" height="60" rx="8" class="base" />
    <line x1="668" y1="90" x2="724" y2="90" class="shaft ${held ? "held" : ""}" />
    <text x="666" y="42" text-anchor="middle" class="svg-label">${held ? "Chain held" : "Chain advances"}</text>`;
  return svgShell("Card chain", body, tick);
}

function storeToMillDiagram(tick) {
  const wheels = wheelList(tick);
  const body = `
    <rect x="42" y="40" width="118" height="74" rx="6" class="store-block" />
    <text x="101" y="68" text-anchor="middle" class="svg-label">Store column</text>
    <text x="101" y="94" text-anchor="middle" class="svg-value">${wheels || "Vn"}</text>
    <line x1="166" y1="78" x2="252" y2="78" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("axis", 264, 24, 118, 104, "transfer axis")}
    <line x1="394" y1="78" x2="460" y2="78" class="shaft" marker-end="url(#arrow)" />
    <rect x="482" y="42" width="96" height="72" rx="8" class="mill-block" />
    <text x="530" y="68" text-anchor="middle" class="svg-label">Mill</text>
    <circle cx="512" cy="92" r="9" class="gear" />
    <circle cx="548" cy="92" r="9" class="gear" />
    <rect x="624" y="44" width="92" height="68" rx="5" class="barrel" />
    <text x="670" y="82" text-anchor="middle" class="svg-label">Variable barrel</text>`;
  return svgShell("Store to mill", body, tick);
}

function millDiagram(tick) {
  const wheels = wheelList(tick);
  const body = `
    ${mechanismAsset("barrel", 34, 24, 124, 104, "operation barrel")}
    <line x1="158" y1="80" x2="228" y2="80" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("mill", 244, 18, 120, 116, "mill wheels")}
    <rect x="378" y="34" width="102" height="92" rx="8" class="mill-block" />
    <text x="429" y="58" text-anchor="middle" class="svg-label">Carry train</text>
    ${[0, 1, 2].map((i) => `<circle cx="${404 + i * 28}" cy="86" r="12" class="gear" />`).join("")}
    <path d="M 402 116 h66" class="carry" />
    <line x1="490" y1="80" x2="562" y2="80" class="shaft" marker-end="url(#arrow)" />
    <rect x="584" y="44" width="126" height="72" rx="6" class="bit-box" />
    <text x="647" y="68" text-anchor="middle" class="svg-label">Egress wheels</text>
    <text x="647" y="94" text-anchor="middle" class="svg-value">${wheels || "E / EP"}</text>`;
  return svgShell("Mill wheels", body, tick);
}

function runUpDiagram(tick) {
  const raised = tick.action === "Lever raised";
  const body = `
    ${mechanismAsset("mill", 38, 24, 126, 104, "carry train")}
    <rect x="184" y="112" width="118" height="10" class="base" />
    <circle cx="204" cy="92" r="13" class="gear" />
    <line x1="204" y1="92" x2="274" y2="${raised ? 48 : 92}" class="lever ${raised ? "raised" : ""}" />
    <circle cx="274" cy="${raised ? 48 : 92}" r="10" class="${raised ? "lit" : "unlit"}" />
    <text x="244" y="32" text-anchor="middle" class="svg-label">Run-up lever ${raised ? "raised" : "clear"}</text>
    <line x1="250" y1="80" x2="370" y2="80" class="shaft" marker-end="url(#arrow)" />
    <rect x="400" y="44" width="118" height="76" rx="6" class="bit-box" />
    <text x="459" y="72" text-anchor="middle" class="svg-label">Directive feeler</text>
    <circle cx="459" cy="94" r="8" class="${raised ? "lit" : "unlit"}" />
    <line x1="530" y1="80" x2="650" y2="80" class="shaft" marker-end="url(#arrow)" />
    <text x="626" y="84" text-anchor="middle" class="svg-label">chain control</text>`;
  return svgShell("Run-up lever", body, tick);
}

function millToStoreDiagram(tick) {
  const wheels = wheelList(tick);
  const body = `
    <rect x="48" y="42" width="116" height="74" rx="8" class="mill-block" />
    <text x="106" y="70" text-anchor="middle" class="svg-label">Mill egress</text>
    <text x="106" y="96" text-anchor="middle" class="svg-value">${wheels || "E"}</text>
    <line x1="172" y1="80" x2="300" y2="80" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("axis", 314, 24, 112, 104, "egress axis")}
    <line x1="440" y1="80" x2="550" y2="80" class="shaft" marker-end="url(#arrow)" />
    <rect x="574" y="42" width="122" height="74" rx="6" class="store-block" />
    <text x="635" y="84" text-anchor="middle" class="svg-label">Store column</text>`;
  return svgShell("Mill to store", body, tick);
}

function numberToStoreDiagram(tick) {
  const wheels = wheelList(tick);
  const body = `
    <rect x="52" y="42" width="128" height="74" rx="6" class="bit-box" />
    <text x="116" y="70" text-anchor="middle" class="svg-label">Number reader</text>
    <text x="116" y="96" text-anchor="middle" class="svg-value">${wheels || "constant"}</text>
    <line x1="188" y1="80" x2="312" y2="80" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("store", 324, 20, 120, 112, "store column")}
    <line x1="460" y1="80" x2="650" y2="80" class="shaft" marker-end="url(#arrow)" />
    <text x="668" y="84" class="svg-label">column latched</text>`;
  return svgShell("Number to store", body, tick);
}

function numberReaderDiagram(tick) {
  const wheels = wheelList(tick);
  const body = `
    <rect x="54" y="42" width="116" height="74" rx="5" class="card-plate active" />
    <text x="112" y="70" text-anchor="middle" class="svg-label">Number card</text>
    <circle cx="88" cy="92" r="5" class="lit" />
    <circle cx="112" cy="92" r="5" class="lit" />
    <circle cx="136" cy="92" r="4" class="unlit" />
    <line x1="182" y1="80" x2="272" y2="80" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("reader", 284, 20, 112, 112, "number-reader axis")}
    <rect x="426" y="40" width="154" height="78" rx="6" class="bit-box" />
    <text x="503" y="68" text-anchor="middle" class="svg-label">Pending constant</text>
    <text x="503" y="96" text-anchor="middle" class="svg-value">${wheels || "constant held"}</text>
    <line x1="600" y1="80" x2="700" y2="80" class="shaft held" />
    <text x="650" y="118" text-anchor="middle" class="svg-caption">Held for a later variable card</text>`;
  return svgShell("Number reader", body, tick);
}

function operationBarrelDiagram(tick) {
  const body = `
    <rect x="52" y="44" width="106" height="62" rx="5" class="card-plate active" />
    <text x="105" y="80" text-anchor="middle" class="svg-label">Operation card</text>
    <line x1="170" y1="76" x2="258" y2="76" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("barrel", 282, 24, 124, 104, "studded control barrel")}
    <line x1="420" y1="76" x2="512" y2="76" class="shaft" marker-end="url(#arrow)" />
    <rect x="538" y="42" width="128" height="72" rx="8" class="mill-block" />
    <text x="602" y="82" text-anchor="middle" class="svg-label">Mill set</text>`;
  return svgShell("Operation barrel", body, tick);
}

function directiveDiagram(tick) {
  const body = `
    <rect x="46" y="42" width="128" height="74" rx="5" class="card-plate active" />
    <text x="110" y="70" text-anchor="middle" class="svg-label">Directive bits</text>
    <circle cx="88" cy="92" r="6" class="lit" />
    <circle cx="112" cy="92" r="4" class="unlit" />
    <circle cx="136" cy="92" r="6" class="lit" />
    <line x1="188" y1="80" x2="300" y2="80" class="shaft" marker-end="url(#arrow)" />
    ${mechanismAsset("barrel", 326, 22, 118, 108, "directive control")}
    <path d="M 376 98 h44 l -14 16 h-18 z" class="pointer" />
    <line x1="456" y1="80" x2="592" y2="80" class="shaft" marker-end="url(#arrow)" />
    <rect x="620" y="48" width="88" height="64" rx="6" class="store-block" />
    <text x="664" y="84" text-anchor="middle" class="svg-label">Chain shift</text>`;
  return svgShell("Directive", body, tick);
}

function outputDiagram(tick) {
  const wheels = wheelList(tick);
  const body = `
    ${mechanismAsset("store", 42, 20, 118, 112, "")}
    <text x="101" y="146" text-anchor="middle" class="svg-value">${wheels || "Vn"}</text>
    <line x1="178" y1="80" x2="340" y2="80" class="shaft" marker-end="url(#arrow)" />
    <rect x="370" y="34" width="112" height="92" rx="6" class="bit-box" />
    <text x="426" y="72" text-anchor="middle" class="svg-label">Output</text>
    <path d="M 396 92 h60 M 396 106 h42" class="studs" />
    <line x1="496" y1="80" x2="626" y2="80" class="shaft" marker-end="url(#arrow)" />
    <text x="642" y="84" class="svg-label">printed value</text>`;
  return svgShell("Output", body, tick);
}

function genericMechanismDiagram(tick) {
  const body = `
    <rect x="62" y="54" width="142" height="52" rx="6" class="bit-box" />
    <text x="133" y="84" text-anchor="middle" class="svg-label">${escapeHtml(tick.station)}</text>
    <line x1="220" y1="80" x2="540" y2="80" class="shaft" marker-end="url(#arrow)" />
    <rect x="570" y="54" width="126" height="52" rx="6" class="mill-block" />
    <text x="633" y="84" text-anchor="middle" class="svg-label">${escapeHtml(tick.action)}</text>`;
  return svgShell(tick.station, body, tick);
}

function wheelList(tick) {
  return (tick.wheels ?? [])
    .map((wheel) => `${escapeHtml(wheel.label)} ${escapeHtml(wheel.sign)}${escapeHtml(wheel.digits)}`)
    .join(" / ");
}

function renderMechanism() {
  visualId = 0;
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
