import { expect, test } from 'bun:test'
import plugin from '../../packages/claude/.claude-plugin/plugin.json'
import {
	CHIME,
	type CheckIn,
	createInstance,
	DEFAULTS,
	type Host,
	MINUTE,
	type Settings,
	settingsFrom,
} from './index'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * MINUTE

// Claude Code checks its settings against plugin.json, and both agents go through settingsFrom, which must agree.
test("plugin.json's defaults are settingsFrom's", () => {
	expect(
		Object.fromEntries(
			Object.entries(plugin.userConfig).map(([key, f]) => [key, f.default]),
		),
	).toEqual(DEFAULTS)
	expect(settingsFrom({})).toEqual(DEFAULTS)
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
})

type Pending = { at: number; every?: number; fn: () => void }

// An agent in memory: a clock at T0, the store (open to the test, which ages it to stand for a stretch with no tick),
// ioreg reporting `idle(now)` (null: no ioreg), a repository at /code/app, the agent's own alert, and what the host was
// asked to do.
function world({
	idle = () => 0,
	seed = {},
}: {
	idle?: (now: number) => number | null
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
			return `    |   "HIDIdleTime" = ${ms * 1e6}\n`
		},
		repo: async () => '/code/app',
		show: (label, warning) => {
			shows.push({ label, warning })
		},
		notify: async (text, mark) => {
			notified.push(`${mark}${text}`)
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
		keeps,
		now: () => now,
		set,
		advance: (ms: number) => set(now + ms),
		settle: () => set(now),
		pending: () => timers.size,
		label: () => shows.at(-1)?.label,
	}
}

type World = ReturnType<typeof world>

// An instance on the world's host, started as in a terminal session.
function start(
	w: World,
	settings: Partial<Settings> = {},
	options: { remote?: boolean; kept?: unknown } = {},
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
	expect(pomodoro.toolResult(true)).toBeDefined()
	return pomodoro
}

test('alerts when a pomodoro is up, then every break length while there is no break', async () => {
	const w = world()
	start(w)
	await w.advance(24 * MINUTE)
	expect(w.notified).toEqual([])
	await w.advance(MINUTE)
	expect(w.shows.at(-1)).toEqual({
		label: '🍅 25/25m',
		warning: '🍅 25m, time for a break',
	})
	await w.advance(5 * MINUTE)
	expect(w.notified).toEqual([
		'🍅 25 minutes without a break. Stand up and look away from the screen for 3.',
		'🍅 30 minutes without a break. Stand up and look away from the screen for 3.',
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

	// Asleep for 10 minutes, so no tick ran, and the keyboard was touched on waking.
	w.store.timer = {
		...(w.store.timer as object),
		seenAt: w.now() - 10 * MINUTE,
	}
	await w.advance(MINUTE)
	expect(w.shows.at(-1)).toEqual({ label: '🍅 0/25m', warning: undefined })
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

	// Back at work: a fresh pomodoro, alerting 25 minutes after its first tick.
	await w.set(T0 + 29 * MINUTE)
	expect(w.label()).toBe('🍅 0/25m')
	await w.advance(24 * MINUTE)
	expect(w.notified.length).toBe(1)
	await w.advance(MINUTE)
	expect(w.notified.length).toBe(2)
})

test('a gap with no tick (sleep, no session open) counts as a break', async () => {
	// The last tick a minute before keeps the pomodoro; one 3 minutes before is a gap.
	for (const [seenAgo, label] of [
		[MINUTE, '🍅 20/25m'],
		[3 * MINUTE, '🍅 0/25m'],
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
	await pomodoro.activity()
	await w.advance(3 * MINUTE)
	expect(w.runs).toEqual([])
	// No activity before the first tick: nothing to say the person was there.
	expect(w.shows.map((show) => show.label)).toEqual([
		'🍅 on a break',
		'🍅 0/25m',
		'🍅 1/25m',
		'🍅 on a break',
	])
})

test("one check-in per pomodoro, on a main-loop tool result, kept so that a reloaded instance gives only the next pomodoro's", async () => {
	const w = world()
	const pomodoro = start(w)
	await w.advance(26 * MINUTE)
	expect(pomodoro.toolResult(false)).toBeUndefined()
	expect(pomodoro.toolResult(true)).toStartWith(
		'[Pomodoro] The user has been working for 26 minutes without a break.',
	)
	expect(pomodoro.toolResult(true)).toBeUndefined()
	expect(w.keeps).toEqual([T0 + 25 * MINUTE])

	// A reload (a /config change): the session's next instance gets what this one kept.
	pomodoro.stop()
	const reloaded = start(w, {}, { kept: w.keeps[0] })
	await w.settle()
	expect(reloaded.toolResult(true)).toBeUndefined()
	await w.advance(25 * MINUTE)
	expect(reloaded.toolResult(true)).toStartWith(
		'[Pomodoro] The user has been working for 51 minutes without a break.',
	)
	expect(w.keeps).toEqual([T0 + 25 * MINUTE, T0 + 50 * MINUTE])
})

test('a break clears the check-in due', async () => {
	let leftAt = Infinity
	const w = world({ idle: (now) => (now >= leftAt ? now - leftAt : 0) })
	const pomodoro = start(w)
	await w.advance(26 * MINUTE)
	leftAt = w.now()
	await w.advance(6 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
	expect(pomodoro.toolResult(true)).toBeUndefined()
})

test("the check-in's summary is logged from the first reply that has one, until the turn ends", async () => {
	const w = world()
	const pomodoro = start(w)
	// No summary is awaited before the check-in.
	await pomodoro.reply('Pomodoro: early.')
	await w.advance(26 * MINUTE)
	expect(pomodoro.toolResult(true)).toBeDefined()
	await pomodoro.reply('Wrote a.txt.')
	await pomodoro.reply('Done.\n\nPomodoro: on the goal.')
	await pomodoro.reply('Pomodoro: again.')
	// Only the tool result that carries the check-in starts a wait.
	expect(pomodoro.toolResult(true)).toBeUndefined()
	await pomodoro.reply('Pomodoro: after another tool result.')
	expect(w.store.checkIns).toEqual([
		{ at: T0 + 26 * MINUTE, repo: '/code/app', text: 'Pomodoro: on the goal.' },
	])

	// The next pomodoro's check-in, in a turn that ends without its summary.
	await w.advance(25 * MINUTE)
	expect(pomodoro.toolResult(true)).toBeDefined()
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
	expect(pomodoro.toolResult(true)).toBeDefined()
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
		/^app\n {2}\d\d:\d\d {2}Pomodoro: today\.$/,
	)
})

test("/pomodoro lists today's check-ins by repository, and gives its usage for anything but today", async () => {
	const w = world()
	const pomodoro = start(w)
	for (const args of ['', ' today '])
		expect(await pomodoro.command(args)).toBe('No check-ins today.')
	w.store.checkIns = [
		{ at: T0 - 2 * DAY, repo: null, text: 'Two days ago.' },
		{ at: T0, repo: '/code/app', text: 'Pomodoro: on the goal.' },
		{ at: T0 + 1, repo: null, text: 'Line one.\nLine two.' },
	]
	for (const args of ['', ' today '])
		expect(await pomodoro.command(args)).toMatch(
			/^app\n {2}\d\d:\d\d {2}Pomodoro: on the goal\.\n\nno repository\n {2}\d\d:\d\d {2}Line one\.\n {9}Line two\.$/,
		)
	expect(await pomodoro.command('yesterday')).toBe('Usage: /pomodoro [today]')
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
	await w.set(T0 + 41 * MINUTE)
	expect(w.label()).toBe('🍅 0/25m')
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
	expect(w.label()).toBe('🍅 0/25m')
})

test('scrolling now and then while reading holds off a break', async () => {
	// A scroll every 20 seconds for 10 minutes.
	const w = world({
		idle: inputs(Array.from({ length: 31 }, (_, i) => T0 + i * 20_000)),
	})
	start(w)
	await w.set(T0 + 10 * MINUTE)
	expect(w.shows.map((show) => show.label)).not.toContain('🍅 on a break')
	expect(w.label()).toBe('🍅 10/25m')
})

test("an input every 30 seconds doesn't hold off a break", async () => {
	// One press every 30 seconds, as when answering the agent's prompts or paging through a diff.
	const w = world({
		idle: inputs(Array.from({ length: 17 }, (_, i) => T0 + i * 30_000)),
	})
	start(w)
	await w.set(T0 + 2 * MINUTE)
	expect(w.label()).toBe('🍅 2/25m')
	await w.set(T0 + 8 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})

test('3 minutes away is a break, 2 minutes 59 is not', async () => {
	// In use to 10 minutes in.
	const w = world({ idle: inputs(steady(T0, T0 + 10 * MINUTE)) })
	const pomodoro = start(w)
	await w.set(T0 + 12 * MINUTE + 59_000)
	await pomodoro.tick()
	expect(w.label()).toBe('🍅 12/25m')
	await w.set(T0 + 13 * MINUTE)
	expect(w.label()).toBe('🍅 on a break')
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
	expect(w.label()).toBe('🍅 20/25m')

	for (let i = 0; i < 5; i++) {
		await pomodoro.activity()
		await w.advance(MINUTE)
	}
	expect(w.notified.length).toBe(1)

	// 2 minutes without activity is no break, 3 are.
	await w.advance(MINUTE)
	expect(w.label()).toBe('🍅 26/25m')
	await w.advance(MINUTE)
	expect(w.label()).toBe('🍅 on a break')
})
