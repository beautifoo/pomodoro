// What the person reads, by language. The notes to the agent stay in English, in index.ts.

export type Language = 'en' | 'it' | 'de' | 'fr' | 'es' | 'pt' | 'ru' | 'zh'

export type Messages = {
	// The /pomodoro command's description, and its usage line.
	description: string
	usage: string
	noCheckIns: string
	noRepository: string
	// The label while on a break, the count (minutes of the pomodoro's length), and the warning once it's up.
	onABreak: string
	count: (minutes: number, workMinutes: number) => string
	warning: (minutes: number) => string
	alert: (minutes: number, breakMinutes: number) => string
	// Once the check-in went out.
	notice: string
}

const en: Messages = {
	description: "Lists today's check-ins by repository.",
	usage: 'Usage: /pomodoro [today]',
	noCheckIns: 'No check-ins today.',
	noRepository: 'no repository',
	onABreak: 'on a break',
	count: (minutes, workMinutes) => `${minutes}/${workMinutes}m`,
	warning: (minutes) => `${minutes}m, time for a break`,
	alert: (minutes, breakMinutes) =>
		`${minutes} minutes without a break. Stand up and look away from the screen for ${breakMinutes}.`,
	notice: 'Pomodoro: told the agent your pomodoro is up.',
}

// ponytail: every language is English until the translations land
export const messages: Record<Language, Messages> = {
	en,
	it: en,
	de: en,
	fr: en,
	es: en,
	pt: en,
	ru: en,
	zh: en,
}

// The command that prints the Mac's preferred languages, first first.
export const APPLE_LANGUAGES = [
	'defaults',
	'read',
	'-g',
	'AppleLanguages',
] as const

// A language's code, its English name and its own name, as a person may write it.
const NAMES: Record<Language, string[]> = {
	en: ['en', 'english'],
	it: ['it', 'italian', 'italiano'],
	de: ['de', 'german', 'deutsch'],
	fr: ['fr', 'french', 'français', 'francais'],
	es: ['es', 'spanish', 'español', 'espanol'],
	pt: ['pt', 'portuguese', 'português', 'portugues'],
	ru: ['ru', 'russian', 'русский'],
	zh: ['zh', 'chinese', '中文', '汉语', '简体中文', '繁體中文'],
}

// The language a name or a code (en-US, pt_BR) stands for; undefined: not one of ours.
function named(name: string): Language | undefined {
	const text = name.trim().toLowerCase()
	const found = (Object.keys(NAMES) as Language[]).find((language) =>
		NAMES[language].some((n) => n === text || n === text.split(/[-_]/)[0]),
	)
	return found
}

// Claude Code's free-text `language` setting; else the Mac's first preferred language (`defaults` output, an old-style
// plist); else English. A setting that's set but not one of ours is English, not the Mac's.
export function languageFrom(
	setting: unknown,
	appleLanguages: string,
): Language {
	if (typeof setting === 'string' && setting.trim() !== '')
		return named(setting) ?? 'en'
	const first = appleLanguages.match(/"([^"]+)"/)?.[1]
	return (first === undefined ? undefined : named(first)) ?? 'en'
}
