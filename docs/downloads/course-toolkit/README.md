# Accelerometer Course Toolkit

This toolkit turns the course workflow into a small, auditable practice project.
All participant IDs and values in `example-data/` are synthetic. They must not
be interpreted as real people, clinical values, or recommended study cutoffs.

## Suggested order

1. Read `pre-deployment-checklist.md`.
2. Review the blank templates in `templates/`.
3. Open the three synthetic CSV files in `example-data/`.
4. Run `scripts/validate_inputs.R` from the `scripts/` folder.
5. Run `scripts/build_final_dataset.do` from the `scripts/` folder if Stata is
   available.
6. Complete `capstone/capstone.md`.
7. Compare your decisions with `capstone/answer-key.md` and the file in
   `expected/`.

## What this example teaches

- preserve the raw or source-level evidence;
- identify the unit of observation before merging;
- validate keys before and after a merge;
- derive study-specific valid-day and weekend-coverage indicators explicitly;
- keep numerical QC evidence separate from the final decision;
- produce an exclusion log and a participant-level analysis file;
- retain scripts, versions, and a data dictionary.

## Important limitations

The CSV column names are a deliberately small educational extract, not a
drop-in copy of every GGIR output. Real GGIR columns and folders depend on the
installed version and run configuration. Compare a real run with `config.csv`,
the generated variable dictionary, and the current GGIR documentation before
adapting these scripts.

The course example uses at least four valid days, at least 600 minutes of awake
wear per valid day, and at least one weekend day. These are teaching rules, not
universal standards.
