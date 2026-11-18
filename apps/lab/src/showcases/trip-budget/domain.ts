/**
 * Trip budget splitter ("Lisbon weekend") domain model: the pure, framework-free helpers that the
 * plugins (`./plugins/`), the config checkers (`./config.ts`) and the renderers share. Nothing here
 * touches Core; every function is a plain function of plain values, so it can be tested without a
 * Runtime.
 *
 * Money is whole minor units ("cents", an integer) from the moment an amount is converted into the base
 * currency, so sums and splits never drift: an expense of 100.00 shared by three people is 33.34, 33.33
 * and 33.33, and the three shares add up to exactly 100.00. Every currency is assumed to have two decimals.
 *
 * What lives here:
 * - the value shapes that cross Property boundaries (`ExpenseBreakdown`, `Transfer`, ...);
 * - the arithmetic rules (`splitEqually`, `splitByPercent`, `settle`, `roundToStep`, `toBaseCents`);
 * - text in the trip's active language (`localize`, `tripText`) and money formatting (`formatMoney`), in
 *   `en` and `zh-TW`.
 */

// -------------------------------------------------------------------------------------------------
// Languages and text
// -------------------------------------------------------------------------------------------------

/** The languages the built-in texts cover. The first is the default. */
export const TRIP_LANGUAGES = ['en', 'zh-TW'] as const
export type TripLanguage = typeof TRIP_LANGUAGES[number]
export const DEFAULT_TRIP_LANGUAGE: TripLanguage = 'en'

/** The language's name in that language, for the language switch. */
export const LANGUAGE_ENDONYMS: Readonly<Record<TripLanguage, string>> = {
	'en': 'English',
	'zh-TW': '繁體中文',
}

export function isTripLanguage(input: unknown): input is TripLanguage {
	return typeof input === 'string' && (TRIP_LANGUAGES as readonly string[]).includes(input)
}

/** Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it. */
export interface I18nText { readonly [language: string]: string }

/** The text in `language`, or the English text when that language is missing. */
export function localize(text: I18nText, language: string): string {
	return Object.hasOwn(text, language) && typeof text[language] === 'string' && text[language] !== ''
		? text[language]
		: text.en ?? ''
}

const EN_TEXT = {
	// Host chrome
	startOver: 'Start over',
	startOverHint: 'Resets the whole trip to the starting document',
	language: 'Language',
	// People
	people: 'People',
	paid: 'Paid',
	share: 'Share of costs',
	balance: 'Balance',
	isOwed: 'gets back {amount}',
	owes: 'owes {amount}',
	isEven: 'is even',
	showLedger: 'Show ledger',
	hideLedger: 'Hide ledger',
	ledgerTitle: 'Ledger',
	ledgerPaid: 'paid {amount}',
	ledgerShare: 'share {amount}',
	ledgerEmpty: 'No expenses yet.',
	// Expenses
	expenses: 'Expenses',
	amount: 'Amount',
	currency: 'Currency',
	paidBy: 'Paid by',
	sharedBy: 'Shared by',
	splitEqual: 'Equal split',
	splitPercent: 'Split by percent',
	asBase: '≈ {amount}',
	resetExpense: 'Reset this expense',
	showBreakdown: 'Show breakdown',
	hideBreakdown: 'Hide breakdown',
	breakdownTitle: 'Breakdown',
	breakdownConversion: '{amount} {currency} × {rate} = {base}',
	breakdownShareEqual: '{name}: {amount} (equal split)',
	breakdownSharePercent: '{name}: {amount} ({percent}%)',
	breakdownRemainder: '+{cents} cent to even out the rounding',
	breakdownRemainderMany: '+{cents} cents to even out the rounding',
	// Money settings
	settings: 'Money settings',
	baseCurrency: 'Base currency',
	rates: 'Rates',
	rate: '1 {currency} = {rate} {base}',
	roundTo: 'Round transfers to',
	roundCent: 'the cent',
	roundUnit: 'a whole unit',
	roundFive: 'the nearest 5 units',
	// Settlement
	settlement: 'Settlement',
	totalSpent: 'Total spent',
	whoPaysWhom: 'Who pays whom',
	transfer: '{from} pays {to}',
	allSettled: 'Everyone is settled up.',
	roundedAway: 'Every payment is smaller than the rounding step, so none is due.',
	roundingGap: 'Rounded transfers differ from the exact balances by {amount} in total.',
	// Expense errors
	errorAmountMissing: 'Enter an amount.',
	errorAmountNegative: 'The amount cannot be negative.',
	errorNobodyShares: 'Pick at least one person to share this expense.',
	errorNoPayer: 'Pick who paid.',
	notCounted: 'Not counted in the settlement until this is fixed.',
	conversionFailed: 'No rate for this currency, so the settlement cannot be computed.',
} as const

export type TripText = { readonly [Key in keyof typeof EN_TEXT]: string }

const ZH_TW_TEXT: TripText = {
	startOver: '重新開始',
	startOverHint: '把整趟旅程重設為起始文件的內容',
	language: '語言',
	people: '成員',
	paid: '已付',
	share: '應分攤',
	balance: '結餘',
	isOwed: '可收回 {amount}',
	owes: '要付 {amount}',
	isEven: '剛好打平',
	showLedger: '顯示明細帳',
	hideLedger: '隱藏明細帳',
	ledgerTitle: '明細帳',
	ledgerPaid: '付了 {amount}',
	ledgerShare: '分攤 {amount}',
	ledgerEmpty: '還沒有任何支出。',
	expenses: '支出',
	amount: '金額',
	currency: '幣別',
	paidBy: '付款人',
	sharedBy: '分攤的人',
	splitEqual: '平均分攤',
	splitPercent: '依比例分攤',
	asBase: '約 {amount}',
	resetExpense: '重設這筆支出',
	showBreakdown: '顯示計算過程',
	hideBreakdown: '隱藏計算過程',
	breakdownTitle: '計算過程',
	breakdownConversion: '{amount} {currency} × {rate} = {base}',
	breakdownShareEqual: '{name}：{amount}（平均分攤）',
	breakdownSharePercent: '{name}：{amount}（{percent}%）',
	breakdownRemainder: '多 {cents} 分，用來補齊四捨五入的差額',
	breakdownRemainderMany: '多 {cents} 分，用來補齊四捨五入的差額',
	settings: '金錢設定',
	baseCurrency: '基準幣別',
	rates: '匯率',
	rate: '1 {currency} = {rate} {base}',
	roundTo: '轉帳金額四捨五入到',
	roundCent: '分',
	roundUnit: '整數元',
	roundFive: '最接近的 5 元',
	settlement: '結算',
	totalSpent: '總支出',
	whoPaysWhom: '誰付給誰',
	transfer: '{from} 付給 {to}',
	allSettled: '大家都已結清。',
	roundedAway: '每一筆金額都小於四捨五入的單位，所以不需要轉帳。',
	roundingGap: '四捨五入後的轉帳合計，與精確結餘相差 {amount}。',
	errorAmountMissing: '請輸入金額。',
	errorAmountNegative: '金額不能是負數。',
	errorNobodyShares: '請至少選一位分攤的人。',
	errorNoPayer: '請選擇付款人。',
	notCounted: '修正之前，這筆支出不會列入結算。',
	conversionFailed: '這個幣別沒有匯率，所以無法計算結算。',
}

const TEXT: Readonly<Record<TripLanguage, TripText>> = { 'en': EN_TEXT, 'zh-TW': ZH_TW_TEXT }

/** The built-in texts in `language` (English for any other language). */
export function tripText(language: string): TripText {
	return isTripLanguage(language) ? TEXT[language] : EN_TEXT
}

/** Fills `{name}` placeholders. A placeholder without a value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => Object.hasOwn(values, key) ? String(values[key]) : whole)
}

// -------------------------------------------------------------------------------------------------
// Money
// -------------------------------------------------------------------------------------------------

/** What "round transfers to" can be, in minor units: the cent, a whole unit, the nearest 5 units. */
export const ROUND_STEPS = [1, 100, 500] as const
export type RoundStep = typeof ROUND_STEPS[number]
export const DEFAULT_ROUND_STEP: RoundStep = 1

export function isRoundStep(input: unknown): input is RoundStep {
	return typeof input === 'number' && (ROUND_STEPS as readonly number[]).includes(input)
}

/** The translated label of a rounding step. */
export function roundStepLabel(step: RoundStep, text: TripText): string {
	return step === 1 ? text.roundCent : step === 100 ? text.roundUnit : text.roundFive
}

/** Currency codes are three capital letters. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

/** Person ids are keys of `shares`, `percents` and `among`, so they stay boring. */
export const PERSON_ID_PATTERN = /^[a-z][a-z0-9-]*$/

export function isPersonId(input: unknown): input is string {
	return typeof input === 'string' && PERSON_ID_PATTERN.test(input)
}

/**
 * An amount in a foreign currency, in minor units of the base currency. `rate` is how many base units one
 * foreign unit is worth. Half a cent rounds up.
 */
export function toBaseCents(amount: number, rate: number): number {
	return Math.round(amount * rate * 100)
}

/** `cents` rounded to the nearest multiple of `step` (half up). */
export function roundToStep(cents: number, step: number): number {
	return Math.round(cents / step) * step
}

/** `1234` -> "€12.34" in `language`. A code Intl does not know is printed as it is. */
export function formatMoney(cents: number, currency: string, language: string): string {
	try {
		return new Intl.NumberFormat(language, { style: 'currency', currency })
			.format(cents / 100)
	}
	catch {
		return `${(cents / 100).toFixed(2)} ${currency}`
	}
}

/** A plain amount such as `45.5` as the person typed it, without a currency symbol. */
export function formatPlainAmount(amount: number, language: string): string {
	return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
		.format(amount)
}

// -------------------------------------------------------------------------------------------------
// Splitting
// -------------------------------------------------------------------------------------------------

/**
 * `total` cents shared equally by `ids`: everybody gets the rounded-down share and the leftover cents go
 * to the first people in the order given, one each, so the shares add up to `total` exactly.
 */
export function splitEqually(total: number, ids: readonly string[]): Record<string, number> {
	if (ids.length === 0)
		return {}
	const base = Math.floor(total / ids.length)
	const remainder = total - base * ids.length
	return Object.fromEntries(ids.map((id, index) => [id, base + (index < remainder ? 1 : 0)]))
}

/** The rounded-down cents of each percentage, and the fractional part that decides who gets a leftover cent. */
function percentFloors(total: number, percents: Readonly<Record<string, number>>) {
	return Object.entries(percents)
		.map(([id, percent], index) => {
			const value = total * percent / 100
			const floor = Math.floor(value + 1e-9)
			return { id, index, floor, fraction: value - floor }
		})
}

/**
 * `total` cents split by percentages (which add up to 100): each person gets the rounded-down share, then the
 * leftover cents go one each to the largest fractional parts (earlier people win ties), so the shares add up
 * to `total` exactly.
 */
export function splitByPercent(total: number, percents: Readonly<Record<string, number>>): Record<string, number> {
	const floors = percentFloors(total, percents)
	const leftover = Math.max(0, total - floors.reduce((sum, entry) => sum + entry.floor, 0))
	const winners = new Set([...floors]
		.sort((a, b) => b.fraction - a.fraction || a.index - b.index)
		.slice(0, leftover)
		.map(entry => entry.id))
	return Object.fromEntries(floors.map(entry => [entry.id, entry.floor + (winners.has(entry.id) ? 1 : 0)]))
}

/** The cents of an equal split that did not divide evenly (handed out one by one). */
export function equalLeftover(total: number, people: number): number {
	return people === 0 ? 0 : total - Math.floor(total / people) * people
}

/** The cents of a percentage split that were not covered by the rounded-down shares (handed out one by one). */
export function percentLeftover(total: number, percents: Readonly<Record<string, number>>): number {
	return Math.max(0, total - percentFloors(total, percents)
		.reduce((sum, entry) => sum + entry.floor, 0))
}

// -------------------------------------------------------------------------------------------------
// Settling up
// -------------------------------------------------------------------------------------------------

export interface PersonBalance { readonly id: string, readonly cents: number }

/** One payment: `from` pays `to` `cents`. */
export interface Transfer { readonly from: string, readonly to: string, readonly cents: number }

/**
 * The fewest-looking payments that clear every balance: the person who owes most pays the person who is
 * owed most, as much as that covers, and so on. A positive balance is owed money, a negative one owes it.
 * Ties go to the person listed first, so the result is stable.
 */
export function settle(balances: readonly PersonBalance[]): Transfer[] {
	const debtors = balances.map((balance, index) => ({ id: balance.id, index, cents: -balance.cents }))
		.filter(entry => entry.cents > 0)
		.sort((a, b) => b.cents - a.cents || a.index - b.index)
	const creditors = balances.map((balance, index) => ({ id: balance.id, index, cents: balance.cents }))
		.filter(entry => entry.cents > 0)
		.sort((a, b) => b.cents - a.cents || a.index - b.index)
	const transfers: Transfer[] = []
	while (debtors.length > 0 && creditors.length > 0) {
		const debtor = debtors[0]!
		const creditor = creditors[0]!
		const cents = Math.min(debtor.cents, creditor.cents)
		transfers.push({ from: debtor.id, to: creditor.id, cents })
		debtor.cents -= cents
		creditor.cents -= cents
		if (debtor.cents === 0)
			debtors.shift()
		if (creditor.cents === 0)
			creditors.shift()
		// Keep "largest first" after a partial payment.
		debtors.sort((a, b) => b.cents - a.cents || a.index - b.index)
		creditors.sort((a, b) => b.cents - a.cents || a.index - b.index)
	}
	return transfers
}

// -------------------------------------------------------------------------------------------------
// Expense problems
// -------------------------------------------------------------------------------------------------

/** Why an expense is not counted. The code is language free; `expenseProblemText` says it in words. */
export type ExpenseProblemCode = 'amount-missing' | 'amount-negative' | 'nobody-shares' | 'no-payer'

export interface ExpenseProblem { readonly code: ExpenseProblemCode, readonly message: string }

/** The first problem of an expense's current input, or `null` when it can be counted. */
export function expenseProblemCode(input: { readonly amount: number | null, readonly paidBy: string | null, readonly participants: readonly string[] }): ExpenseProblemCode | null {
	if (input.amount === null)
		return 'amount-missing'
	if (input.amount < 0)
		return 'amount-negative'
	if (input.participants.length === 0)
		return 'nobody-shares'
	if (input.paidBy === null)
		return 'no-payer'
	return null
}

export function expenseProblemText(code: ExpenseProblemCode, text: TripText): string {
	switch (code) {
		case 'amount-missing': return text.errorAmountMissing
		case 'amount-negative': return text.errorAmountNegative
		case 'nobody-shares': return text.errorNobodyShares
		case 'no-payer': return text.errorNoPayer
	}
}

// -------------------------------------------------------------------------------------------------
// Property value shapes
// -------------------------------------------------------------------------------------------------

/**
 * What every widget's `view` Property says: the trip language and the base currency. The built-in texts
 * (`tripText(language)`) are a plain lookup the renderers do themselves, so the Runtime panel shows two small
 * values instead of the whole text table.
 */
export interface TripView {
	readonly language: string
	readonly base: string
}

export interface RosterEntry { readonly id: string, readonly name: string }

/** One line of an expense's breakdown: a person's share and where it came from. */
export interface BreakdownLine {
	readonly id: string
	readonly name: string
	readonly cents: number
	/** The authored percentage, or `null` for an equal split. */
	readonly percent: number | null
}

export interface ExpenseBreakdown {
	/** The conversion, or `null` when the expense is already in the base currency. */
	readonly conversion: { readonly amount: number, readonly currency: string, readonly rate: number, readonly baseCents: number } | null
	readonly totalCents: number
	readonly lines: readonly BreakdownLine[]
	/** Leftover cents handed out one by one so the shares add up to the total. */
	readonly remainderCents: number
}

/** One person's line in the ledger: what they paid and their share, for one expense. */
export interface LedgerEntry {
	readonly expense: string
	readonly title: string
	readonly paidCents: number
	readonly shareCents: number
}

export interface PersonLedger {
	readonly entries: readonly LedgerEntry[]
}

export interface BalanceEntry { readonly id: string, readonly name: string, readonly cents: number }

export interface SettlementTransfer {
	readonly from: string
	readonly fromName: string
	readonly to: string
	readonly toName: string
	/** The exact amount the balances ask for. */
	readonly exactCents: number
	/** The amount after rounding to the chosen step. */
	readonly cents: number
}

/** What the Settlement Property computes: the transfers and how they compare with the exact balances. */
export interface SettlementOutcome {
	readonly transfers: readonly SettlementTransfer[]
	/** Exact amount to move minus the rounded amount actually moved, in minor units (can be negative). */
	readonly roundingGapCents: number
}
