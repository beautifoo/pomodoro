// What the person reads, by language. The notes to the agent stay in English, in index.ts.

export type Language = 'en' | 'it' | 'de' | 'fr' | 'es' | 'pt' | 'ru' | 'zh'

export type Messages = {
	// The /pomodoro command's description, and its usage line.
	description: string
	usage: string
	// /pomodoro today's first line: the day's pomodoros, yesterday's, the long breaks, the breaks skipped (a pomodoro
	// followed by another with no break) and the longest stretch without a break in minutes, after `mark` (the 🍅 or
	// nothing); or that no pomodoro has counted today.
	today: (day: {
		mark: string
		pomodoros: number
		yesterday: number
		longBreaks: number
		skipped: number
		longest: number
	}) => string
	noPomodoros: string
	// The word in place of the 🍅 in the footer, when the emoji is off.
	name: string
	// The label while on a break; the count, of the pomodoro under way in the set of 4 and the minutes into it; the
	// warning once a pomodoro is up, and the alert, each with the minutes since the last break, asking for the long break
	// at the end of a set.
	onABreak: string
	count: (position: number, minutes: number) => string
	due: (minutes: number) => string
	dueLong: (minutes: number) => string
	alert: (minutes: number) => string
	alertLong: (minutes: number) => string
	// Back from a break: the minutes away, and the pomodoro of the set taken up again, or a new set after a long break.
	back: (minutes: number, position: number) => string
	backLong: (minutes: number) => string
	// The word before the count while quiet, and what /pomodoro quiet says as it turns quiet on, and off.
	quiet: string
	quietOn: string
	quietOff: string
	// Once the check-in went out.
	notice: string
	// Claude Code's /config rows for the two settings.
	settings: Record<'sound' | 'emoji', { label: string; description: string }>
	// Pi's line when the settings file is wrong, with what's wrong and the file; each thing that can be.
	off: (problems: string[], path: string) => string
	notObject: string
	notBoolean: (key: string) => string
	unreadable: (code: string) => string
	notJson: string
}

// `count` and its noun in the form the number takes in `locale`: `one` and `other`, and Russian's `few` (2 to 4, 22 to
// 24…) and `many` (0, 5 to 20, 25…).
const plural = (
	locale: string,
	count: number,
	forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
) =>
	`${count} ${forms[new Intl.PluralRules(locale).select(count)] ?? forms.other}`

// Minutes away, in whole hours from 2 hours (a night away reads 14h, not 840m), with the units `m` and `h`.
const away = (minutes: number, m: string, h: string) =>
	minutes >= 120 ? `${Math.floor(minutes / 60)}${h}` : `${minutes}${m}`

const en: Messages = {
	description:
		"Shows today's pomodoros and check-ins in this repository, or turns quiet on or off to hold the alerts during a meeting.",
	usage: 'Usage: /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Today: ${mark}${plural('en', pomodoros, { one: 'pomodoro', other: 'pomodoros' })} (yesterday ${yesterday}), ${plural('en', longBreaks, { one: 'long break', other: 'long breaks' })}, ${plural('en', skipped, { one: 'break', other: 'breaks' })} skipped, longest ${longest}m`,
	noPomodoros: 'Today: no pomodoros yet.',
	name: 'pomodoro',
	onABreak: 'on a break',
	count: (position, minutes) => `${position} of 4 · ${minutes}/25m`,
	due: (minutes) => `${minutes}m, time for a break`,
	dueLong: (minutes) => `${minutes}m, time for a long break`,
	alert: (minutes) =>
		`${minutes} minutes without a break. Stand up and look away from the screen for 3 to 5 minutes.`,
	alertLong: (minutes) =>
		`${minutes} minutes without a break. Your set of 4 pomodoros is done: take a 15 to 30 minute break.`,
	back: (minutes, position) =>
		`Back after ${away(minutes, 'm', 'h')} · pomodoro ${position} of 4`,
	backLong: (minutes) =>
		`Back after ${away(minutes, 'm', 'h')} · new set, pomodoro 1 of 4`,
	quiet: 'quiet',
	quietOn:
		'Quiet is on: no alerts or check-ins until you run /pomodoro quiet again, or lock the screen or close the lid for 3 minutes. The count goes on.',
	quietOff: 'Quiet is off.',
	notice: 'Pomodoro: told the agent your pomodoro is up.',
	settings: {
		sound: {
			label: 'Chime',
			description:
				'Play a chime with each alert (macOS). You hear it through a Focus, and while the Claude tab is in front, where Ghostty shows the banner for a few seconds only.',
		},
		emoji: {
			label: 'Tomato emoji',
			description:
				"Show 🍅 in the count, the status line, the toasts and the transcript note. Off, the footer count reads 'pomodoro 3 of 4 · 12/25m'.",
		},
	},
	off: (problems, path) => `Pomodoro is off: ${problems.join('; ')} (${path}).`,
	notObject: 'the file must hold a JSON object',
	notBoolean: (key) => `${key} must be a boolean`,
	unreadable: (code) => `the file can't be read (${code})`,
	notJson: "the file isn't valid JSON",
}

const it: Messages = {
	description:
		'Mostra i pomodori e i check-in di oggi in questo repository, o attiva e disattiva il silenzio per sospendere gli avvisi durante una riunione.',
	usage: 'Uso: /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Oggi: ${mark}${plural('it', pomodoros, { one: 'pomodoro', other: 'pomodori' })} (ieri ${yesterday}), ${plural('it', longBreaks, { one: 'pausa lunga', other: 'pause lunghe' })}, ${plural('it', skipped, { one: 'pausa saltata', other: 'pause saltate' })}, massimo senza pausa ${longest} min`,
	noPomodoros: 'Oggi: ancora nessun pomodoro.',
	name: 'pomodoro',
	onABreak: 'in pausa',
	count: (position, minutes) => `${position} di 4 · ${minutes}/25 min`,
	due: (minutes) => `${minutes} min, è ora di una pausa`,
	dueLong: (minutes) => `${minutes} min, è ora di una pausa lunga`,
	alert: (minutes) =>
		`${plural('it', minutes, { one: 'minuto', other: 'minuti' })} senza pausa. Alzati e distogli lo sguardo dallo schermo per 3-5 minuti.`,
	alertLong: (minutes) =>
		`${plural('it', minutes, { one: 'minuto', other: 'minuti' })} senza pausa. Hai finito la serie di 4 pomodori: fai una pausa di 15-30 minuti.`,
	back: (minutes, position) =>
		`Di ritorno dopo ${away(minutes, ' min', ' ore')} · pomodoro ${position} di 4`,
	backLong: (minutes) =>
		`Di ritorno dopo ${away(minutes, ' min', ' ore')} · nuova serie, pomodoro 1 di 4`,
	quiet: 'silenzio',
	quietOn:
		'Silenzio attivo: niente avvisi né check-in finché non esegui di nuovo /pomodoro quiet, o blocchi lo schermo o chiudi il portatile per 3 minuti. Il conteggio continua.',
	quietOff: 'Silenzio disattivato.',
	notice: "Pomodoro: ho detto all'agente che il tuo pomodoro è finito.",
	settings: {
		sound: {
			label: 'Suono',
			description:
				'Riproduce un suono a ogni avviso (macOS). Lo senti anche con una Full immersione attiva, e quando la scheda di Claude è in primo piano, dove Ghostty mostra il banner solo per pochi secondi.',
		},
		emoji: {
			label: 'Emoji del pomodoro',
			description:
				"Mostra 🍅 nel conteggio, nella riga di stato, nei messaggi a comparsa e nella nota della conversazione. Se è disattivato, il conteggio in basso è 'pomodoro 3 di 4 · 12/25 min'.",
		},
	},
	off: (problems, path) =>
		`Pomodoro è disattivato: ${problems.join('; ')} (${path}).`,
	notObject: 'il file deve contenere un oggetto JSON',
	notBoolean: (key) => `${key} deve essere true o false`,
	unreadable: (code) => `il file non si può leggere (${code})`,
	notJson: 'il file non è un JSON valido',
}

const de: Messages = {
	description:
		'Zeigt die heutigen Pomodoros und Check-ins in diesem Repository oder schaltet die Benachrichtigungen während eines Meetings stumm und wieder an.',
	usage: 'Verwendung: /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Heute: ${mark}${plural('de', pomodoros, { one: 'Pomodoro', other: 'Pomodoros' })} (gestern ${yesterday}), ${plural('de', longBreaks, { one: 'lange Pause', other: 'lange Pausen' })}, ${plural('de', skipped, { one: 'Pause', other: 'Pausen' })} ausgelassen, am längsten ohne Pause ${longest} min`,
	noPomodoros: 'Heute: noch keine Pomodoros.',
	name: 'Pomodoro',
	onABreak: 'in der Pause',
	count: (position, minutes) => `${position} von 4 · ${minutes}/25 min`,
	due: (minutes) => `${minutes} min, Zeit für eine Pause`,
	dueLong: (minutes) => `${minutes} min, Zeit für eine lange Pause`,
	alert: (minutes) =>
		`${plural('de', minutes, { one: 'Minute', other: 'Minuten' })} ohne Pause. Steh auf und schau 3 bis 5 Minuten vom Bildschirm weg.`,
	alertLong: (minutes) =>
		`${plural('de', minutes, { one: 'Minute', other: 'Minuten' })} ohne Pause. Deine Runde aus 4 Pomodoros ist geschafft: Mach 15 bis 30 Minuten Pause.`,
	back: (minutes, position) =>
		`Zurück nach ${away(minutes, ' min', ' Stunden')} · Pomodoro ${position} von 4`,
	backLong: (minutes) =>
		`Zurück nach ${away(minutes, ' min', ' Stunden')} · neue Runde, Pomodoro 1 von 4`,
	quiet: 'stumm',
	quietOn:
		'Stumm geschaltet: keine Benachrichtigungen oder Check-ins, bis du /pomodoro quiet erneut ausführst oder 3 Minuten lang den Bildschirm sperrst oder den Laptop zuklappst. Die Zählung läuft weiter.',
	quietOff: 'Stummschaltung aus.',
	notice: 'Pomodoro: Der Agent weiß jetzt, dass dein Pomodoro um ist.',
	settings: {
		sound: {
			label: 'Signalton',
			description:
				'Spielt bei jeder Benachrichtigung einen Ton ab (macOS). Du hörst ihn auch in einem Fokus und wenn der Claude-Tab vorne ist, wo Ghostty das Banner nur ein paar Sekunden zeigt.',
		},
		emoji: {
			label: 'Tomaten-Emoji',
			description:
				"Zeigt 🍅 in der Zählung, der Statuszeile, den Einblendungen und dem Hinweis im Verlauf. Ist es aus, steht unten 'Pomodoro 3 von 4 · 12/25 min'.",
		},
	},
	off: (problems, path) =>
		`Pomodoro ist aus: ${problems.join('; ')} (${path}).`,
	notObject: 'die Datei muss ein JSON-Objekt enthalten',
	notBoolean: (key) => `${key} muss true oder false sein`,
	unreadable: (code) => `die Datei kann nicht gelesen werden (${code})`,
	notJson: 'die Datei ist kein gültiges JSON',
}

const fr: Messages = {
	description:
		'Affiche les pomodoros et check-ins du jour dans ce dépôt, ou active et désactive le mode silencieux pour suspendre les alertes pendant une réunion.',
	usage: 'Utilisation : /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Aujourd'hui : ${mark}${plural('fr', pomodoros, { one: 'pomodoro', other: 'pomodoros' })} (hier ${yesterday}), ${plural('fr', longBreaks, { one: 'longue pause', other: 'longues pauses' })}, ${plural('fr', skipped, { one: 'pause sautée', other: 'pauses sautées' })}, plus long sans pause ${longest} min`,
	noPomodoros: "Aujourd'hui : pas encore de pomodoro.",
	name: 'pomodoro',
	onABreak: 'en pause',
	count: (position, minutes) => `${position} sur 4 · ${minutes}/25 min`,
	due: (minutes) => `${minutes} min, c'est l'heure de la pause`,
	dueLong: (minutes) => `${minutes} min, c'est l'heure de la longue pause`,
	alert: (minutes) =>
		`${plural('fr', minutes, { one: 'minute', other: 'minutes' })} sans pause. Levez-vous et détournez le regard de l'écran pendant 3 à 5 minutes.`,
	alertLong: (minutes) =>
		`${plural('fr', minutes, { one: 'minute', other: 'minutes' })} sans pause. Votre série de 4 pomodoros est terminée : faites une pause de 15 à 30 minutes.`,
	back: (minutes, position) =>
		`De retour après ${away(minutes, ' min', ' h')} · pomodoro ${position} sur 4`,
	backLong: (minutes) =>
		`De retour après ${away(minutes, ' min', ' h')} · nouvelle série, pomodoro 1 sur 4`,
	quiet: 'silencieux',
	quietOn:
		"Mode silencieux activé : aucune alerte ni check-in jusqu'à ce que vous relanciez /pomodoro quiet, ou que vous verrouilliez l'écran ou fermiez le portable pendant 3 minutes. Le comptage continue.",
	quietOff: 'Mode silencieux désactivé.',
	notice: "Pomodoro : l'agent sait que votre pomodoro est terminé.",
	settings: {
		sound: {
			label: 'Son',
			description:
				"Joue un son à chaque alerte (macOS). Vous l'entendez même en mode Concentration, et quand l'onglet de Claude est au premier plan, où Ghostty n'affiche la bannière que quelques secondes.",
		},
		emoji: {
			label: 'Emoji tomate',
			description:
				"Affiche 🍅 dans le compteur, la ligne d'état, les notifications et la note de la conversation. Désactivé, le compteur en bas affiche « pomodoro 3 sur 4 · 12/25 min ».",
		},
	},
	off: (problems, path) =>
		`Pomodoro est désactivé : ${problems.join(' ; ')} (${path}).`,
	notObject: 'le fichier doit contenir un objet JSON',
	notBoolean: (key) => `${key} doit valoir true ou false`,
	unreadable: (code) => `impossible de lire le fichier (${code})`,
	notJson: "le fichier n'est pas un JSON valide",
}

const es: Messages = {
	description:
		'Muestra los pomodoros y check-ins de hoy en este repositorio, o activa y desactiva el modo silencio para pausar las alertas durante una reunión.',
	usage: 'Uso: /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Hoy: ${mark}${plural('es', pomodoros, { one: 'pomodoro', other: 'pomodoros' })} (ayer ${yesterday}), ${plural('es', longBreaks, { one: 'descanso largo', other: 'descansos largos' })}, ${plural('es', skipped, { one: 'descanso saltado', other: 'descansos saltados' })}, máximo sin descanso ${longest} min`,
	noPomodoros: 'Hoy: aún no hay pomodoros.',
	name: 'pomodoro',
	onABreak: 'en descanso',
	count: (position, minutes) => `${position} de 4 · ${minutes}/25 min`,
	due: (minutes) => `${minutes} min, hora de descansar`,
	dueLong: (minutes) => `${minutes} min, hora de un descanso largo`,
	alert: (minutes) =>
		`${plural('es', minutes, { one: 'minuto', other: 'minutos' })} sin descanso. Levántate y aparta la vista de la pantalla de 3 a 5 minutos.`,
	alertLong: (minutes) =>
		`${plural('es', minutes, { one: 'minuto', other: 'minutos' })} sin descanso. Tu serie de 4 pomodoros está completa: tómate un descanso de 15 a 30 minutos.`,
	back: (minutes, position) =>
		`De vuelta tras ${away(minutes, ' min', ' h')} · pomodoro ${position} de 4`,
	backLong: (minutes) =>
		`De vuelta tras ${away(minutes, ' min', ' h')} · nueva serie, pomodoro 1 de 4`,
	quiet: 'silencio',
	quietOn:
		'Modo silencio activado: sin alertas ni check-ins hasta que vuelvas a ejecutar /pomodoro quiet, o bloquees la pantalla o cierres la tapa durante 3 minutos. El conteo sigue.',
	quietOff: 'Modo silencio desactivado.',
	notice: 'Pomodoro: el agente sabe que tu pomodoro terminó.',
	settings: {
		sound: {
			label: 'Sonido',
			description:
				'Reproduce un sonido con cada alerta (macOS). Lo oyes incluso con un modo de concentración activo, y cuando la pestaña de Claude está al frente, donde Ghostty muestra el aviso solo unos segundos.',
		},
		emoji: {
			label: 'Emoji de tomate',
			description:
				"Muestra 🍅 en el contador, la línea de estado, los avisos y la nota de la conversación. Desactivado, el contador de abajo dice 'pomodoro 3 de 4 · 12/25 min'.",
		},
	},
	off: (problems, path) =>
		`Pomodoro está desactivado: ${problems.join('; ')} (${path}).`,
	notObject: 'el archivo debe contener un objeto JSON',
	notBoolean: (key) => `${key} debe ser true o false`,
	unreadable: (code) => `no se puede leer el archivo (${code})`,
	notJson: 'el archivo no es un JSON válido',
}

// Brazilian Portuguese. Its plurals follow Portugal's rule, which puts 0 with the plural ("0 pausas"), as Brazilian apps
// do.
const pt: Messages = {
	description:
		'Mostra os pomodoros e check-ins de hoje neste repositório, ou liga e desliga o modo silêncio para pausar os alertas durante uma reunião.',
	usage: 'Uso: /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Hoje: ${mark}${plural('pt-PT', pomodoros, { one: 'pomodoro', other: 'pomodoros' })} (ontem ${yesterday}), ${plural('pt-PT', longBreaks, { one: 'pausa longa', other: 'pausas longas' })}, ${plural('pt-PT', skipped, { one: 'pausa pulada', other: 'pausas puladas' })}, máximo sem pausa ${longest} min`,
	noPomodoros: 'Hoje: nenhum pomodoro ainda.',
	name: 'pomodoro',
	onABreak: 'em pausa',
	count: (position, minutes) => `${position} de 4 · ${minutes}/25 min`,
	due: (minutes) => `${minutes} min, hora de uma pausa`,
	dueLong: (minutes) => `${minutes} min, hora de uma pausa longa`,
	alert: (minutes) =>
		`${plural('pt-PT', minutes, { one: 'minuto', other: 'minutos' })} sem pausa. Levante-se e desvie o olhar da tela por 3 a 5 minutos.`,
	alertLong: (minutes) =>
		`${plural('pt-PT', minutes, { one: 'minuto', other: 'minutos' })} sem pausa. Sua série de 4 pomodoros terminou: faça uma pausa de 15 a 30 minutos.`,
	back: (minutes, position) =>
		`De volta após ${away(minutes, ' min', ' h')} · pomodoro ${position} de 4`,
	backLong: (minutes) =>
		`De volta após ${away(minutes, ' min', ' h')} · nova série, pomodoro 1 de 4`,
	quiet: 'silêncio',
	quietOn:
		'Modo silêncio ativado: sem alertas nem check-ins até você executar /pomodoro quiet de novo, ou bloquear a tela ou fechar a tampa por 3 minutos. A contagem continua.',
	quietOff: 'Modo silêncio desativado.',
	notice: 'Pomodoro: o agente sabe que seu pomodoro terminou.',
	settings: {
		sound: {
			label: 'Som',
			description:
				'Toca um som a cada alerta (macOS). Você ouve mesmo com um modo Foco ativo, e quando a aba do Claude está em primeiro plano, onde o Ghostty mostra o banner só por alguns segundos.',
		},
		emoji: {
			label: 'Emoji de tomate',
			description:
				"Mostra 🍅 na contagem, na linha de status, nos avisos e na nota da conversa. Desativado, a contagem no rodapé fica 'pomodoro 3 de 4 · 12/25 min'.",
		},
	},
	off: (problems, path) =>
		`O Pomodoro está desativado: ${problems.join('; ')} (${path}).`,
	notObject: 'o arquivo deve conter um objeto JSON',
	notBoolean: (key) => `${key} deve ser true ou false`,
	unreadable: (code) => `não foi possível ler o arquivo (${code})`,
	notJson: 'o arquivo não é um JSON válido',
}

// The minutes, in the form each number takes.
const ruMinutes = (minutes: number) =>
	plural('ru', minutes, {
		one: 'минута',
		few: 'минуты',
		many: 'минут',
		other: 'минуты',
	})

const ru: Messages = {
	description:
		'Показывает сегодняшние помидоры и сводки в этом репозитории или включает и выключает тихий режим, чтобы уведомления не мешали во время встречи.',
	usage: 'Использование: /pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`Сегодня: ${mark}${plural('ru', pomodoros, { one: 'помидор', few: 'помидора', many: 'помидоров', other: 'помидора' })} (вчера ${yesterday}), ${plural('ru', longBreaks, { one: 'длинный перерыв', few: 'длинных перерыва', many: 'длинных перерывов', other: 'длинного перерыва' })}, ${plural('ru', skipped, { one: 'пропущенный перерыв', few: 'пропущенных перерыва', many: 'пропущенных перерывов', other: 'пропущенного перерыва' })}, максимум без перерыва ${longest} мин`,
	noPomodoros: 'Сегодня: помидоров пока нет.',
	name: 'помидор',
	onABreak: 'на перерыве',
	count: (position, minutes) => `${position} из 4 · ${minutes}/25 мин`,
	due: (minutes) => `${minutes} мин, пора сделать перерыв`,
	dueLong: (minutes) => `${minutes} мин, пора сделать длинный перерыв`,
	alert: (minutes) =>
		`${ruMinutes(minutes)} без перерыва. Встаньте и отведите взгляд от экрана на 3–5 минут.`,
	alertLong: (minutes) =>
		`${ruMinutes(minutes)} без перерыва. Серия из 4 помидоров завершена: сделайте перерыв на 15–30 минут.`,
	back: (minutes, position) =>
		`Вы вернулись через ${away(minutes, ' мин', ' ч')} · помидор ${position} из 4`,
	backLong: (minutes) =>
		`Вы вернулись через ${away(minutes, ' мин', ' ч')} · новая серия, помидор 1 из 4`,
	quiet: 'тихо',
	quietOn:
		'Тихий режим включён: никаких уведомлений и сводок, пока вы снова не выполните /pomodoro quiet, не заблокируете экран или не закроете крышку ноутбука на 3 минуты. Счёт продолжается.',
	quietOff: 'Тихий режим выключен.',
	notice: 'Pomodoro: агент знает, что ваш помидор закончился.',
	settings: {
		sound: {
			label: 'Звук',
			description:
				'Звуковой сигнал при каждом уведомлении (macOS). Его слышно и в режиме фокусирования, и когда вкладка Claude на переднем плане, где Ghostty показывает баннер лишь несколько секунд.',
		},
		emoji: {
			label: 'Эмодзи помидора',
			description:
				'Показывать 🍅 в счётчике, строке состояния, всплывающих сообщениях и заметке в переписке. Если выключено, счётчик внизу выглядит так: «помидор 3 из 4 · 12/25 мин».',
		},
	},
	off: (problems, path) =>
		`Pomodoro выключен: ${problems.join('; ')} (${path}).`,
	notObject: 'файл должен содержать объект JSON',
	notBoolean: (key) => `значение ${key} должно быть true или false`,
	unreadable: (code) => `не удаётся прочитать файл (${code})`,
	notJson: 'в файле некорректный JSON',
}

// Simplified Chinese: no plural, and no space between a number and its unit.
const zh: Messages = {
	description: '显示此仓库今天的番茄钟和小结，或开关静音，在会议期间暂停提醒。',
	usage: '用法：/pomodoro [today|quiet]',
	today: ({ mark, pomodoros, yesterday, longBreaks, skipped, longest }) =>
		`今天：${mark}${pomodoros}个番茄钟（昨天${yesterday}个），${longBreaks}次长休息，跳过${skipped}次休息，最长连续${longest}分钟`,
	noPomodoros: '今天：还没有番茄钟。',
	name: '番茄钟',
	onABreak: '休息中',
	count: (position, minutes) => `第${position}/4个 · ${minutes}/25分钟`,
	due: (minutes) => `${minutes}分钟，该休息了`,
	dueLong: (minutes) => `${minutes}分钟，该长休息了`,
	alert: (minutes) =>
		`已经${minutes}分钟没休息了。站起来，让视线离开屏幕3到5分钟。`,
	alertLong: (minutes) =>
		`已经${minutes}分钟没休息了。这一轮4个番茄钟已完成，休息15到30分钟吧。`,
	back: (minutes, position) =>
		`回来了，离开了${away(minutes, '分钟', '小时')} · 第${position}/4个番茄钟`,
	backLong: (minutes) =>
		`回来了，离开了${away(minutes, '分钟', '小时')} · 新一轮，第1/4个番茄钟`,
	quiet: '静音',
	quietOn:
		'静音已开启：不提醒，也不做小结，直到你再次运行 /pomodoro quiet，或锁屏、合上笔记本满3分钟。计时照常进行。',
	quietOff: '静音已关闭。',
	notice: 'Pomodoro：已告知智能体，你的番茄钟时间到了。',
	settings: {
		sound: {
			label: '提示音',
			description:
				'每次提醒时播放提示音（macOS）。专注模式下也能听到；Claude 标签页在前台时也能听到，这时 Ghostty 只显示横幅几秒钟。',
		},
		emoji: {
			label: '番茄表情',
			description:
				'在计数、状态栏、弹出提示和对话记录的提示中显示 🍅。关闭后，底部计数显示为“番茄钟 第3/4个 · 12/25分钟”。',
		},
	},
	off: (problems, path) =>
		`Pomodoro 已关闭：${problems.join('；')}（${path}）。`,
	notObject: '文件必须是一个 JSON 对象',
	notBoolean: (key) => `${key} 必须是 true 或 false`,
	unreadable: (code) => `无法读取文件（${code}）`,
	notJson: '文件不是有效的 JSON',
}

export const messages: Record<Language, Messages> = {
	en,
	it,
	de,
	fr,
	es,
	pt,
	ru,
	zh,
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
