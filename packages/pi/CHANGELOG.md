# @beautifoo/pi-pomodoro

## 0.3.0

### Minor Changes

- 188f9e5: When you come back from a break, an info line says how long you were away and which pomodoro of the set you're taking up, as `🍅 Back after 4m · pomodoro 2 of 4`, or after a long break `🍅 Back after 22m · new set, pomodoro 1 of 4`, and from 2 hours away in hours, as `🍅 Back after 2h · new set, pomodoro 1 of 4`. Not after a break that began on an earlier day, such as the night. It comes once, with no chime, even with several sessions open.
- 6125ddd: The pomodoro and break lengths, the mouse-movement setting and the check-in switch are gone: a pomodoro is 25 minutes, a break 3 minutes or more, and the check-in is always on. Values left in pomodoro-settings.json are ignored. There is no osascript banner any more, so Pi alerts in the app and with the chime.
- 560be74: About 5 minutes before a pomodoro ends, the agent gets a heads-up after a tool result, so it brings the current step to a stopping point and doesn't start anything big. It comes once per pomodoro, only while the agent is working, never while quiet or on a break. It's a message the terminal doesn't show, and it adds no request to the model.
- 08bae64: The extension now speaks Italian, German, French, Spanish, Portuguese, Russian and Chinese as well as English: the count, the warning, the alerts, the line when you're back, `/pomodoro` and its replies, and the line that says why it's off. It follows your Mac's language and falls back to English; `/pomodoro`'s description in Pi's command list stays English.
- bfedc11: Locking the screen starts the time away at once, and alerts stay quiet while it's locked; 3 minutes locked is a break, a shorter lock is nothing. Typing the password, or a jiggler, under the lock screen doesn't end a break. The main agent's own activity (the prompt, its replies, its tool calls as each starts and ends) counts as you being there, so watching it work isn't a break, but 3 minutes with nothing from you or the main agent is, mid-turn too. A tool call another tool made (a codemode script's) doesn't count. A prompt you submit counts as your own input, so it ends a break. A break's length counts from your own last input.
- 3a88e0a: Pomodoros come in sets of four. At the end of the fourth, the alert, the warning and the note to the agent ask for a 15 to 30 minute break instead of a short one, and keep asking until you take it: a short break then doesn't start a new set. 15 minutes or more away, a closed lid or no session open included, starts a new set. The count shows the pomodoro under way in the set and the minutes into it, as `🍅 3 of 4 · 12/25m`, and goes on as `5 of 4` after the fourth; a pomodoro cut short by a break doesn't count. The alert asks for 3 to 5 minutes away.
- 71a31b8: `/pomodoro quiet` is for a meeting, a demo or pairing: the count goes on, shown as `🍅 quiet · 2 of 4 · 7/25m`, but there's no alert, no chime, no warning and no check-in, and sitting still is never a break. It ends when you run `/pomodoro quiet` again, or lock the screen or close the lid for 3 minutes; if a break is due then, the alert comes at once. It's shared by your Pi sessions, and Pi suggests `today` and `quiet` as you type the command.
- 44c390a: A break is now 3 minutes or more away. A stray key, a click or a keep-awake app's mouse jiggler neither holds a break off nor ends one: input counts once macOS's idle time, looked at every 10 seconds, shows it in three looks within a minute. Off macOS and over SSH, 3 minutes without a prompt, a reply or a tool call of the main agent is a break. The osascript that watched the input all along is gone.
- ac442b8: `/pomodoro today` starts with the day's count for the repository you're in: `Today: 🍅 4 pomodoros (yesterday 6), 1 long break, 2 breaks skipped, longest 75m`, then that repository's summaries only. Each pomodoro, break and stretch counts for the repository of the terminal UI session with the latest prompt or tool call, so a `-p` run elsewhere takes no credit, and a worktree now counts as its main repository, in the log too. Days are local time, and the tally keeps 14 days, like the log.

### Patch Changes

- bfedc11: A check-in that was due before the Mac slept is no longer sent on the first tool call after it wakes: the extension notices the break first.
- 94f0009: The break warning in Pi's status line is drawn in the theme's warning colour, so it stands out from the plain count.

## 0.2.2

### Patch Changes

- e07c73b: While a settings file that doesn't fit keeps the timer off, `/pomodoro` now says why, as the session's start does, instead of listing today's check-ins.
- 0f7ae24: A `/reload`, `/resume` or `pi --continue` no longer brings the same pomodoro's check-in again: the extension keeps the check-in it gave in an entry of the session, and reads it back when the session starts.
- 5feaa0b: The notice at a check-in reads "told the agent your pomodoro is up", in the Pomodoro Technique's word, not "your work block".
- fb8ad90: A `pomodoro-settings.json` that can't be read (its permissions, or a folder at that path) now keeps the timer off, with an error at session start, as a broken one does. Pi used to run on the defaults without a word. Only a missing file means the defaults.

## 0.2.1

### Patch Changes

- 9bd8103: A value of the wrong kind or below its minimum in `pomodoro-settings.json`, or a file that isn't valid JSON, now keeps the timer off, with an error at session start that names it. Pi used to take the default for it without a word, and kept a work block of a fraction of a minute as it was (a break under a minute became 1 minute). `workMinutes` and `breakMinutes` take 1 or more, `moveSeconds` 0 or more, and an empty value counts as left out.

## 0.2.0

### Minor Changes

- 7ab824d: The check-in no longer stops the agent or asks whether to go on: once the block is up, the agent gets a note, carries on, and sums up the session in its next reply, in a paragraph that starts with "Pomodoro:", if that would help. The hold during a git rebase or merge goes with the stop. The log keeps only that paragraph, or nothing when the agent doesn't sum up.

## 0.1.0

### Minor Changes

- 2eaa156: Add the Pi extension: the break alert, the check-in with its menu, and /pomodoro today.
