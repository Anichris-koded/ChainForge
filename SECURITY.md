# Security Policy

## Supported Versions

The following versions of ChainForge are currently receiving security updates:

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

ChainForge handles sensitive humanitarian aid data and recipient PII. We take security seriously.

**Please do NOT report security vulnerabilities through public GitHub Issues.**

### How to Report

1. **Email**: Send a detailed report to the maintainers at security@chainforge.app.
2. **GitHub Private Disclosure**: Use [GitHub's private vulnerability reporting](https://github.com/ChainForgee/ChainForge/security/advisories/new) feature.

### What to Include

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any proof-of-concept code (if applicable)
- Suggested fix (if you have one)

### Response Timeline

- **Acknowledgement**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Patch or mitigation**: Within 30 days for critical issues

### Scope

Areas of particular concern given ChainForge's use case:

- Smart contract vulnerabilities on Stellar/Soroban. For more details on our scheduled external reviews, please refer to our [Third-Party Security Review Audit Plan](docs/security/audit-plan.md).
- PII data exposure or leakage
- Authentication and authorization bypasses
- SQL/NoSQL injection
- Insecure data transmission

Thank you for helping keep ChainForge and its users safe.