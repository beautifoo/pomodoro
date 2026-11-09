import type { EngineInterface, Register } from 'claude-code'
import {
	COMMAND,
	createInstance,
	type Host,
	type Instance,
	notice,
	type Settings,
	settingsFrom,
} from './core'
import {
	APPLE_LANGUAGES,
	type Language,
	languageFrom,
	messages,
} from './messages'

// What core keeps across a reload, in $.state: a reload (a /config change) starts the module over, not the session.
// The key is named for what it holds, the number 0.6.1 kept there too, so an update doesn't repeat a check-in.
const KEPT = { plugin: 'pomodoro', key: 'sentKey' } as const
const LABEL = { plugin: 'pomodoro', key: 'label' } as const

// This session's instance of core (lib/core), from its start.
let instance: Instance | undefined
// The person's language, read at the session's start.
let language: Language = 'en'

// Claude Code's side of core: the engine's clock, store, processes and UI, through the session's start's `$`.
function host($: EngineInterface): Host {
	return {
		now: () => $.clock.now(),
		after: (ms, fn) => {
			const timer = $.clock.after(ms, fn)
			return () => timer.cancel()
		},
		every: (ms, fn) => {
			const timer = $.clock.every(ms, fn)
			return () => timer.cancel()
		},
		load: (key) => $.store.get(key),
		save: (key, value) => $.store.set(key, value),
		run: async (argv, timeoutMs) =>
			(await $.process.run(argv, { cwd: '/', timeoutMs })).stdout,
		repo: async () => (await $.session.repo())?.root ?? null,
		// The count is a mode label in the prompt footer. The status line, which Claude Code marks ⚠, only says a break
		// is due.
		show: (label, warning) => {
			void $.state.set(LABEL, label).catch(() => {})
			$.ui.status(warning)
		},
		// The toast, and the terminal's own notification if it has one.
		notify: async (text, mark) => {
			$.ui.toast(`${mark}${text}`, { timeoutMs: 15_000 })
			await $.ui.notify(text, { title: 'Pomodoro' }).catch(() => {})
		},
		// A toast alone, shorter than the alert's.
		toast: (text) => $.ui.toast(text, { timeoutMs: 8_000 }),
		keep: (kept) => void $.state.set(KEPT, kept).catch(() => {}),
	}
}

// The clock runs where the count shows: an interactive terminal session. Never in -p, VS Code or the desktop app.
async function begin(
	$: EngineInterface,
	settings: Settings,
	isInteractive: boolean,
) {
	const kept = await $.state.get(KEPT).then(
		(read) => read.value,
		() => undefined,
	)
	// ioreg sees the console's input, not the input of an SSH session.
	const remote = Boolean(await $.env.get('SSH_CONNECTION'))
	if (instance !== undefined) return
	instance = createInstance(host($), { settings, remote, kept, language })
	if (isInteractive) instance.start()
}

export const register: Register = (on, options) => {
	// Claude Code has checked them against plugin.json, but hands an empty one on. A problem left fails the load, as its
	// own check does.
	const read = settingsFrom(options)
	if ('problems' in read) throw new Error(read.problems.join('; '))
	const settings = read
	on('session.start', async ($, e, next) => {
		// A rejected `$` call here makes Claude Code skip the hook, so each read falls back on its own.
		const setting = await $.settings
			.read({ key: 'language' })
			.catch(() => undefined)
		const mac = await $.process
			.run([...APPLE_LANGUAGES], { cwd: '/', timeoutMs: 5_000 })
			.catch(() => ({ stdout: '' }))
		language = languageFrom(setting, mac.stdout)
		await $.command
			.register({
				...COMMAND,
				description: messages[language].description,
				argumentHint: 'today',
			})
			.catch(() => {})
		await begin($, settings, e.isInteractive)
		return next(e)
	})

	// Reading the label while drawing redraws the footer on each new count.
	on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
		const { value } = await $.state.get(LABEL)
		return next(
			value === undefined
				? e
				: { ...e, props: { ...e.props, modes: [...e.props.modes, value] } },
		)
	})

	// A prompt the person entered is their own input too; one from /loop, a schedule, a notification or a peer isn't.
	on('prompt.submit', async (_, e, next) => {
		await instance?.activity(true, e.origin.kind === 'composer')
		return next(e)
	})

	// A tool call counts as the main loop's activity as it starts and as it ends, not while it waits. The check rides a
	// tool result of the main loop: Claude reads it mid-turn, and it never waits in an idle session.
	on('tool.call', async ($, e, next) => {
		const isMain = e.agentId === undefined
		await instance?.activity(isMain)
		const ran = await next(e)
		await instance?.activity(isMain)
		if (ran.deny !== undefined) return ran
		const checkIn = instance?.toolResult(isMain)
		if (checkIn === undefined) return ran
		void $.session
			.append({
				message: {
					type: 'system',
					content: [
						{
							type: 'text',
							text: notice(settings, language),
						},
					],
				},
			})
			.catch(() => {})
		return { ...ran, context: [...(ran.context ?? []), checkIn] }
	})

	// A response, which is activity; the main loop's may hold the summary.
	on('turn.step', async function* (_, e, next) {
		const response = yield* next(e)
		const isMain = e.agentId === undefined
		await instance?.activity(isMain)
		if (isMain) await instance?.reply(response.answer)
		return response
	})

	// The main loop's turn ended, answered or cut short.
	on('turn.complete', async (_, e, next) => {
		const ended = await next(e)
		if (e.agentId === undefined) instance?.turnEnded()
		return ended
	})

	on('command.run', { command: COMMAND.name }, async (_, e) => ({
		text: (await instance?.command(e.args)) ?? '',
	}))
}
