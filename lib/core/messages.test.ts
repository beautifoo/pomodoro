import { expect, test } from 'bun:test'
import { type Language, languageFrom, messages } from './messages'

test("languageFrom follows Claude Code's setting, then the Mac's first language, then English", () => {
	const mac = '(\n    "zh-Hans-CH",\n    "en-US"\n)'
	expect(languageFrom('  Italiano ', mac)).toBe('it')
	expect(languageFrom('GERMAN', '')).toBe('de')
	expect(languageFrom('français', '')).toBe('fr')
	expect(languageFrom('Español', '')).toBe('es')
	expect(languageFrom('pt-BR', '')).toBe('pt')
	expect(languageFrom('русский', '')).toBe('ru')
	expect(languageFrom('中文', '')).toBe('zh')
	expect(languageFrom('japanese', mac)).toBe('en') // set but not one of ours
	expect(languageFrom(undefined, mac)).toBe('zh')
	expect(languageFrom('', '(\n    "fr-CH"\n)')).toBe('fr') // empty is unset
	expect(languageFrom(42, '')).toBe('en')
	expect(languageFrom(undefined, 'garbage')).toBe('en')
})

const DAY = {
	mark: '🍅 ',
	pomodoros: 3,
	yesterday: 2,
	longBreaks: 1,
	skipped: 2,
	longest: 75,
}

// What each language says, one of each.
const said = (language: Language) => {
	const text = messages[language]
	return [
		text.description,
		text.usage,
		text.today(DAY),
		text.noPomodoros,
		text.onABreak,
		text.count(3, 12),
		text.due(25),
		text.dueLong(100),
		text.alert(52),
		text.alertLong(100),
		text.back(4, 2),
		text.backLong(22),
		text.quiet,
		text.quietOn,
		text.quietOff,
		text.notice,
		text.settings.sound.label,
		text.settings.sound.description,
		text.settings.emoji.label,
		text.settings.emoji.description,
		text.off(['x', 'y'], '/a/b.json'),
		text.notObject,
		text.notBoolean('sound'),
		text.unreadable('EISDIR'),
		text.notJson,
	]
}

test('every language says everything in its own words', () => {
	const english = said('en')
	for (const language of Object.keys(messages) as Language[]) {
		const own = said(language)
		expect(own.join('\n')).not.toContain('undefined')
		expect(own.every((text) => text.trim() !== '')).toBe(true)
		if (language !== 'en')
			for (const [i, text] of own.entries()) expect(text).not.toBe(english[i])
	}
})

test('English reads as it always has, and the time away is in hours from 2 hours', () => {
	const { en } = messages
	expect(en.count(3, 12)).toBe('3 of 4 · 12/25m')
	expect(en.today(DAY)).toBe(
		'Today: 🍅 3 pomodoros (yesterday 2), 1 long break, 2 breaks skipped, longest 75m',
	)
	expect(en.back(119, 2)).toBe('Back after 119m · pomodoro 2 of 4')
	expect(en.backLong(840)).toBe('Back after 14h · new set, pomodoro 1 of 4')
	expect(en.backLong(150)).toBe('Back after 2h · new set, pomodoro 1 of 4')
	expect(en.quietOn).toBe(
		'Quiet is on: no alerts or check-ins until you run /pomodoro quiet again, or lock the screen or close the lid for 3 minutes. The count goes on.',
	)
	for (const language of Object.keys(messages) as Language[]) {
		expect(messages[language].backLong(840)).toContain('14')
		expect(messages[language].backLong(840)).not.toContain('840')
		expect(messages[language].back(22, 2)).toContain('22')
	}
})

// A count, a fraction, and a time away that reads as a time away, not a time of day.
test('Chinese and French read naturally', () => {
	const { zh, fr } = messages
	expect(zh.count(3, 12)).toBe('3/4 · 12/25分钟')
	expect(zh.back(4, 2)).toBe('回来了，离开了4分钟 · 番茄钟 2/4')
	expect(zh.backLong(840)).toBe('回来了，离开了14小时 · 新一轮，番茄钟 1/4')
	expect(fr.back(4, 2)).toBe('Absence de 4 min · pomodoro 2 sur 4')
	expect(fr.backLong(840)).toBe(
		'Absence de 14 h · nouvelle série, pomodoro 1 sur 4',
	)
	expect(fr.today(DAY)).toEndWith(', record sans pause 75 min')
})

// One, few and many: 1, 21; 2, 22; 5, 11, 25.
test('Russian has a form for one, a few and many', () => {
	const word = (minutes: number) => messages.ru.alert(minutes).split(' ')[1]
	expect(new Set([word(1), word(2), word(5)]).size).toBe(3)
	expect([word(21), word(22), word(11), word(25)]).toEqual([
		word(1),
		word(2),
		word(5),
		word(5),
	])
})
