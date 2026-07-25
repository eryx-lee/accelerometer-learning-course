# Capstone: build the analysis-ready teaching dataset

Use the synthetic files and scripts in this toolkit. Record your answers before
opening the answer key.

## Tasks

1. State the unit of observation and candidate key for each input file.
2. Confirm whether every daily row has exactly one matching nightly row.
3. Explain why the quality file requires a many-to-one merge with daily data.
4. Derive cumulative MVPA measures for at least 1, 5, and 10 minutes.
5. Apply the course valid-day rule: at least 600 minutes of awake wear.
6. Count valid days and valid weekend days for each participant.
7. Apply the course participant rule: at least four valid days, at least one
   valid weekend day, and a final QC status of `keep`.
8. Produce an exclusion table that preserves overlapping reasons.
9. Collapse retained valid days to one row per participant.
10. Compare your result with `expected/expected_final_participant_dataset.csv`.

## Reflection

- Which rules are general data-management principles?
- Which rules are specific to this course example?
- Which fields would need to be mapped before using real GGIR output?
- What should happen when the visual review conflicts with a numerical flag?
- What evidence would allow another analyst to reproduce your final file?

Completion criterion: your final dataset has one row per retained participant,
all merge assertions pass, and every exclusion can be reconstructed from the
source files and log.
