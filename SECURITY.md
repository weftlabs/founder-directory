# Security and data concerns

Do not disclose credentials, vulnerabilities, or private profile evidence in a
public issue. Use GitHub's **Report a vulnerability** option when available;
otherwise contact Weft through the official contact route at https://weft.network.
Include the affected commit/version, impact, and a minimal redacted reproduction.
Do not test against another person's account or the hosted production database.

For profile correction or removal, contact the deployment's operator privately.
Fork operators are responsible for their own data handling, provider terms,
retention and removal process. This project does not verify identity or consent
merely because an upstream API returns a public profile.

## Deployment responsibilities

- Keep `WEFT_API_KEY`, `DATABASE_URL`, and `CRON_SECRET` server-side.
- Use separate preview/test databases and credentials; never expose them to fork CI.
- Configure Weft wallet limits before enabling scheduled scans.
- Keep dependency updates and deployment access under maintainer review.
- Do not log provider bodies, authorization headers, or raw database exceptions.
- A public profile URL is untrusted input, not proof of identity or safe content.

[Operational limitations](docs/quality.md) are tracked openly. No response-time
SLA or security certification is claimed.
