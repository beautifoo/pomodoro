# Pomodoro for Pi

After 25 minutes without a break, you get a reminder to take one, and your agent gets a note so it can sum up the session if that helps.

```
pi install npm:@beautifoo/pi-pomodoro
```

It runs in Pi's terminal UI only, not with `-p`, `--mode json` or RPC. The footer counts your pomodoros in sets of four, and your minutes. A break is 3 minutes with no keyboard or mouse input and no work from the agent (macOS idle time; elsewhere, no prompt, reply or tool call in any Pi session), and a long one, due after the fourth pomodoro, 15 minutes or more. `/pomodoro today` counts today's pomodoros and lists the check-ins in the repository you're in, and `/pomodoro quiet` holds the alerts during a meeting.

Settings go in `~/.pi/agent/pomodoro-settings.json`, read when a session starts or on `/reload`, with these defaults:

```json
{
	"sound": true,
	"emoji": true
}
```

A key the file leaves out, or leaves empty, keeps its default. A value that isn't `true` or `false`, or a file that isn't valid JSON or can't be read, keeps the timer off, with an error that says why.

The [repository](https://github.com/beautifoo/pomodoro) has the details, and the same plugin for Claude Code. MIT licensed. Pomodoro Technique® is a registered trademark of Francesco Cirillo; this package isn't affiliated with it.
