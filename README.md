# Pomodoro for Claude Code and Pi

After 25 minutes without a break, you get a reminder to take one, and your agent gets a note so it can sum up the session if that helps. It's a plugin for [Claude Code](https://code.claude.com) and an extension for [Pi](https://pi.dev).

## Install

### Claude Code

At the prompt of a Claude Code terminal session:

```
/plugin install pomodoro --marketplace beautifoo/pomodoro
```

Answer `y` to add the marketplace, then press Enter to install it for your user (or pick another scope).

From a shell:

```
claude plugin install pomodoro --marketplace beautifoo/pomodoro
```

It needs Claude Code 2.1.304 or later, and `npm` on your PATH, which comes with [Node.js](https://nodejs.org): Claude Code fetches the plugin from npm with it. Without it, the install fails with "Could not resolve @beautifoo/claude-pomodoro@latest from the npm registry: npm exited with an error". It runs in terminal sessions only: not in the desktop app, VS Code or `claude -p`. It's built on Claude Code's plugin API for TypeScript hooks, which is in early access, so a Claude Code update can break it.

Claude Code doesn't update plugins from a marketplace like this one by itself, unless you turn on auto-update for it under `/plugin` → Marketplaces. To update by hand, run these, then `/reload-plugins` in open sessions:

```
claude plugin marketplace update pomodoro
claude plugin update pomodoro@pomodoro
```

To remove the plugin:

```
claude plugin uninstall pomodoro@pomodoro
```

### Pi

```
pi install npm:@beautifoo/pi-pomodoro
```

Tested with Pi 1.5. It runs in Pi's terminal UI only: not with `-p`, `--mode json` or RPC. `pi update --extensions` updates it, and `pi remove npm:@beautifoo/pi-pomodoro` removes it.

## Features

The same in both agents, as Claude Code shows them; how Pi differs follows the list.
- **Check-in.** Once the pomodoro is up, Claude gets a note with its next tool result: you've gone 25 minutes without a break, it should carry on with the task, and if it would help you, include in its next reply a short summary of the session so far and whether it still serves the original goal, in a paragraph that starts with "Pomodoro:", then remind you to take a break, a 15 to 30 minute one after the fourth pomodoro of a set. Nothing stops Claude or asks you anything: whether to sum up is Claude's call. A line in the transcript tells you the note was sent. It's sent once for every 25 minutes without a break, and only while Claude is working: it never waits in an idle session for your next prompt. It reaches the main conversation only, so during a long-running subagent it comes once the subagent returns. About 5 minutes before, Claude gets a heads-up you don't see, to bring its current step to a stopping point.
- **Log.** Claude's summary at each check-in, that "Pomodoro:" paragraph from any reply until its turn ends, is kept for 14 days, with the time and the repository, in Claude Code's plugin store on this machine (`~/.claude/plugins/store/`), and so is a tally of your pomodoros and breaks. `/pomodoro today` counts and lists today's in the repository you're in. A turn with no summary logs nothing.
- **Count.** Shows the pomodoro under way in a set of four and the minutes into it, at the right of the prompt footer beside its other labels: `🍅 3 of 4 · 12/25m`. Once a break is due, a status line under the prompt says so too, with the minutes since your last break; Claude Code draws a plugin's status line in yellow with a ⚠, as `⚠ pomodoro: 🍅 27m, time for a break`. A phone following the session shows that line only.
- **Alert.** After a 25-minute pomodoro it plays a chime and shows a toast and a desktop notification. The alert repeats every 5 minutes until you take a break, but not once you've been away from the keyboard for 2 minutes (the break may already be under way), nor while the screen is locked.

It runs on a clock, a tick every minute, so the alert comes on time even while you're not typing to Claude. It speaks English, Italian, German, French, Spanish, Portuguese, Russian or Chinese, by Claude Code's `language` setting, else your Mac's language, and English for any other.

In Pi, the count and the break warning share one entry at the foot of the screen, and the alert is a warning line in Pi with the chime. The log is in `~/.pi/agent/pomodoro-log.json`, the tally in `~/.pi/agent/pomodoro-tally.json`, and the language is the Mac's.

## Breaks

You never start or stop the timer:
- 3 minutes with no keyboard or mouse input (macOS idle time) counts as a break, and 15 minutes or more as a long one, which starts a new set. The next pomodoro starts when you're back.
- Input counts only once it goes on: in 3 of the looks at the idle time, one every 10 seconds, within a minute. So a stray key, a click, or the nudge a keep-awake app's mouse jiggler gives every minute neither holds off a break nor ends one. A prompt you send counts at once.
- Claude's own work, its replies and its tool calls, counts as you being there, so watching it isn't a break; but it doesn't end one, and a subagent's doesn't count. A break's length runs from your own last input.
- Locking the screen starts the time away at once, and holds the alerts; 3 minutes locked is a break. Typing the password doesn't end it.
- Idle time is this Mac's own: 3 minutes spent on another computer counts as a break, unless you use this Mac's keyboard or trackpad in between (Universal Control included).
- A closed lid, or a stretch with no session of the agent open, also counts as a break.
- `/pomodoro quiet`, for a meeting or a demo, keeps the count going with no alert, chime, warning or check-in, and sitting still is never a break. It ends when you run it again, or lock the screen or close the lid for 3 minutes.
- The timer is one per person, shared by all your open sessions, so three sessions don't mean three notifications.
- Claude Code and Pi keep a timer each: with both open, each counts and alerts on its own.

On Linux, on Windows, or over SSH, there's no system idle time to read, so it falls back to the agent's activity: 3 minutes with no prompt, reply or tool call of the main agent in any session of that agent counts as a break.

## Settings

Under `/config`, or `pluginConfigs` in `settings.json`:

| Setting | Default | What it does                                                                                |
| ------- | ------- | ------------------------------------------------------------------------------------------- |
| `sound` | `true`  | Whether each alert plays a chime (macOS)                                                    |
| `emoji` | `true`  | Whether 🍅 marks the count and the alerts; off, the footer reads `pomodoro 3 of 4 · 12/25m` |

A value that isn't `true` or `false` in `settings.json` stops the plugin from loading, and nothing on screen says so: Claude Code names the setting only in its debug log (`claude --debug`).

In Pi, the same keys go in `~/.pi/agent/pomodoro-settings.json`, read when a session starts or on `/reload`. A key the file leaves out, or leaves empty, keeps its default. A value that isn't `true` or `false`, or a file that isn't valid JSON or can't be read, keeps the timer off, with an error that says why:

```json
{ "sound": false }
```

## Alerts

- **Banner.** It goes through your Claude Code notification channel (`preferredNotifChannel`), so your terminal shows it. While the Claude tab is in front, Ghostty shows it for a few seconds only, then removes it, so it's easy to miss. Where the terminal can't raise one, as in Apple Terminal, which has no notification channel, or if you turned Claude Code notifications off, there's no banner.
- **Chime.** Plain audio, not a notification, so you hear it even when the banner is easy to miss, and through a Focus (Work, Do Not Disturb).

A Focus silences the banner unless it allows your terminal: System Settings → Focus → (your Focus) → Allowed Notifications → Apps.

Pi has no notification channel of its own, so there's no banner in Pi.

## Development

The Claude Code plugin is in `packages/claude`, and the Pi extension in `packages/pi`. The rhythm itself, with neither agent's API in it, is in `lib/core`, which each of them copies in: each agent creates an instance of it for each session, with a host that does the agent's I/O ([ADR 1](docs/adr/0001-core-carries-out-its-effects-through-a-host.md)). [`CONTEXT.md`](CONTEXT.md) holds the words the project uses. From a clone of this repository:

```
bun install
bun run build
claude plugin validate packages/claude
bun run test
claude --plugin-dir packages/claude
```

`bun run build` copies `lib/core/index.ts` and `lib/core/messages.ts` to `core.ts` and `messages.ts` in `packages/claude/hooks/` and `packages/pi/` (all ignored by git), since a Claude Code plugin can only import its own files: run it again after editing core. `bun run test` runs core's tests, the plugin's, and a smoke test that runs Pi with the extension against a scripted model on localhost. The last command starts a session with the mod loaded from the folder; saving a file reloads it. Each load also writes the `claude-code` module's types for your Claude Code version into `packages/claude/.claude-plugin/types/` (ignored by git), which `packages/claude/tsconfig.json` points your editor and `tsc -p packages/claude` at, so run it once after cloning.

For Pi, `pi -e ./packages/pi` starts a session with the extension loaded from the folder; remove the installed package first, or both run.

Formatting and linting use [Biome](https://biomejs.dev) with the [`@lrnz09/biome-config`](https://www.npmjs.com/package/@lrnz09/biome-config) preset:

```
bun run check
bun run fix
bun run typecheck
```

To release, describe the change with `bunx changeset`, then run `bun run bump`: it bumps the version of each package the changesets name, writes their changelogs, and copies the plugin's version into `plugin.json`. Core isn't published on its own: it ships inside the plugin, so a change to it needs a changeset for the plugin. Once that's pushed to `main` and the checks pass, CI publishes each new version to npm.

## License

[MIT](LICENSE)

Pomodoro Technique® is a registered trademark of Francesco Cirillo; this project isn't affiliated with it.
