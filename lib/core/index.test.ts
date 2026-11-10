import { expect, test } from 'bun:test'
import plugin from '../../packages/claude/.claude-plugin/plugin.json'
import {
	CHIME,
	type CheckIn,
	createInstance,
	DEFAULTS,
	type Host,
	LOCK,
	MINUTE,
	type Settings,
	settingsFrom,
	step,
	type TallyEntry,
	type Timer,
} from './index'
import { type Language, messages } from './messages'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * MINUTE
// 9:00 local time on the day after T0's, and `minutes` after it: the tally's days are local time.
const NINE = new Date(T0 + DAY).setHours(9, 0, 0, 0)
const nine = (minutes: number) => NINE + minutes * MINUTE

// Claude Code checks its settings against plugin.json, and both agents go through settingsFrom, which must agree.
test("plugin.json's defaults are settingsFrom's", () => {
	expect(
		Object.fromEntries(
			Object.entries(plugin.userConfig).map(([key, f]) => [key, f.default]),
		),
	).toEqual(DEFAULTS)
	expect(settingsFrom({})).toEqual(DEFAULTS)
})

// Claude Code's /config draws plugin.json's rows, which the plugin relabels in the person's language.
test("plugin.json's titles and descriptions are the English ones", () => {
	expect(
		Object.fromEntries(
			Object.entries(plugin.userConfig).map(([key, f]) => [
				key,
				{ label: f.title, description: f.description },
			]),
		),
	).toEqual(messages.en.settings)
})

test('settingsFrom names every value of the wrong kind, takes an empty one as left out, and ignores the keys of older versions', () => {
	expect(
		settingsFrom({
			workMinutes: 0,
			breakMinutes: '',
			moveSeconds: 'abc',
			checkIn: false,
			sound: false,
		}),
	).toEqual({ sound: false, emoji: true })
	expect(settingsFrom({ sound: 1, emoji: 'no' })).toEqual({
		problems: ['sound must be a boolean', 'emoji must be a boolean'],
	})
	for (const json of [[], null, 25])
		expect(settingsFrom(json)).toEqual({
			problems: ['the file must hold a JSON object'],
		})
	expect(settingsFrom({ sound: '' })).toEqual(DEFAULTS)
	expect(settingsFrom({ theme: 'dark' })).toEqual(DEFAULTS)
	// In the person's language, where it's known (Pi).
	expect(settingsFrom({ sound: 1 }, 'it')).toEqual({
		problems: ['sound deve essere true o false'],
	})
	expect(settingsFrom(null, 'de')).toEqual({
		problems: ['die Datei muss ein JSON-Objekt enthalten'],
	})
})

type Pending = { at: number; every?: number; fn: () => void }

// An agent in memory: a clock at T0, the store (open to the test, which ages it to stand for a stretch with no tick),
// ioreg reporting `idle(now)` (null: no ioreg) and whether the screen is `locked(now)`, a repository at /code/app, the
// agent's own alert, its toast, and what the host was asked to do.
function world({
	idle = () => 0,
	locked = () => false,
	seed = {},
}: {
	idle?: (now: number) => number | null
	locked?: (now: number) => boolean
	seed?: Record<string, unknown>
} = {}) {
	let now = T0
	// A Set iterates in the order of adding, so of two timers due at once the one set first fires first.
	const timers = new Set<Pending>()
	const schedule = (pending: Pending) => {
		timers.add(pending)
		return () => void timers.delete(pending)
	}
	const store: Record<string, unknown> = { ...seed }
	const runs: (readonly string[])[] = []
	const shows: { label: string; warning?: string }[] = []
	const notified: string[] = []
	const toasts: string[] = []
	const keeps: number[] = []
	const host: Host = {
		now: async () => now,
		after: (ms, fn) => schedule({ at: now + ms, fn }),
		every: (ms, fn) => schedule({ at: now + ms, every: ms, fn }),
		load: async (key) => store[key],
		save: async (key, value) => {
			store[key] = value
		},
		run: async (argv) => {
			runs.push(argv)
			if (argv[0] !== 'ioreg') return ''
			const ms = idle(now)
			if (ms === null) throw new Error('no ioreg')
			// Indented, as ioreg prints it.
			if (argv.join(' ') === LOCK.join(' '))
				return `  |   "IOConsoleLocked" = ${locked(now) ? 'Yes' : 'No'}\n`
			return `    |   "HIDIdleTime" = ${ms * 1e6}\n`
		},
		repo: async () => '/code/app',
		show: (label, warning) => {
			shows.push({ label, warning })
		},
		notify: async (text, mark) => {
			notified.push(`${mark}${text}`)
		},
		toast: (text) => {
			toasts.push(text)
		},
		keep: (kept) => {
			keeps.push(kept)
		},
	}

	// Moves the clock to `to`, firing each timer due on the way at its own time. Every call to the host resolves at
	// once, so what a timer started (a tick) is done by the next turn of the event loop.
	async function set(to: number) {
		for (;;) {
			await new Promise((resolve) => setImmediate(resolve))
			let next: Pending | undefined
			for (const pending of timers)
				if (pending.at <= to && (next === undefined || pending.at < next.at))
					next = pending
			if (next === undefined) break
			now = next.at
			timers.delete(next)
			if (next.every !== undefined) {
				next.at += next.every
				timers.add(next)
			}
			next.fn()
		}
		now = to
	}

	return {
		host,
		store,
		runs,
		shows,
		notified,
		toasts,
		keeps,
		now: () => now,
		set,
		advance: (ms: number) => set(now + ms),
		settle: () => set(now),
		// A sleeping Mac: the clock moves on, and every timer with it, firing nothing.
		sleep: (ms: number) => {
			now += ms
			for (const pending of timers) pending.at += ms
		},
		pending: () => timers.size,
		label: () => shows.at(-1)?.label,
	}
}

type World = ReturnType<typeof world>

// An instance on the world's host, started as in a terminal session.
function start(
	w: World,
	settings: Partial<Settings> = {},
	options: { remote?: boolean; kept?: unknown; language?: Language } = {},
) {
	const pomodoro = createInstance(w.host, {
		settings: { ...DEFAULTS, ...settings },
		remote: false,
		language: 'en',
		...options,
	})
	pomodoro.start()
	return pomodoro
}

// ioreg's idle time for input at each of `times`: since the latest at or before `now`, or since long before the first.
const inputs = (times: number[]) => (now: number) =>
	now - Math.max(T0 - DAY, ...times.filter((at) => at <= now))

// Input every 2 seconds from `from` to `to`, as in steady use.
const steady = (from: number, to: number) =>
	Array.from({ length: (to - from) / 2_000 + 1 }, (_, i) => from + i * 2_000)

// The chimes the alerts ran.
const sounds = (w: World) => w.runs.filter((argv) => argv[0] !== 'ioreg')

const texts = (checkIns: unknown) => (checkIns as CheckIn[]).map((c) => c.text)

// An instance 26 minutes into a pomodoro, which has given its check-in.
async function checkedIn(w: World) {
	const pomodoro = start(w)
	await w.advance(26 * MINUTE)
	expect(pomodoro.toolResult(true).checkIn).toBeDefined()
	return pomodoro
}

test('alerts when a pomodoro is up, then every 5 minutes while there is no break', async () => {
	const w = world()
	start(w)
	await w.advance(24 * MINUTE)
	expect(w.notified).toEqual([])
	await w.advance(MINUTE)
	expect(w.shows.at(-1)).toEqual({
		label: '🍅 2 of 4 · 0/25m',
		warning: '🍅 25m, time for a break',
	})
	await w.advance(5 * MINUTE)
	expect(w.notified).toEqual([
		'🍅 25 minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.',
		'🍅 30 minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.',
	])
	// Ghostty shows the banner of the tab in front for a few seconds only, and a Focus silences it: each alert also chimes.
	expect(sounds(w)).toEqual([CHIME, CHIME])
})

test('no chime when turned off', async () => {
	const w = world()
	start(w, { sound: false })
	await w.advance(25 * MINUTE)
	expect(w.notified.length).toBe(1)
	expect(sounds(w)).toEqual([])
})

test('a closed lid clears the status line: the pomodoro that starts on waking is not due', async () => {
	const w = world()
	start(w)
	await w.advance(25 * MINUTE)
	expect(w.shows.at(-1)?.warning).toBe('🍅 25m, time for a break')

	// Asleep for 10 minutes, and the keyboard was touched on waking: the pomodoro up before it counts.
	w.sleep(10 * MINUTE)
	await w.advance(MINUTE)
	expect(w.shows.at(-1)).toEqual({
		label: '🍅 2 of 4 · 0/25m',
		warning: undefined,
	})
})

test('a break of just 3 minutes counts, and no alert comes during it', async () => {
	const leftAt = T0 + 25 * MINUTE + 10_000
	const backAt = leftAt + 3 * MINUTE + 5_000
	const w = world({
		idle: (now) => (now >= leftAt && now < backAt ? now - leftAt : 0),
	})
	start(w)
	await w.advance(25 * MINUTE)
	expect(w.notified.length).toBe(1)

	await w.set(leftAt + 3 * MINUTE + 2_000)
	expect(w.label()).toBe('🍅 on a break')
	expect(w.notified.length).toBe(1)

	// Back at work: the second pomodoro of the set, alerting 25 minutes after the return.
	await w.set(T0 + 29 * MINUTE)
	expect(w.label()).toBe('🍅 2 of 4 · 0/25m')
	await w.advance(24 * MINUTE)
	expect(w.notified.length).toBe(1)
	await w.advance(MINUTE)
	expect(w.notified.length).toBe(2)
})

test('a gap with no tick (sleep, no session open) counts as a break', async () => {
	// The last tick a minute before keeps the pomodoro; one 3 minutes before is a gap.
	for (const [seenAgo, label] of [
		[MINUTE, '🍅 1 of 4 · 20/25m'],
		[3 * MINUTE, '🍅 1 of 4 · 0/25m'],
	] as const) {
		const w = world({
			seed: { timer: { blockStart: T0 - 20 * MINUTE, seenAt: T0 - seenAgo } },
		})
		start(w)
		await w.settle()
		expect(w.label()).toBe(label)
	}

	const w = world({
		seed: {
			timer: { blockStart: T0 - 180 * MINUTE, seenAt: T0 - 60 * MINUTE },
		},
	})
	start(w)
	await w.advance(MINUTE)
	expect(w.notified.length).toBe(0)
	await w.advance(24 * MINUTE)
	expect(w.notified.length).toBe(1)
})

// Away for just over 2 minutes, each tick asks for a wake at the moment the break would start, and replaces the wake
// before: once the minute's tick finds the break, one wake is left to run.
test("one wake is pending at most: the ticks don't pile up while a break is near", async () => {
	const w = world({ idle: inputs([T0 - 2 * MINUTE - 500]) })
	const pomodoro = start(w)
	await w.settle()
	for (let i = 0; i < 3; i++) {
		await w.advance(5_000)
		await pomodoro.tick()
	}
	// The minute's clock, the looks and one wake.
	expect(w.pending()).toBe(3)
	const before = w.shows.length
	await w.advance(MINUTE)
	expect(w.shows.length - before).toBe(2)
})

test('stop cancels the clock, the looks and the wake, and no tick runs after it', async () => {
	const w = world({ idle: () => 2 * MINUTE + 500 })
	const pomodoro = start(w)
	await w.settle()
	expect(w.pending()).toBe(3)
	pomodoro.stop()
	expect(w.pending()).toBe(0)
	const [shown, ran] = [w.shows.length, w.runs.length]
	await w.advance(10 * MINUTE)
	expect([w.shows.length, w.runs.length]).toEqual([shown, ran])

	// Stopped while its first tick is under way: that tick carries out nothing, so a session that took its place doesn't
	// see its count.
	const early = world({ idle: () => 2 * MINUTE + 500 })
	start(early).stop()
	await early.advance(10 * MINUTE)
	expect(early.shows.length).toBe(0)
	expect(early.store.timer).toBeUndefined()
	expect(early.pending()).toBe(0)
})

test('over SSH ioreg never runs: activity stands in, and 3 minutes without it is a break, 2 is not', async () => {
	const w = world()
	const pomodoro = start(w, {}, { remote: true })
	await w.settle()
	await pomodoro.activity(true)
	await w.advance(3 * MINUTE)
	expect(w.runs).toEqual([])
	// No activity before the first tick: nothing to say the person was there, nor how long they were away.
	expect(w.shows.map((show) => show.label)).toEqual([
		'🍅 on a break',
		'🍅 1 of 4 · 1/25m',
		'🍅 1 of 4 · 2/25m',
		'🍅 on a break',
	])
	expect(w.toasts).toEqual([])
})

test("one check-in per pomodoro, on a main-loop tool result, kept so that a reloaded instance gives only the next pomodoro's", async () => {
	const w = world()
	const pomodoro = start(w)
	await w.advance(26 * MINUTE)
	expect(pomodoro.toolResult(false)).toEqual({})
	expect(pomodoro.toolResult(true)).toEqual({
		checkIn: expect.stringContaining(
			'[Pomodoro] The user has been working for 26 minutes without a break.',
		),
		notice: '🍅 Pomodoro: told the agent your pomodoro is up.',
	})
	expect(pomodoro.toolResult(true)).toEqual({})
	expect(w.keeps).toEqual([T0 + 25 * MINUTE])

	// A reload (a /config change): the session's next instance gets what this one kept.
	pomodoro.stop()
	const reloaded = start(w, {}, { kept: w.keeps[0] })
	await w.settle()
	expect(reloaded.toolResult(true)).toEqual({})
	await w.advance(25 * MINUTE)
	expect(reloaded.toolResult(true).checkIn).toStartWith(
		'[Pomodoro] The user has been working for 51 minutes without a break.',
	)
	expect(w.keeps).toEqual([T0 + 25 * MINUTE, T0 + 50 * MINUTE])
})

const HEADS_UP =
	"[Pomodoro] The user's pomodoro ends in about 5 minutes. Bring the current step to a stopping point, and don't start anything big."

test('the heads-up comes once, 5 minutes before each pomodoro ends, on a main-loop tool result', async () => {
	const w = world()
	const pomodoro = start(w)
	await w.set(T0 + 19 * MINUTE)
	expect(pomodoro.toolResult(true)).toEqual({})
	await w.set(T0 + 20 * MINUTE + 30_000)
	expect(pomodoro.toolResult(false)).toEqual({})
	expect(pomodoro.toolResult(true)).toEqual({ headsUp: HEADS_UP })
	await w.set(T0 + 21 * MINUTE)
	expect(pomodoro.toolResult(true)).toEqual({})
	// The check-in when this pomodoro is up, then the next pomodoro's heads-up.
	await w.set(T0 + 26 * MINUTE)
	expect(pomodoro.toolResult(true).headsUp).toBeUndefined()
	await w.set(T0 + 45 * MINUTE + 30_000)
	expect(pomodoro.toolResult(true)).toEqual({ headsUp: HEADS_UP })

	// None while quiet.
	const quiet = world()
	const meeting = start(quiet)
	await quiet.set(T0 + 10 * MINUTE)
	await meeting.command('quiet')
	await quiet.set(T0 + 20 * MINUTE + 30_000)
	expect(meeting.toolResult(true)).toEqual({})
})

test('a break clears the check-in and the heads-up due', async () => {
	let leftAt = Infinity
	const w = world({ idle: (now) => (now >= leftAt ? now - leftAt : 0) })
	const pomodoro = start(w)
	await w.advance(26 * MINUTE)
	leftAt = w.now()
	await w.advance(6 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	expect(pomodoro.toolResult(true)).toEqual({})

	// Away from 20 minutes in, as the heads-up came due: on the break, none.
	const away = world({ idle: inputs(steady(T0, T0 + 20 * MINUTE)) })
	const resting = start(away)
	await away.set(T0 + 23 * MINUTE)
	expect(away.label()).toBe('🍅 on a break')
	expect(resting.toolResult(true)).toEqual({})
})

test("the check-in's summary is logged from the first reply that has one, until the turn ends", async () => {
	const w = world()
	const pomodoro = start(w)
	// No summary is awaited before the check-in.
	await pomodoro.reply('Pomodoro: early.')
	await w.advance(26 * MINUTE)
	expect(pomodoro.toolResult(true).checkIn).toBeDefined()
	await pomodoro.reply('Wrote a.txt.')
	await pomodoro.reply('Done.\n\nPomodoro: on the goal.')
	await pomodoro.reply('Pomodoro: again.')
	// Only the tool result that carries the check-in starts a wait.
	expect(pomodoro.toolResult(true)).toEqual({})
	await pomodoro.reply('Pomodoro: after another tool result.')
	expect(w.store.checkIns).toEqual([
		{ at: T0 + 26 * MINUTE, repo: '/code/app', text: 'Pomodoro: on the goal.' },
	])

	// The next pomodoro's check-in, in a turn that ends without its summary.
	await w.advance(25 * MINUTE)
	expect(pomodoro.toolResult(true).checkIn).toBeDefined()
	pomodoro.turnEnded()
	await pomodoro.reply('Pomodoro: the next turn.')
	expect(texts(w.store.checkIns)).toEqual(['Pomodoro: on the goal.'])
})

test('the summary is the first paragraph that starts with Pomodoro:, and nothing else is', async () => {
	const w = world()
	const pomodoro = await checkedIn(w)
	await pomodoro.reply('Done.\n\nThe pomodoro timer: unchanged.')
	await pomodoro.reply('Fixed the Pomodoro: label.')
	await pomodoro.reply(
		'Ran the tests.\n\n**Pomodoro:** on the goal, the parser is next.\nTake a break.\n\n Pomodoro: again.',
	)
	await w.advance(25 * MINUTE)
	expect(pomodoro.toolResult(true).checkIn).toBeDefined()
	await pomodoro.reply('## Pomodoro check-in: done so far.')
	expect(texts(w.store.checkIns)).toEqual([
		'Pomodoro: on the goal, the parser is next.\nTake a break.',
		'Pomodoro check-in: done so far.',
	])
})

test('a long summary is cut to 4,000 characters', async () => {
	const w = world()
	const pomodoro = await checkedIn(w)
	await pomodoro.reply(`Pomodoro: ${'x'.repeat(5_000)}`)
	expect(texts(w.store.checkIns)).toEqual([`Pomodoro: ${'x'.repeat(3_990)}`])
})

test("check-ins older than 14 days are dropped, and /pomodoro today lists only today's", async () => {
	const w = world({
		seed: {
			checkIns: [
				{ at: T0 - 14 * DAY, repo: '/code/app', text: 'Old.' },
				{ at: T0 - 2 * DAY, repo: null, text: 'Two days ago.' },
			],
		},
	})
	const pomodoro = await checkedIn(w)
	await pomodoro.reply('Pomodoro: today.')
	expect(texts(w.store.checkIns)).toEqual(['Two days ago.', 'Pomodoro: today.'])
	expect(await pomodoro.command('today')).toMatch(
		/^Today: 🍅 1 pomodoro \(yesterday 0\), 0 long breaks, 0 breaks skipped, longest 26m\n\d\d:\d\d {2}Pomodoro: today\.$/,
	)
})

test('/pomodoro today with nothing yet', async () => {
	const w = world()
	const pomodoro = start(w)
	for (const args of ['', ' today '])
		expect(await pomodoro.command(args)).toBe('Today: no pomodoros yet.')
})

test("/pomodoro lists this repository's check-ins of today under the day's count", async () => {
	const w = world()
	const pomodoro = start(w)
	w.store.checkIns = [
		{ at: T0 - 2 * DAY, repo: '/code/app', text: 'Two days ago.' },
		{ at: T0, repo: '/code/app', text: 'Pomodoro: on the goal.' },
		{ at: T0 + 1, repo: '/code/app', text: 'Line one.\nLine two.' },
		{ at: T0 + 2, repo: null, text: 'In no repository.' },
	]
	for (const args of ['', ' today '])
		expect(await pomodoro.command(args)).toMatch(
			/^Today: no pomodoros yet\.\n\d\d:\d\d {2}Pomodoro: on the goal\.\n\d\d:\d\d {2}Line one\.\n {7}Line two\.$/,
		)
})

// A world whose clock starts at `at`.
function worldAt(at: number, options: Parameters<typeof world>[0] = {}) {
	const w = world(options)
	w.sleep(at - T0)
	return w
}

test('the tally counts pomodoros, long breaks, skipped breaks and the longest stretch', async () => {
	// In use for 75 minutes, away for 4, in use for 26, away for 20, and in use again.
	const w = worldAt(NINE, {
		idle: inputs([
			...steady(nine(0), nine(75)),
			...steady(nine(79) + 10_000, nine(105) + 10_000),
			...steady(nine(125) + 20_000, nine(152)),
		]),
	})
	const pomodoro = start(w)
	await w.set(nine(152))
	expect(await pomodoro.command('today')).toBe(
		'Today: 🍅 5 pomodoros (yesterday 0), 1 long break, 2 breaks skipped, longest 75m',
	)
})

test('without the emoji, the count of the day has no tomato', async () => {
	const w = worldAt(NINE)
	const pomodoro = start(w, { emoji: false })
	await w.set(nine(26))
	expect(await pomodoro.command('today')).toBe(
		'Today: 1 pomodoro (yesterday 0), 0 long breaks, 0 breaks skipped, longest 26m',
	)
})

// The tally counts what the set counts: the pomodoro up while the person was already away doesn't.
test('a pomodoro cut short by a break is not in the tally', async () => {
	// In use for 23 minutes, away for 5, and in use again.
	const w = worldAt(NINE, {
		idle: inputs([
			...steady(nine(0), nine(23)),
			...steady(nine(28) + 10_000, nine(30)),
		]),
	})
	const pomodoro = start(w)
	await w.set(nine(30))
	expect(w.toasts).toEqual(['🍅 Back after 5m · pomodoro 1 of 4'])
	expect(await pomodoro.command('today')).toBe('Today: no pomodoros yet.')
})

// Each counts for the repository of the session with the latest activity when it ended.
test("/pomodoro today counts only this repository's, and lists only its summaries", async () => {
	const w = worldAt(NINE, {
		seed: {
			checkIns: [
				{ at: nine(26), repo: '/code/app', text: 'Pomodoro: in app.' },
				{ at: nine(51), repo: '/code/web', text: 'Pomodoro: in web.' },
			],
		},
	})
	const app = start(w)
	// Another session of the agent, in another repository, on the same store.
	const web = createInstance(
		{ ...w.host, repo: async () => '/code/web' },
		{ settings: DEFAULTS, remote: false, language: 'en' },
	)
	web.start()
	await w.settle()
	await app.activity(true)
	await w.set(nine(51))
	await web.activity(true)
	await w.set(nine(76))
	expect(await app.command('today')).toBe(
		'Today: 🍅 2 pomodoros (yesterday 0), 0 long breaks, 1 break skipped, longest 0m\n09:26  Pomodoro: in app.',
	)
	expect(await web.command('today')).toBe(
		'Today: 🍅 1 pomodoro (yesterday 0), 0 long breaks, 0 breaks skipped, longest 76m\n09:51  Pomodoro: in web.',
	)
})

// A stretch ends when the person leaves: the agent's work in another repository during the break doesn't take it.
test('a stretch and the break after it count for the repository in use before the break', async () => {
	// In use in app for 75 minutes, away for 20 while the agent works in web, and in use again.
	const w = worldAt(NINE, {
		idle: inputs([
			...steady(nine(0), nine(75)),
			...steady(nine(95) + 10_000, nine(97)),
		]),
	})
	const app = start(w)
	const web = createInstance(
		{ ...w.host, repo: async () => '/code/web' },
		{ settings: DEFAULTS, remote: false, language: 'en' },
	)
	web.start()
	await w.settle()
	await app.activity(true)
	await w.set(nine(85))
	expect(w.label()).toBe('🍅 on a break')
	await web.activity(true)
	await w.set(nine(97))
	expect(await app.command('today')).toBe(
		'Today: 🍅 3 pomodoros (yesterday 0), 1 long break, 2 breaks skipped, longest 75m',
	)
	expect(await web.command('today')).toBe('Today: no pomodoros yet.')
})

test("the night before the first pomodoro is no long break, and its stretch not the day's longest", async () => {
	// The evening before, in use from 20:00 to 20:50, then the lid closed for the night. In use from 8:00 to 8:45:30,
	// away for 20 minutes, and in use again.
	const evening = nine(-13 * 60)
	const w = worldAt(evening, {
		idle: inputs([
			...steady(evening, evening + 50 * MINUTE),
			...steady(nine(-60), nine(-15) + 30_000),
			...steady(nine(5) + 10_000, nine(31)),
		]),
	})
	const pomodoro = start(w)
	await w.set(evening + 50 * MINUTE)
	w.sleep(nine(-60) - w.now())
	await w.set(nine(31))
	expect(await pomodoro.command('today')).toBe(
		'Today: 🍅 2 pomodoros (yesterday 2), 1 long break, 0 breaks skipped, longest 45m',
	)
})

test('no back toast after the night, one after a break the same day', async () => {
	// The evening before, in use from 20:00 to 20:50, then the lid closed for the night. In use from 8:00 to 8:45:30,
	// away for 20 minutes, and in use again.
	const evening = nine(-13 * 60)
	const w = worldAt(evening, {
		idle: inputs([
			...steady(evening, evening + 50 * MINUTE),
			...steady(nine(-60), nine(-15) + 30_000),
			...steady(nine(5) + 10_000, nine(31)),
		]),
	})
	start(w)
	await w.set(evening + 50 * MINUTE)
	w.sleep(nine(-60) - w.now())
	await w.set(nine(-50))
	expect(w.toasts).toEqual([])
	await w.set(nine(31))
	expect(w.toasts).toEqual(['🍅 Back after 19m · new set, pomodoro 1 of 4'])
})

test('a pomodoro at 23:50 counts for that day', async () => {
	// From 23:25, in use for 27 minutes, then the lid closed for the night, and in use from 8:00.
	const late = nine(14 * 60 + 25)
	const morning = nine(23 * 60)
	const w = worldAt(late, {
		idle: inputs([
			...steady(late, late + 27 * MINUTE),
			...steady(morning, morning + 26 * MINUTE),
		]),
	})
	const pomodoro = start(w)
	await w.set(late + 27 * MINUTE)
	expect(await pomodoro.command('today')).toBe(
		'Today: 🍅 1 pomodoro (yesterday 0), 0 long breaks, 0 breaks skipped, longest 27m',
	)
	w.sleep(morning - w.now())
	await w.set(morning + 26 * MINUTE)
	expect(await pomodoro.command('today')).toBe(
		'Today: 🍅 1 pomodoro (yesterday 1), 0 long breaks, 0 breaks skipped, longest 25m',
	)
})

// The tick that ends the break counts it, as the set does.
test('a pomodoro up just before the lid closed counts, though no tick saw it', async () => {
	// 24 minutes 30 into a pomodoro, in use for 40 seconds more, then the lid closed for 10 minutes, and in use again.
	const blockStart = NINE - 24 * MINUTE - 30_000
	const w = worldAt(NINE, {
		idle: inputs([
			...steady(blockStart, NINE + 40_000),
			...steady(nine(10) + 40_000, nine(12)),
		]),
		seed: { timer: { blockStart, seenAt: NINE - 30_000, lastInput: NINE } },
	})
	const pomodoro = start(w)
	await w.set(NINE + 40_000)
	w.sleep(10 * MINUTE)
	await w.set(nine(12))
	expect(await pomodoro.command('today')).toBe(
		'Today: 🍅 1 pomodoro (yesterday 0), 0 long breaks, 0 breaks skipped, longest 25m',
	)
})

// The tick that counts a pomodoro stores the timer with it counted, and the one that ends a break without the break:
// the other session's has neither to add.
test('two sessions add each pomodoro and each break to the tally once', async () => {
	// In use for 25 minutes, away for 4, and in use again.
	const w = worldAt(NINE, {
		idle: inputs([
			...steady(nine(0), nine(25)),
			...steady(nine(29) + 10_000, nine(55)),
		]),
	})
	const sessions = [start(w), start(w)]
	await w.set(nine(55))
	expect(w.store.tally).toEqual([
		{ at: nine(25), repo: '/code/app', kind: 'pomodoro', run: NINE },
		{
			at: nine(29) + 10_000,
			repo: '/code/app',
			kind: 'break',
			ms: 4 * MINUTE + 10_000,
			runMs: 25 * MINUTE,
		},
		{
			at: nine(54) + 10_000,
			repo: '/code/app',
			kind: 'pomodoro',
			run: nine(29) + 10_000,
		},
	] satisfies TallyEntry[])
	for (const pomodoro of sessions)
		expect(await pomodoro.command('today')).toBe(
			'Today: 🍅 2 pomodoros (yesterday 0), 0 long breaks, 0 breaks skipped, longest 25m',
		)
})

test("yesterday's count is this repository's, and the tally keeps 14 days", async () => {
	const pomodoroAt = (at: number, repo = '/code/app'): TallyEntry => ({
		at,
		repo,
		kind: 'pomodoro',
		run: at - 25 * MINUTE,
	})
	const w = worldAt(NINE, {
		seed: {
			tally: [
				pomodoroAt(NINE - 14 * DAY),
				pomodoroAt(NINE - 2 * DAY),
				pomodoroAt(NINE - DAY),
				pomodoroAt(NINE - DAY + 25 * MINUTE),
				pomodoroAt(NINE - DAY, '/code/web'),
			],
		},
	})
	const pomodoro = start(w)
	await w.set(nine(26))
	expect(await pomodoro.command('today')).toBe(
		'Today: 🍅 1 pomodoro (yesterday 2), 0 long breaks, 0 breaks skipped, longest 26m',
	)
	expect((w.store.tally as TallyEntry[]).map((entry) => entry.at)).toEqual([
		NINE - 2 * DAY,
		NINE - DAY,
		NINE - DAY + 25 * MINUTE,
		NINE - DAY,
		nine(25),
	])
})

test('/pomodoro with anything else gives the usage', async () => {
	const w = world()
	const pomodoro = start(w)
	for (const args of ['yesterday', 'quiet now'])
		expect(await pomodoro.command(args)).toBe('Usage: /pomodoro [today|quiet]')
	expect((w.store.timer as Timer | undefined)?.quiet).toBeFalsy()
})

const QUIET_ON =
	'Quiet is on: no alerts or check-ins until you run /pomodoro quiet again, or lock the screen or close the lid for 3 minutes. The count goes on.'
const QUIET_OFF = 'Quiet is off.'

test('quiet keeps counting with no alert or check-in, and the alert comes as soon as it ends', async () => {
	const w = world()
	const pomodoro = start(w)
	await w.set(T0 + 20 * MINUTE)
	expect(await pomodoro.command('quiet')).toBe(QUIET_ON)
	expect(w.label()).toBe('🍅 quiet · 1 of 4 · 20/25m')
	await w.set(T0 + 60 * MINUTE)
	expect(w.notified).toEqual([])
	expect(pomodoro.toolResult(true)).toEqual({})
	expect(w.shows.at(-1)).toEqual({
		label: '🍅 quiet · 3 of 4 · 10/25m',
		warning: undefined,
	})
	// Off: a tick at once, which alerts and makes the check-in due.
	expect(await pomodoro.command(' quiet ')).toBe(QUIET_OFF)
	expect(w.notified).toEqual([
		'🍅 60 minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.',
	])
	expect(w.shows.at(-1)).toEqual({
		label: '🍅 3 of 4 · 10/25m',
		warning: '🍅 60m, time for a break',
	})
	expect(pomodoro.toolResult(true).checkIn).toBeDefined()
})

// Even when the last alert was a minute before quiet began.
test('the alert comes as soon as quiet ends, however soon after the last one', async () => {
	const w = world()
	const pomodoro = start(w)
	await w.set(T0 + 26 * MINUTE)
	await pomodoro.command('quiet')
	await w.set(T0 + 28 * MINUTE)
	await pomodoro.command('quiet')
	expect(w.notified.length).toBe(2)
})

test('while quiet, sitting still is no break, however long', async () => {
	// In use for a minute, then nothing from the person or the main agent.
	const w = world({ idle: inputs(steady(T0, T0 + MINUTE)) })
	const pomodoro = start(w)
	await w.set(T0 + MINUTE)
	await pomodoro.command('quiet')
	await w.set(T0 + 41 * MINUTE)
	expect(w.shows.map((show) => show.label)).not.toContain('🍅 on a break')
	expect(w.label()).toBe('🍅 quiet · 2 of 4 · 16/25m')
	// Once it's off, sitting still counts from then: the alert, and 3 minutes later a break.
	await pomodoro.command('quiet')
	expect(w.notified.length).toBe(1)
	await w.set(T0 + 43 * MINUTE)
	expect(w.label()).toBe('🍅 2 of 4 · 18/25m')
	await w.set(T0 + 44 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	expect((w.store.timer as Timer).breakStart).toBe(T0 + 41 * MINUTE)
})

test('locking the screen for 3 minutes ends quiet, a gap too', async () => {
	// In use for 5 minutes, then sitting still, and the screen locked from 10.
	const locked = world({
		idle: inputs(steady(T0, T0 + 5 * MINUTE)),
		locked: (now) => now >= T0 + 10 * MINUTE,
	})
	const pomodoro = start(locked)
	await locked.set(T0 + MINUTE)
	await pomodoro.command('quiet')
	await locked.set(T0 + 12 * MINUTE + 59_000)
	expect(locked.label()).toBe('🍅 quiet · 1 of 4 · 12/25m')
	await locked.set(T0 + 13 * MINUTE)
	expect(locked.label()).toBe('🍅 on a break')
	expect((locked.store.timer as Timer).quiet).toBeFalsy()

	// The lid closed at 5 minutes for 5, and in use again from when it opens: quiet stays off after the return.
	const gap = world({
		idle: inputs([
			...steady(T0, T0 + 5 * MINUTE),
			...steady(T0 + 10 * MINUTE, T0 + 15 * MINUTE),
		]),
	})
	const closed = start(gap)
	await gap.set(T0 + MINUTE)
	await closed.command('quiet')
	await gap.set(T0 + 5 * MINUTE)
	gap.sleep(5 * MINUTE)
	await gap.advance(10_000)
	expect(gap.label()).toBe('🍅 on a break')
	expect((gap.store.timer as Timer).quiet).toBeFalsy()
	await gap.advance(MINUTE)
	expect(gap.label()).toBe('🍅 1 of 4 · 0/25m')
})

// The last tick can come up to a minute before the lid closes: the time away runs from the session's own last look, so
// 2 minutes 30 seconds is no break wherever it falls in the minute, typing around it or sitting still with quiet on.
test('a lid closed for 2 minutes 30 seconds is no break, and quiet stays on', async () => {
	for (const closedAt of [5_000, 30_000, 50_000].map((s) => 10 * MINUTE + s))
		for (const [quiet, isTyping] of [
			[false, true],
			[true, true],
			[true, false],
		] as const) {
			const openedAt = T0 + closedAt + 150_000
			const w = world({
				idle: inputs(
					isTyping
						? [
								...steady(T0, T0 + closedAt),
								...steady(openedAt, T0 + 20 * MINUTE),
							]
						: steady(T0, T0 + MINUTE),
				),
			})
			const pomodoro = start(w)
			if (quiet) {
				await w.set(T0 + 2 * MINUTE)
				await pomodoro.command('quiet')
			}
			await w.set(T0 + closedAt)
			w.sleep(150_000)
			await w.set(T0 + 20 * MINUTE)
			// The ticks run 2 minutes 30 seconds later than before, the last at 19:30.
			expect(w.label()).toBe(`🍅 ${quiet ? 'quiet · ' : ''}1 of 4 · 19/25m`)
			expect(w.toasts).toEqual([])
			// No break in the tally, and no pomodoro up yet.
			expect(w.store.tally).toBeUndefined()
			expect((w.store.timer as Timer).quiet).toBe(quiet)
		}
})

// A keep-awake app's jiggler nudges the mouse each minute: seen by one look, it never counts.
test("a jiggler's nudge every minute neither holds off a break nor ends one", async () => {
	// In use to 29 minutes in, then only the nudge, 12 seconds into each minute, and in use again from 40.
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 29 * MINUTE),
			...Array.from({ length: 11 }, (_, i) => T0 + (29 + i) * MINUTE + 12_000),
			...steady(T0 + 40 * MINUTE, T0 + 45 * MINUTE),
		]),
	})
	start(w)
	await w.set(T0 + 33 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	await w.set(T0 + 39 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	// Back from the nudge at 39:12, which the looks of the return take in.
	await w.set(T0 + 41 * MINUTE)
	expect(w.label()).toBe('🍅 2 of 4 · 1/25m')
})

test('a stray key, or a click, never ends a break', async () => {
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			T0 + 14 * MINUTE,
			T0 + 14 * MINUTE + 30_000,
		]),
	})
	start(w)
	await w.set(T0 + 16 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

test('input seen in three looks within a minute counts', async () => {
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			T0 + 14 * MINUTE + 5_000,
			T0 + 14 * MINUTE + 15_000,
			T0 + 14 * MINUTE + 25_000,
		]),
	})
	start(w)
	await w.set(T0 + 14 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	await w.set(T0 + 15 * MINUTE)
	expect(w.label()).toBe('🍅 1 of 4 · 0/25m')
})

test('scrolling now and then while reading holds off a break', async () => {
	// A scroll every 20 seconds for 10 minutes.
	const w = world({
		idle: inputs(Array.from({ length: 31 }, (_, i) => T0 + i * 20_000)),
	})
	start(w)
	await w.set(T0 + 10 * MINUTE)
	expect(w.shows.map((show) => show.label)).not.toContain('🍅 on a break')
	expect(w.label()).toBe('🍅 1 of 4 · 10/25m')
})

test("an input every 30 seconds doesn't hold off a break", async () => {
	// One press every 30 seconds, as when answering the agent's prompts or paging through a diff.
	const w = world({
		idle: inputs(Array.from({ length: 17 }, (_, i) => T0 + i * 30_000)),
	})
	start(w)
	await w.set(T0 + 2 * MINUTE)
	expect(w.label()).toBe('🍅 1 of 4 · 2/25m')
	await w.set(T0 + 8 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

test('3 minutes away is a break, 2 minutes 59 is not', async () => {
	// In use to 10 minutes in.
	const w = world({ idle: inputs(steady(T0, T0 + 10 * MINUTE)) })
	const pomodoro = start(w)
	await w.set(T0 + 12 * MINUTE + 59_000)
	await pomodoro.tick()
	expect(w.label()).toBe('🍅 1 of 4 · 12/25m')
	await w.set(T0 + 13 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

// Input counts only once three looks have seen it, so the tick at 3 minutes can find a break the person came back from
// just before: less than 3 minutes away, the stretch goes on.
test('2 minutes 40 seconds away is no break, though the input after it counts only later', async () => {
	// In use to 10 minutes in, away for 2 minutes 40 seconds, then in use again.
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			...steady(T0 + 12 * MINUTE + 40_000, T0 + 30 * MINUTE),
		]),
	})
	start(w)
	await w.set(T0 + 30 * MINUTE)
	expect(w.label()).toBe('🍅 2 of 4 · 5/25m')
	expect(w.toasts).toEqual([])
	expect((w.store.tally as TallyEntry[]).map((entry) => entry.kind)).toEqual([
		'pomodoro',
	])
})

// Another session's input can end this one's break before its own looks see the return: what it read at the last
// return is never taken for this one.
test('a break forgets when the person came back from the last one', () => {
	type State = Parameters<typeof step>[0]
	type Event = Parameters<typeof step>[1]
	let state: State = { lastActivity: 0, looks: [], awaitingSummary: false }
	const feed = (...events: Event[]) => {
		for (const event of events) state = step(state, event, DEFAULTS, 'en').state
	}
	// Input that counts to 30 seconds in, then a break.
	const look = (at: number) => ({ type: 'look', now: at, idleMs: 0 }) as const
	const tick = (at: number) =>
		({ type: 'tick', now: at, timer: {}, isLocked: false, awakeAt: 0 }) as const
	feed(...[0, 10, 20, 30].map((s) => look(T0 + s * 1_000)))
	feed(tick(T0 + 3.5 * MINUTE))
	expect(state.backAt).toBeUndefined()
	// Back 4 minutes in, from the first of three looks that saw input.
	feed(...[240, 250, 260].map((s) => look(T0 + s * 1_000)))
	expect(state.backAt).toBe(T0 + 4 * MINUTE)
	// Away again: the next break forgets that return.
	feed(tick(T0 + 4.5 * MINUTE), tick(T0 + 7.5 * MINUTE))
	expect(state.backAt).toBeUndefined()
})

test("a reload while the person is away doesn't end their break", async () => {
	// 26 minutes into a pomodoro, last input 2 minutes ago: the first look says so, and counts at once.
	const leftAt = T0 - 2 * MINUTE
	const w = world({
		idle: inputs([leftAt]),
		seed: {
			timer: {
				blockStart: T0 - 26 * MINUTE,
				seenAt: T0 - 30_000,
				lastInput: leftAt,
			},
		},
	})
	start(w)
	await w.set(T0 + 2 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

test('without ioreg, a break is a break from every session', async () => {
	// Another session was in use 10 seconds ago, 20 minutes into a pomodoro: a fresh session keeps that pomodoro.
	const w = world({
		idle: () => null,
		seed: {
			timer: {
				blockStart: T0 - 20 * MINUTE,
				seenAt: T0 - 30_000,
				lastInput: T0 - 10_000,
			},
		},
	})
	const pomodoro = start(w)
	await w.settle()
	expect(w.label()).toBe('🍅 1 of 4 · 20/25m')

	for (let i = 0; i < 5; i++) {
		await pomodoro.activity(true)
		await w.advance(MINUTE)
	}
	expect(w.notified.length).toBe(1)

	// 2 minutes without activity is no break, 3 are.
	await w.advance(MINUTE)
	expect(w.label()).toBe('🍅 2 of 4 · 1/25m')
	await w.advance(MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

test('no alert while the screen is locked', async () => {
	const lockedAt = T0 + 24 * MINUTE + 30_000
	const w = world({
		idle: inputs(steady(T0, lockedAt)),
		locked: (now) => now >= lockedAt,
	})
	start(w)
	await w.set(T0 + 27 * MINUTE)
	expect(w.notified).toEqual([])
})

test('a short lock is nothing, a lock of 3 minutes is a break', async () => {
	// Locked from 10:00 to 10:40, in use around it, and locked again from 12:00.
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			...steady(T0 + 10 * MINUTE + 40_000, T0 + 12 * MINUTE),
		]),
		locked: (now) =>
			(now >= T0 + 10 * MINUTE && now < T0 + 10 * MINUTE + 40_000) ||
			now >= T0 + 12 * MINUTE,
	})
	start(w)
	await w.set(T0 + 12 * MINUTE)
	expect(w.label()).toBe('🍅 1 of 4 · 12/25m')
	await w.set(T0 + 15 * MINUTE + 30_000)
	expect(w.label()).toBe('🍅 on a break')
})

test("typing the password after a lock doesn't end the break", async () => {
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			...[51, 52, 53, 54, 55].map((s) => T0 + 14 * MINUTE + s * 1_000),
		]),
		locked: (now) => now >= T0 + 10 * MINUTE && now < T0 + 14 * MINUTE + 50_000,
	})
	start(w)
	await w.set(T0 + 16 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

// Under the lock screen the main agent may still work, and keys (a fumbled password, a jiggler) still reach ioreg.
test("while the screen is locked, neither input nor the main agent's work holds off a break or ends one", async () => {
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			...steady(T0 + 13 * MINUTE + 30_000, T0 + 14 * MINUTE),
		]),
		locked: (now) => now >= T0 + 10 * MINUTE && now < T0 + 15 * MINUTE,
	})
	const pomodoro = start(w)
	for (let at = T0 + 10 * MINUTE; at <= T0 + 15 * MINUTE; at += 30_000) {
		await w.set(at)
		await pomodoro.activity(true)
	}
	expect(w.label()).toBe('🍅 on a break')
})

test("a check-in due before the Mac slept isn't sent after it wakes", async () => {
	const w = world()
	const pomodoro = start(w)
	await w.set(T0 + 26 * MINUTE)
	expect(w.shows.at(-1)?.warning).toBe('🍅 26m, time for a break')
	// Asleep for an hour: on waking, a tool call comes before the minute's tick.
	w.sleep(60 * MINUTE)
	await pomodoro.activity(true)
	expect(pomodoro.toolResult(true)).toEqual({})
	expect(w.label()).toBe('🍅 on a break')
})

test('watching the main agent work is no break', async () => {
	const w = world({ idle: inputs(steady(T0, T0 + 10 * MINUTE)) })
	const pomodoro = start(w)
	for (let at = T0 + 12 * MINUTE; at <= T0 + 30 * MINUTE; at += 2 * MINUTE) {
		await w.set(at)
		await pomodoro.activity(true)
	}
	expect(w.shows.map((show) => show.label)).not.toContain('🍅 on a break')
	expect(w.label()).toBe('🍅 2 of 4 · 5/25m')
	expect(w.notified[0]).toStartWith('🍅 25 minutes without a break.')
})

test("a subagent's work is no presence", async () => {
	const w = world({ idle: inputs(steady(T0, T0 + 10 * MINUTE)) })
	const pomodoro = start(w)
	for (
		let at = T0 + 10 * MINUTE;
		at <= T0 + 13 * MINUTE + 30_000;
		at += 30_000
	) {
		await w.set(at)
		await pomodoro.activity(false)
	}
	expect(w.label()).toBe('🍅 on a break')
})

test('3 minutes with nothing from the person or the main agent is a break, mid-turn too', async () => {
	const w = world({ idle: inputs(steady(T0, T0 + 10 * MINUTE)) })
	const pomodoro = start(w)
	await w.set(T0 + 12 * MINUTE)
	await pomodoro.activity(true)
	await w.set(T0 + 14 * MINUTE + 59_000)
	expect(w.label()).toBe('🍅 1 of 4 · 14/25m')
	await w.set(T0 + 15 * MINUTE + 30_000)
	expect(w.label()).toBe('🍅 on a break')
})

test("a break's length counts from the person's own last input", async () => {
	// In use to 10 minutes in, watching the main agent to 20, and back at 32: 22 minutes away.
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			...steady(T0 + 32 * MINUTE, T0 + 35 * MINUTE),
		]),
	})
	const pomodoro = start(w)
	for (let at = T0 + 11 * MINUTE; at <= T0 + 20 * MINUTE; at += MINUTE) {
		await w.set(at)
		await pomodoro.activity(true)
	}
	await w.set(T0 + 22 * MINUTE + 59_000)
	expect(w.label()).toBe('🍅 1 of 4 · 22/25m')
	await w.set(T0 + 32 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	expect((w.store.timer as Timer).breakStart).toBe(T0 + 10 * MINUTE)
	await w.set(T0 + 33 * MINUTE)
	expect(w.label()).toBe('🍅 1 of 4 · 1/25m')
})

// A reload's first look counts at once, a stray key 5 minutes ago too: the break goes on from when it began.
test('a break keeps its start through a reload', async () => {
	const w = world({
		idle: inputs([T0 - 20 * MINUTE, T0 - 5 * MINUTE]),
		seed: {
			timer: {
				seenAt: T0 - 30_000,
				lastInput: T0 - 20 * MINUTE,
				breakStart: T0 - 20 * MINUTE,
			},
		},
	})
	start(w)
	await w.settle()
	expect(w.label()).toBe('🍅 on a break')
	expect((w.store.timer as Timer).breakStart).toBe(T0 - 20 * MINUTE)
})

// The tick that first sees the screen unlocked, the minute's or the wake at the 3-minute mark, comes after the input
// that followed the lock: that input counts from there.
test('a lock of under 3 minutes is no break when the person is back right after it', async () => {
	for (const [from, to] of [
		[10 * MINUTE + 5_000, 12 * MINUTE + 5_000],
		// Only the wake at 13:31 sees this one end.
		[10 * MINUTE + 30_000, 13 * MINUTE + 5_000],
	] as const) {
		const w = world({
			idle: inputs([
				...steady(T0, T0 + from),
				...steady(T0 + to, T0 + 16 * MINUTE + 5_000),
			]),
			locked: (now) => now >= T0 + from && now < T0 + to,
		})
		start(w)
		await w.set(T0 + 16 * MINUTE)
		expect(w.shows.map((show) => show.label)).not.toContain('🍅 on a break')
		expect(w.label()).toBe('🍅 1 of 4 · 16/25m')
	}
})

test("a prompt is the person's own input: it ends a break", async () => {
	// In use to 10 minutes in, then a 4-second prompt at 14, and only the main agent after it.
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 10 * MINUTE),
			...steady(T0 + 13 * MINUTE + 56_000, T0 + 14 * MINUTE),
		]),
	})
	const pomodoro = start(w)
	await w.set(T0 + 14 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	expect((w.store.timer as Timer).breakStart).toBe(T0 + 10 * MINUTE)
	await pomodoro.activity(true, true)
	for (
		let at = T0 + 14 * MINUTE + 30_000;
		at <= T0 + 15 * MINUTE;
		at += 30_000
	) {
		await w.set(at)
		await pomodoro.activity(true)
	}
	// Back at the prompt.
	expect(w.label()).toBe('🍅 1 of 4 · 1/25m')
	const timer = w.store.timer as Timer
	expect(timer.lastInput).toBe(T0 + 14 * MINUTE)
	expect(timer.breakStart).toBeUndefined()
})

test('the count shows the pomodoro under way and the minutes into it', async () => {
	const w = world()
	start(w)
	await w.set(T0 + 12 * MINUTE)
	expect(w.label()).toBe('🍅 1 of 4 · 12/25m')
	// 52 minutes straight: two pomodoros, and 2 minutes into the third.
	await w.set(T0 + 52 * MINUTE)
	expect(w.shows.at(-1)).toEqual({
		label: '🍅 3 of 4 · 2/25m',
		warning: '🍅 52m, time for a break',
	})
})

// Each return below comes 10 seconds into a minute, so the minute's tick after it is the first of the new pomodoro.
test("a pomodoro cut short doesn't count", async () => {
	// In use for 20 minutes, then away for 4.
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 20 * MINUTE),
			...steady(T0 + 24 * MINUTE + 10_000, T0 + 30 * MINUTE),
		]),
	})
	start(w)
	await w.set(T0 + 24 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	await w.set(T0 + 25 * MINUTE)
	expect(w.label()).toBe('🍅 1 of 4 · 0/25m')
})

test('a short break keeps the set, 15 minutes away starts a new one', async () => {
	for (const [away, label] of [
		[4, '🍅 2 of 4 · 0/25m'],
		[10, '🍅 2 of 4 · 0/25m'],
		[16, '🍅 1 of 4 · 0/25m'],
	] as const) {
		// In use for 25 minutes, then away.
		const backAt = T0 + (25 + away) * MINUTE + 10_000
		const w = world({
			idle: inputs([
				...steady(T0, T0 + 25 * MINUTE),
				...steady(backAt, backAt + 5 * MINUTE),
			]),
		})
		start(w)
		await w.set(backAt - 10_000)
		expect(w.label()).toBe('🍅 on a break')
		await w.set(backAt + 50_000)
		expect(w.label()).toBe(label)
	}
})

test("after the fourth the alert asks for the long break, and a short break doesn't end the set", async () => {
	// Rounds of 30 minutes, in use for 26 and away for 4; after the fifth, away for 15.
	const at = (minutes: number) => T0 + minutes * MINUTE
	const w = world({
		idle: inputs([
			...steady(at(0), at(26)),
			...[1, 2, 3, 4].flatMap((round) =>
				steady(at(30 * round) + 10_000, at(30 * round + 26)),
			),
			...steady(at(161) + 10_000, at(165)),
		]),
	})
	start(w)
	const short =
		'🍅 25 minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.'
	const long =
		'🍅 25 minutes without a break. Your set of 4 pomodoros is done: take a 15 to 30 minute break.'
	await w.set(at(116))
	expect(w.notified).toEqual([short, short, short, long])
	expect(w.shows.at(-1)?.warning).toBe('🍅 25m, time for a long break')
	await w.set(at(121))
	expect(w.label()).toBe('🍅 5 of 4 · 0/25m')
	await w.set(at(146))
	expect(w.notified).toEqual([short, short, short, long, long])
	await w.set(at(162))
	expect(w.label()).toBe('🍅 1 of 4 · 0/25m')
})

test('a closed lid for 15 minutes or more is a long break', async () => {
	for (const [closed, label] of [
		[20, '🍅 1 of 4 · 0/25m'],
		[5, '🍅 2 of 4 · 0/25m'],
	] as const) {
		// In use for 30 minutes, then the lid closed, and in use again from when it opens.
		const openedAt = T0 + (30 + closed) * MINUTE
		const w = world({
			idle: inputs([
				...steady(T0, T0 + 30 * MINUTE),
				...steady(openedAt, openedAt + 5 * MINUTE),
			]),
		})
		start(w)
		await w.set(T0 + 30 * MINUTE)
		expect(w.label()).toBe('🍅 2 of 4 · 5/25m')
		w.sleep(closed * MINUTE)
		await w.advance(MINUTE)
		expect(w.label()).toBe(label)
	}
})

// The minute's tick comes up to a minute after waking, and three looks of the input after it count in 20 seconds; the
// break still begins at the last input before the lid closed.
test('a lid closed right after a pomodoro keeps it, and under 15 minutes keeps the set', async () => {
	for (const [closedAt, closed] of [
		[25 * MINUTE + 10_000, 5],
		[30 * MINUTE + 10_000, 14.5],
	] as const) {
		const openedAt = T0 + closedAt + closed * MINUTE
		const w = world({
			idle: inputs([
				...steady(T0, T0 + closedAt),
				...steady(openedAt, openedAt + 5 * MINUTE),
			]),
		})
		start(w)
		await w.set(T0 + closedAt)
		w.sleep(closed * MINUTE)
		await w.advance(MINUTE)
		expect(w.label()).toBe('🍅 2 of 4 · 0/25m')
	}
})

test('no session open for 15 minutes or more is a long break', async () => {
	for (const [gap, label] of [
		[20, '🍅 1 of 4 · 0/25m'],
		[5, '🍅 3 of 4 · 0/25m'],
	] as const) {
		// One pomodoro of the set done, and 45 minutes into the next stretch when the last session closed.
		const closedAt = T0 - gap * MINUTE
		const w = world({
			seed: {
				timer: {
					blockStart: closedAt - 45 * MINUTE,
					done: 1,
					seenAt: closedAt,
					lastInput: closedAt,
				},
			},
		})
		start(w)
		await w.settle()
		expect(w.label()).toBe(label)
	}
})

test('the check-in at the end of a set asks for the long break', async () => {
	const w = world()
	const pomodoro = start(w)
	await w.set(T0 + 26 * MINUTE)
	expect(pomodoro.toolResult(true).checkIn).toEndWith(
		'Remind them to take a break.',
	)
	// 100 minutes straight: four pomodoros.
	await w.set(T0 + 101 * MINUTE)
	expect(pomodoro.toolResult(true).checkIn).toEndWith(
		'Remind them to take a 15 to 30 minute break: their set of 4 pomodoros is done.',
	)
})

test('a timer stored by 0.6 still loads', async () => {
	const w = world({
		seed: {
			timer: {
				blockStart: T0 - 10 * MINUTE,
				seenAt: T0,
				alertedAt: 0,
				lastInput: T0,
			},
		},
	})
	start(w)
	await w.settle()
	expect(w.label()).toBe('🍅 1 of 4 · 10/25m')
})

// A return read before the break began (a stray look, another session's) isn't this break's, and a break found before
// any activity (at 0, off macOS) began long ago: either way, 20 minutes or more away from a set two pomodoros in.
test('the return is never before the break began, and a break from 0 is a long one', () => {
	const now = T0 + 20 * MINUTE
	for (const [backAt, breakStart] of [
		[T0 - MINUTE, T0],
		[undefined, 0],
	] as const) {
		const { effects } = step(
			{
				lastActivity: 0,
				looks: [],
				awaitingSummary: false,
				lastInputThatCounts: now - 10_000,
				backAt,
			},
			{
				type: 'tick',
				now,
				timer: {
					blockStart: T0 - 30 * MINUTE,
					done: 1,
					seenAt: now - MINUTE,
					lastInput: breakStart,
					breakStart,
				},
				isLocked: false,
				awakeAt: now - MINUTE,
			},
			DEFAULTS,
			'en',
		)
		expect(effects).toContainEqual({
			type: 'show',
			label: '🍅 1 of 4 · 0/25m',
			warning: undefined,
		})
	}
})

// In use for 25 minutes, then away for `away` minutes and back `into` the minute after, in `sessions` sessions of one
// agent: the toasts by 3 minutes after the return.
async function toastsAfter(
	away: number,
	{
		into = 10_000,
		settings = {},
		sessions = 1,
	}: { into?: number; settings?: Partial<Settings>; sessions?: number } = {},
) {
	const backAt = T0 + (25 + away) * MINUTE + into
	const w = world({
		idle: inputs([
			...steady(T0, T0 + 25 * MINUTE),
			...steady(backAt, backAt + 5 * MINUTE),
		]),
	})
	for (let i = 0; i < sessions; i++) start(w, settings)
	await w.set(backAt + 3 * MINUTE)
	return w.toasts
}

// Whole minutes away, rounded down as the count's are: back 10 or 50 seconds into the fifth minute is 4.
test('coming back from a short break, a toast says how long and which pomodoro', async () => {
	for (const into of [10_000, 50_000])
		expect(await toastsAfter(4, { into })).toEqual([
			'🍅 Back after 4m · pomodoro 2 of 4',
		])
})

test('coming back from a long break, the toast says a new set begins', async () => {
	expect(await toastsAfter(22)).toEqual([
		'🍅 Back after 22m · new set, pomodoro 1 of 4',
	])
})

// The word is the product's name, in every language.
test('without the emoji, the footer says pomodoro in Russian and Chinese too', async () => {
	for (const [language, label] of [
		['ru', 'pomodoro 1 из 4 · 1/25 мин'],
		['zh', 'pomodoro 1/4 · 1/25分钟'],
	] as const) {
		const w = world()
		start(w, { emoji: false }, { language })
		await w.advance(MINUTE)
		expect(w.label()).toBe(label)
	}
})

test('without the emoji, the toast has no tomato', async () => {
	expect(await toastsAfter(4, { settings: { emoji: false } })).toEqual([
		'Back after 4m · pomodoro 2 of 4',
	])
})

// The tick that ends the break stores the timer without it, so the other session's tick has none to end.
test('two sessions, one toast', async () => {
	expect(await toastsAfter(4, { sessions: 2 })).toEqual([
		'🍅 Back after 4m · pomodoro 2 of 4',
	])
})
