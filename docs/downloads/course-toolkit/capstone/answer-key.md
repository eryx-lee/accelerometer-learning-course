# Capstone answer key

## Units and keys

- `synthetic_daily.csv`: participant-day; key is
  `participant_id + activity_date`.
- `synthetic_nightly.csv`: participant-night aligned to the teaching activity
  date; key is `participant_id + activity_date`.
- `synthetic_quality.csv`: participant/recording; key is `participant_id`.

The quality file therefore joins many-to-one onto the day-level file.

## Inclusion decisions

- `P001`: include; five valid days and two valid weekend days.
- `P002`: include; four valid days and two valid weekend days.
- `P003`: exclude; only three days meet the 600-minute wear rule.
- `P004`: exclude; no valid weekend day is present.
- `P005`: exclude; the final course QC decision is `exclude`.
- `P006`: include; four valid days and two valid weekend days.

The numerical fields in the quality file are evidence, but `qc_status` records
the documented teaching decision. A real study must apply its approved review
procedure rather than copying this decision.

## Expected retained dataset

The final participant-level file contains `P001`, `P002`, and `P006`.
Compare calculated values with
`expected/expected_final_participant_dataset.csv`. Small display differences
caused only by decimal formatting are acceptable.
