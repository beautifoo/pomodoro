import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { credited, onBreak, quietToggled, type Timer, working } from './timer'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

// Every field of the timer, so a new one doesn't compile until it's here too.
const fields = {
	blockStart: fc.nat(),
	done: fc.nat({ max: 8 }),
	seenAt: fc.nat(),
	alertedAt: fc.nat(),
	lastInput: fc.nat(),
	agentAt: fc.nat(),
	breakStart: fc.nat(),
	quiet: fc.boolean(),
	quietAt: fc.nat(),
	repo: fc.option(fc.string(), { nil: null }),
	repoAt: fc.nat(),
	counted: fc.nat({ max: 8 }),
} as const satisfies { [K in keyof Required<Timer>]: fc.Arbitrary<Timer[K]> }
// A timer as any version may have stored it, with some of its fields or none; and one with all of them.
const stored = fc.record(fields, { requiredKeys: [] })
const full = fc.record(fields)
// A tick's time and the person's and the main agent's last presence then; off a break, with what the tick found.
const presence = { now: fc.nat(), lastInput: fc.nat(), agentAt: fc.nat() }
const seen = fc.record(presence)
const found = fc.record({
	...presence,
	blockStart: fc.nat(),
	done: fc.nat({ max: 8 }),
	alertedAt: fc.nat(),
	quiet: fc.boolean(),
	counted: fc.nat({ max: 8 }),
})
// The timer's fields, in order.
const FIELDS = [
	'agentAt',
	'alertedAt',
	'blockStart',
	'breakStart',
	'counted',
	'done',
	'lastInput',
	'quiet',
	'quietAt',
	'repo',
	'repoAt',
	'seenAt',
]

test('a break ends quiet', () => {
	const timer = onBreak(
		{ blockStart: T0, seenAt: T0 + 20 * MINUTE, quiet: true },
		{
			now: T0 + 24 * MINUTE,
			lastInput: T0 + 21 * MINUTE,
			agentAt: T0 + 21 * MINUTE,
		},
	)
	expect(timer.quiet).toBeUndefined()
})

test("a first break, with nothing stored, begins at the person's last input and credits no repository", () => {
	expect(
		onBreak({}, { now: T0 + 4 * MINUTE, lastInput: T0, agentAt: T0 + MINUTE }),
	).toEqual({
		blockStart: undefined,
		done: undefined,
		seenAt: T0 + 4 * MINUTE,
		alertedAt: undefined,
		lastInput: T0,
		agentAt: T0 + MINUTE,
		breakStart: T0,
		quiet: undefined,
		quietAt: undefined,
		repo: null,
		repoAt: undefined,
		counted: 0,
	})
})

test('whatever the timer, a break ends quiet', () => {
	fc.assert(
		fc.property(stored, seen, (timer, tick) => {
			expect(onBreak(timer, tick).quiet).toBeUndefined()
		}),
	)
})

test('whatever the timer, a break keeps the stretch, the set, the last alert, the credit and the tally', () => {
	fc.assert(
		fc.property(full, seen, (timer, tick) => {
			const { blockStart, done, alertedAt, repo, repoAt, counted } = onBreak(
				timer,
				tick,
			)
			expect({ blockStart, done, alertedAt, repo, repoAt, counted }).toEqual({
				blockStart: timer.blockStart,
				done: timer.done,
				alertedAt: timer.alertedAt,
				repo: timer.repo,
				repoAt: timer.repoAt,
				counted: timer.counted,
			})
		}),
	)
})

test('a break already under way keeps its start, whatever the tick', () => {
	fc.assert(
		fc.property(full, seen, (timer, tick) => {
			expect(onBreak(timer, tick).breakStart).toBe(timer.breakStart)
		}),
	)
})

test('a break writes exactly the timer, less any field an older version left', () => {
	fc.assert(
		fc.property(stored, seen, (timer, tick) => {
			const older = { ...timer, checkInAt: T0 }
			expect(Object.keys(onBreak(older, tick)).sort()).toEqual(FIELDS)
		}),
	)
})

test('coming back from a break clears it', () => {
	const timer = working(
		{ blockStart: T0, breakStart: T0 + 21 * MINUTE },
		{
			now: T0 + 30 * MINUTE,
			lastInput: T0 + 30 * MINUTE,
			agentAt: T0 + 21 * MINUTE,
			blockStart: T0 + 29 * MINUTE,
			done: 0,
			alertedAt: 0,
			quiet: false,
			counted: 0,
		},
	)
	expect(timer.breakStart).toBeUndefined()
})

test('whatever the timer, a tick off a break clears the break under way', () => {
	fc.assert(
		fc.property(stored, found, (timer, tick) => {
			expect(working(timer, tick).breakStart).toBeUndefined()
		}),
	)
})

test('whatever the timer, a tick off a break keeps the credit', () => {
	fc.assert(
		fc.property(full, found, (timer, tick) => {
			const { repo, repoAt } = working(timer, tick)
			expect({ repo, repoAt }).toEqual({
				repo: timer.repo,
				repoAt: timer.repoAt,
			})
		}),
	)
})

test('a tick off a break writes exactly the timer, less any field an older version left', () => {
	fc.assert(
		fc.property(stored, found, (timer, tick) => {
			const older = { ...timer, checkInAt: T0 }
			expect(Object.keys(working(older, tick)).sort()).toEqual(FIELDS)
		}),
	)
})

test('activity newer than the credit takes it for this repository', () => {
	expect(credited({ repo: '/a', repoAt: T0 }, T0 + MINUTE, '/b')).toEqual({
		repo: '/b',
		repoAt: T0 + MINUTE,
	})
})

test('during a break the credit stays with the repository in use when the person left', () => {
	expect(
		credited(
			{ repo: '/a', repoAt: T0, breakStart: T0 + MINUTE },
			T0 + 5 * MINUTE,
			'/b',
		),
	).toEqual({ repo: '/a', repoAt: T0, breakStart: T0 + MINUTE })
})

// A timer stored off a break, with some of its fields or none.
const offBreak = stored.map((timer) => ({ ...timer, breakStart: undefined }))

test('whatever the activity, during a break the credit stays', () => {
	fc.assert(
		fc.property(full, fc.nat(), fields.repo, (timer, activity, repo) => {
			expect(credited(timer, activity, repo)).toEqual(timer)
		}),
	)
})

test("activity at the credit's own time leaves it", () => {
	expect(credited({ repo: '/a', repoAt: T0 }, T0, '/b')).toEqual({
		repo: '/a',
		repoAt: T0,
	})
})

// Off a break, with a credit and activity up to its time, the bounds most often.
const notNewer = full.chain((timer) =>
	fc.tuple(
		fc.constant({ ...timer, breakStart: undefined }),
		fc.nat({ max: timer.repoAt }),
	),
)

test('activity no newer than the credit leaves it', () => {
	fc.assert(
		fc.property(notNewer, fields.repo, ([timer, activity], repo) => {
			expect(credited(timer, activity, repo)).toEqual(timer)
		}),
	)
})

test('newer activity off a break takes the credit for this repository and keeps the rest', () => {
	fc.assert(
		fc.property(offBreak, fc.nat(), fields.repo, (timer, activity, repo) => {
			fc.pre(activity > (timer.repoAt ?? -1))
			expect(credited(timer, activity, repo)).toEqual({
				...timer,
				repo,
				repoAt: activity,
			})
		}),
	)
})

test('crediting twice is the same as once', () => {
	fc.assert(
		fc.property(stored, fc.nat(), fields.repo, (timer, activity, repo) => {
			const once = credited(timer, activity, repo)
			expect(credited(once, activity, repo)).toEqual(once)
		}),
	)
})

test('turning quiet off forgets the last alert and when it began', () => {
	expect(
		quietToggled({ quiet: true, quietAt: T0, alertedAt: T0 }, T0 + MINUTE),
	).toEqual({ quiet: false, quietAt: undefined, alertedAt: undefined })
})

test('turning quiet on keeps the last alert and notes when', () => {
	expect(quietToggled({ alertedAt: T0 }, T0 + MINUTE)).toEqual({
		quiet: true,
		quietAt: T0 + MINUTE,
		alertedAt: T0,
	})
})

// A timer stored while quiet, and one stored while not, with any other fields.
const quiet = stored.map((timer) => ({ ...timer, quiet: true }))
const notQuiet = stored.filter((timer) => timer.quiet !== true)

test('toggling quiet twice gives back the same quiet', () => {
	fc.assert(
		fc.property(stored, fc.nat(), (timer, now) => {
			expect(quietToggled(quietToggled(timer, now), now).quiet).toBe(
				timer.quiet === true,
			)
		}),
	)
})

test('whatever the timer, turning quiet off forgets the last alert', () => {
	fc.assert(
		fc.property(quiet, fc.nat(), (timer, now) => {
			expect(quietToggled(timer, now).alertedAt).toBeUndefined()
		}),
	)
})

test('whatever the timer, turning quiet off forgets when it began', () => {
	fc.assert(
		fc.property(quiet, fc.nat(), (timer, now) => {
			expect(quietToggled(timer, now).quietAt).toBeUndefined()
		}),
	)
})

test('whatever the timer, turning quiet on keeps the last alert', () => {
	fc.assert(
		fc.property(notQuiet, fc.nat(), (timer, now) => {
			expect(quietToggled(timer, now).alertedAt).toBe(timer.alertedAt)
		}),
	)
})

test('whatever the timer, turning quiet on sets it', () => {
	fc.assert(
		fc.property(notQuiet, fc.nat(), (timer, now) => {
			expect(quietToggled(timer, now).quiet).toBe(true)
		}),
	)
})

test('whatever the timer, turning quiet on notes when', () => {
	fc.assert(
		fc.property(notQuiet, fc.nat(), (timer, now) => {
			expect(quietToggled(timer, now).quietAt).toBe(now)
		}),
	)
})

test('toggling quiet keeps everything but quiet, when it began and the last alert', () => {
	fc.assert(
		fc.property(stored, fc.nat(), (timer, now) => {
			const left = {
				quiet: undefined,
				quietAt: undefined,
				alertedAt: undefined,
			}
			expect({ ...quietToggled(timer, now), ...left }).toEqual({
				...timer,
				...left,
			})
		}),
	)
})

test('whatever the timer, a tick off a break keeps when quiet began while quiet, and forgets it after', () => {
	fc.assert(
		fc.property(full, found, (timer, tick) => {
			expect(working(timer, tick).quietAt).toBe(
				tick.quiet ? timer.quietAt : undefined,
			)
		}),
	)
})
