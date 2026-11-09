import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const T0 = 1_700_000_000_000
const MIN = 60_000

// The engine beneath the mod: a clock, a store, ioreg reporting `idle(now)` (null: no ioreg), Claude Code's `language`
// setting (none by default), the terminal's notification, a repository at /code/app, and recorders. `notified` holds every banner, `osascripts` those osascript was asked for,
// `labels` each count written for the prompt footer.
const world = (
	on: On,
	idle: (now: number) => number | null,
	seed?: Record<string, unknown>,
	language?: string,
) => {
	const clock = mock.clock(on, { now: T0 })
	// The mod's store, open to the test.
	const store: Record<string, unknown> = { ...seed }
	on('store.get', (_, e) => ({ value: store[e.key] }))
	on('store.set', (_, e) => {
		store[e.key] = e.value
		return { value: undefined }
	})
	mock.env(on, {})
	const session = mock.session(on)
	const notified: string[] = []
	const osascripts: (readonly string[])[] = []
	const status: (string | undefined)[] = []
	const labels: string[] = []
	const chimes: number[] = []
	// Each command the mod registered, as it asked.
	const registered: unknown[] = []
	// Without an answer the kit skips the whole session.start hook.
	on('settings.read', () => ({ value: { language } }))
	on('session.start', (_, e) => ({ cwd: e.cwd }))
	on('prompt.submit', (_, e) => ({ text: e.text }))
	on('tool.call', () => ({ result: {} }))
	on('command.register', (_, e) => {
		registered.push(e)
		return { value: { command: e.name } }
	})
	on('session.repo', () => ({
		value: { root: '/code/app', remote: null, internal: false, name: null },
	}))
	on('turn.complete', (_, e) => ({ text: e.answer }))
	// The model: its next response, which `respond` sets.
	let reply = { answer: '', tools: [] as string[] }
	on('turn.step', async function* (_, e) {
		yield* []
		return {
			turnId: e.turnId,
			index: e.index,
			answer: reply.answer,
			toolUses: reply.tools.map((name) => ({ name, input: {} })),
			stopReason: reply.tools.length > 0 ? 'tool_use' : 'end_turn',
			usage: null,
		}
	})
	// A response of the main loop, or of a subagent's run with `agentId`: its text and the tools it calls.
	const respond = async (
		$: Engine,
		answer: string,
		tools: string[] = [],
		agentId?: string,
	) => {
		reply = { answer, tools }
		const step = $.turn.step({
			turnId: 't',
			index: 0,
			model: 'claude',
			messageCount: 1,
			agentId,
		})
		for await (const _ of step) {
		}
		return step.result
	}
	on('process.run', (_, e) => {
		if (e.argv[0] === 'afplay') chimes.push(clock.now())
		if (e.argv[0] === 'osascript') osascripts.push(e.argv)
		// The Mac's languages: none.
		if (e.argv[0] === 'defaults')
			return {
				value: {
					exitCode: 0,
					stdout: '',
					stderr: '',
					isStdoutTruncated: false,
					isStderrTruncated: false,
				},
			}
		const ms = idle(clock.now())
		// The screen lock: never locked.
		const isLock = e.argv.includes('Root')
		return {
			value: {
				exitCode: ms === null ? 1 : 0,
				stdout:
					ms === null
						? ''
						: isLock
							? '"IOConsoleLocked" = No'
							: `"HIDIdleTime" = ${ms * 1e6}`,
				stderr: '',
				isStdoutTruncated: false,
				isStderrTruncated: false,
			},
		}
	})
	on('ui.notify', (_, e) => {
		notified.push(e.text)
		return { value: { isSent: true, channel: 'ghostty' } }
	})
	// Each toast's text, and how long it stays.
	const toasts: string[] = []
	const toastMs: (number | undefined)[] = []
	on('ui.toast', (_, e) => {
		toasts.push(e.text)
		toastMs.push(e.timeoutMs)
		return { value: undefined }
	})
	on('ui.status', (_, e) => {
		status.push(e.text)
		return { value: undefined }
	})
	// Each cached answer the mod asked for again.
	const invalidated: string[] = []
	on('ui.invalidate', (_, e) => {
		invalidated.push(e.event)
		return { value: undefined }
	})
	on('state.set', { plugin: 'pomodoro', key: 'label' }, (_, e, next) => {
		labels.push(e.value)
		return next(e)
	})
	return {
		clock,
		store,
		session,
		notified,
		osascripts,
		status,
		labels,
		toasts,
		toastMs,
		chimes,
		registered,
		invalidated,
		respond,
	}
}

const start = ($: Engine) =>
	$.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

// A tool call of the main loop, or of a subagent's with `agentId`; true when the check-in came back with its result.
// Not a literal: Claude Code 2.1.304's test kit passes `agentId` on but doesn't declare it.
const checked = async ($: Engine, agentId?: string) => {
	const call = { tool: 'Bash' as const, command: 'ls', agentId }
	return JSON.stringify(await $.tool.call(call)).includes(
		'[Pomodoro] The user has been working',
	)
}

// The end of the main loop's turn, answered or interrupted, or of a subagent's run with `agentId`.
const endTurn = (
	$: Engine,
	reason: 'answer' | 'aborted' = 'answer',
	agentId?: string,
) =>
	$.turn.complete({
		answer: '',
		durationMs: 1,
		isAborted: reason === 'aborted',
		turnId: 't',
		reason,
		agentId,
	})

// What /pomodoro prints for `args`, and for today.
const pomodoro = async ($: Engine, args: string) =>
	(
		await $.command.run({
			command: 'pomodoro',
			args,
			origin: { kind: 'composer' },
			presentation: { isFullscreen: false, columns: 80 },
		})
	).text
const listed = ($: Engine) => pomodoro($, 'today')

const texts = (checkIns: unknown) =>
	(checkIns as { text: string }[]).map((c) => c.text)

test('the count is a mode label in the prompt footer', async ($, on) => {
	const { clock } = world(on, () => 0)
	// Stands for the engine drawing the footer's labels.
	on('ui.render', { component: 'SessionMode' }, ($, e) => {
		const { Text } = $.ui.resolve(e)
		return <Text>{e.props.modes.join(' & ')}</Text>
	})
	await start($)
	await clock.settle()

	const ui = await $.ui.mount({
		plugin: 'pomodoro',
		surface: 'terminal',
		component: 'SessionMode',
		props: { modes: ['focus'] },
	})
	expect((await ui.find({ type: 'Text', text: /🍅/ }))?.text).toBe(
		'focus & 🍅 1 of 4 · 0/25m',
	)
	await clock.advance(MIN)
	expect((await ui.find({ type: 'Text', text: /🍅/ }))?.text).toBe(
		'focus & 🍅 1 of 4 · 1/25m',
	)
	await ui.unmount()
})

test('the status line, which Claude Code marks ⚠, shows only while a break is due', async ($, on) => {
	let leftAt = Infinity
	const { clock, status } = world(on, (now) =>
		now >= leftAt ? now - leftAt : 0,
	)
	await start($)
	await clock.advance(24 * MIN)
	expect(status.filter((text) => text !== undefined)).toEqual([])
	await clock.advance(MIN)
	expect(status.at(-1)).toBe('🍅 25m, time for a break')

	leftAt = clock.now()
	await clock.advance(6 * MIN)
	expect(status.at(-1)).toBe(undefined)
})

test('a session with nobody at its prompt never counts: -p, VS Code, the desktop app', async ($, on) => {
	const { clock, labels } = world(on, () => 0)
	on('session.attach', (_, e) => ({ clientId: e.clientId }))
	await $.session.start({ cwd: '/', surface: null, isInteractive: false })
	await clock.advance(2 * MIN)
	expect(labels).toEqual([])

	// VS Code and the desktop app attach to a session that started headless; neither starts the clock.
	await $.session.attach({ surface: 'vscode', clientId: 'vscode:default' })
	await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
	await clock.advance(MIN)
	expect(labels).toEqual([])
	expect(await checked($)).toBe(false)
})

test("the alert goes through the terminal's notification, and nothing else posts a banner", async ($, on) => {
	const { clock, notified, chimes, osascripts } = world(on, () => 0)
	await start($)
	await clock.advance(25 * MIN)
	expect(notified).toEqual([
		'25 minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.',
	])
	expect(chimes.length).toBe(1)
	expect(osascripts).toEqual([])
})

// Registered `immediate`, /pomodoro typed while a turn is in flight runs at once instead of waiting for the turn to end.
test('/pomodoro quiet runs mid-turn, and the count shows it', async ($, on) => {
	const { clock, notified, chimes, status, labels, registered } = world(
		on,
		() => 0,
	)
	await start($)
	expect(registered).toEqual([
		{
			name: 'pomodoro',
			description:
				"Shows today's pomodoros and check-ins in this repository, or turns quiet on or off to hold the alerts during a meeting.",
			argumentHint: 'today | quiet',
			immediate: true,
		},
	])
	await clock.advance(10 * MIN)
	expect(await pomodoro($, 'quiet')).toStartWith('Quiet is on: no alerts')
	expect(labels.at(-1)).toBe('🍅 quiet · 1 of 4 · 10/25m')

	// No alert, chime or warning while quiet; off, the alert at once.
	await clock.advance(20 * MIN)
	expect([notified, chimes, status.filter(Boolean)]).toEqual([[], [], []])
	expect(await pomodoro($, 'quiet')).toBe('Quiet is off.')
	expect(labels.at(-1)).toBe('🍅 2 of 4 · 5/25m')
	expect([notified.length, chimes.length]).toEqual([1, 1])
	expect(status.at(-1)).toBe('🍅 30m, time for a break')
})

// Claude Code's free-text `language` setting before the Mac's; /config's rows for the plugin's settings too.
test('in Italian, the count, /pomodoro and /config speak Italian', async ($, on) => {
	// The menu's own answer beneath the mod's, which passes the row through.
	on('config.describe', (_, e) => ({
		label: e.label,
		description: e.description,
		isHidden: e.isHidden,
	}))
	const { clock, labels, registered, invalidated } = world(
		on,
		() => 0,
		undefined,
		'Italiano',
	)
	await start($)
	await clock.settle()
	expect(labels.at(-1)).toBe('🍅 1 di 4 · 0/25 min')
	expect(JSON.stringify(registered)).toContain('Mostra i pomodori')
	expect(await pomodoro($, 'today')).toBe('Oggi: ancora nessun pomodoro.')

	// /config asks again once the language is known.
	expect(invalidated).toEqual(['config.describe'])

	const row = {
		label: 'Chime',
		description: 'x',
		isHidden: false,
		provider: { plugin: 'pomodoro', tier: 'user' },
	} as const
	expect(
		await $.config.describe({ key: 'pomodoro.sound', ...row }),
	).toMatchObject({ label: 'Suono', isHidden: false })
	expect(
		await $.config.describe({ key: 'pomodoro.emoji', ...row }),
	).toMatchObject({ label: 'Emoji del pomodoro' })
	// Another row is left as it is.
	expect(await $.config.describe({ key: 'theme', ...row })).toEqual({
		label: 'Chime',
		description: 'x',
		isHidden: false,
	})
})

test('back from a break, a toast says so, with no banner and no chime', async ($, on) => {
	let leftAt = Infinity
	const { clock, notified, chimes, toasts, toastMs } = world(on, (now) =>
		now >= leftAt ? now - leftAt : 0,
	)
	await start($)
	await clock.advance(25 * MIN)
	leftAt = clock.now()
	await clock.advance(4 * MIN)
	leftAt = Infinity
	await clock.advance(MIN)
	expect(toasts.at(-1)).toBe('🍅 Back after 4m · pomodoro 2 of 4')
	expect(toastMs.at(-1)).toBe(8_000)
	// The one banner and the one chime are the alert's.
	expect([notified.length, chimes.length]).toEqual([1, 1])
})

test('the check-in rides the next tool result, once per pomodoro, and never waits in an idle session', async ($, on) => {
	let leftAt = Infinity
	const { clock, session, labels } = world(on, (now) =>
		now >= leftAt ? now - leftAt : 0,
	)
	await start($)
	expect(await checked($)).toBe(false)

	// At the prompt, typing elsewhere: nothing lands in the conversation.
	await clock.advance(26 * MIN)
	expect(session.appended().length).toBe(0)

	expect(await checked($)).toBe(true)
	expect(JSON.stringify(session.appended())).toContain(
		'told the agent your pomodoro is up',
	)
	expect(await checked($)).toBe(false)

	// Still no break 25 minutes later: a second check-in.
	await clock.advance(25 * MIN)
	expect(await checked($)).toBe(true)

	// A break of 3 minutes clears what is due, and steady input ends it.
	leftAt = clock.now()
	await clock.advance(3 * MIN)
	expect(labels.at(-1)).toBe('🍅 on a break')
	leftAt = Infinity
	await clock.advance(MIN)
	expect(labels.at(-1)).toBe('🍅 3 of 4 · 0/25m')
	expect(await checked($)).toBe(false)
})

// For Claude alone: nothing of it shows in the conversation.
test("the heads-up rides a tool result's context 5 minutes before the pomodoro ends, once", async ($, on) => {
	const { clock, session } = world(on, () => 0)
	await start($)
	const call = { tool: 'Bash' as const, command: 'ls' }
	await clock.advance(19 * MIN)
	expect((await $.tool.call(call)).context).toBeUndefined()
	await clock.advance(MIN)
	expect((await $.tool.call(call)).context).toEqual([
		"[Pomodoro] The user's pomodoro ends in about 5 minutes. Bring the current step to a stopping point, and don't start anything big.",
	])
	expect((await $.tool.call(call)).context).toBeUndefined()
	expect(session.appended()).toEqual([])
})

// The check-in is for Claude's own loop, and a denied call returns no result to carry it.
test("a subagent's tool call, or one that was denied, doesn't take the check-in", async ($, on) => {
	// Beneath the mod, before world()'s answer to every tool call.
	on('tool.call', { tool: 'Write' }, () => ({ deny: 'not now' }))
	const { clock } = world(on, () => 0)
	await start($)
	await clock.advance(26 * MIN)
	expect(await checked($, 'a1')).toBe(false)
	expect(
		JSON.stringify(
			await $.tool.call({ tool: 'Write', file_path: '/a', content: '' }),
		),
	).not.toContain('[Pomodoro]')
	expect(await checked($)).toBe(true)
})

test('a reload does not repeat the check-in the session was given', async ($, on) => {
	// Overdue for a minute, and the check-in for this pomodoro was given before the mod reloaded (a /config change). The
	// number under sentKey is also what 0.6.1 left there, so an update doesn't repeat a check-in.
	const { clock } = world(on, () => 0, {
		timer: {
			blockStart: T0 - 26 * MIN,
			seenAt: T0 - 30_000,
			alertedAt: T0 - MIN,
			lastInput: T0,
		},
	})
	const sent: number[] = []
	on('state.get', { plugin: 'pomodoro', key: 'sentKey' }, () => ({
		value: { value: T0 - MIN, version: 1 },
	}))
	on('state.set', { plugin: 'pomodoro', key: 'sentKey' }, (_, e) => {
		sent.push(e.value)
		return { value: { isSet: true, version: 2 } }
	})
	await start($)
	await clock.settle()
	expect(await checked($)).toBe(false)

	// The next pomodoro still gets its check-in, and it's kept for the next reload.
	await clock.advance(25 * MIN)
	expect(await checked($)).toBe(true)
	expect(sent).toEqual([T0 + 24 * MIN])
})

// A removed setting reaches the plugin as it was in settings.json: unchecked, and of any type.
test(
	'a removed setting left in settings.json is ignored',
	{ options: { workMinutes: 0, moveSeconds: 'abc' } },
	async ($, on) => {
		const { clock, labels } = world(on, () => 0)
		await start($)
		await clock.settle()
		expect(labels.at(-1)).toBe('🍅 1 of 4 · 0/25m')
	},
)

test(
	'without the emoji, the footer says pomodoro and nothing else shows a tomato',
	{ options: { emoji: false } },
	async ($, on) => {
		const { clock, session, status, labels, toasts } = world(on, () => 0)
		await start($)
		await clock.settle()
		expect(labels.at(-1)).toBe('pomodoro 1 of 4 · 0/25m')

		await clock.advance(25 * MIN)
		expect(status.at(-1)).toBe('25m, time for a break')
		expect(toasts).toEqual([
			'25 minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.',
		])
		expect(await checked($)).toBe(true)
		expect(JSON.stringify(session.appended())).toContain(
			'Pomodoro: told the agent your pomodoro is up',
		)
		expect(
			JSON.stringify([labels, status, toasts, session.appended()]),
		).not.toContain('🍅')
	},
)

// Listed at the moment it's logged, so the day matches in any time zone: CI's and this Mac's differ.
test("the check-in's summary is logged from any reply in its turn, and /pomodoro today lists it under the day's count", async ($, on) => {
	const { clock, store, respond } = world(on, () => 0)
	await start($)
	expect(await listed($)).toBe('Today: no pomodoros yet.')

	// A summary with no check-in before it logs nothing.
	await respond($, 'Pomodoro: early.')
	expect(store.checkIns).toBe(undefined)

	await clock.advance(26 * MIN)
	expect(await checked($)).toBe(true)
	// Neither a subagent's summary nor a reply without one is logged, and the end of the subagent's run doesn't end the
	// wait; one given mid-task, beside a tool call, is.
	await respond($, 'Pomodoro: the subagent.', [], 'a1')
	await endTurn($, 'answer', 'a1')
	await respond($, 'Writing step2.', ['Write'])
	await respond(
		$,
		'Wrote step2.\n\n**Pomodoro:** on the goal.\nTake a break.',
		['Write'],
	)
	await respond($, 'Pomodoro: again.')
	expect(texts(store.checkIns)).toEqual([
		'Pomodoro: on the goal.\nTake a break.',
	])
	expect(await listed($)).toMatch(
		/^Today: 🍅 1 pomodoro \(yesterday 0\), 0 long breaks, 0 breaks skipped, longest 26m\n\d\d:\d\d {2}Pomodoro: on the goal\.\n {7}Take a break\.$/,
	)
})

test("a turn that ends without the summary, answered or cut short, logs nothing, and the next turn's isn't taken for it", async ($, on) => {
	const { clock, store, respond } = world(on, () => 0)
	await start($)
	for (const reason of ['answer', 'aborted'] as const) {
		await clock.advance(26 * MIN)
		expect(await checked($)).toBe(true)
		await respond($, 'Done.')
		await endTurn($, reason)
		await respond($, 'Pomodoro: the next turn.')
	}
	expect(store.checkIns).toBe(undefined)
})

test("ioreg's idle time is the input: 3 minutes away is a break, and steady use ends it", async ($, on) => {
	// ioreg sees the person away since 3 minutes before the start.
	let leftAt = T0 - 3 * MIN
	const { clock, labels } = world(on, (now) =>
		now >= leftAt ? now - leftAt : 0,
	)
	await start($)
	await clock.settle()
	expect(labels.at(-1)).toBe('🍅 on a break')

	// Back at the keyboard.
	leftAt = Infinity
	await clock.set(T0 + MIN)
	expect(labels.at(-1)).toBe('🍅 1 of 4 · 0/25m')
	await clock.set(T0 + 10 * MIN)
	expect(labels.at(-1)).toBe('🍅 1 of 4 · 9/25m')
})

test("a subagent's tool calls don't hold off a break, the main loop's do", async ($, on) => {
	// No input since the start.
	const { clock, labels } = world(on, (now) => now - T0)
	await start($)
	// The main loop's tool calls, one each 30 seconds for 5 minutes: the count runs on.
	for (let i = 0; i < 10; i++) {
		await clock.advance(30_000)
		await checked($)
	}
	expect(labels.at(-1)).toBe('🍅 1 of 4 · 5/25m')
	// A subagent's from then on: 3 minutes after the main loop's last, a break.
	for (let i = 0; i < 8; i++) {
		await clock.advance(30_000)
		await checked($, 'a1')
	}
	expect(labels.at(-1)).toBe('🍅 on a break')
})

test("the person's own prompt ends a break", async ($, on) => {
	// No input since the start.
	const { clock, labels } = world(on, (now) => now - T0)
	await start($)
	await clock.advance(4 * MIN)
	expect(labels.at(-1)).toBe('🍅 on a break')
	await $.prompt.submit({
		text: 'Go on.',
		wait: false,
		origin: { kind: 'composer' },
	})
	// Back at the prompt.
	await clock.advance(MIN)
	expect(labels.at(-1)).toBe('🍅 1 of 4 · 1/25m')
})

test('without ioreg, a break is a break from every session', async ($, on) => {
	// Another session was in use 10 seconds ago, 20 minutes into a pomodoro: a fresh session keeps that pomodoro.
	const { clock, notified, labels } = world(on, () => null, {
		timer: {
			blockStart: T0 - 20 * MIN,
			seenAt: T0 - 30_000,
			lastInput: T0 - 10_000,
		},
	})
	await start($)
	await clock.settle()
	expect(labels.at(-1)).toBe('🍅 1 of 4 · 20/25m')

	// Prompts, then tool calls, stand in for input: one a minute until the alert, then until the next.
	for (let i = 0; i < 5; i++) {
		await $.prompt.submit({
			text: 'Go on.',
			wait: false,
			origin: { kind: 'composer' },
		})
		await clock.advance(MIN)
	}
	expect(notified.length).toBe(1)
	for (let i = 0; i < 5; i++) {
		await $.tool.call({ tool: 'Bash', command: 'ls' })
		await clock.advance(MIN)
	}
	expect(notified.length).toBe(2)

	await clock.advance(6 * MIN)
	expect(labels.at(-1)).toBe('🍅 on a break')
})
