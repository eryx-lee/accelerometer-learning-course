#!/usr/bin/env Rscript

# Run this script from the course-toolkit/scripts folder.
toolkit_dir <- normalizePath("..", mustWork = TRUE)
data_dir <- file.path(toolkit_dir, "example-data")

daily <- read.csv(file.path(data_dir, "synthetic_daily.csv"),
                  stringsAsFactors = FALSE)
nightly <- read.csv(file.path(data_dir, "synthetic_nightly.csv"),
                    stringsAsFactors = FALSE)
quality <- read.csv(file.path(data_dir, "synthetic_quality.csv"),
                    stringsAsFactors = FALSE)

stopifnot(
  !anyDuplicated(daily[c("participant_id", "activity_date")]),
  !anyDuplicated(nightly[c("participant_id", "activity_date")]),
  !anyDuplicated(quality["participant_id"]),
  all(daily$valid_day %in% c(0, 1)),
  all(daily$awake_wear_minutes >= 0),
  all(quality$complete_24hcycle >= 0 &
      quality$complete_24hcycle <= 1)
)

daily_key <- paste(daily$participant_id, daily$activity_date)
nightly_key <- paste(nightly$participant_id, nightly$activity_date)
stopifnot(setequal(daily_key, nightly_key))

message("Input validation passed:")
message("  daily rows: ", nrow(daily))
message("  nightly rows: ", nrow(nightly))
message("  participants: ", nrow(quality))
message("Remember: these are synthetic teaching data and course rules.")
