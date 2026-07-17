# ChainForge Contributor Journey

Welcome to ChainForge! This document provides an end-to-end walk-through for first-time contributors: from finding an issue to getting your PR merged.

## 1. Picking an Issue

We recommend starting with issues labeled `good-first-issue` or `help-wanted`. 

- **`good-first-issue`**: These are self-contained issues that require minimal context about the overall architecture. Perfect for your first PR.
- **`help-wanted`**: These might be slightly more involved but are well-scoped and ready for community contribution.

To claim an issue, simply leave a comment on it asking to be assigned. Please wait for assignment before you start working to avoid duplicated efforts.

## 2. Local Setup Steps per Package

ChainForge consists of multiple packages under the `app/` directory. Depending on the issue you picked, you will need to set up the corresponding package.

1. **Fork & Clone**: Fork the repository and clone it locally.
   ```bash
   git clone https://github.com/YOUR_USERNAME/ChainForge.git
   cd ChainForge
   ```

2. **Package Setup**:
   - **Backend** (`app/backend`):
     ```bash
     cd app/backend
     npm ci
     cp .env.example .env
     npm run prisma:migrate
     npm run start:dev
     ```
   - **Frontend** (`app/frontend`):
     ```bash
     cd app/frontend
     pnpm install
     cp .env.example .env.local
     pnpm dev
     ```
   - **Mobile** (`app/mobile`):
     ```bash
     cd app/mobile
     pnpm install
     pnpm start
     ```
   - **AI Service** (`app/ai-service`):
     ```bash
     cd app/ai-service
     python -m venv .venv
     source .venv/bin/activate
     pip install -r requirements.txt
     uvicorn main:app --reload --port 8000
     ```
   - **Smart Contracts** (`app/onchain`): Ensure Rust and Soroban CLI are installed.
     ```bash
     cd app/onchain
     make build
     ```

For deeper package-specific guidelines, always check the `CONTRIBUTING.md` or `README.md` in the respective `app/` subdirectories.

## 3. PR Conventions

- **Branch Naming**: Create a new branch for your work. A good convention is `type/issue-number-brief-description` (e.g., `fix/123-update-button-color`).
  ```bash
  git checkout -b fix/123-update-button-color
  ```
- **One Issue per PR**: Keep pull requests small and strictly focused on a single issue.
- **Conventional Commits**: We follow [Conventional Commits](https://www.conventionalcommits.org/). Your commit messages should look like:
  - `feat: add new reporting dashboard`
  - `fix: resolve crash on mobile login`
  - `docs: update contributor journey`

## 4. CI Expectations

Before you open a PR, make sure you pass the local checks. Our CI pipeline will strictly enforce the following:

- **Linting**: Ensure your code passes all lint checks (e.g., `npm run lint` / `pnpm lint`).
- **Tests**: All existing tests must pass. If you are adding a new feature, include tests for it.
- **Build**: The project must build successfully without errors.
- **Spec Drift**: For backend and API changes, ensure the OpenAPI/GraphQL specs are up to date and do not drift from the implementation.
- **Coverage**: Code coverage should not drop. We expect reasonable test coverage for newly added logic.

## 5. Merge and Release Process

Once your PR is ready:

1. **Push your branch** to your fork.
2. **Open a PR** against the `main` branch of the upstream ChainForge repository.
3. **Review**: A maintainer will review your code. You might be asked to make some changes.
4. **Merge**: Once approved and all CI checks pass, a maintainer will merge your PR.
5. **Release**: Merged PRs are grouped into releases based on our release cadence and semantic versioning automatically derived from the conventional commits.

Thank you for contributing to ChainForge and helping make humanitarian aid delivery more transparent and efficient!
