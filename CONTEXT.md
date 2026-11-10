# Pomodoro

A break reminder inside coding agents: once a pomodoro is up, it alerts the person and gives the agent a check-in, so it can sum up the session if that helps.

## Language

### Time

**Pomodoro**:
25 minutes at the computer, the Pomodoro Technique's unit; it counts once its 25 minutes are up, and one cut short by a break doesn't. Pomodoros follow one another until a break.
_Avoid_: block, work block, work period

**Set**:
Four pomodoros, the first after a long break; once the fourth is up, a long break is due.

**Break**:
3 minutes or more away: with neither input that counts nor activity, with the screen locked, or in a gap. Its length runs from the person's own last input; the next pomodoro starts once the person is back.

**Short break**:
A break of 3 up to 15 minutes, the paper's 3 to 5 and longer; the set carries on.

**Long break**:
A break of 15 minutes or more, the paper's 15 to 30 and longer; it starts a new set.

**Gap**:
3 minutes or more with no tick in any session of the agent, as with a closed lid or no session open.

**Tick**:
One look at the clock and the screen lock, every minute and at the moment a break would begin.

**Input that counts**:
Keyboard or mouse input that macOS's idle time shows in 3 of its looks, one every 10 seconds, within a minute, or a prompt the person sends. Input under the lock screen waits for the screen to be unlocked.

**Stray input**:
A key, a click, a scroll or a mouse nudge, the person's or a keep-awake app's jiggler, that isn't input that counts: it neither holds off a break nor ends one.

**Activity**:
The main loop's prompt, reply, or tool call as it starts and as it ends: it holds off a break, so watching the agent work isn't one, but doesn't end one. A subagent's doesn't count. Where there's no system idle time to read (Linux, Windows, SSH), it stands in for input.

**Quiet**:
What `/pomodoro quiet` turns on, for a meeting or a demo: the count goes on, but nothing asks for a break, and sitting still is never one. A lock or a gap long enough to make a break ends it, and so does the command again.
_Avoid_: mute, meeting mode, do not disturb

**Shared timer**:
When the stretch since the last break began and the pomodoros of the set before it, the last tick, the last alert, the person's last input, the main loop's last activity, the break under way, whether it's quiet, and the repository the tally credits, shared by every session of one agent.

### Agents

**Agent**:
Claude Code or Pi, the coding agent the person works with.
_Avoid_: host, app

**Session**:
One open session of an agent; only one in a terminal counts.

**Main loop**:
The agent's own turn, as opposed to a subagent's run.

### What the person and the agent get

**Count**:
The pomodoro under way in the set and the minutes into it: `🍅 3 of 4 · 12/25m`, and on past 4 (`5 of 4`, `6 of 4`…) after the fourth until a long break. The warning beside it once a break is due keeps the minutes since the last break: `🍅 52m, time for a break`.

**Alert**:
The agent's own alert (in Claude Code a toast, and a banner where the terminal raises one; in Pi a warning line) and a chime when a pomodoro is up, asking for a short break, or a long one at the end of a set.

**Heads-up**:
A note on a tool result of the main loop about 5 minutes before a pomodoro ends, so the agent comes to a stopping point; the person doesn't see it.

**Check-in**:
A note on a tool result of the main loop that a pomodoro is up, asking the agent to carry on, to sum up if that helps, and to remind the person of the break, the long one at the end of a set. Always on.
_Avoid_: reminder, rabbit-hole check

**Summary**:
The paragraph starting "Pomodoro:" that the agent may write after a check-in, until its turn ends.

**Log**:
The summaries of the last 14 days, with their time and repository; `/pomodoro today` lists today's in the session's repository.

**Tally**:
The pomodoros and breaks of the last 14 days, each with the repository in use, that of the session with the latest activity; `/pomodoro today` counts today's in the session's repository.

## Relationships

- An **Agent** keeps one **Shared timer**, which all its **Sessions** read and write; Claude Code and Pi keep one each.
- A **Break** ends the **Pomodoro** under way; without one, **Pomodoros** follow back to back.
- A **Short break** keeps the **Set**; a **Long break** starts a new one. Once the fourth **Pomodoro** of a **Set** is up, the **Alert**, the warning and the **Check-in** ask for a **Long break** until one comes.
- The first **Alert** comes when a **Pomodoro** is up, then one every 5 minutes until a **Break**, once per **Agent**, and none while **Quiet**.
- Each **Session** gets at most one **Check-in** per **Pomodoro** that ends without a **Break**, on its **Main loop**'s next tool result; one not sent by the time the next **Pomodoro** ends gives way to that **Pomodoro**'s. Likewise one **Heads-up** per **Pomodoro**, before it ends. Neither while **Quiet**.
- A **Check-in** gets at most one **Summary**, which goes into the **Log**.

## Example dialogue

> **Dev:** "The person has worked 52 minutes straight after a **Long break**, with one session open and the agent busy all along: how many **Check-ins** did it get?"
> **Domain expert:** "Two, one per **Pomodoro**: just after 25 and just after 50 minutes, each on the next tool result of the **Main loop**. Had the agent sat idle from 20 to 52 minutes while the person worked, only one, for the second **Pomodoro**. The **Count** reads `3 of 4 · 2/25m`, the third **Pomodoro** of the **Set**, 2 minutes in, and the warning `52m`, since it runs from the last **Break**."
> **Dev:** "And if the lid was closed for ten minutes in between?"
> **Domain expert:** "That **Gap** is a **Short break**: a **Pomodoro** it cut short doesn't count, the next starts when the person is back, and the **Set** carries on."

## Flagged ambiguities

- "Pomodoro" names both the product and its unit, as in the technique ("the Pomodoro Technique", "a Pomodoro"): resolved, "Pomodoro" with no article is the product (the Claude Code plugin and the Pi extension), and "a pomodoro" is the unit. The count's word without the emoji ("pomodoro 3 of 4 · 12/25m", "pomodoro on a break") is the product's name.
- "block", "work block" and "work period" meant a **Pomodoro**: resolved, it's a **Pomodoro**, the technique's word. The code keeps `blockStart` (stored in the shared timer) for when the stretch since the last break began.
- A **Pomodoro** here follows the paper (Cirillo, _The Pomodoro Technique_, v1.3, 2007) in its lengths: 25 minutes, a **Short break** from 3 minutes, a **Long break** from 15 after a **Set** of four, and one cut short doesn't count. Where it differs: it starts by itself with the first input after a break, not for a task; a break is found, not taken when the timer rings; and without one, the next pomodoro starts at once, which is what the **Alert** is about.
