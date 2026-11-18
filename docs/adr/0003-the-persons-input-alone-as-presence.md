# The person's input alone as presence

ADR 0002 counted the main agent's own activity (a prompt, its replies, its tool calls) as the person being there, so watching it work wasn't a break. That also meant a break taken while the agent worked was lost: the 3 minutes away never added up while it kept making tool calls, and someone back before it had been still for 3 minutes had taken no break at all. Stepping away while the agent runs is the natural time for one, so only the person's own input is presence now, on every platform: keyboard or mouse input that counts, on macOS, and the prompts they send. The agent's replies and tool calls, and prompts the person didn't type, neither hold off a break nor end one; the main agent's activity still picks the repository the tally credits. Where there's no system idle time to read (Linux, Windows, SSH), the prompts alone stand in for input, not the agent's activity. This reverses the part of ADR 0002 on activity; the rest of it stands.

## Considered Options

- **Keep the agent's activity as presence, and lock the screen to step away**: a lock already counted at once, but a break no one remembers to lock for is lost, and the plugin is there for the breaks people forget.
- **Let the agent's activity hold off a break for a while only**, say 10 minutes after the person's last input: a threshold to pick, and a break under it still lost.
- **The agent's activity as presence off macOS only**: there it was all the plugin had, but then a break while the agent works would count on one platform and not on another.

Watching a long turn without touching anything for 3 minutes is now a break, which ADR 0002 turned down; that's the cost.
