// Runs Pi with the extension against a scripted model on localhost, on a stored timer whose pomodoro is up, with
// stand-ins for the macOS commands its tick runs. Fails unless that tick, before the first prompt, makes the check-in
// due and alerts through those commands, the check-in rides the first tool result and reaches the model, once, and the
// summary the model then gives is logged; unless a second run that continues that session isn't given the same
// pomodoro's check-in again; unless, 21 minutes into a pomodoro, the heads-up reaches the model once, as a message of
// its own after the first tool result; unless nothing ticks with a settings file that doesn't fit; and on an extension
// error. No login, so CI runs it against each Pi it checks.
// Usage: bun scripts/pi-smoke.ts (after bun run build)
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
	CHIME,
	type CheckIn,
	IOREG,
	LOCK,
	MINUTE,
	type Timer,
} from '../lib/core'

const pi = resolve('packages/pi/node_modules/@earendil-works/pi-coding-agent')
const { version, bin } = await Bun.file(`${pi}/package.json`).json()

// Stand-ins for ioreg, afplay and osascript, first on Pi's PATH: each records its arguments, and ioreg takes a second,
// as the real one can, then reports no idle time and an unlocked screen. So every machine runs the same test, a tick Pi
// doesn't wait for loses the race to the first tool result, and nothing shows or plays.
const fakes = await mkdtemp(join(tmpdir(), 'pi-smoke-fakes-'))
for (const name of ['ioreg', 'afplay', 'osascript'])
	await writeFile(
		join(fakes, name),
		`#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.POMODORO_SMOKE_CALLS, JSON.stringify(['${name}', ...process.argv.slice(2)]) + '\\n')
if ('${name}' === 'ioreg') setTimeout(() => console.log('"HIDIdleTime" = 0\\n"IOConsoleLocked" = No'), 1_000)
`,
		{ mode: 0o755 },
	)
// Over SSH the tick wouldn't run ioreg.
const { SSH_CONNECTION: _, ...env } = process.env

// The prompt, and the model's replies: it writes a.txt, then b.txt, then answers with a summary, by how many tool
// results it has been sent.
const PROMPT = 'Write a.txt, then b.txt.'
const replies = [
	{ tool: { name: 'write', arguments: { path: 'a.txt', content: '1' } } },
	{ tool: { name: 'write', arguments: { path: 'b.txt', content: '2' } } },
	{ text: 'Pomodoro: wrote a.txt and b.txt.\n\nDone.' },
]
const chunk = (body: object) =>
	`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'smoke', ...body })}\n\n`
// Each request of the current run after a tool result: the run's messages by role, * on those holding a note from the
// extension.
let seen: string[] = []
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const { messages } = (await request.json()) as {
			messages: { role: string; content: unknown }[]
		}
		// This run's messages: those after the last prompt, as a continued session sends the earlier run's too. Found by
		// its text, since Pi sends the heads-up as a user message too.
		const run = messages.slice(
			messages.findLastIndex((m) =>
				JSON.stringify(m.content).includes(PROMPT),
			) + 1,
		)
		const results = run.filter((m) => m.role === 'tool')
		if (results.length > 0)
			seen.push(
				run
					.map(
						(m) =>
							`${m.role}${JSON.stringify(m.content).includes('[Pomodoro]') ? '*' : ''}`,
					)
					.join(' '),
			)
		const reply = replies[Math.min(results.length, replies.length - 1)]
		const delta = reply?.tool
			? {
					role: 'assistant',
					tool_calls: [
						{
							index: 0,
							id: `call_${results.length}`,
							type: 'function',
							function: {
								name: reply.tool.name,
								arguments: JSON.stringify(reply.tool.arguments),
							},
						},
					],
				}
			: { role: 'assistant', content: reply?.text }
		return new Response(
			chunk({ choices: [{ index: 0, delta, finish_reason: null }] }) +
				chunk({
					choices: [
						{
							index: 0,
							delta: {},
							finish_reason: reply?.tool ? 'tool_calls' : 'stop',
						},
					],
				}) +
				chunk({
					choices: [],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}) +
				'data: [DONE]\n\n',
			{ headers: { 'content-type': 'text/event-stream' } },
		)
	},
})

// A run's folders: Pi's agent dir, where the session is stored too, and the one it works in.
type Dirs = { agentDir: string; workDir: string }
const clean = ({ agentDir, workDir }: Dirs) =>
	Promise.all([
		rm(agentDir, { recursive: true, force: true }),
		rm(workDir, { recursive: true, force: true }),
	])

// One run of Pi in new folders, `worked` into a pomodoro, with its settings file made by `settings`, or one that
// continues the session of an `earlier` run in its folders, on the timer it left. What `seen` held, whether Pi's tick
// stored the timer and whether it alerted, the summaries logged, the stand-ins' calls and whether an extension threw;
// Pi's stderr; the folders.
async function run(
	settings?: (path: string) => Promise<unknown>,
	earlier?: Dirs,
	worked = 25 * MINUTE,
) {
	seen = []
	const dirs = earlier ?? {
		agentDir: await mkdtemp(join(tmpdir(), 'pi-smoke-agent-')),
		workDir: await mkdtemp(join(tmpdir(), 'pi-smoke-work-')),
	}
	const { agentDir, workDir } = dirs
	const timerPath = join(agentDir, 'pomodoro.json')
	const calls = join(agentDir, 'calls')
	await rm(calls, { force: true })
	// By default a pomodoro just up, with no alert yet: a tick makes the check-in due, and alerts.
	if (earlier === undefined) {
		const now = Date.now()
		const seeded: Timer = {
			blockStart: now - worked,
			seenAt: now,
			alertedAt: 0,
		}
		await writeFile(timerPath, JSON.stringify(seeded))
	}
	const before: Timer = JSON.parse(await readFile(timerPath, 'utf8'))
	await settings?.(join(agentDir, 'pomodoro-settings.json'))
	await writeFile(
		join(agentDir, 'models.json'),
		JSON.stringify({
			providers: {
				smoke: {
					baseUrl: `http://127.0.0.1:${server.port}/v1`,
					api: 'openai-completions',
					apiKey: 'smoke',
					models: [
						{
							id: 'smoke',
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		}),
	)
	// Spawned, not run synchronously: this process answers the model's requests meanwhile.
	const child = Bun.spawn(
		[
			'node',
			join(pi, typeof bin === 'string' ? bin : bin.pi),
			'--mode',
			'json',
			'-p',
			'--session-dir',
			join(agentDir, 'sessions'),
			...(earlier === undefined ? [] : ['--continue']),
			'-ne',
			'-nc',
			'-e',
			resolve('packages/pi'),
			'--tools',
			'read,write',
			'--model',
			'smoke/smoke',
			PROMPT,
		],
		{
			cwd: workDir,
			env: {
				...env,
				PATH: `${fakes}:${process.env.PATH}`,
				PI_CODING_AGENT_DIR: agentDir,
				EVAL_POMODORO_TICK: '1',
				POMODORO_SMOKE_CALLS: calls,
			},
			stdout: 'ignore',
			stderr: 'pipe',
		},
	)
	const timeout = setTimeout(() => child.kill(), 60_000)
	const stderr = await new Response(child.stderr).text()
	await child.exited
	clearTimeout(timeout)
	const timer: Timer = JSON.parse(await readFile(timerPath, 'utf8'))
	const log: CheckIn[] = await readFile(
		join(agentDir, 'pomodoro-log.json'),
		'utf8',
	).then(JSON.parse, () => [])
	const called: string[][] = await readFile(calls, 'utf8').then(
		(text) =>
			text
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line)),
		() => [],
	)
	return {
		got: {
			seen,
			ticked: timer.seenAt !== before.seenAt,
			alerted: timer.alertedAt !== before.alertedAt,
			logged: log.map((c) => c.text),
			calls: called,
			crashed: stderr.includes('Extension error'),
		},
		stderr,
		dirs,
	}
}

// A settings file holding `text`.
const file = (text: string) => (path: string) => writeFile(path, text)
const off = {
	seen: ['assistant tool', 'assistant tool assistant tool'],
	ticked: false,
	alerted: false,
	logged: [],
	calls: [],
	crashed: false,
}
// Each run in new folders, except the one that continues the run before it: those folders stay until the next run is
// checked.
let earlier: Dirs | undefined
for (const [settings, expected, what] of [
	[
		undefined,
		{
			seen: ['assistant tool*', 'assistant tool* assistant tool'],
			ticked: true,
			alerted: true,
			logged: ['Pomodoro: wrote a.txt and b.txt.'],
			calls: [IOREG, LOCK, CHIME],
			crashed: false,
		},
		'the check-in came due with a tick that alerted, rode the first tool result, reached the model once, and its summary was logged',
	],
	// The same pomodoro, a few seconds on: the tick makes its check-in due again, without alerting again, and the
	// check-in kept in the session holds it back.
	[
		'continue',
		{
			seen: ['assistant tool', 'assistant tool assistant tool'],
			ticked: true,
			alerted: false,
			logged: ['Pomodoro: wrote a.txt and b.txt.'],
			calls: [IOREG, LOCK],
			crashed: false,
		},
		"the check-in wasn't given again in a run that continued the session that got it",
	],
	// 21 minutes in: no check-in or alert, and the heads-up, which Pi sends as a message of its own.
	[
		'heads-up',
		{
			seen: ['assistant tool user*', 'assistant tool user* assistant tool'],
			ticked: true,
			alerted: false,
			logged: [],
			calls: [IOREG, LOCK],
			crashed: false,
		},
		'the heads-up reached the model once, as a message after the first tool result, not in a tool result, and made no request of its own',
	],
	// A setting of an older version is ignored, and the timer runs.
	[
		file('{ "workMinutes": 0 }'),
		{
			seen: ['assistant tool*', 'assistant tool* assistant tool'],
			ticked: true,
			alerted: true,
			logged: ['Pomodoro: wrote a.txt and b.txt.'],
			calls: [IOREG, LOCK, CHIME],
			crashed: false,
		},
		'the check-in ran with a setting of an older version in its file',
	],
	[
		file('{ "sound": "yes" }'),
		off,
		'the check-in stayed off with a sound that is not a boolean',
	],
	[
		file('{ "workMinutes": 50'),
		off,
		'the check-in stayed off with a broken file',
	],
	[
		(path: string) => mkdir(path),
		off,
		"the check-in stayed off with a settings file it can't read",
	],
] as const) {
	const { got, stderr, dirs } =
		settings === 'continue'
			? await run(undefined, earlier)
			: settings === 'heads-up'
				? await run(undefined, undefined, 21 * MINUTE)
				: await run(settings)
	if (JSON.stringify(got) !== JSON.stringify(expected)) {
		console.error(
			`Pi ${version} (${what}): ${JSON.stringify(got)}, not ${JSON.stringify(expected)}.\n${stderr}`,
		)
		await rm(fakes, { recursive: true, force: true })
		await clean(dirs)
		if (earlier !== undefined && earlier !== dirs) await clean(earlier)
		process.exit(1)
	}
	console.log(`Pi ${version}: ${what}.`)
	if (earlier !== undefined && earlier !== dirs) await clean(earlier)
	earlier = dirs
}
if (earlier !== undefined) await clean(earlier)
await rm(fakes, { recursive: true, force: true })
server.stop(true)
