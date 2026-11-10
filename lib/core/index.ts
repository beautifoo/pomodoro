import { type Language, messages } from './messages'

// The work-and-break rhythm the pomodoro plugins share. Each agent creates an instance for each session
// (createInstance), with a host that does its I/O, and passes it the session's events; whatever only one agent does
// stays in that agent's code (docs/adr/0001). Inside, step() is pure: it says what to do, and the instance does it.

// Shared by every open session through the agent's store: one pomodoro per person, not per session. `blockStart` is when
// the stretch of work since the last break began, `done` the pomodoros of the set before it, `lastInput` the person's
// own (while quiet, the person is there until a tick sees the screen locked), `agentAt` the main agent's last activity,
// `breakStart` when the break under way began, and `quiet` whether /pomodoro quiet is on. `repo` is the repository the
// tally credits, that of the ticking session with the latest activity, at `repoAt`; `counted` the pomodoros of this
// stretch already in the tally.
export type Timer = {
	blockStart?: number
	done?: number
	seenAt?: number
	alertedAt?: number
	lastInput?: number
	agentAt?: number
	breakStart?: number
	quiet?: boolean
	repo?: string | null
	repoAt?: number
	counted?: number
}
// The agent's summary at a check-in, kept for /pomodoro today.
export type CheckIn = { at: number; repo: string | null; text: string }
// The tally /pomodoro today counts, by repository: a pomodoro when its 25 minutes were up, `run` the start of its
// stretch; a break when the person came back, `ms` away after a stretch of `runMs`.
export type TallyEntry =
	| { at: number; repo: string | null; kind: 'pomodoro'; run: number }
	| {
			at: number
			repo: string | null
			kind: 'break'
			ms: number
			runMs: number
	  }
// The Claude plugin's plugin.json declares the same defaults.
export const DEFAULTS = { sound: true, emoji: true }
export type Settings = Readonly<typeof DEFAULTS>

// The settings in a file's JSON or Claude Code's options, with the defaults for the keys left out or empty; or what's
// wrong with them in `language`, as Claude Code checks a plugin's options: then neither agent runs the timer. Other
// keys, such as the timings of an older version, are ignored.
export function settingsFrom(
	json: unknown,
	language: Language = 'en',
): Settings | { problems: string[] } {
	const text = messages[language]
	if (typeof json !== 'object' || json === null || Array.isArray(json))
		return { problems: [text.notObject] }
	const file = json as Record<string, unknown>
	const settings: Record<string, unknown> = { ...DEFAULTS }
	const problems: string[] = []
	for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
		const value = file[key]
		// Claude Code's check skips an empty value, then hands it on.
		if (value === undefined || value === '') continue
		if (typeof value !== 'boolean') problems.push(text.notBoolean(key))
		else settings[key] = value
	}
	return problems.length > 0 ? { problems } : (settings as Settings)
}

// One session's own: the main loop's last activity; its last look at ioreg, and the latest input of each look that saw
// input in the last minute; the last input that counts (undefined: no look yet); when the person came back from the
// latest break, by the first look of the run that made input count again; since when the screen is locked, from the
// first tick that saw it; the check-in now due, the last one sent, and whether the summary it asked for is still to log;
// the heads-up now due and the last one sent, each by when its pomodoro ends.
type State = {
	lastActivity: number
	lookedAt?: number
	looks: number[]
	lastInputThatCounts?: number
	backAt?: number
	lockedSince?: number
	due?: { key: number; text: string }
	sentKey?: number
	awaitingSummary: boolean
	headsUp?: number
	headsUpKey?: number
}

type Event =
	// The main loop's prompt, reply, or tool call as it starts or ends; the person's own for a prompt.
	| { type: 'activity'; now: number; byPerson: boolean }
	// A look at the system's input idle time, which ioreg reads.
	| { type: 'look'; now: number; idleMs: number }
	// The minute's tick, with the stored timer, whether the screen is locked, and the instance's last tick or look before
	// it (0: none), when the Mac was last awake as far as this session knows.
	| {
			type: 'tick'
			now: number
			timer: Timer
			isLocked: boolean
			awakeAt: number
	  }
	| { type: 'toolResult'; isMain: boolean }
	// A finished response of the main loop, and the end of its turn (in Pi, the run).
	| { type: 'reply'; text: string }
	| { type: 'turnEnded' }

// In the order to carry them out.
type Effect =
	// Tick again this much later.
	| { type: 'wake'; afterMs: number }
	// Store the shared timer.
	| { type: 'persist'; timer: Timer }
	// The count, and the warning while a break is due.
	| { type: 'show'; label: string; warning?: string }
	| { type: 'alert'; text: string; mark: string; sound: boolean }
	// Back from a break: a toast, with no banner and no chime.
	| { type: 'toast'; text: string }
	// Add `text` to this tool result.
	| { type: 'checkIn'; key: number; text: string }
	// Tell the agent `text` with this tool result, where the person doesn't see it.
	| { type: 'headsUp'; text: string }
	// Add the summary to the log.
	| { type: 'log'; text: string }
	// Add these to the tally.
	| { type: 'tally'; entries: TallyEntry[] }

export const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// A pomodoro; the time away that makes a break, and a long one; the pomodoros of a set; how often the alert repeats; the
// time away after which it's skipped; how long before a pomodoro ends the heads-up comes.
const POMODORO = 25 * MINUTE
const SHORT_BREAK = 3 * MINUTE
const LONG_BREAK = 15 * MINUTE
const SET = 4
const REPEAT = 5 * MINUTE
const AWAY = 2 * MINUTE
const AHEAD = 5 * MINUTE
// How often the instance looks at the input idle time, and how many looks within a minute must see input for it to
// count: a stray key, a click or a jiggler's nudge is one look.
const LOOK = 10_000
const USE_LOOKS = 3

const initial: State = {
	lastActivity: 0,
	looks: [],
	awaitingSummary: false,
}

// The command that prints macOS's input idle time (about 22 ms), and that time in its output (undefined: none, as off
// macOS).
export const IOREG = ['ioreg', '-r', '-c', 'IOHIDSystem', '-d', '1']
function ioregIdleMs(stdout: string) {
	const ns = stdout.match(/"HIDIdleTime" = (\d+)/)?.[1]
	return ns === undefined ? undefined : Number(ns) / 1e6
}

// The command that says whether the screen is locked (about 24 ms), in its "IOConsoleLocked" key, which Apple doesn't
// document.
export const LOCK = ['ioreg', '-n', 'Root', '-d', '1']

// An alert's chime (macOS).
export const CHIME = ['afplay', '/System/Library/Sounds/Glass.aiff']

// /pomodoro, which an instance answers.
export const COMMAND = {
	name: 'pomodoro',
	description: messages.en.description,
}

// What an agent gives an instance to do its I/O with. Each of these is general: what only one agent does stays in
// that agent's code.
export type Host = {
	now: () => Promise<number>
	// `fn` once after `ms`, or every `ms`; each returns what cancels it.
	after: (ms: number, fn: () => void) => () => void
	every: (ms: number, fn: () => void) => () => void
	// What every session of the agent shares: the timer, the log of summaries, and the tally.
	load: (key: 'timer' | 'checkIns' | 'tally') => Promise<unknown>
	save: (key: 'timer' | 'checkIns' | 'tally', value: unknown) => Promise<void>
	// A command's output; a rejection or '' when it can't run, which core takes the same.
	run: (argv: readonly string[], timeoutMs?: number) => Promise<string>
	// The root of the session's repository (null: none).
	repo: () => Promise<string | null>
	// The count, and the warning while a break is due.
	show: (label: string, warning?: string) => void
	// The agent's own alert.
	notify: (text: string, mark: string) => Promise<void>
	// A plain toast, which comes and goes on its own.
	toast: (text: string) => void
	// What the session keeps across a reload, to hand back to createInstance.
	keep: (kept: Kept) => void
}

// The pomodoro whose check-in the session got. Only that: the wait for the summary ends with the turn, and a reload
// comes between turns.
export type Kept = number

// One session's: each agent passes it the session's events.
export type Instance = {
	// The clock, and the looks at ioreg unless over SSH: only where the count shows.
	start: () => void
	stop: () => void
	// One tick now, as the clock would.
	tick: () => Promise<void>
	// A prompt, a reply, or a tool call as it starts or ends; only the main loop's is the person being there. A prompt the
	// person submitted is their own input too.
	activity: (isMain: boolean, byPerson?: boolean) => Promise<void>
	// What goes with this tool result, if it's of the main loop: the check-in once a pomodoro is up, with the line that
	// tells the person, and the heads-up shortly before it ends, for the agent alone. Each once per pomodoro.
	toolResult: (isMain: boolean) => {
		checkIn?: string
		notice?: string
		headsUp?: string
	}
	// A finished response of the main loop, which may hold the summary.
	reply: (text: string) => Promise<void>
	// The end of the main loop's turn (in Pi, the run).
	turnEnded: () => void
	// What /pomodoro prints for `args`.
	command: (args: string) => Promise<string>
}

export function createInstance(
	host: Host,
	options: {
		settings: Settings
		remote: boolean
		kept?: unknown
		language: Language
	},
): Instance {
	const { settings, remote, language } = options
	let state: State = {
		...initial,
		sentKey: typeof options.kept === 'number' ? options.kept : undefined,
	}
	// What ends the minute's clock, the looks and the wake.
	let cancelClock: (() => void) | undefined
	let cancelLooks: (() => void) | undefined
	let cancelWake: (() => void) | undefined
	let isStopped = false
	// When the last tick began. A sleeping Mac stops the clock's timers, so the first look or activity after it wakes can
	// come before the first tick: then the tick comes first.
	let lastTickAt = 0
	const isTickBehind = (now: number) =>
		cancelClock !== undefined && !isStopped && now - lastTickAt >= SHORT_BREAK

	// Moves the rhythm on by one event, and returns what to carry out, in order.
	function feed(event: Event) {
		const next = step(state, event, settings, language)
		state = next.state
		return next.effects
	}

	// Where ioreg gives nothing (not macOS) there's no look, and the session's activity stands in. After a sleep the tick,
	// which takes its own look, finds the break from the input before it, before looks of the input after it can count.
	async function look() {
		const now = await host.now()
		if (isTickBehind(now)) return runTick()
		const idleMs = ioregIdleMs(await host.run(IOREG, 5_000).catch(() => ''))
		if (idleMs !== undefined) feed({ type: 'look', now, idleMs })
	}

	// The agent's alert, then the chime.
	async function alert(text: string, hasSound: boolean, mark: string) {
		await host.notify(text, mark).catch(() => {})
		// Ghostty shows the banner of the tab in front for a few seconds only, and a Focus silences it; not a chime.
		if (hasSound) await host.run(CHIME).catch(() => {})
	}

	async function runTick() {
		// Before this tick's own look: after a sleep, the last before it.
		const awakeAt = Math.max(lastTickAt, state.lookedAt ?? 0)
		lastTickAt = await host.now()
		// A tick on its own (the clock never started) or with the looks behind takes one first; over SSH ioreg would see
		// the console's input.
		const { lookedAt } = state
		if (!remote && (lookedAt === undefined || lastTickAt - lookedAt > LOOK))
			await look()
		// Only where a look read ioreg (macOS, not over SSH); nothing from it is unlocked.
		const isLocked =
			state.lookedAt !== undefined &&
			(await host.run(LOCK, 5_000).catch(() => '')).includes(
				'"IOConsoleLocked" = Yes',
			)
		const now = await host.now()
		let timer = ((await host.load('timer')) ?? {}) as Timer
		// The tally credits the repository of the session with the latest activity: this one's, once its activity is newer
		// than that stored, or none is. Only a ticking session writes it, so a `claude -p` run elsewhere takes no credit. Not
		// during a break: the stretch before it, and the break, count for the repository in use when the person left.
		if (
			timer.breakStart === undefined &&
			state.lastActivity > (timer.repoAt ?? -1)
		)
			timer = {
				...timer,
				repo: await host.repo().catch(() => null),
				repoAt: state.lastActivity,
			}
		for (const effect of feed({
			type: 'tick',
			now,
			timer,
			isLocked,
			awakeAt,
		})) {
			// A tick still under way when the instance stopped carries out nothing more: its session is gone.
			if (isStopped) return
			// Each wake aims at the moment the stretch without input becomes a break, so the newest replaces the last.
			if (effect.type === 'wake') {
				cancelWake?.()
				cancelWake = host.after(
					effect.afterMs,
					() => void runTick().catch(() => {}),
				)
			}
			// ponytail: read-then-write, so two sessions ticking in the same instant can both alert, or both add a pomodoro
			else if (effect.type === 'persist') await host.save('timer', effect.timer)
			else if (effect.type === 'show') host.show(effect.label, effect.warning)
			else if (effect.type === 'alert')
				await alert(effect.text, effect.sound, effect.mark)
			else if (effect.type === 'toast') host.toast(effect.text)
			else if (effect.type === 'tally')
				await tally(now, effect.entries).catch(() => {})
		}
	}

	// The tally with `entries` added, less the entries 14 days old.
	// ponytail: read-then-write, so two sessions adding in the same instant can drop one
	async function tally(now: number, entries: TallyEntry[]) {
		const stored = ((await host.load('tally')) ?? []) as TallyEntry[]
		await host.save('tally', [
			...stored.filter((entry) => now - entry.at < 14 * DAY),
			...entries,
		])
	}

	// Quiet on or off for every session of the agent, then a tick at once: the count says so, and off, a break due alerts
	// now, even within 5 minutes of the last alert. After a sleep the tick comes first, so the gap doesn't end quiet just
	// turned on.
	// ponytail: read-then-write, so a tick storing the timer in the same instant can undo it
	async function toggleQuiet() {
		if (isTickBehind(await host.now())) await runTick().catch(() => {})
		const timer = ((await host.load('timer')) ?? {}) as Timer
		const quiet = !timer.quiet
		await host.save(
			'timer',
			quiet ? { ...timer, quiet } : { ...timer, quiet, alertedAt: undefined },
		)
		// Only where the clock runs, which is where the count shows.
		if (cancelClock !== undefined && !isStopped) await runTick().catch(() => {})
		return quiet ? messages[language].quietOn : messages[language].quietOff
	}

	// ponytail: read-then-write, so two sessions logging in the same instant can drop one
	async function log(text: string) {
		const at = await host.now()
		const repo = await host.repo()
		const checkIns = ((await host.load('checkIns')) ?? []) as CheckIn[]
		await host.save('checkIns', logged(checkIns, { at, repo, text }))
	}

	return {
		start() {
			if (cancelClock !== undefined || isStopped) return
			// ioreg sees the console's input, not the input of an SSH session. The first tick takes the first look.
			// ponytail: looks per open session; share them across sessions if many sessions matter
			if (!remote)
				cancelLooks = host.every(LOOK, () => void look().catch(() => {}))
			// A failed tick is retried by the next one.
			void runTick().catch(() => {})
			cancelClock = host.every(MINUTE, () => void runTick().catch(() => {}))
		},
		stop() {
			isStopped = true
			cancelClock?.()
			cancelLooks?.()
			cancelWake?.()
		},
		tick: runTick,
		async activity(isMain, byPerson = false) {
			const now = await host.now()
			// After a sleep the tick comes first, so a check-in due before it isn't sent.
			if (isTickBehind(now)) await runTick().catch(() => {})
			// A subagent's work isn't the person being there.
			if (isMain) feed({ type: 'activity', now, byPerson })
		},
		toolResult(isMain) {
			const notes: ReturnType<Instance['toolResult']> = {}
			for (const effect of feed({ type: 'toolResult', isMain }))
				if (effect.type === 'checkIn') {
					host.keep(effect.key)
					notes.checkIn = effect.text
					notes.notice = `${tomato(settings)}${messages[language].notice}`
				} else if (effect.type === 'headsUp') notes.headsUp = effect.text
			return notes
		},
		async reply(text) {
			for (const effect of feed({ type: 'reply', text }))
				if (effect.type === 'log') await log(effect.text).catch(() => {})
		},
		turnEnded() {
			feed({ type: 'turnEnded' })
		},
		async command(args) {
			if (args.trim() === 'quiet') return toggleQuiet()
			if (!['', 'today'].includes(args.trim())) return messages[language].usage
			return today(
				{
					tally: ((await host.load('tally')) ?? []) as TallyEntry[],
					log: ((await host.load('checkIns')) ?? []) as CheckIn[],
					timer: ((await host.load('timer')) ?? {}) as Timer,
					now: await host.now(),
					repo: await host.repo().catch(() => null),
				},
				settings,
				language,
			)
		},
	}
}

// Whether to sum up, and when, is the agent's call: nothing stops it or asks the person anything. At the end of a set,
// the long break.
const check = (minutes: number, isSetUp: boolean) =>
	`[Pomodoro] The user has been working for ${minutes} minutes without a break. Carry on with the task. ` +
	'If it would help them, include in your next reply a short summary of the session so far, and whether it still ' +
	'serves the original goal, in a paragraph that starts with "Pomodoro:". ' +
	(isSetUp
		? 'Remind them to take a 15 to 30 minute break: their set of 4 pomodoros is done.'
		: 'Remind them to take a break.')

// So the agent comes to a stopping point as the pomodoro ends.
const HEADS_UP =
	"[Pomodoro] The user's pomodoro ends in about 5 minutes. Bring the current step to a stopping point, and don't start " +
	'anything big.'

// 🍅 before a line, unless the setting turns it off; `word` stands in where the line needs a name to make sense.
const tomato = (settings: Settings, word = '') =>
	settings.emoji ? '🍅 ' : word

// Exported for its tests, which read the state an instance keeps to itself.
export function step(
	state: State,
	event: Event,
	settings: Settings,
	language: Language,
): { state: State; effects: Effect[] } {
	switch (event.type) {
		case 'activity': {
			const { now, byPerson } = event
			const active = { ...state, lastActivity: now }
			// The person's prompt counts at once as input. Without the looks, the activity stands in for input already.
			return {
				state:
					byPerson && state.lastInputThatCounts !== undefined
						? inputCounts(active, now, now, now)
						: active,
				effects: [],
			}
		}
		case 'look':
			return {
				state: looked(state, event.now, event.idleMs),
				effects: [],
			}
		case 'tick':
			return tick(state, event, settings, language)
		case 'toolResult':
			return toolResult(state, event.isMain)
		case 'reply':
			return reply(state, event.text)
		// No summary by the turn's end: the agent chose not to give one, or the turn was cut short.
		case 'turnEnded':
			return { state: { ...state, awaitingSummary: false }, effects: [] }
	}
}

// A look puts the latest input `idleMs` before `now`, and saw input when that's after the look before.
function looked(state: State, now: number, idleMs: number): State {
	const latest = now - idleMs
	// The first look counts at once: the input before the instance started, so a reload doesn't end a break.
	if (state.lookedAt === undefined || state.lastInputThatCounts === undefined)
		return { ...state, lookedAt: now, lastInputThatCounts: latest }
	const looks = latest > state.lookedAt ? [...state.looks, latest] : state.looks
	return counted({ ...state, lookedAt: now, looks }, now)
}

// Input counts once looks saw it USE_LOOKS times within a minute, so a stray key, a click or a jiggler's nudge never
// does, before a break or during one. Looks under the lock screen wait for a tick to see it unlocked, so the password
// alone, one look, doesn't count, and the input right after it does.
function counted(state: State, now: number): State {
	const looks = state.looks.filter((at) => now - at < MINUTE)
	if (state.lockedSince !== undefined || looks.length < USE_LOOKS)
		return { ...state, looks }
	return inputCounts(
		{ ...state, looks },
		now,
		Math.max(...looks),
		Math.min(...looks),
	)
}

// Input that counts, the latest at `latest`. After a break's length or more without any, the person is back from
// `from`, the first input of the run.
function inputCounts(
	state: State,
	now: number,
	latest: number,
	from: number,
): State {
	const last = state.lastInputThatCounts ?? latest
	return {
		...state,
		lastInputThatCounts: Math.max(last, latest),
		backAt: now - last >= SHORT_BREAK ? from : state.backAt,
	}
}

function tick(
	previous: State,
	{ now, timer, isLocked, awakeAt }: Extract<Event, { type: 'tick' }>,
	settings: Settings,
	language: Language,
): { state: State; effects: Effect[] } {
	const text = messages[language]
	// The lock first, kept from the first tick that saw it: once a tick sees the screen unlocked, the looks kept meanwhile
	// count.
	const state = counted(
		{
			...previous,
			lockedSince: isLocked ? (previous.lockedSince ?? now) : undefined,
		},
		now,
	)
	const { lockedSince } = state
	// A gap is a break's length with no tick and no look of this session: the machine slept or no session was open. Like
	// a break, it ends quiet. This session's last look comes at most 10 seconds before the lid closes, the last tick up to
	// a minute, so a shorter sleep is no gap.
	// ponytail: no session open counts from the last tick, up to a minute early; store when a session ends to fix it
	const isGap =
		timer.seenAt === undefined ||
		now - Math.max(timer.seenAt, awakeAt) >= SHORT_BREAK
	const isQuiet = timer.quiet === true && !isGap
	// The person's last input that counts, from the looks at ioreg, and the main agent's last activity; without the
	// looks, both are the activity. Each is the latest any session has seen, so an idle session can't end the pomodoro
	// another one is working in. While quiet the person is there until the screen locks: sitting still in a call is no
	// break, however long, and only a lock held for a break's length is one.
	const lastInput = Math.max(
		timer.lastInput ?? 0,
		state.lastInputThatCounts ?? state.lastActivity,
		isQuiet ? (lockedSince ?? now) : 0,
	)
	const agentAt = Math.max(timer.agentAt ?? 0, state.lastActivity)
	// Time since the person or the main agent was last there. Watching the agent holds off a break but doesn't end one:
	// only the person's own input does. A lock starts the time away at once.
	const idle =
		now -
		Math.min(
			timer.breakStart === undefined ? Math.max(lastInput, agentAt) : lastInput,
			lockedSince ?? Number.POSITIVE_INFINITY,
		)

	// The break began at the person's own last input, not the agent's. It forgets the last return: the look that counts
	// the next one sets it again, and where another session's input ends this break first, there's none to read. The
	// stretch before it, the set, the tally's and the last alert are kept for the return, which may find it was none;
	// quiet isn't.
	const { repo = null, repoAt } = timer
	let inTally = timer.counted ?? 0
	if (idle >= SHORT_BREAK)
		return {
			state: {
				...state,
				due: undefined,
				headsUp: undefined,
				backAt: undefined,
			},
			effects: [
				{
					type: 'persist',
					timer: {
						blockStart: timer.blockStart,
						done: timer.done,
						seenAt: now,
						alertedAt: timer.alertedAt,
						lastInput,
						agentAt,
						breakStart: timer.breakStart ?? lastInput,
						repo,
						repoAt,
						counted: inTally,
					},
				},
				{
					type: 'show',
					label: `${tomato(settings, 'pomodoro ')}${text.onABreak}`,
				},
			],
		}
	const effects: Effect[] = []
	// Ticks are a minute apart: tick again the moment this stretch without input would become a break.
	if (idle > SHORT_BREAK - MINUTE)
		effects.push({ type: 'wake', afterMs: SHORT_BREAK - idle + 1_000 })

	// The break this tick ends, from when it began: the one found, or a gap from the person's last input before it.
	const leftAt =
		timer.breakStart ?? (isGap ? (timer.lastInput ?? timer.seenAt) : undefined)
	let blockStart = timer.blockStart ?? now
	let done = timer.done ?? 0
	let away: number | undefined
	const entries: TallyEntry[] = []
	if (leftAt !== undefined) {
		// Back at the first input of the run that counted again. Not a look from before the break began, which was stray
		// input; without one (no looks, or another session's input ended the break), at the person's latest presence.
		const backAt =
			state.backAt !== undefined && state.backAt >= leftAt
				? state.backAt
				: now - idle
		// Less than a break's length away is no break: input counts only once three looks saw it, so a tick can find a
		// break the person came back from just before. Then the stretch goes on, as if none was found.
		if (backAt - leftAt >= SHORT_BREAK) {
			// The pomodoros up before the break count, one cut short doesn't; a long break starts a new set. A break that
			// began before any activity (at 0, off macOS) began long ago.
			away = backAt - leftAt
			const runMs = Math.max(0, leftAt - blockStart)
			const upBefore = Math.floor(runMs / POMODORO)
			done = away >= LONG_BREAK ? 0 : done + upBefore
			// Into the tally: those no tick saw up (the lid closed right after one), and the break, unless it began before
			// any activity, which has no length to tell. None of the new stretch's are in yet.
			entries.push(...pomodoros(blockStart, inTally, upBefore, repo))
			if (leftAt !== 0)
				entries.push({ at: backAt, repo, kind: 'break', ms: away, runMs })
			blockStart = backAt
			inTally = 0
		}
	}
	const worked = now - blockStart
	const minutes = Math.floor(worked / MINUTE)
	// A pomodoro goes into the tally once the person's own input is 25 minutes in, by the first session to tick then: one
	// up after they left is cut short by the break, as the set counts it.
	const up = Math.floor(Math.max(0, lastInput - blockStart) / POMODORO)
	entries.push(...pomodoros(blockStart, inTally, up, repo))
	// Once a pomodoro is up, a break is due, except while quiet: then the count goes on, but nothing asks for one, the
	// alert, the warning or the notes to the agent.
	const isDue = worked >= POMODORO && !isQuiet
	// The pomodoro under way in the set, and whether the set is up: after the fourth, until a long break.
	const position = done + Math.floor(worked / POMODORO) + 1
	const isSetUp = position > SET
	const alertedAt = timer.alertedAt ?? 0
	// Not once the person has been away a while, nor while the screen is locked: that may be the break already under way.
	const shouldAlert =
		isDue &&
		idle < AWAY &&
		lockedSince === undefined &&
		(alertedAt < blockStart || now - alertedAt >= REPEAT)

	effects.push(
		{
			type: 'persist',
			timer: {
				blockStart,
				done,
				seenAt: now,
				alertedAt: shouldAlert ? now : alertedAt,
				lastInput,
				agentAt,
				quiet: isQuiet,
				repo,
				repoAt,
				counted: Math.max(inTally, up),
			},
		},
		{
			type: 'show',
			label: `${tomato(settings, 'pomodoro ')}${isQuiet ? `${text.quiet} · ` : ''}${text.count(position, Math.floor((worked % POMODORO) / MINUTE))}`,
			warning: isDue
				? `${tomato(settings)}${(isSetUp ? text.dueLong : text.due)(minutes)}`
				: undefined,
		},
	)
	// Back, once: this tick stores the timer without the break, so another session's has none to end. In whole minutes, as
	// the count's; not from a break that began before any activity, which has no length to tell.
	if (away !== undefined && leftAt !== 0) {
		const minutesAway = Math.floor(away / MINUTE)
		effects.push({
			type: 'toast',
			text: `${tomato(settings)}${away >= LONG_BREAK ? text.backLong(minutesAway) : text.back(minutesAway, position)}`,
		})
	}
	if (shouldAlert)
		effects.push({
			type: 'alert',
			text: (isSetUp ? text.alertLong : text.alert)(minutes),
			mark: tomato(settings),
			sound: settings.sound,
		})
	if (entries.length > 0) effects.push({ type: 'tally', entries })
	// One check-in per pomodoro that ends without a break, keyed by when that pomodoro ended; one heads-up per pomodoro in
	// its last minutes, keyed by when it ends, except while quiet.
	const due = isDue
		? {
				key: blockStart + Math.floor(worked / POMODORO) * POMODORO,
				text: check(minutes, isSetUp),
			}
		: undefined
	const headsUp =
		worked % POMODORO >= POMODORO - AHEAD && !isQuiet
			? blockStart + (Math.floor(worked / POMODORO) + 1) * POMODORO
			: undefined
	return { state: { ...state, due, headsUp }, effects }
}

// The tally's entries for the pomodoros of the stretch from `run`, after the first `from` up to the `to`th, each at the
// moment its 25 minutes were up.
const pomodoros = (
	run: number,
	from: number,
	to: number,
	repo: string | null,
): TallyEntry[] =>
	Array.from({ length: Math.max(0, to - from) }, (_, i) => ({
		at: run + (from + i + 1) * POMODORO,
		repo,
		kind: 'pomodoro',
		run,
	}))

// The check-in and the heads-up ride a tool result of the main loop, each once per pomodoro. Each counts as sent from
// here, so two tool results at once can't both carry it.
function toolResult(
	state: State,
	isMain: boolean,
): { state: State; effects: Effect[] } {
	if (!isMain) return { state, effects: [] }
	const { due, headsUp } = state
	let next = state
	const effects: Effect[] = []
	if (due !== undefined && due.key !== state.sentKey) {
		next = { ...next, sentKey: due.key, awaitingSummary: true }
		effects.push({ type: 'checkIn', ...due })
	}
	if (headsUp !== undefined && headsUp !== state.headsUpKey) {
		next = { ...next, headsUpKey: headsUp }
		effects.push({ type: 'headsUp', text: HEADS_UP })
	}
	return { state: next, effects }
}

// The summary can come in any response after the check-in, mid-task too, until the turn ends.
function reply(
	state: State,
	text: string,
): { state: State; effects: Effect[] } {
	const found = state.awaitingSummary ? summary(text) : undefined
	if (found === undefined) return { state, effects: [] }
	return {
		state: { ...state, awaitingSummary: false },
		effects: [{ type: 'log', text: found }],
	}
}

// The summary the note asks for: the first paragraph of a reply that starts with "Pomodoro:", with markdown around the
// label (**Pomodoro:**) or a word before its colon (Pomodoro check-in:) allowed. Undefined: the agent didn't sum up.
const summary = (reply: string) =>
	reply
		.split(/\n\s*\n/)
		.find((paragraph) => /^[\s#>*_]*pomodoro\b[^:\n]{0,20}:/i.test(paragraph))
		?.replace(/^[\s#>*_]+/, '')
		.replaceAll('**', '')
		.trim()

// The log with `entry` added, its text cut to 4,000 characters, less the entries 14 days old.
const logged = (log: CheckIn[], entry: CheckIn): CheckIn[] => [
	...log.filter((c) => entry.at - c.at < 14 * DAY),
	{ ...entry, text: entry.text.slice(0, 4_000) },
]

// The day's tally in `repo`, at local time, then its check-ins of the day. Long breaks count after a pomodoro of the day,
// so the night before the first doesn't; a stretch counts on the day it ended, and the one under way (or just ended by
// the break under way) while a tick has seen it lately, in the repository it counts for.
function today(
	{
		tally,
		log,
		timer,
		now,
		repo,
	}: {
		tally: TallyEntry[]
		log: CheckIn[]
		timer: Timer
		now: number
		repo: string | null
	},
	settings: Settings,
	language: Language,
) {
	const day = (at: number) => new Date(at).toDateString()
	const date = new Date(now)
	date.setDate(date.getDate() - 1)
	const yesterday = date.toDateString()
	const isToday = (at: number) => day(at) === day(now)
	const mine = tally.filter((entry) => entry.repo === repo)
	const pomodoros = mine.filter((entry) => entry.kind === 'pomodoro')
	const breaks = mine.filter((entry) => entry.kind === 'break')
	const todays = pomodoros.filter((p) => isToday(p.at))
	const current =
		timer.repo === repo &&
		timer.blockStart !== undefined &&
		now - (timer.seenAt ?? 0) < SHORT_BREAK
			? (timer.breakStart ?? now) - timer.blockStart
			: 0
	const longest = Math.max(
		0,
		current,
		...breaks.filter((b) => isToday(b.at - b.ms)).map((b) => b.runMs),
	)
	const head =
		todays.length === 0
			? messages[language].noPomodoros
			: messages[language].today({
					mark: tomato(settings),
					pomodoros: todays.length,
					yesterday: pomodoros.filter((p) => day(p.at) === yesterday).length,
					longBreaks: breaks.filter(
						(b) =>
							isToday(b.at) &&
							b.ms >= LONG_BREAK &&
							todays.some((p) => p.at < b.at),
					).length,
					// Each stretch's pomodoros after its first.
					skipped: todays.length - new Set(todays.map((p) => p.run)).size,
					longest: Math.floor(longest / MINUTE),
				})
	return [
		head,
		...log
			.filter((c) => c.repo === repo && isToday(c.at))
			.map(
				({ at, text }) =>
					`${new Date(at).toTimeString().slice(0, 5)}  ${text.replaceAll('\n', '\n       ')}`,
			),
	].join('\n')
}
