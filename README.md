# Analytical Engine Emulator

A Rust emulator for the programming model of Charles Babbage's Analytical
Engine.  The goal is historical faithfulness at the architectural level:

- decimal arithmetic, not binary arithmetic
- a separate Store and Mill
- 1000 store columns, each limited to 50 decimal figures by default
- number cards, operation cards, variable cards, and directive cards
- reversible card-chain motion through relative jumps
- a run-up lever flag that can guide conditional card motion
- primed ingress and egress axes for double-width division and multiplication

This emulator is card-semantic with an explanatory mechanism trace: it models
the state changes visible to an analyst using Babbage-style cards, then expands
each card into reader, barrel, axis, figure-wheel, run-up, and card-chain phases.
It still does not simulate every tooth, stud, or crank timing from Babbage's
drawings.  The text deck format is an interleaved notation for cards that
Babbage's mechanism would have presented through separate card apparatus.

## Run

```sh
cargo run -- examples/division.ae
```

Expected output:

```text
P0: 357
P1: 4
```

## Step API

The library exposes a pure step API for visualizers and other front ends:

```rust
use analytical_engine::{initial_program_state, step_instruction};

let state = initial_program_state();
let result = step_instruction("N 12", &state)?;
let next_state = result.state;
```

`step_instruction` takes one card instruction plus a serializable
`ProgramState` and returns a `StepResult` containing the next state, normalized
instruction text, pointer advance, and a `MechanismTrace`.  The trace breaks the
card into crank-turn phases such as card reading, barrel selection, axis
coupling, figure-wheel motion, run-up lever testing, and card-chain movement.
JSON helpers are available for browser bindings:

```rust
let state_json = analytical_engine::initial_program_state_json();
let result_json = analytical_engine::step_instruction_json("N 12", &state_json)?;
```

## Static Visualizer

The `site/` directory contains a static browser visualizer that executes cards
one at a time through the WASM build and shows the state difference after each
instruction.  It also shows the mechanism trace for the last executed card,
including active subsystems and compact decimal wheel snapshots.

The public GitHub Pages deployment is:

<https://lukeolney.me/analytical-engine/>

Build the WASM package:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.122 --locked
cargo build --release --target wasm32-unknown-unknown
rm -rf site/pkg
wasm-bindgen --target web --out-dir site/pkg \
  target/wasm32-unknown-unknown/release/analytical_engine.wasm
```

Serve the static site:

```sh
cd site
python3 -m http.server 4173 --bind 127.0.0.1
```

## Card Deck Syntax

Blank lines and `#` comments are ignored.

```text
N 10000              # number card: presents a decimal constant
V NUMBER -> V1       # variable card: receive pending number into the Store
O /                  # operation card: engage divide in the Mill
V V1 -> I1           # variable card: Store column to first ingress axis
V V0 -> IP           # optional primed first ingress for double-width dividends
V V2 -> I2           # variable card: Store column to second ingress axis
V EP -> V3           # variable card: primed egress to Store
V E -> V4            # variable card: main egress to Store
PRINT V3             # output apparatus
HALT                 # stop the card chain
```

Transfers from Store to Mill may erase the Store column:

```text
V V7 -> I1 ERASE
```

The directive cards move the card chain relative to the current card:

```text
JUMP -5
JUMP_IF_RUNUP 3
JUMP_UNLESS_RUNUP -9
```

In this emulator, the run-up lever is set by arithmetic events the analyst can
use for conditional control: sign change or carry/borrow on addition and
subtraction, division by zero, division quotient overflow, and negative division
quotient.  Multiplication can place a high half on primed egress without setting
run-up; that is ordinary double-width product output, not an exception.

## Design Sources

The implementation follows the public historical descriptions of the Analytical
Engine's programming apparatus:

- L. F. Menabrea and Ada Lovelace, *Sketch of the Analytical Engine Invented by
  Charles Babbage*
- Henry Prevost Babbage, *The Analytical Engine*
- Fourmilab's Analytical Engine card notes
- Science Museum Group collection notes on Babbage punched cards

The current emulator deliberately exposes a conservative subset where the
surviving descriptions are coherent enough to test: arithmetic operations,
number ingress, Store/Mill transfers, quotient/remainder egress, output, and
conditional/reversible card motion.
