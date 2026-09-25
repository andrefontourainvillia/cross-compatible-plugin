---
description: Start the complete plugin cross compatibility audit, approval, fix, re-audit, and README badge workflow.
argument-hint: "[plugin-directory]"
agent: plugin-cross-orchestrator
---

Use or delegate to the `plugin-cross-orchestrator` agent to run the complete compatibility workflow.

Treat text appended to this slash command as the optional target plugin directory. In clients that expose command arguments through `$ARGUMENTS`, the value is:

`$ARGUMENTS`

If no directory was supplied, detect the most likely plugin root in the current workspace and ask the user to confirm it. Do not modify files until the orchestrator reaches the relevant explicit approval boundary.
