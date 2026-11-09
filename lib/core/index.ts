import { type Language, messages } from './messages'

// The work-and-break rhythm the pomodoro plugins share. Each agent creates an instance for each session
// (createInstance), with a host that does its I/O, and passes it the session's events; whatever only one agent does
// stays in that agent's code (docs/adr/0001). Inside, step() is pure: it says what to do, and the instance does it.

// Shared by every open session through the agent's store: one pomodoro per person, not per session.
export type Timer = {
	blockStart?: number
	seenAt?: number
	alertedAt?: number
	lastInput?: number
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

// One session's own: its last prompt or tool call; its last look at ioreg, and the latest input of each look that saw
// input in the last minute; the last input that counts (undefined: no look yet); when the person came back from the
// latest break, by the first look of the run that made input count again; the check-in now due, the last one sent, and
// whether the summary it asked for is still to log.
type State = {
	lastActivity: number
	lookedAt?: number
	looks: number[]
	lastInputThatCounts?: number
	backAt?: number
	due?: { key: number; text: string }
	sentKey?: number
	awaitingSummary: boolean
}

type Event =
	// A prompt or a tool call.
	| { type: 'activity'; now: number }
	// A look at the system's input idle time, which ioreg reads.
	| { type: 'look'; now: number; idleMs: number }
	// The minute's tick, with the stored timer.
	| { type: 'tick'; now: number; timer: Timer }
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
	// Add `text` to this tool result.
	| { type: 'checkIn'; key: number; text: string }
	// Add the summary to the log.
	| { type: 'log'; text: string }

export const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// A pomodoro; the time away that makes a break; how often the alert repeats; the time away after which it's skipped.
const POMODORO = 25 * MINUTE
const SHORT_BREAK = 3 * MINUTE
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
	// A prompt or a tool call.
	activity: () => Promise<void>
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

	// Moves the rhythm on by one event, and returns what to carry out, in order.
	function feed(event: Event) {
		const next = step(state, event, settings, language)
		state = next.state
		return next.effects
	}

	// Where ioreg gives nothing (not macOS) there's no look, and the session's activity stands in.
	async function look() {
		const now = await host.now()
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
		// A tick on its own (the clock never started) or with the looks behind takes one first; over SSH ioreg would see
		// the console's input.
		const { lookedAt } = state
		if (
			!remote &&
			(lookedAt === undefined || (await host.now()) - lookedAt > LOOK)
		)
			await look()
		const now = await host.now()
		const timer = ((await host.load('timer')) ?? {}) as Timer
		for (const effect of feed({ type: 'tick', now, timer })) {
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
		}
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
		async activity() {
			feed({ type: 'activity', now: await host.now() })
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
			if (!['', 'today'].includes(args.trim())) return messages[language].usage
			return today(
				((await host.load('checkIns')) ?? []) as CheckIn[],
				await host.now(),
				language,
			)
		},
	}
}

// Whether to sum up, and when, is the agent's call: nothing stops it or asks the person anything.
const check = (minutes: number) =>
	`[Pomodoro] The user has been working for ${minutes} minutes without a break. Carry on with the task. ` +
	'If it would help them, include in your next reply a short summary of the session so far, and whether it still ' +
	'serves the original goal, in a paragraph that starts with "Pomodoro:". Remind them to take a break.'

// 🍅 before a line, unless the setting turns it off; `word` stands in where the line needs a name to make sense.
const tomato = (settings: Settings, word = '') =>
	settings.emoji ? '🍅 ' : word

// What the person reads once the check-in went out, the same in every agent.
export const notice = (settings: Settings, language: Language) =>
	`${tomato(settings)}${messages[language].notice}`

function step(
	state: State,
	event: Event,
	settings: Settings,
	language: Language,
): { state: State; effects: Effect[] } {
	switch (event.type) {
		case 'activity':
			return { state: { ...state, lastActivity: event.now }, effects: [] }
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

// A look puts the latest input `idleMs` before `now`, and saw input when that's after the look before. Input counts once
// looks saw it USE_LOOKS times within a minute, so a stray key, a click or a jiggler's nudge never does, before a break
// or during one.
function looked(state: State, now: number, idleMs: number): State {
	const latest = now - idleMs
	// The first look counts at once: the input before the instance started, so a reload doesn't end a break.
	if (state.lookedAt === undefined || state.lastInputThatCounts === undefined)
		return { ...state, lookedAt: now, lastInputThatCounts: latest }
	const sawInput = latest > state.lookedAt
	const looks = [
		...state.looks.filter((at) => now - at < MINUTE),
		...(sawInput ? [latest] : []),
	]
	if (!sawInput || looks.length < USE_LOOKS)
		return { ...state, lookedAt: now, looks }
	// Back after a break's length or more without input that counts: from the first look of this run.
	const isBack = now - state.lastInputThatCounts >= SHORT_BREAK
	return {
		...state,
		lookedAt: now,
		looks,
		lastInputThatCounts: latest,
		backAt: isBack ? looks[0] : state.backAt,
	}
}

function tick(
	state: State,
	{ now, timer }: Extract<Event, { type: 'tick' }>,
	settings: Settings,
	language: Language,
): { state: State; effects: Effect[] } {
	const text = messages[language]
	// Time since input that counts, from the looks at ioreg; without them, since this session's last activity.
	const idleMs = now - (state.lastInputThatCounts ?? state.lastActivity)
	// The latest input any session has seen, so an idle session can't end the pomodoro another one is working in.
	const lastInput = Math.max(timer.lastInput ?? 0, now - idleMs)
	const idle = now - lastInput

	if (idle >= SHORT_BREAK)
		return {
			state: { ...state, due: undefined },
			effects: [
				{ type: 'persist', timer: { seenAt: now, lastInput } },
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

	// No tick for a break's length: the machine slept or no session was open.
	const isGap = timer.seenAt === undefined || now - timer.seenAt >= SHORT_BREAK
	const blockStart =
		isGap || timer.blockStart === undefined ? now : timer.blockStart
	const worked = now - blockStart
	const minutes = Math.floor(worked / MINUTE)
	const isDue = worked >= POMODORO
	const alertedAt = timer.alertedAt ?? 0
	// Not once the person has been away a while: that may be the break already under way.
	const shouldAlert =
		isDue &&
		idle < AWAY &&
		(alertedAt < blockStart || now - alertedAt >= REPEAT)

	effects.push(
		{
			type: 'persist',
			timer: {
				blockStart,
				seenAt: now,
				alertedAt: shouldAlert ? now : alertedAt,
				lastInput,
			},
		},
		{
			type: 'show',
			label: `${tomato(settings, 'pomodoro ')}${text.count(minutes, POMODORO / MINUTE)}`,
			warning: isDue
				? `${tomato(settings)}${text.warning(minutes)}`
				: undefined,
		},
	)
	if (shouldAlert)
		effects.push({
			type: 'alert',
			text: text.alert(minutes, SHORT_BREAK / MINUTE),
			mark: tomato(settings),
			sound: settings.sound,
		})
	// One check-in per pomodoro that ends without a break, keyed by when that pomodoro ended.
	const due = isDue
		? {
				key: blockStart + Math.floor(worked / POMODORO) * POMODORO,
				text: check(minutes),
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
