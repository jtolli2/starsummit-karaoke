# Explain Action

1. Read the active feature context and determine the comparison base: use the repository's default branch when it is available, otherwise state the base used.
2. Use `git diff <base> --name-only` and inspect the relevant diff.
3. List each created or modified file with a one- or two-sentence explanation of its purpose and important behavior.
4. End with a concise description of data and control flow, including PocketBase, tablet, and guest-client boundaries when they apply.

Use the headings `## Files Changed` and `## How It Connects`.
