/**
 * Intra-line highlighting for paired -/+ lines.
 *
 * A plain character diff produces noisy, unreadable speckle on real code, so
 * this works on word-ish tokens instead and only highlights when the two lines
 * actually resemble each other. When they do not, whole-line colouring already
 * says everything and highlighting would just add noise.
 */

export interface Span {
  start: number
  end: number
}

/** Splits into runs of word characters, runs of whitespace, and single symbols. */
export function tokenize(line: string): Array<{ text: string; start: number }> {
  const tokens: Array<{ text: string; start: number }> = []
  const re = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) tokens.push({ text: m[0], start: m.index })
  return tokens
}

/** Length of the longest common subsequence table walk, returning matched pairs. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  // Guard against quadratic blow-up on very long lines.
  if (n === 0 || m === 0 || n * m > 250_000) return []

  const table = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => table[i * (m + 1) + j]
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) i++
    else j++
  }
  return pairs
}

/** Merges adjacent/overlapping spans so the DOM stays small. */
function coalesce(spans: Span[]): Array<[number, number]> {
  if (spans.length === 0) return []
  const sorted = [...spans].sort((x, y) => x.start - y.start)
  const out: Array<[number, number]> = [[sorted[0].start, sorted[0].end]]
  for (const span of sorted.slice(1)) {
    const last = out[out.length - 1]
    if (span.start <= last[1]) last[1] = Math.max(last[1], span.end)
    else out.push([span.start, span.end])
  }
  return out
}

export interface WordDiffResult {
  /** Ranges to emphasise on the deleted line. */
  del: Array<[number, number]>
  /** Ranges to emphasise on the added line. */
  add: Array<[number, number]>
}

/**
 * Returns the differing ranges of two lines, or empty ranges when the lines are
 * too dissimilar for the result to be useful.
 */
export function wordDiff(oldLine: string, newLine: string): WordDiffResult {
  if (oldLine === newLine) return { del: [], add: [] }

  const oldTokens = tokenize(oldLine)
  const newTokens = tokenize(newLine)
  const pairs = lcsPairs(
    oldTokens.map((t) => t.text),
    newTokens.map((t) => t.text)
  )

  // Ignore whitespace-only matches when deciding whether the lines are related.
  const meaningful = pairs.filter(([i]) => oldTokens[i].text.trim() !== '').length
  const meaningfulTotal = Math.max(
    oldTokens.filter((t) => t.text.trim() !== '').length,
    newTokens.filter((t) => t.text.trim() !== '').length
  )
  if (meaningfulTotal === 0 || meaningful / meaningfulTotal < 0.25) {
    return { del: [], add: [] }
  }

  const matchedOld = new Set(pairs.map(([i]) => i))
  const matchedNew = new Set(pairs.map(([, j]) => j))

  const del = coalesce(
    oldTokens
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !matchedOld.has(i))
      .map(({ t }) => ({ start: t.start, end: t.start + t.text.length }))
  )
  const add = coalesce(
    newTokens
      .map((t, j) => ({ t, j }))
      .filter(({ j }) => !matchedNew.has(j))
      .map(({ t }) => ({ start: t.start, end: t.start + t.text.length }))
  )

  return { del, add }
}
