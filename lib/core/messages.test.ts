import { expect, test } from 'bun:test'
import { languageFrom } from './messages'

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
