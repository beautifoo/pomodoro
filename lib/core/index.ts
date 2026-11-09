import { type Language, messages } from './messages'

// The work-and-break rhythm the pomodoro plugins share. Each agent creates an instance for each session
// (createInstance), with a host that does its I/O, and passes it the session's events; whatever only one agent does
// stays in that agent's code (docs/adr/0001). Inside, step() is pure: it says what to do, and the instance does it.

// Shared by every open session through the agent's store: one pomodoro per person, not per session. `blockStart` is when
// the stretch of work since the last break began, `done` the pomodoros of the set before it, `lastInput` the person's
// own (while quiet, the person is there until a tick sees the screen locked), `agentAt` the main agent's last activity,
// `breakStart` when the break under way began, and `quiet` whether /pomodoro quiet is on.
export type Timer = {
	blockStart?: number
	done?: number
	seenAt?: number
	alertedAt?: number
	lastInput?: number
	agentAt?: number
	breakStart?: number
	quiet?: boolean
}
// The agent's summary at a check-in, kept for /pomodoro today.
export type CheckIn = { at: number; repo: string | null; text: string }
// The Claude plugin's plugin.json declares the same defaults.
export const DEFAULTS = { sound: true, emoji: true }
export type Settings = Readonly<typeof DEFAULTS>

// The settings in a file's JSON or Claude Code's options, with the defaults for the keys left out or empty; or what's
// wrong with them, as Claude Code checks a plugin's options: then neither agent runs the timer. Other keys, such as
// the timings of an older version, are ignored.
export function settingsFrom(json: unknown): Settings | { problems: string[] } {
	if (typeof json !== 'object' || json === null || Array.isArray(json))
		return { problems: ['the file must hold a JSON object'] }
	const file = json as Record<string, unknown>
	const settings: Record<string, unknown> = { ...DEFAULTS }
	const problems: string[] = []
	for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
		const value = file[key]
		// Claude Code's check skips an empty value, then hands it on.
		if (value === undefined || value === '') continue
		if (typeof value !== 'boolean') problems.push(`${key} must be a boolean`)
		else settings[key] = value
	}
	return problems.length > 0 ? { problems } : (settings as Settings)
}

// One session's own: the main loop's last activity; its last look at ioreg, and the latest input of each look that saw
// input in the last minute; the last input that counts (undefined: no look yet); when the person came back from the
// latest break, by the first look of the run that made input count again; since when the screen is locked, from the
// first tick that saw it; the check-in now due, the last one sent, and whether the summary it asked for is still to log.
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
}

type Event =
	// The main loop's prompt, reply, or tool call as it starts or ends; the person's own for a prompt.
	| { type: 'activity'; now: number; byPerson: boolean }
	// A look at the system's input idle time, which ioreg reads.
	| { type: 'look'; now: number; idleMs: number }
	// The minute's tick, with the stored timer and whether the screen is locked.
	| { type: 'tick'; now: number; timer: Timer; isLocked: boolean }
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
	// Add the summary to the log.
	| { type: 'log'; text: string }

export const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// A pomodoro; the time away that makes a break, and a long one; the pomodoros of a set; how often the alert repeats; the
// time away after which it's skipped.
const POMODORO = 25 * MINUTE
const SHORT_BREAK = 3 * MINUTE
const LONG_BREAK = 15 * MINUTE
const SET = 4
const REPEAT = 5 * MINUTE
const AWAY = 2 * MINUTE
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
	// What every session of the agent shares: the timer, and the log of summaries.
	load: (key: 'timer' | 'checkIns') => Promise<unknown>
	save: (key: 'timer' | 'checkIns', value: unknown) => Promise<void>
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
	// The check-in to add to this tool result, if it's of the main loop and one is due: once per pomodoro.
	toolResult: (isMain: boolean) => string | undefined
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
		const timer = ((await host.load('timer')) ?? {}) as Timer
		for (const effect of feed({ type: 'tick', now, timer, isLocked })) {
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
			// ponytail: read-then-write, so two sessions ticking in the same instant can both alert
			else if (effect.type === 'persist') await host.save('timer', effect.timer)
			else if (effect.type === 'show') host.show(effect.label, effect.warning)
			else if (effect.type === 'alert')
				await alert(effect.text, effect.sound, effect.mark)
			else if (effect.type === 'toast') host.toast(effect.text)
		}
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
			const [checkIn] = feed({ type: 'toolResult', isMain })
			if (checkIn?.type !== 'checkIn') return undefined
			host.keep(checkIn.key)
			return checkIn.text
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
				((await host.load('checkIns')) ?? []) as CheckIn[],
				await host.now(),
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
		? "Remind them to take a 15 to 30 minute break: that's 4 pomodoros."
		: 'Remind them to take a break.')

// 🍅 before a line, unless the setting turns it off; `word` stands in where the line needs a name to make sense.
const tomato = (settings: Settings, word = '') =>
	settings.emoji ? '🍅 ' : word

// What the person reads once the check-in went out, the same in every agent.
export const notice = (settings: Settings, language: Language) =>
	`${tomato(settings)}${messages[language].notice}`

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
	{ now, timer, isLocked }: Extract<Event, { type: 'tick' }>,
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
	// A gap is no tick for a break's length: the machine slept or no session was open. Like a break, it ends quiet.
	const isGap = timer.seenAt === undefined || now - timer.seenAt >= SHORT_BREAK
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
	// stretch before it and the set are kept for the return; quiet isn't.
	if (idle >= SHORT_BREAK)
		return {
			state: { ...state, due: undefined, backAt: undefined },
			effects: [
				{
					type: 'persist',
					timer: {
						blockStart: timer.blockStart,
						done: timer.done,
						seenAt: now,
						lastInput,
						agentAt,
						breakStart: timer.breakStart ?? lastInput,
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
	if (leftAt !== undefined) {
		// Back at the first input of the run that counted again. Not a look from before the break began, which was stray
		// input; without one (no looks, or another session's input ended the break), at the person's latest presence.
		const backAt =
			state.backAt !== undefined && state.backAt >= leftAt
				? state.backAt
				: now - idle
		// The pomodoros up before the break count, one cut short doesn't; a long break starts a new set. A break that began
		// before any activity (at 0, off macOS) began long ago.
		away = Math.max(0, backAt - leftAt)
		done =
			away >= LONG_BREAK
				? 0
				: done + Math.floor(Math.max(0, leftAt - blockStart) / POMODORO)
		blockStart = backAt
	}
	const worked = now - blockStart
	const minutes = Math.floor(worked / MINUTE)
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
	// One check-in per pomodoro that ends without a break, keyed by when that pomodoro ended.
	const due = isDue
		? {
				key: blockStart + Math.floor(worked / POMODORO) * POMODORO,
				text: check(minutes, isSetUp),
			}
		: undefined
	return { state: { ...state, due }, effects }
}

// The check-in rides a tool result of the main loop, once per pomodoro. It counts as sent from here, so two tool
// results at once can't both carry it.
function toolResult(
	state: State,
	isMain: boolean,
): { state: State; effects: Effect[] } {
	const { due } = state
	if (!isMain || due === undefined || due.key === state.sentKey)
		return { state, effects: [] }
	return {
		state: { ...state, sentKey: due.key, awaitingSummary: true },
		effects: [{ type: 'checkIn', ...due }],
	}
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

// Today's check-ins at local time, under the name of their repository's folder.
function today(log: CheckIn[], now: number, language: Language) {
	const words = messages[language]
	const day = new Date(now).toDateString()
	const byRepo = new Map<string | null, string[]>()
	for (const { at, repo, text } of log)
		if (new Date(at).toDateString() === day)
			byRepo.set(repo, [
				...(byRepo.get(repo) ?? []),
				`  ${new Date(at).toTimeString().slice(0, 5)}  ${text.replaceAll('\n', '\n         ')}`,
			])
	if (byRepo.size === 0) return words.noCheckIns
	return [...byRepo]
		.map(([repo, lines]) =>
			[repo?.split(/[/\\]/).at(-1) ?? words.noRepository, ...lines].join('\n'),
		)
		.join('\n\n')
}
