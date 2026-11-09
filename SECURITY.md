# Security

Only what runs from `main` is supported: the site at
https://spanishtoptechcompanies.com, its JSON under `/api/v1/` and the MCP
server at https://spanishtoptechcompanies.com/mcp. There are no other
versions to patch.

To report a vulnerability, open a private report at
https://github.com/pugarte7/spanish-top-tech-companies/security/advisories/new
rather than a public issue. You should get an answer within a week.

The MCP server takes no sign-in and stores nothing about the person using it;
the site keeps only aggregates of salaries, never one person's row. A way to
read a single person's salary or anything private through either is in scope.
