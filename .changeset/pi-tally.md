---
"@beautifoo/pi-pomodoro": minor
---

`/pomodoro today` starts with the day's count for the repository you're in: `Today: 🍅 4 pomodoros (yesterday 6), 1 long break, 2 breaks skipped, longest 75m`, then that repository's summaries only. Each pomodoro, break and stretch counts for the repository of the terminal UI session with the latest prompt or tool call, so a `-p` run elsewhere takes no credit, and a worktree now counts as its main repository, in the log too. Days are local time, and the tally keeps 14 days, like the log.
