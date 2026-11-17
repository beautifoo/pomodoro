---
"@beautifoo/claude-pomodoro": minor
---

A new pomodoro starts only after a break. Past 25 minutes without one, the count holds at `25/25m`, as `🍅 1 of 4 · 25/25m`, while the status line keeps the minutes since your last break, and no second pomodoro counts, so Claude gets the check-in and the heads-up once until you take a break. The alert still repeats every 5 minutes. The long break is asked for after the fourth pomodoro of a set, so 100 minutes straight asks for a short one. `/pomodoro today` counts late breaks, those that came 5 minutes or more after the pomodoro was up, where it counted breaks skipped: `Today: 🍅 4 pomodoros (yesterday 6), 1 long break, 2 late breaks, longest 75m`.
