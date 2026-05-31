//! A decimal punched-card emulator for Babbage's Analytical Engine.
//!
//! This is intentionally not a von Neumann machine in Victorian clothing.  It
//! models the Engine as Babbage described it: a decimal Store, a separate Mill,
//! and streams of number, operation, variable, and directive cards.

use num_bigint::BigInt;
use num_traits::{Signed, ToPrimitive, Zero};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use thiserror::Error;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const STORE_COLUMNS: usize = 1000;
pub const DEFAULT_FIGURES: usize = 50;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EngineError {
    #[error("store column V{0} is outside V0..V999")]
    BadColumn(usize),
    #[error("{value} needs more than {figures} decimal figures")]
    NumberTooWide { value: BigInt, figures: usize },
    #[error("mill axis {0} is empty")]
    EmptyAxis(&'static str),
    #[error("no operation card is currently engaged")]
    MissingOperation,
    #[error("division by zero")]
    DivisionByZero,
    #[error("card pointer moved outside the deck at {0}")]
    PointerOutOfDeck(isize),
    #[error("execution limit of {0} cards reached")]
    StepLimit(usize),
    #[error("parse error on line {line}: {message}")]
    Parse { line: usize, message: String },
    #[error("expected exactly one instruction, got {0}")]
    InstructionCount(usize),
    #[error("invalid decimal value `{0}`")]
    BadDecimal(String),
    #[error("invalid operation `{0}` in state")]
    BadStateOperation(String),
    #[error("state points before the start of the deck at {0}")]
    BadStatePointer(isize),
    #[error("invalid JSON state: {0}")]
    BadJson(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Column(usize);

impl Column {
    pub fn new(index: usize) -> Result<Self, EngineError> {
        if index < STORE_COLUMNS {
            Ok(Self(index))
        } else {
            Err(EngineError::BadColumn(index))
        }
    }

    pub fn index(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    Add,
    Subtract,
    Multiply,
    Divide,
}

impl Operation {
    fn symbol(self) -> &'static str {
        match self {
            Self::Add => "+",
            Self::Subtract => "-",
            Self::Multiply => "*",
            Self::Divide => "/",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngressAxis {
    First,
    PrimedFirst,
    Second,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EgressAxis {
    Main,
    Primed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VariableTransfer {
    StoreToMill {
        column: Column,
        axis: IngressAxis,
        erase: bool,
    },
    MillToStore {
        axis: EgressAxis,
        column: Column,
    },
    NumberToStore {
        column: Column,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Directive {
    Jump(isize),
    JumpIfRunUp(isize),
    JumpUnlessRunUp(isize),
    Halt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Card {
    Number(BigInt),
    Operation(Operation),
    Variable(VariableTransfer),
    Directive(Directive),
    Print(Column),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoreCellState {
    pub column: usize,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MillState {
    pub operation: Option<String>,
    pub ingress_1: Option<String>,
    pub primed_ingress_1: Option<String>,
    pub ingress_2: Option<String>,
    pub egress: Option<String>,
    pub primed_egress: Option<String>,
    pub run_up: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MachineState {
    pub figures: usize,
    pub store: Vec<StoreCellState>,
    pub mill: MillState,
    pub pending_number: Option<String>,
    pub output: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProgramState {
    pub machine: MachineState,
    pub pointer: isize,
    pub halted: bool,
    pub steps: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepResult {
    pub state: ProgramState,
    pub instruction: String,
    pub advance: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Store {
    columns: Vec<BigInt>,
    figures: usize,
}

impl Store {
    pub fn new(figures: usize) -> Self {
        Self {
            columns: vec![BigInt::zero(); STORE_COLUMNS],
            figures,
        }
    }

    pub fn read(&self, column: Column) -> &BigInt {
        &self.columns[column.index()]
    }

    pub fn write(&mut self, column: Column, value: BigInt) -> Result<(), EngineError> {
        check_width(&value, self.figures)?;
        self.columns[column.index()] = value;
        Ok(())
    }

    pub fn take(&mut self, column: Column) -> BigInt {
        std::mem::take(&mut self.columns[column.index()])
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mill {
    operation: Option<Operation>,
    ingress_1: Option<BigInt>,
    primed_ingress_1: Option<BigInt>,
    ingress_2: Option<BigInt>,
    egress: Option<BigInt>,
    primed_egress: Option<BigInt>,
    run_up: bool,
    figures: usize,
}

impl Mill {
    pub fn new(figures: usize) -> Self {
        Self {
            operation: None,
            ingress_1: None,
            primed_ingress_1: None,
            ingress_2: None,
            egress: None,
            primed_egress: None,
            run_up: false,
            figures,
        }
    }

    pub fn operation(&self) -> Option<Operation> {
        self.operation
    }

    pub fn run_up(&self) -> bool {
        self.run_up
    }

    pub fn state(&self) -> MillState {
        MillState {
            operation: self
                .operation
                .map(|operation| operation.symbol().to_string()),
            ingress_1: self.ingress_1.as_ref().map(ToString::to_string),
            primed_ingress_1: self.primed_ingress_1.as_ref().map(ToString::to_string),
            ingress_2: self.ingress_2.as_ref().map(ToString::to_string),
            egress: self.egress.as_ref().map(ToString::to_string),
            primed_egress: self.primed_egress.as_ref().map(ToString::to_string),
            run_up: self.run_up,
        }
    }

    pub fn from_state(state: &MillState, figures: usize) -> Result<Self, EngineError> {
        let operation = state
            .operation
            .as_deref()
            .map(operation_from_label)
            .transpose()?;

        let mill = Self {
            operation,
            ingress_1: parse_optional_decimal(&state.ingress_1)?,
            primed_ingress_1: parse_optional_decimal(&state.primed_ingress_1)?,
            ingress_2: parse_optional_decimal(&state.ingress_2)?,
            egress: parse_optional_decimal(&state.egress)?,
            primed_egress: parse_optional_decimal(&state.primed_egress)?,
            run_up: state.run_up,
            figures,
        };

        for value in [
            &mill.ingress_1,
            &mill.primed_ingress_1,
            &mill.ingress_2,
            &mill.egress,
            &mill.primed_egress,
        ]
        .into_iter()
        .flatten()
        {
            check_width(value, figures)?;
        }

        Ok(mill)
    }

    fn set_operation(&mut self, operation: Operation) {
        self.operation = Some(operation);
        self.ingress_1 = None;
        self.primed_ingress_1 = None;
        self.ingress_2 = None;
        self.egress = None;
        self.primed_egress = None;
        self.run_up = false;
    }

    fn receive(&mut self, axis: IngressAxis, value: BigInt) -> Result<(), EngineError> {
        check_width(&value, self.figures)?;
        self.egress = None;
        self.primed_egress = None;
        match axis {
            IngressAxis::First => {
                self.ingress_1 = Some(value);
                self.primed_ingress_1 = Some(BigInt::zero());
            }
            IngressAxis::PrimedFirst => self.primed_ingress_1 = Some(value),
            IngressAxis::Second => {
                self.ingress_2 = Some(value);
                self.ensure_computed()?;
            }
        }
        Ok(())
    }

    fn read_egress(&mut self, axis: EgressAxis) -> Result<BigInt, EngineError> {
        self.ensure_computed()?;
        let value = match axis {
            EgressAxis::Main => self
                .egress
                .as_ref()
                .ok_or(EngineError::EmptyAxis("egress"))?,
            EgressAxis::Primed => self
                .primed_egress
                .as_ref()
                .ok_or(EngineError::EmptyAxis("primed egress"))?,
        };
        Ok(value.clone())
    }

    fn ensure_computed(&mut self) -> Result<(), EngineError> {
        if self.egress.is_some() || self.primed_egress.is_some() {
            return Ok(());
        }

        let operation = self.operation.ok_or(EngineError::MissingOperation)?;
        let lhs = self
            .ingress_1
            .as_ref()
            .ok_or(EngineError::EmptyAxis("ingress 1"))?
            .clone();
        let rhs = self
            .ingress_2
            .as_ref()
            .ok_or(EngineError::EmptyAxis("ingress 2"))?
            .clone();

        match operation {
            Operation::Add => {
                let result = &lhs + &rhs;
                self.finish_single(result, true, &lhs);
            }
            Operation::Subtract => {
                let result = &lhs - &rhs;
                self.finish_single(result, true, &lhs);
            }
            Operation::Multiply => {
                let result = &lhs * &rhs;
                let (high, low, _overflow) = split_decimal_pair(&result, self.figures);
                self.egress = Some(low);
                self.primed_egress = Some(high);
                self.run_up = false;
            }
            Operation::Divide => {
                if rhs.is_zero() {
                    self.run_up = true;
                    self.egress = None;
                    self.primed_egress = None;
                    self.clear_ingress();
                    return Ok(());
                }
                let primed_lhs = self.primed_ingress_1.clone().unwrap_or_else(BigInt::zero);
                let dividend = compose_decimal_pair(&primed_lhs, &lhs, self.figures);
                let quotient = &dividend / &rhs;
                let remainder = &dividend % &rhs;
                if !fits_width(&quotient, self.figures) {
                    self.run_up = true;
                    self.egress = None;
                    self.primed_egress = None;
                    self.clear_ingress();
                    return Ok(());
                }
                check_width(&remainder, self.figures)?;
                self.run_up = quotient.is_negative();
                self.primed_egress = Some(quotient);
                self.egress = Some(remainder);
            }
        }

        self.clear_ingress();
        Ok(())
    }

    fn finish_single(&mut self, result: BigInt, sign_test: bool, lhs: &BigInt) {
        let (_high, low, overflow) = split_decimal_pair(&result, self.figures);
        self.run_up = overflow || (sign_test && signs_differ(lhs, &result));
        self.egress = Some(low);
        self.primed_egress = None;
    }

    fn clear_ingress(&mut self) {
        self.ingress_1 = None;
        self.primed_ingress_1 = None;
        self.ingress_2 = None;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Engine {
    store: Store,
    mill: Mill,
    pending_number: Option<BigInt>,
    output: Vec<BigInt>,
}

impl Engine {
    pub fn new() -> Self {
        Self::with_figures(DEFAULT_FIGURES)
    }

    pub fn with_figures(figures: usize) -> Self {
        Self {
            store: Store::new(figures),
            mill: Mill::new(figures),
            pending_number: None,
            output: Vec::new(),
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn mill(&self) -> &Mill {
        &self.mill
    }

    pub fn output(&self) -> &[BigInt] {
        &self.output
    }

    pub fn set_column(&mut self, column: Column, value: BigInt) -> Result<(), EngineError> {
        self.store.write(column, value)
    }

    pub fn state(&self) -> MachineState {
        let store = self
            .store
            .columns
            .iter()
            .enumerate()
            .filter_map(|(column, value)| {
                if value.is_zero() {
                    None
                } else {
                    Some(StoreCellState {
                        column,
                        value: value.to_string(),
                    })
                }
            })
            .collect();

        MachineState {
            figures: self.store.figures,
            store,
            mill: self.mill.state(),
            pending_number: self.pending_number.as_ref().map(ToString::to_string),
            output: self.output.iter().map(ToString::to_string).collect(),
        }
    }

    pub fn from_state(state: &MachineState) -> Result<Self, EngineError> {
        let mut engine = Self::with_figures(state.figures);

        for cell in &state.store {
            let column = Column::new(cell.column)?;
            let value = parse_decimal(&cell.value)?;
            engine.store.write(column, value)?;
        }

        engine.mill = Mill::from_state(&state.mill, state.figures)?;
        engine.pending_number = parse_optional_decimal(&state.pending_number)?;
        engine.output = state
            .output
            .iter()
            .map(|value| parse_decimal(value))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(engine)
    }

    pub fn run(&mut self, deck: &[Card], limit: usize) -> Result<RunReport, EngineError> {
        let mut pointer: isize = 0;
        let mut steps = 0;

        while pointer >= 0 && (pointer as usize) < deck.len() {
            if steps == limit {
                return Err(EngineError::StepLimit(limit));
            }

            let current = pointer as usize;
            let advance = self.execute(&deck[current])?;
            steps += 1;

            match advance {
                Advance::Next => pointer += 1,
                Advance::Relative(offset) => pointer += offset,
                Advance::Halt => {
                    return Ok(RunReport {
                        steps,
                        halted: true,
                        next_card: Some(current),
                    });
                }
            }
        }

        if pointer < 0 {
            return Err(EngineError::PointerOutOfDeck(pointer));
        }

        Ok(RunReport {
            steps,
            halted: false,
            next_card: None,
        })
    }

    fn execute(&mut self, card: &Card) -> Result<Advance, EngineError> {
        match card {
            Card::Number(value) => {
                check_width(value, self.store.figures)?;
                self.pending_number = Some(value.clone());
                Ok(Advance::Next)
            }
            Card::Operation(operation) => {
                self.mill.set_operation(*operation);
                Ok(Advance::Next)
            }
            Card::Variable(transfer) => {
                self.transfer(transfer)?;
                Ok(Advance::Next)
            }
            Card::Directive(Directive::Jump(offset)) => Ok(Advance::Relative(*offset)),
            Card::Directive(Directive::JumpIfRunUp(offset)) => {
                if self.mill.run_up() {
                    Ok(Advance::Relative(*offset))
                } else {
                    Ok(Advance::Next)
                }
            }
            Card::Directive(Directive::JumpUnlessRunUp(offset)) => {
                if self.mill.run_up() {
                    Ok(Advance::Next)
                } else {
                    Ok(Advance::Relative(*offset))
                }
            }
            Card::Directive(Directive::Halt) => Ok(Advance::Halt),
            Card::Print(column) => {
                self.output.push(self.store.read(*column).clone());
                Ok(Advance::Next)
            }
        }
    }

    fn transfer(&mut self, transfer: &VariableTransfer) -> Result<(), EngineError> {
        match *transfer {
            VariableTransfer::StoreToMill {
                column,
                axis,
                erase,
            } => {
                let value = if erase {
                    self.store.take(column)
                } else {
                    self.store.read(column).clone()
                };
                self.mill.receive(axis, value)
            }
            VariableTransfer::MillToStore { axis, column } => {
                let value = self.mill.read_egress(axis)?;
                self.store.write(column, value)
            }
            VariableTransfer::NumberToStore { column } => {
                let value = self
                    .pending_number
                    .take()
                    .ok_or(EngineError::EmptyAxis("number reader"))?;
                self.store.write(column, value)
            }
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

pub fn initial_program_state() -> ProgramState {
    ProgramState {
        machine: Engine::new().state(),
        pointer: 0,
        halted: false,
        steps: 0,
    }
}

pub fn step_instruction(
    instruction: &str,
    state: &ProgramState,
) -> Result<StepResult, EngineError> {
    if state.pointer < 0 {
        return Err(EngineError::BadStatePointer(state.pointer));
    }

    if state.halted {
        return Ok(StepResult {
            state: state.clone(),
            instruction: instruction.trim().to_string(),
            advance: "halted".to_string(),
        });
    }

    let cards = parse_deck(instruction)?;
    if cards.len() != 1 {
        return Err(EngineError::InstructionCount(cards.len()));
    }

    let card = &cards[0];
    let mut engine = Engine::from_state(&state.machine)?;
    let advance = engine.execute(card)?;
    let (pointer, halted, label) = match advance {
        Advance::Next => (state.pointer + 1, false, "next".to_string()),
        Advance::Relative(offset) => (
            state.pointer + offset,
            false,
            format!("relative {offset:+}"),
        ),
        Advance::Halt => (state.pointer, true, "halt".to_string()),
    };

    if pointer < 0 {
        return Err(EngineError::PointerOutOfDeck(pointer));
    }

    Ok(StepResult {
        state: ProgramState {
            machine: engine.state(),
            pointer,
            halted,
            steps: state.steps + 1,
        },
        instruction: card.to_string(),
        advance: label,
    })
}

pub fn initial_program_state_json() -> String {
    serde_json::to_string(&initial_program_state()).expect("program state is serializable")
}

pub fn step_instruction_json(instruction: &str, state_json: &str) -> Result<String, EngineError> {
    let state = serde_json::from_str::<ProgramState>(state_json)
        .map_err(|error| EngineError::BadJson(error.to_string()))?;
    let result = step_instruction(instruction, &state)?;
    serde_json::to_string(&result).map_err(|error| EngineError::BadJson(error.to_string()))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn wasm_initial_program_state_json() -> String {
    initial_program_state_json()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn wasm_step_instruction_json(instruction: &str, state_json: &str) -> Result<String, JsValue> {
    step_instruction_json(instruction, state_json)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunReport {
    pub steps: usize,
    pub halted: bool,
    pub next_card: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Advance {
    Next,
    Relative(isize),
    Halt,
}

pub fn parse_deck(source: &str) -> Result<Vec<Card>, EngineError> {
    let mut cards = Vec::new();

    for (zero_based_line, raw_line) in source.lines().enumerate() {
        let line_number = zero_based_line + 1;
        let body = raw_line
            .split_once('#')
            .map_or(raw_line, |(before, _)| before)
            .trim();

        if body.is_empty() {
            continue;
        }

        let tokens = body.split_whitespace().collect::<Vec<_>>();
        let card = parse_card(&tokens).map_err(|message| EngineError::Parse {
            line: line_number,
            message,
        })?;
        cards.push(card);
    }

    Ok(cards)
}

fn parse_card(tokens: &[&str]) -> Result<Card, String> {
    let Some(kind) = tokens.first().map(|s| s.to_ascii_uppercase()) else {
        return Err("empty card".to_string());
    };

    match kind.as_str() {
        "N" | "NUMBER" => {
            expect_len(tokens, 2)?;
            let value = BigInt::from_str(tokens[1]).map_err(|_| "invalid number".to_string())?;
            Ok(Card::Number(value))
        }
        "O" | "OP" | "OPERATION" => {
            expect_len(tokens, 2)?;
            Ok(Card::Operation(parse_operation(tokens[1])?))
        }
        "V" | "VAR" | "VARIABLE" => parse_variable(tokens),
        "PRINT" | "P" => {
            expect_len(tokens, 2)?;
            Ok(Card::Print(parse_column(tokens[1])?))
        }
        "JUMP" | "J" => {
            expect_len(tokens, 2)?;
            Ok(Card::Directive(Directive::Jump(parse_offset(tokens[1])?)))
        }
        "JUMP_IF_RUNUP" | "JIR" => {
            expect_len(tokens, 2)?;
            Ok(Card::Directive(Directive::JumpIfRunUp(parse_offset(
                tokens[1],
            )?)))
        }
        "JUMP_UNLESS_RUNUP" | "JUR" => {
            expect_len(tokens, 2)?;
            Ok(Card::Directive(Directive::JumpUnlessRunUp(parse_offset(
                tokens[1],
            )?)))
        }
        "HALT" | "H" => {
            expect_len(tokens, 1)?;
            Ok(Card::Directive(Directive::Halt))
        }
        _ => Err(format!("unknown card kind `{}`", tokens[0])),
    }
}

fn parse_variable(tokens: &[&str]) -> Result<Card, String> {
    if (tokens.len() != 4 && tokens.len() != 5) || tokens[2] != "->" {
        return Err("variable cards use `V SOURCE -> DEST [ERASE|KEEP]`".to_string());
    }

    let source = tokens[1].to_ascii_uppercase();
    let dest = tokens[3].to_ascii_uppercase();

    if source == "NUMBER" || source == "N" {
        if tokens.len() != 4 {
            return Err("NUMBER transfers do not accept ERASE or KEEP".to_string());
        }
        return Ok(Card::Variable(VariableTransfer::NumberToStore {
            column: parse_column(&dest)?,
        }));
    }

    if let Ok(axis) = parse_ingress(&dest) {
        let erase = tokens
            .get(4)
            .map(|flag| match flag.to_ascii_uppercase().as_str() {
                "ERASE" => Ok(true),
                "KEEP" => Ok(false),
                _ => Err("transfer flag must be ERASE or KEEP".to_string()),
            })
            .transpose()?
            .unwrap_or(false);
        return Ok(Card::Variable(VariableTransfer::StoreToMill {
            column: parse_column(&source)?,
            axis,
            erase,
        }));
    }

    if tokens.len() != 4 {
        return Err("ERASE and KEEP are only valid when transferring store to mill".to_string());
    }

    Ok(Card::Variable(VariableTransfer::MillToStore {
        axis: parse_egress(&source)?,
        column: parse_column(&dest)?,
    }))
}

fn expect_len(tokens: &[&str], expected: usize) -> Result<(), String> {
    if tokens.len() == expected {
        Ok(())
    } else {
        Err(format!(
            "expected {expected} token(s), got {}",
            tokens.len()
        ))
    }
}

fn parse_operation(token: &str) -> Result<Operation, String> {
    match token.to_ascii_uppercase().as_str() {
        "+" | "ADD" => Ok(Operation::Add),
        "-" | "SUB" | "SUBTRACT" => Ok(Operation::Subtract),
        "*" | "X" | "MUL" | "MULTIPLY" => Ok(Operation::Multiply),
        "/" | "DIV" | "DIVIDE" => Ok(Operation::Divide),
        _ => Err(format!("unknown operation `{token}`")),
    }
}

fn operation_from_label(token: &str) -> Result<Operation, EngineError> {
    parse_operation(token).map_err(|_| EngineError::BadStateOperation(token.to_string()))
}

fn parse_ingress(token: &str) -> Result<IngressAxis, String> {
    match token.to_ascii_uppercase().as_str() {
        "I1" | "INGRESS1" | "INGRESS_1" => Ok(IngressAxis::First),
        "IP" | "I1P" | "PRIMED_INGRESS" | "PRIMED_INGRESS_1" => Ok(IngressAxis::PrimedFirst),
        "I2" | "INGRESS2" | "INGRESS_2" => Ok(IngressAxis::Second),
        _ => Err(format!("unknown ingress axis `{token}`")),
    }
}

fn parse_egress(token: &str) -> Result<EgressAxis, String> {
    match token.to_ascii_uppercase().as_str() {
        "E" | "EGRESS" => Ok(EgressAxis::Main),
        "EP" | "E'" | "PRIMED" | "PRIMED_EGRESS" => Ok(EgressAxis::Primed),
        _ => Err(format!("unknown egress axis `{token}`")),
    }
}

fn parse_column(token: &str) -> Result<Column, String> {
    let normalized = token
        .strip_prefix('V')
        .or_else(|| token.strip_prefix('v'))
        .unwrap_or(token);
    let index = normalized
        .parse::<usize>()
        .map_err(|_| format!("invalid store column `{token}`"))?;
    Column::new(index).map_err(|error| error.to_string())
}

fn parse_offset(token: &str) -> Result<isize, String> {
    let offset = token
        .parse::<isize>()
        .map_err(|_| format!("invalid relative offset `{token}`"))?;
    if offset == 0 {
        Err("relative offset may not be zero".to_string())
    } else {
        Ok(offset)
    }
}

fn check_width(value: &BigInt, figures: usize) -> Result<(), EngineError> {
    if fits_width(value, figures) {
        Ok(())
    } else {
        Err(EngineError::NumberTooWide {
            value: value.clone(),
            figures,
        })
    }
}

fn parse_decimal(value: &str) -> Result<BigInt, EngineError> {
    BigInt::from_str(value).map_err(|_| EngineError::BadDecimal(value.to_string()))
}

fn parse_optional_decimal(value: &Option<String>) -> Result<Option<BigInt>, EngineError> {
    value.as_deref().map(parse_decimal).transpose()
}

fn fits_width(value: &BigInt, figures: usize) -> bool {
    let limit = BigInt::from(10u8).pow(figures as u32);
    value.abs() < limit
}

fn split_decimal_pair(value: &BigInt, figures: usize) -> (BigInt, BigInt, bool) {
    let limit = BigInt::from(10u8).pow(figures as u32);
    let sign = if value.is_negative() {
        -BigInt::from(1u8)
    } else {
        BigInt::from(1u8)
    };
    let magnitude = value.abs();
    let low = (&magnitude % &limit) * &sign;
    let high = (&magnitude / &limit) * &sign;
    let overflow = magnitude >= limit;
    (high, low, overflow)
}

fn compose_decimal_pair(high: &BigInt, low: &BigInt, figures: usize) -> BigInt {
    let limit = BigInt::from(10u8).pow(figures as u32);
    high * limit + low
}

fn signs_differ(lhs: &BigInt, result: &BigInt) -> bool {
    lhs.is_negative() != result.is_negative()
}

impl fmt::Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Card::Number(value) => write!(f, "N {value}"),
            Card::Operation(operation) => write!(f, "O {}", operation.symbol()),
            Card::Variable(VariableTransfer::StoreToMill {
                column,
                axis,
                erase,
            }) => write!(
                f,
                "V V{} -> {} {}",
                column.index(),
                match axis {
                    IngressAxis::First => "I1",
                    IngressAxis::PrimedFirst => "IP",
                    IngressAxis::Second => "I2",
                },
                if *erase { "ERASE" } else { "KEEP" }
            ),
            Card::Variable(VariableTransfer::MillToStore { axis, column }) => write!(
                f,
                "V {} -> V{}",
                match axis {
                    EgressAxis::Main => "E",
                    EgressAxis::Primed => "EP",
                },
                column.index()
            ),
            Card::Variable(VariableTransfer::NumberToStore { column }) => {
                write!(f, "V NUMBER -> V{}", column.index())
            }
            Card::Directive(Directive::Jump(offset)) => write!(f, "JUMP {offset}"),
            Card::Directive(Directive::JumpIfRunUp(offset)) => {
                write!(f, "JUMP_IF_RUNUP {offset}")
            }
            Card::Directive(Directive::JumpUnlessRunUp(offset)) => {
                write!(f, "JUMP_UNLESS_RUNUP {offset}")
            }
            Card::Directive(Directive::Halt) => write!(f, "HALT"),
            Card::Print(column) => write!(f, "PRINT V{}", column.index()),
        }
    }
}

pub fn bigint(value: i64) -> BigInt {
    BigInt::from(value)
}

pub fn decimal_figures(value: &BigInt) -> usize {
    if value.is_zero() {
        1
    } else {
        value.abs().to_str_radix(10).len()
    }
}

pub fn as_i64(value: &BigInt) -> Option<i64> {
    value.to_i64()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(source: &str) -> Engine {
        let deck = parse_deck(source).unwrap();
        let mut engine = Engine::new();
        engine.run(&deck, 1_000).unwrap();
        engine
    }

    #[test]
    fn adds_numbers_through_store_and_mill() {
        let engine = run("
            N 2
            V NUMBER -> V0
            N 3
            V NUMBER -> V1
            O +
            V V0 -> I1
            V V1 -> I2
            V E -> V2
            PRINT V2
            HALT
            ");

        assert_eq!(engine.store().read(Column::new(2).unwrap()), &bigint(5));
        assert_eq!(engine.output(), &[bigint(5)]);
    }

    #[test]
    fn store_to_mill_transfer_can_erase_column() {
        let engine = run("
            N 7
            V NUMBER -> V0
            N 8
            V NUMBER -> V1
            O *
            V V0 -> I1 ERASE
            V V1 -> I2
            V E -> V2
            HALT
            ");

        assert_eq!(engine.store().read(Column::new(0).unwrap()), &bigint(0));
        assert_eq!(engine.store().read(Column::new(2).unwrap()), &bigint(56));
    }

    #[test]
    fn division_uses_primed_egress_for_quotient_and_main_for_remainder() {
        let engine = run("
            N 10000
            V NUMBER -> V1
            N 28
            V NUMBER -> V2
            O /
            V V1 -> I1
            V V2 -> I2
            V EP -> V3
            V E -> V4
            HALT
            ");

        assert_eq!(engine.store().read(Column::new(3).unwrap()), &bigint(357));
        assert_eq!(engine.store().read(Column::new(4).unwrap()), &bigint(4));
    }

    #[test]
    fn multiplication_splits_a_double_width_product() {
        let mut engine = Engine::with_figures(3);
        let deck = parse_deck(
            "
            N 999
            V NUMBER -> V0
            N 999
            V NUMBER -> V1
            O *
            V V0 -> I1
            V V1 -> I2
            V EP -> V2
            V E -> V3
            HALT
            ",
        )
        .unwrap();

        engine.run(&deck, 100).unwrap();

        assert_eq!(engine.store().read(Column::new(2).unwrap()), &bigint(998));
        assert_eq!(engine.store().read(Column::new(3).unwrap()), &bigint(1));
        assert!(!engine.mill().run_up());
    }

    #[test]
    fn multiplication_high_half_does_not_trigger_run_up_branch() {
        let mut engine = Engine::with_figures(3);
        let deck = parse_deck(
            "
            N 999
            V NUMBER -> V0
            N 999
            V NUMBER -> V1
            N 42
            V NUMBER -> V2
            O *
            V V0 -> I1
            V V1 -> I2
            JUMP_IF_RUNUP 3
            PRINT V2
            HALT
            PRINT V0
            HALT
            ",
        )
        .unwrap();

        engine.run(&deck, 100).unwrap();

        assert_eq!(engine.output(), &[bigint(42)]);
    }

    #[test]
    fn division_can_use_a_primed_ingress_axis_for_double_width_dividends() {
        let mut engine = Engine::with_figures(3);
        let deck = parse_deck(
            "
            N 1
            V NUMBER -> V0
            N 234
            V NUMBER -> V1
            N 2
            V NUMBER -> V2
            O /
            V V1 -> I1
            V V0 -> IP
            V V2 -> I2
            V EP -> V3
            V E -> V4
            HALT
            ",
        )
        .unwrap();

        engine.run(&deck, 100).unwrap();

        assert_eq!(engine.store().read(Column::new(3).unwrap()), &bigint(617));
        assert_eq!(engine.store().read(Column::new(4).unwrap()), &bigint(0));
    }

    #[test]
    fn addition_overflow_sets_run_up_and_keeps_low_digits_available() {
        let mut engine = Engine::with_figures(3);
        let deck = parse_deck(
            "
            N 999
            V NUMBER -> V0
            N 1
            V NUMBER -> V1
            O +
            V V0 -> I1
            V V1 -> I2
            V E -> V2
            HALT
            ",
        )
        .unwrap();

        engine.run(&deck, 100).unwrap();

        assert!(engine.mill().run_up());
        assert_eq!(engine.store().read(Column::new(2).unwrap()), &bigint(0));
    }

    #[test]
    fn division_quotient_overflow_sets_run_up_for_conditional_cards() {
        let mut engine = Engine::with_figures(3);
        let deck = parse_deck(
            "
            N 1
            V NUMBER -> V0
            N 0
            V NUMBER -> V1
            N 42
            V NUMBER -> V9
            O /
            V V1 -> I1
            V V0 -> IP
            V V0 -> I2
            JUMP_IF_RUNUP 3
            V EP -> V2
            HALT
            PRINT V9
            HALT
            ",
        )
        .unwrap();

        engine.run(&deck, 100).unwrap();

        assert!(engine.mill().run_up());
        assert_eq!(engine.output(), &[bigint(42)]);
    }

    #[test]
    fn run_up_directive_supports_reversing_the_card_chain() {
        let engine = run("
            N 4
            V NUMBER -> V0   # counter
            N 0
            V NUMBER -> V1   # sum
            N 1
            V NUMBER -> V2   # one
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
            HALT
            ");

        assert_eq!(engine.output(), &[bigint(10)]);
        assert_eq!(engine.store().read(Column::new(0).unwrap()), &bigint(0));
    }

    #[test]
    fn rejects_numbers_wider_than_the_configured_decimal_columns() {
        let mut engine = Engine::with_figures(3);
        let deck = parse_deck(
            "
            N 1000
            V NUMBER -> V0
            ",
        )
        .unwrap();

        assert_eq!(
            engine.run(&deck, 10),
            Err(EngineError::NumberTooWide {
                value: bigint(1000),
                figures: 3
            })
        );
    }

    #[test]
    fn rejects_malformed_variable_cards() {
        for source in [
            "V NUMBER -> V0 ERASE",
            "V NUMBER -> V0 KEEP EXTRA",
            "V E -> V1 KEEP",
            "V V1 -> I1 KEEP EXTRA",
        ] {
            assert!(
                matches!(parse_deck(source), Err(EngineError::Parse { .. })),
                "{source} should be rejected"
            );
        }
    }

    #[test]
    fn computed_operand_pairs_are_not_reused_with_stale_ingress_axes() {
        for source in [
            "
            N 2
            V NUMBER -> V0
            N 3
            V NUMBER -> V1
            N 10
            V NUMBER -> V2
            O +
            V V0 -> I1
            V V1 -> I2
            V E -> V3
            V V2 -> I1
            V E -> V4
            ",
            "
            N 2
            V NUMBER -> V0
            N 3
            V NUMBER -> V1
            N 10
            V NUMBER -> V2
            O +
            V V0 -> I1
            V V1 -> I2
            V E -> V3
            V V2 -> I2
            ",
            "
            N 2
            V NUMBER -> V0
            N 3
            V NUMBER -> V1
            N 1
            V NUMBER -> V2
            O +
            V V0 -> I1
            V V1 -> I2
            V E -> V3
            V V2 -> IP
            V E -> V4
            ",
        ] {
            let deck = parse_deck(source).unwrap();
            let mut engine = Engine::new();

            assert!(engine.run(&deck, 100).is_err(), "{source} should fail");
        }
    }

    #[test]
    fn public_step_api_returns_next_program_state() {
        let mut state = initial_program_state();

        for instruction in [
            "N 2",
            "V NUMBER -> V0",
            "N 3",
            "V NUMBER -> V1",
            "O +",
            "V V0 -> I1",
            "V V1 -> I2",
            "V E -> V2",
            "PRINT V2",
        ] {
            state = step_instruction(instruction, &state).unwrap().state;
        }

        let result = step_instruction("HALT", &state).unwrap();

        assert!(result.state.halted);
        assert_eq!(result.state.machine.output, vec!["5"]);
        assert_eq!(
            result
                .state
                .machine
                .store
                .iter()
                .find(|cell| cell.column == 2)
                .map(|cell| cell.value.as_str()),
            Some("5")
        );
    }

    #[test]
    fn public_step_json_round_trips_state() {
        let state_json = initial_program_state_json();
        let result_json = step_instruction_json("N 12", &state_json).unwrap();
        let result = serde_json::from_str::<StepResult>(&result_json).unwrap();

        assert_eq!(result.state.machine.pending_number.as_deref(), Some("12"));
        assert_eq!(result.state.pointer, 1);
        assert_eq!(result.state.steps, 1);
    }
}
