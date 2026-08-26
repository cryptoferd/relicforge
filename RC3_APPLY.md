# Apply RelicForge Contracts V1 RC3

This archive is a **flat branch-only overlay**. There is no top-level wrapper directory and no patch/helper script.

From the local repository root:

```powershell
git checkout contracts-v1-production
git pull --ff-only origin contracts-v1-production
git branch --show-current
```

The last command must print:

```text
contracts-v1-production
```

Then extract:

```powershell
Expand-Archive .\relicforge-contracts-v1-rc3-overlay.zip -DestinationPath . -Force
Remove-Item .\relicforge-contracts-v1-rc3-overlay.zip
```

Review and push:

```powershell
git status
git diff --stat
git add -A
git commit -m "Add RelicForge Contracts V1 RC3 hardening"
git push origin contracts-v1-production
```

Do not call RC3 green until the new GitHub Actions run compiles the direct-funded adapter, checks its runtime size, passes the expanded Foundry suite, and produces a Slither baseline.
