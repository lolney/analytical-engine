use analytical_engine::{Column, Engine, parse_deck};
use std::env;
use std::fs;
use std::process::ExitCode;

const DEFAULT_LIMIT: usize = 100_000;

fn main() -> ExitCode {
    match run_cli() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run_cli() -> Result<(), String> {
    let args = env::args().collect::<Vec<_>>();
    if args.len() < 2 || args.len() > 3 {
        return Err(format!(
            "usage: {} DECK.ae [STEP_LIMIT]",
            args.first()
                .map(String::as_str)
                .unwrap_or("analytical-engine")
        ));
    }

    let limit = if let Some(raw_limit) = args.get(2) {
        raw_limit
            .parse::<usize>()
            .map_err(|_| format!("invalid step limit `{raw_limit}`"))?
    } else {
        DEFAULT_LIMIT
    };

    let source = fs::read_to_string(&args[1])
        .map_err(|error| format!("could not read `{}`: {error}", args[1]))?;
    let deck = parse_deck(&source).map_err(|error| error.to_string())?;

    let mut engine = Engine::new();
    let report = engine
        .run(&deck, limit)
        .map_err(|error| error.to_string())?;

    for (index, value) in engine.output().iter().enumerate() {
        println!("P{index}: {value}");
    }

    eprintln!(
        "ran {} card(s); {}",
        report.steps,
        if report.halted {
            "halted"
        } else {
            "fell off the end of the deck"
        }
    );

    let non_zero = (0..analytical_engine::STORE_COLUMNS)
        .filter_map(|index| {
            let column = Column::new(index).ok()?;
            let value = engine.store().read(column);
            if value == &analytical_engine::bigint(0) {
                None
            } else {
                Some((index, value.clone()))
            }
        })
        .collect::<Vec<_>>();

    if !non_zero.is_empty() {
        eprintln!("non-zero store columns:");
        for (index, value) in non_zero {
            eprintln!("  V{index}: {value}");
        }
    }

    Ok(())
}
