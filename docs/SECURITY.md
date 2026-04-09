# Security Policy

## Supported Versions

Security fixes are applied to actively maintained branches only.

| Branch / Version | Supported |
| --- | --- |
| `master` | Yes |
| `0.13` | Yes |
| `0.12` and older release branches | No |
| Feature branches and personal branches | No |

If a security issue affects an unsupported branch, the fix should be applied to a supported branch and then backported only if the maintainers explicitly decide to do so.

## Reporting a Vulnerability

Do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Please report suspected vulnerabilities privately by using GitHub's private vulnerability reporting for this repository. If that is not available, contact the repository owner privately through GitHub and include `Security` in the message title.

When reporting an issue, include:

- A short description of the problem and affected component
- Steps to reproduce or a proof of concept
- The impact you expect
- Any suggested remediation or relevant logs

Scope includes, but is not limited to:

- `apps/api`
- `apps/web`
- `apps/workers`
- `apps/ai-service`
- `packages/*`
- `infrastructure/`
- `jenkins/`

## Response Expectations

- Initial acknowledgment target: within 3 business days
- Status update target: within 7 business days after acknowledgment
- Fix timing: depends on severity, exposure, and release risk

After validation, maintainers may:

- Confirm the issue and prepare a private fix
- Request more information or reproduction details
- Decide the report is out of scope or not a vulnerability

Please avoid public disclosure until the maintainers confirm remediation or advise that disclosure is safe.
