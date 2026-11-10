<!-- What changes and why, in a few lines. Keep the title short: it becomes the release note. -->

Label it `patch`, `minor` or `major` (see CONTRIBUTING.md).

- [ ] `python3 tests/test_pipeline.py` passes
- [ ] If data changed: `python3 scripts/validate.py && python3 scripts/site.py --refresh`, regenerated `data/` committed
- [ ] No `companies.csv`, no single person's salary, no tokens
