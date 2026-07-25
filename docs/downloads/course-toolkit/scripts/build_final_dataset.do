version 17
clear all
set more off

* Run this do-file from the course-toolkit/scripts folder.
local data_dir "../example-data"
local output_dir "../expected"

import delimited using "`data_dir'/synthetic_daily.csv", clear varnames(1)
isid participant_id activity_date
assert inlist(valid_day, 0, 1)
assert awake_wear_minutes >= 0

generate mvpa_1plus_min = mvpa_1_5_min + mvpa_5_10_min + mvpa_10_plus_min
generate mvpa_5plus_min = mvpa_5_10_min + mvpa_10_plus_min
generate inactivity_20plus_min = inactivity_20_30_min + inactivity_30_plus_min
generate weekend_day = inlist(day_type, "Saturday", "Sunday")

tempfile daily
save `daily'

import delimited using "`data_dir'/synthetic_nightly.csv", clear varnames(1)
isid participant_id activity_date
tempfile nightly
save `nightly'

use `daily', clear
merge 1:1 participant_id activity_date using `nightly'
assert _merge == 3
drop _merge
tempfile daynight
save `daynight'

import delimited using "`data_dir'/synthetic_quality.csv", clear varnames(1)
isid participant_id
tempfile quality
save `quality'

use `daynight', clear
merge m:1 participant_id using `quality'
assert _merge == 3
drop _merge

* Course teaching rules, not universal accelerometer standards.
bysort participant_id: egen n_valid_days = total(valid_day)
bysort participant_id: egen n_weekend_days = total(valid_day * weekend_day)

generate failed_quality_review = qc_status != "keep"
generate insufficient_valid_days = n_valid_days < 4
generate no_valid_weekend_day = n_weekend_days < 1
generate final_include = !failed_quality_review ///
    & !insufficient_valid_days ///
    & !no_valid_weekend_day

preserve
keep participant_id failed_quality_review insufficient_valid_days ///
    no_valid_weekend_day final_include qc_rationale
bysort participant_id: keep if _n == 1
export delimited using "`output_dir'/generated_exclusion_log.csv", replace
restore

keep if valid_day == 1 & final_include == 1
collapse (firstnm) n_valid_days n_weekend_days ///
    (mean) awake_wear_minutes sleep_duration_min ///
    mvpa_1plus_min mvpa_5plus_min mvpa_10_plus_min ///
    inactivity_20plus_min, by(participant_id)
isid participant_id
sort participant_id

order participant_id n_valid_days n_weekend_days awake_wear_minutes ///
    sleep_duration_min mvpa_1plus_min mvpa_5plus_min mvpa_10_plus_min ///
    inactivity_20plus_min
export delimited using "`output_dir'/generated_final_participant_dataset.csv", replace
save "`output_dir'/generated_final_participant_dataset.dta", replace

display as result "Course pipeline complete: " _N " participants retained."
