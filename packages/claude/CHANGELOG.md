# @beautifoo/claude-pomodoro

## 0.7.0

### Minor Changes

- 188f9e5: When you come back from a break, a toast says how long you were away and which pomodoro of the set you're taking up, as `🍅 Back after 4m · pomodoro 2 of 4`, or after a long break `🍅 Back after 22m · new set, pomodoro 1 of 4`, and from 2 hours away in hours, as `🍅 Back after 2h · new set, pomodoro 1 of 4`. Not after a break that began on an earlier day, such as the night. It comes once, with no banner and no chime, even with several sessions open.
- 6125ddd: The pomodoro and break lengths, the mouse-movement setting and the check-in switch are gone: a pomodoro is 25 minutes, a break 3 minutes or more, and the check-in is always on. Values left in settings.json are ignored. There is no osascript banner any more, so where the terminal can't raise a notification (Apple Terminal) the alert is the one in the app, with the chime.
- 560be74: About 5 minutes before a pomodoro ends, Claude gets a heads-up with a tool result, so it brings the current step to a stopping point and doesn't start anything big. It comes once per pomodoro, only while Claude is working, never while quiet or on a break, and you don't see it.
- 08bae64: The plugin now speaks Italian, German, French, Spanish, Portuguese, Russian and Chinese as well as English: the count, the status line, the alerts and toasts, the transcript note, `/pomodoro` and its replies, and the plugin's two rows in `/config`. It follows Claude Code's `language` setting, or else your Mac's language, and falls back to English.
- bfedc11: Locking the screen starts the time away at once, and alerts stay quiet while it's locked; 3 minutes locked is a break, a shorter lock is nothing. Typing the password, or a jiggler, under the lock screen doesn't end a break. The main agent's own activity (the prompt, its replies, its tool calls as each starts and ends) counts as you being there, so watching it work isn't a break, but 3 minutes with nothing from you or the main agent is, mid-turn too. A subagent's work doesn't count. A prompt you submit counts as your own input, so it ends a break. A break's length counts from your own last input.
- 3a88e0a: Pomodoros come in sets of four. At the end of the fourth, the alert, the warning and the note to the agent ask for a 15 to 30 minute break instead of a short one, and keep asking until you take it: a short break then doesn't start a new set. 15 minutes or more away, a closed lid or no session open included, starts a new set. The count shows the pomodoro under way in the set and the minutes into it, as `🍅 3 of 4 · 12/25m`, and goes on as `5 of 4` after the fourth; a pomodoro cut short by a break doesn't count. The alert asks for 3 to 5 minutes away.
- 71a31b8: `/pomodoro quiet` is for a meeting, a demo or pairing: the count goes on, shown as `🍅 quiet · 2 of 4 · 7/25m`, but there's no alert, no chime, no status-line warning and no check-in, and sitting still is never a break. It ends when you run `/pomodoro quiet` again, or lock the screen or close the lid for 3 minutes; if a break is due then, the alert comes at once. It's shared by your Claude Code sessions, and runs at once even while Claude is working.
- 44c390a: A break is now 3 minutes or more away. A stray key, a click or a keep-awake app's mouse jiggler neither holds a break off nor ends one: input counts once macOS's idle time, looked at every 10 seconds, shows it in three looks within a minute. Off macOS and over SSH, 3 minutes without a prompt, a reply or a tool call of the main agent is a break. The osascript that watched the input all along is gone.
- ac442b8: `/pomodoro today` starts with the day's count for the repository you're in: `Today: 🍅 4 pomodoros (yesterday 6), 1 long break, 2 breaks skipped, longest 75m`, then that repository's summaries only. Each pomodoro, break and stretch counts for the repository of the terminal session with the latest prompt or tool call, so a `claude -p` run elsewhere takes no credit, and a worktree counts as its main repository. Days are local time, and the tally keeps 14 days, like the log.

### Patch Changes

- bfedc11: A check-in that was due before the Mac slept is no longer sent on the first tool call after it wakes: the plugin notices the break first.

## 0.6.2

### Patch Changes

- e07c73b: A line of the input watcher's output that reached the plugin in two pieces was read as two broken times, which could restart the measure of how long the mouse had been moving. The pieces are now joined into whole lines first. The desktop notification your terminal raises for an alert now comes before the chime, not after it.
- 2c281aa: With `breakMinutes` under 2, a wake-up tick never replaced the one before, so while you worked without a break the plugin ticked one more time a minute for each minute worked, until your next break. Each tick reads and writes the shared timer, and without the input watcher runs `ioreg`. Now, as in Pi, a new wake-up replaces the one before, so it ticks at most about twice a minute.
- 5feaa0b: It says "pomodoro", the Pomodoro Technique's word, where it said "work block", and no longer calls that time work: `workMinutes` is "Pomodoro (minutes)" under `/config` and in the error for a value below 1, described as "Minutes without a break before the alert.", the transcript line reads "told the agent your pomodoro is up", and the plugin's description says "a notification after a pomodoro without a break".

## 0.6.1

### Patch Changes

- b2d09c6: `/config` no longer takes a work block or a break under 1 minute, or mouse movement under 0 seconds. A work block of 0 put the check-in on every tool result. A value below its minimum already in `settings.json` now stops the plugin from loading, and Claude Code names the setting only in its debug log (`claude --debug`). If the timer is gone after this update, look for a break of 0, a work block or a break under 1 minute, or `moveSeconds` under 0, and raise it.
- 9bd8103: A setting left empty in `settings.json` now takes its default. An empty work block put the check-in on every tool result, and an empty break made it 1 minute.

## 0.6.0

### Minor Changes

- 7ab824d: The check-in no longer stops the agent or asks whether to go on: once the block is up, the agent gets a note, carries on, and sums up the session in its next reply, in a paragraph that starts with "Pomodoro:", if that would help. The hold during a git rebase or merge goes with the stop. The log keeps only that paragraph, or nothing when the agent doesn't sum up.

## 0.5.0

### Minor Changes

- 12a8489: Install the plugin from npm.
