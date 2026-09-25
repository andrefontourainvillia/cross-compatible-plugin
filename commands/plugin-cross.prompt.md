---
description: Start the complete plugin cross compatibility audit, approval, fix, re-audit, and README badge workflow.
argument-hint: "[plugin-directory]"
agent: plugin-cross-orchestrator
---

Use or delegate to the `plugin-cross-orchestrator` agent to run the complete compatibility workflow.

Treat text appended to this slash command as the optional target plugin directory. In clients that expose command arguments through `$ARGUMENTS`, the value is:

`$ARGUMENTS`

If the value above is empty or is the literal text `$ARGUMENTS`, treat it as no directory supplied.

If no directory was supplied, detect the most likely plugin root in the current workspace and ask the user to confirm it. Do not modify files until the orchestrator reaches the relevant explicit approval boundary.

If the supplied directory does not exist or contains no plugin manifest, report this and ask the user for a valid path. If no plugin root can be detected in the workspace, ask the user to provide the plugin directory instead of guessing. Do not start the audit until a valid plugin root is confirmed.
