---
name: manage-skills-hub
description: Manage and use Ray Skills Hub, a GitHub-based Codex skills catalog. Use when the user asks to browse available team skills, install a skill from this hub, add or update a skill, prepare a release, maintain CATALOG.yaml/README.md, migrate a local skill into the hub, or record third-party/upstream provenance.
---

# Manage Skills Hub v0.4.0

## Overview

Use this skill to operate the Ray Skills Hub with the smallest reliable workflow. The hub is a GitHub repository where each Codex skill remains a normal skill folder, and `CATALOG.yaml` plus `README.md` provide the human and machine index.

## Repository Shape

Expected layout:

```text
README.md
CATALOG.yaml
skills/
  team/<skill-name>/
    SKILL.md
    agents/openai.yaml
    references/
    assets/
  personal/<skill-name>/
    SKILL.md
third_party/
```

Only `SKILL.md` is required for a skill. Keep optional folders only when they are used.

## Common Tasks

### Browse Skills

Read `CATALOG.yaml` first, then `README.md` if the user needs a human-facing summary. Report skill id, path, version, maturity, owner, and whether it is recommended.

### Install a Skill

Prefer the built-in `$skill-installer` flow with a stable GitHub path:

```bash
scripts/install-skill-from-github.py \
  --repo <owner>/<repo> \
  --path skills/team/<skill-name>
```

After installation, tell the user to restart Codex.

### Add or Update a Team Skill

1. Put team skills under `skills/team/<skill-name>/`; put Ray personal skills under `skills/personal/<skill-name>/`.
2. Ensure folder name equals `SKILL.md` frontmatter `name`.
3. Keep `SKILL.md` concise; move long material to `references/`.
4. Update `CATALOG.yaml` and the skills table in `README.md`.
5. Validate YAML, paths, and name consistency before finishing.

### Publish Local Skill Updates to Hub

Use this flow when Ray says “把这个 skill 提交到 `Coco422/ray-skills-hub`”, “更新 hub 里的 skill”, or “往 hub 增加一个 skill”.

1. Resolve the local source skill folder.
   - Default source: `${CODEX_HOME:-$HOME/.codex}/skills/<skill-name>`.
   - If the user provides a path, use that exact folder.
   - Verify `SKILL.md` frontmatter `name` equals the folder name.
2. Prepare or open the hub working tree.
   - Search for an existing local clone first.
   - If none exists, clone `https://github.com/Coco422/ray-skills-hub.git`.
   - Check `git status --short --branch` before edits.
3. Choose the destination path.
   - Team skills: `skills/team/<skill-name>/`.
   - Ray personal skills: `skills/personal/<skill-name>/`.
   - Third-party or unreviewed upstream material: keep isolated under `third_party/` until reviewed.
4. Sync files.
   - For an existing skill, copy the local folder into the destination with deletion so removed files disappear too.
   - Preserve only repository-specific files that intentionally differ, such as a reviewed `LICENSE`, unless the source includes the replacement.
   - For a new skill, create the destination folder and copy only useful skill files: `SKILL.md`, `agents/`, `references/`, `scripts/`, `assets/`, and license/provenance files.
5. Update indexes.
   - Update or add the `CATALOG.yaml` entry: `id`, `path`, `source`, `owner`, `recommended`, `maturity`, `version`, `license`, `upstream`, `tags`, `last_reviewed`.
   - Update `hub.updated` to today.
   - Update the `README.md` skill table and install examples if the skill is new or its version changes.
6. Validate.
   - Run `python3 scripts/validate_catalog.py`.
   - If `PyYAML` is missing, use a temporary venv outside the repo, e.g. `/tmp/ray-skills-hub-validate-venv`, install `PyYAML`, then rerun.
   - Run quick validation for the changed skill:

```bash
${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py \
  skills/team/<skill-name>
```

7. Commit.
   - Review `git diff --stat`, `git diff`, and `git diff --check`.
   - Configure repo-local git identity if missing.
   - Commit with a concise message such as `Update <skill-name> skill` or `Add <skill-name> skill`.
8. Push and PR.
   - Check permission with `gh repo view Coco422/ray-skills-hub --json viewerPermission`.
   - If permission is `WRITE`, `MAINTAIN`, or `ADMIN`, push a branch to `origin` and open a PR.
   - If permission is `READ`, fork to the active GitHub account, push the branch to the fork, and open a PR from `<account>:<branch>` to `Coco422/ray-skills-hub:main`.
   - If `gh pr create` fails because the token cannot create PRs, provide the GitHub compare URL and PR body for manual creation.

Use branch names like:

```text
update/<skill-name>-<short-purpose>
feat/add-<skill-name>
```

PR body must include:

- Purpose
- Changes
- Trigger examples
- Source/license
- Assets included or changed
- Validation commands and results

Never include generated output from unrelated user projects in the hub unless it is part of the skill itself.

### Collaborator PR Flow

For external collaborators, use this exact flow:

1. Fork `Coco422/ray-skills-hub`.
2. Create a branch in the fork, such as `feat/add-<skill-name>` or `fix/update-<skill-name>`.
3. Add or update files only under the relevant skill directory plus `CATALOG.yaml` and `README.md`. Team skills go under `skills/team/`; Ray personal skills go under `skills/personal/`.
4. Keep historical versions in Git history; the repository tree should contain only the latest accepted version of each skill.
5. Push the branch to the fork and open a PR against `Coco422/ray-skills-hub:main`.
6. Ask the PR author to include purpose, trigger examples, source/license, assets included, and validation run.

When Ray asks an agent to process a PR, review the diff, verify the catalog and skill frontmatter, check assets/provenance, then either request changes or merge.

### Branch Rules

The remote repository should protect `main` with a GitHub ruleset:

- Require pull requests before merging.
- Require the `validate-catalog` status check.
- Block direct pushes for collaborators.
- Allow Ray/repo admins to bypass only for bootstrap or emergency maintenance.

### Third-Party or Upstream Skills

Do not trust a moving upstream branch as production input. Record upstream repo, commit/ref, license, importer, and review status. Keep third-party material isolated until reviewed.

### Release

For a release, update hub `version`, skill entry versions, and README install examples. Do not keep draft folders in the repository. If the user asks to push, confirm the Git repo has a remote and use normal git commit/tag/push flow.

## Validation

Run targeted checks:

```bash
python3 scripts/validate_catalog.py
```

If PyYAML is available, also run:

```bash
python3 ${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py \
  skills/team/<skill-name>
```
