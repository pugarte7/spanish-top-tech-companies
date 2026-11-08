# offers

The pay employers in Spain state in their job postings, kept day by day.
`.github/workflows/deploy.yml` on `main` crawls the job boards every day and
`scripts/offers.py` merges the postings that state pay into `offers.csv`.

One row per posting and range: `first_seen` and `last_seen` are the first and
last days the crawl saw it. When an employer changes the range, a new row
starts. Postings carried over from a board that failed that day do not count
as seen.

`min`, `max`, `currency` and `period` are what the board states in its own
fields. `location_classes` says why the posting is open to someone in Spain
(`spain`, `remote-spain`, `remote-europe`, ...).

This is the employers' own published data, not anyone's salary.
