import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	type ExtensionAPI,
	type ExtensionUIContext,
	getAgentDir,
} from '@earendil-works/pi-coding-agent'
import {
	COMMAND,
	createInstance,
	DEFAULTS,
	type Host,
	type Instance,
	type Settings,
	settingsFrom,
} from './core'
import { type Language, languageFrom } from './messages'

// A file's JSON, or undefined when it's missing or unreadable.
const load = (path: string): Promise<unknown> =>
	readFile(path, 'utf8')
		.then(JSON.parse)
		.catch(() => undefined)

// Through a temp file, so a reader never sees half a file.
async function save(path: string, value: unknown) {
	await writeFile(`${path}.${process.pid}`, JSON.stringify(value))
	await rename(`${path}.${process.pid}`, path)
}

// The file's settings, the defaults without one, or what's wrong with it.
async function readSettings(path: string) {
	const text = await readFile(path, 'utf8').catch(
		(error: NodeJS.ErrnoException) => error,
	)
	if (text instanceof Error)
		return text.code === 'ENOENT'
			? DEFAULTS
			: { problems: [`the file can't be read (${text.code})`] }
	try {
		return settingsFrom(JSON.parse(text))
	} catch {
		return { problems: ["the file isn't valid JSON"] }
	}
}

// What core keeps across a /reload, /resume or --continue: an entry in the session, the latest on any of its branches,
// since a pomodoro is time, not part of the conversation (a /tree back past the check-in doesn't undo it).
const KEPT = 'pomodoro'

// Pi caches this factory per path, so everything lives in its closure, set again at each session start.
export default function (pi: ExtensionAPI) {
	const dir = getAgentDir()
	// One timer per person, shared by every open Pi session, and the log of summaries after check-ins: a file each.
	const paths = {
		timer: join(dir, 'pomodoro.json'),
		checkIns: join(dir, 'pomodoro-log.json'),
	}
	const settingsPath = join(dir, 'pomodoro-settings.json')

	let settings: Settings = DEFAULTS
	// This session's instance of core (lib/core), or why there's none.
	let instance: Instance | undefined
	let off: string | undefined
	// The Mac's first language, read at the session's start.
	let language: Language = 'en'

	// Pi's side of core, for a session in `cwd`; `ui` only in the terminal UI.
	const host = (cwd: string, ui: ExtensionUIContext | undefined): Host => ({
		now: async () => Date.now(),
		after: (ms, fn) => {
			const timeout = setTimeout(fn, ms)
			return () => clearTimeout(timeout)
		},
		every: (ms, fn) => {
			const interval = setInterval(fn, ms)
			return () => clearInterval(interval)
		},
		load: (key) => load(paths[key]),
		save: (key, value) => save(paths[key], value),
		run: async ([file, ...args], timeoutMs) =>
			(await pi.exec(file, args, { timeout: timeoutMs })).stdout,
		repo: async () => {
			const { code, stdout } = await pi
				.exec('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 5_000 })
				.catch(() => ({ code: 1, stdout: '' }))
			return code === 0 ? stdout.trim() : null
		},
		// One status entry: the count, or that a break is due.
		show: (label, warning) => ui?.setStatus('pomodoro', warning ?? label),
		// Pi has no desktop notification of its own: the alert is the in-app one, and core's chime.
		notify: async (text, mark) => {
			ui?.notify(`${mark}${text}`, 'warning')
		},
		// An info line, which Pi shows dim.
		toast: (text) => ui?.notify(text, 'info'),
		keep: (kept) => pi.appendEntry(KEPT, kept),
	})

	pi.on('session_start', async (_, ctx) => {
		instance = undefined
		off = undefined
		const read = await readSettings(settingsPath)
		// No timer, as in Claude Code with a setting that doesn't fit; Claude Code says why only in its debug log.
		if ('problems' in read) {
			off = `Pomodoro is off: ${read.problems.join('; ')} (${settingsPath}).`
			ctx.ui.notify(off, 'error')
			return
		}
		settings = read
		const mac = await pi
			.exec('defaults', ['read', '-g', 'AppleLanguages'], { timeout: 5_000 })
			.catch(() => ({ stdout: '' }))
		language = languageFrom(undefined, mac.stdout)
		// The clock runs where the count shows: the terminal UI. Never with -p, --mode json or RPC.
		const isTui = ctx.mode === 'tui'
		const kept = ctx.sessionManager
			.getEntries()
			.findLast((entry) => entry.type === 'custom' && entry.customType === KEPT)
		instance = createInstance(host(ctx.cwd, isTui ? ctx.ui : undefined), {
			settings,
			remote: Boolean(process.env.SSH_CONNECTION),
			language,
			kept: kept?.type === 'custom' ? kept.data : undefined,
		})
		if (isTui) instance.start()
		// The smoke test (scripts/pi-smoke.ts) runs where the clock never starts: EVAL_POMODORO_TICK makes one tick, on the
		// timer it stored, before the first prompt.
		else if (process.env.EVAL_POMODORO_TICK) await instance.tick()
	})

	pi.on('session_shutdown', () => {
		instance?.stop()
	})

	// Input the person typed is their own input too; one an extension sent isn't.
	pi.on('input', async (e) => {
		await instance?.activity(true, e.source === 'interactive')
	})

	// A tool call counts as the agent's activity as it starts and as it ends, not while it waits; one another tool made
	// doesn't.
	pi.on('tool_call', async (e) => {
		await instance?.activity(e.parentToolCallId === undefined)
	})

	// The check-in and the heads-up ride a tool result of the agent's own: it reads them mid-run, and they never wait in an
	// idle session.
	pi.on('tool_result', async (e, ctx) => {
		const isMain = e.parentToolCallId === undefined
		await instance?.activity(isMain)
		const { checkIn, notice, headsUp } = instance?.toolResult(isMain) ?? {}
		// Pi shows a tool result's text, so the heads-up is a message the screen doesn't show. It goes with the run's next
		// request to the model, and doesn't make one of its own.
		if (headsUp !== undefined)
			pi.sendMessage(
				{ customType: 'pomodoro', content: headsUp, display: false },
				{ triggerTurn: false },
			)
		if (notice !== undefined) ctx.ui.notify(notice, 'info')
		if (checkIn === undefined) return
		// Replacing the content drops the structured content unless it comes back too.
		return {
			content: [...e.content, { type: 'text', text: checkIn }],
			structuredContent: e.structuredContent,
		}
	})

	// A response of the agent's, which is activity. One cut short (an error, Escape, the length limit) ends here too, with
	// its partial text: it's not a reply, as a retry may finish it.
	pi.on('message_end', async (e) => {
		const { message } = e
		if (!('role' in message) || message.role !== 'assistant') return
		await instance?.activity(true)
		if (!['stop', 'toolUse'].includes(message.stopReason)) return
		await instance?.reply(
			message.content
				.map((part) => (part.type === 'text' ? part.text : ''))
				.join('\n\n'),
		)
	})

	// Pi is done with the run, retries and compaction included (agent_end can come before them).
	pi.on('agent_settled', () => {
		instance?.turnEnded()
	})

	// Pi runs it at once, mid-run too.
	pi.registerCommand(COMMAND.name, {
		description: COMMAND.description,
		// Pi's counterpart of Claude Code's argument hint.
		getArgumentCompletions: (prefix) => {
			const items = ['today', 'quiet']
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }))
			return items.length > 0 ? items : null
		},
		handler: async (args, ctx) => {
			ctx.ui.notify(
				(await instance?.command(args)) ?? off ?? '',
				off === undefined ? 'info' : 'error',
			)
		},
	})
}
