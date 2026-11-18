// The shared timer, and what each change to it keeps. A change that writes the whole timer names every field, so a new
// field doesn't compile until each says whether it keeps it.

// Shared by every open session through the agent's store: one pomodoro per person, not per session. `blockStart` is when
// the stretch of work since the last break began, `done` the pomodoros of the set before it, `lastInput` the person's
// own (while quiet, the person is there until a tick sees the screen locked),
// `breakStart` when the break under way began, `quiet` whether /pomodoro quiet is on, since `quietAt` (0.8.0 kept no
// start). `repo` is the repository the tally credits, that of the ticking session with the latest activity, at
// `repoAt`; `counted` the pomodoros of this stretch already in the tally.
export interface Timer {
	blockStart?: number
	done?: number
	seenAt?: number
	alertedAt?: number
	lastInput?: number
	breakStart?: number
	quiet?: boolean
	quietAt?: number
	repo?: string | null
	repoAt?: number
	counted?: number
}

// Every field of `T`, each named even when it's undefined.
type Every<T> = { [K in keyof Required<T>]: T[K] }

// A tick's time, and the person's last input then.
interface Seen {
	now: number
	lastInput: number
}

// A break, under way or begun at the person's last input. The stretch before it, the set, the last alert, the credit
// and the tally's count are kept for the return, which may find it was none; quiet isn't.
export const onBreak = (
	timer: Timer,
	{ now, lastInput }: Seen,
): Every<Timer> => ({
	blockStart: timer.blockStart,
	done: timer.done,
	seenAt: now,
	alertedAt: timer.alertedAt,
	lastInput,
	breakStart: timer.breakStart ?? lastInput,
	quiet: undefined,
	quietAt: undefined,
	repo: timer.repo ?? null,
	repoAt: timer.repoAt,
	counted: timer.counted ?? 0,
})

// What a tick off a break found: the stretch since the last break, the set before it, the last alert, whether it's
// quiet, and the pomodoros of the stretch in the tally.
interface Working extends Seen {
	blockStart: number
	done: number
	alertedAt: number
	quiet: boolean
	counted: number
}

// A tick off a break: the break under way, if any, is over, whether the person came back from it or it was none.
export const working = (
	timer: Timer,
	{ now, lastInput, blockStart, done, alertedAt, quiet, counted }: Working,
): Every<Timer> => ({
	blockStart,
	done,
	seenAt: now,
	alertedAt,
	lastInput,
	breakStart: undefined,
	quiet,
	quietAt: quiet ? timer.quietAt : undefined,
	repo: timer.repo ?? null,
	repoAt: timer.repoAt,
	counted,
})

// The tally credits the repository of the ticking session with the latest activity: this one's, once its `activity` is
// newer than the credit's, or there's none. Not during a break: the stretch before it, and the break, count for the
// repository in use when the person left.
export const credited = (
	timer: Timer,
	activity: number,
	repo: string | null,
): Timer =>
	timer.breakStart == null && activity > (timer.repoAt ?? -1)
		? { ...timer, repo, repoAt: activity }
		: timer

// /pomodoro quiet, on or off. Off, it forgets the last alert, so a break due alerts at once, even within 5 minutes of it.
export const quietToggled = (timer: Timer, now: number): Timer =>
	timer.quiet
		? { ...timer, quiet: false, quietAt: undefined, alertedAt: undefined }
		: { ...timer, quiet: true, quietAt: now }
