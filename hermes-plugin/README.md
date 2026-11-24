# Spanish Top Tech Companies for Hermes

Every day, the open tech postings at the companies that pay best in Spain, and in remote roles open to Spain or Europe, searchable by your agent, each one with what that company pays the role.

This package connects Hermes to the hosted MCP server at `https://spanishtoptechcompanies.com/mcp` and bundles the `tech-pay-spain` skill that tells the agent how to use it. There is no local code, no account and no API key.

## What it does

- `find_jobs`: searches the day's postings from 400+ company job boards, by words, role, region, remote, seniority, years, company size or minimum salary, each with the company's median base for the role.
- `job_questions`: reads one posting's text and application form live from its job board, with each question marked for the person or for the agent.
- `application_guide` and `report_application`: the procedure for applying on someone's behalf, and the outcome of each application (sent, failed and why, or handed over), with nothing about the person.
- `salary_stats`, `top_companies`, `company_salaries`, `list_filters`: medians of real salaries in Spain by role, region, years of experience and company, from Levels.fyi submissions. Every figure comes from 5 or more people and is rounded to 1,000 EUR.

The agent writes the answers from the CV the person gave it, asks the person what the CV does not say, shows the full application, and sends it with its own browser only after the person says yes. Privacy or data-processing consents are accepted only with their explicit permission.

## Install

```
hermes plugins install spanish-top-tech-companies
```

Or connect the server alone: `hermes mcp add tech-pay-spain --url https://spanishtoptechcompanies.com/mcp`.

## What leaves your machine

- Every tool call goes to the server at spanishtoptechcompanies.com, run by the project's maintainer. It stores nothing about the user: the CV, what they want and the applications sent stay with the agent.
- `job_questions` makes the server read the posting from the employer's public job board (Greenhouse, Lever, Ashby, Workday and others) at that moment.
- The server counts each call in PostHog (EU servers), without an IP address: the tool, the filters or posting asked for, how many results came back, the client's name, the country, and the reason the agent gives if any, with emails, numbers and keys removed. `report_application` records whether an application was sent or why not, never anything about the person. Details: https://spanishtoptechcompanies.com/en/legal/
- Applications are sent by the agent with its own browser to the employer's job board, only after the person says yes. Without a browser, the agent hands over the apply URL and the answers.
- The tool list comes from the server at run time, so the pinned commit does not cover it.

## Source

Code, data and the skill: https://github.com/pugarte7/spanish-top-tech-companies. Data CC BY-SA 4.0.
