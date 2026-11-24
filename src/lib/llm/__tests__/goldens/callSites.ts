/**
 * The seam between the LLM request goldens and the code (daatan#2287).
 *
 * `scanSource()` reads every LLM call site LIVE from src/ (TypeScript AST) — what each
 * call site passes today. The goldens never feed a stored file back into the code.
 *
 * `effectiveStageParams()` and `effectiveModelRoles()` say what each stage / role ends
 * up with. Today that is the call-site literals and the module constants. The
 * model-registry refactor changes ONLY these two functions (to merge the registry);
 * the golden JSON files must stay byte-identical.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import ts from 'typescript'

const SRC = path.resolve(process.cwd(), 'src')
const SKIP_PROPS = new Set(['prompt', 'signal'])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (name === '__tests__' || name === 'node_modules') continue
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

export interface StageCall {
  stage: string
  file: string
  fallback: string | null
  params: Record<string, string>
}
export interface StageModelRead {
  stage: string
  file: string
  fallback: string | null
}
export interface ModelConstant {
  name: string
  file: string
  value: string
}

function isCall(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
}

export function scanSource() {
  const calls: StageCall[] = []
  const reads: StageModelRead[] = []
  const constants: ModelConstant[] = []
  for (const full of sourceFiles(SRC)) {
    const text = readFileSync(full, 'utf8')
    if (!/generateContent\(|stageModel\(|MODEL/.test(text)) continue
    const file = path.relative(SRC, full)
    const sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true)
    // File-level `const NAME = <expr>`: a param written as `NAME` is recorded with its
    // value, so changing EXPRESS_DRAFT_THINKING_BUDGET from 512 still shows up here.
    const fileConsts = new Map<string, string>()
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const d of stmt.declarationList.declarations) {
        // Scalars only: schema objects are pinned by value in the chain golden instead.
        const init = d.initializer
        const scalar =
          init &&
          (ts.isNumericLiteral(init) ||
            ts.isStringLiteral(init) ||
            init.kind === ts.SyntaxKind.TrueKeyword ||
            init.kind === ts.SyntaxKind.FalseKeyword)
        if (ts.isIdentifier(d.name) && init && scalar) fileConsts.set(d.name.text, init.getText(sf))
      }
    }
    const show = (expr: ts.Expression): string => {
      const t = expr.getText(sf).replace(/\s+/g, ' ')
      return ts.isIdentifier(expr) && fileConsts.has(t) ? `${t} = ${fileConsts.get(t)}` : t
    }
    const visit = (node: ts.Node) => {
      // Every `<x>.generateContent({ … })`, staged (`...forStage('x')`) or not (bots).
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'generateContent' &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const obj = node.arguments[0]
        const spread = obj.properties.find(
          (p): p is ts.SpreadAssignment => ts.isSpreadAssignment(p) && isCall(p.expression, 'forStage'),
        )
        const call = spread?.expression as ts.CallExpression | undefined
        const params: Record<string, string> = {}
        for (const p of obj.properties) {
          if (p === spread) continue
          if (ts.isPropertyAssignment(p)) {
            const key = p.name.getText(sf)
            if (!SKIP_PROPS.has(key)) params[key] = show(p.initializer)
          } else if (ts.isShorthandPropertyAssignment(p)) {
            if (!SKIP_PROPS.has(p.name.text)) params[p.name.text] = p.name.text
          } else if (ts.isSpreadAssignment(p)) {
            params[`...${p.expression.getText(sf)}`] = 'spread'
          }
        }
        calls.push({
          stage: call ? (call.arguments[0] as ts.StringLiteral).text : '(unstaged)',
          file,
          fallback: call?.arguments[1] ? show(call.arguments[1]) : null,
          params: Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
        })
      }
      if (isCall(node, 'stageModel') && !(ts.isSpreadAssignment(node.parent))) {
        const inForStage = sf.fileName.endsWith('stageModels.ts')
        if (!inForStage) {
          reads.push({
            stage: (node.arguments[0] as ts.StringLiteral).text,
            file,
            fallback: node.arguments[1] ? show(node.arguments[1]) : null,
          })
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /MODEL/.test(node.name.text) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        ts.isSourceFile(node.parent.parent.parent)
      ) {
        constants.push({ name: node.name.text, file, value: node.initializer.text })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  const byStageThenFile = (a: { stage: string; file: string }, b: { stage: string; file: string }) =>
    a.stage.localeCompare(b.stage) || a.file.localeCompare(b.file)
  calls.sort(byStageThenFile)
  reads.sort(byStageThenFile)
  constants.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
  return { calls, reads, constants }
}

/** `'EXPRESS_DRAFT_THINKING_BUDGET = 512'` → 512, `"'gemini-2.5-pro'"` → 'gemini-2.5-pro'; else undefined. */
export function literalValue(text: string): number | string | boolean | undefined {
  const value = text.includes(' = ') ? text.split(' = ').pop()! : text
  if (/^-?[\d_]+(\.\d+)?$/.test(value)) return Number(value.replace(/_/g, ''))
  if (/^'.*'$/.test(value) || /^".*"$/.test(value)) return value.slice(1, -1)
  if (value === 'true' || value === 'false') return value === 'true'
  return undefined
}

/** A param's value when it is a literal, else its source expression (`expr: …`). */
function paramValue(text: string): unknown {
  const v = literalValue(text)
  return v === undefined ? `expr: ${text}` : v
}

/** SEAM — the params each call site's request ends up with, by stage. */
export function effectiveStageParams(): { stage: string; file: string; model: string | null; params: Record<string, unknown> }[] {
  return scanSource().calls.map((c) => ({
    stage: c.stage,
    file: c.file,
    model: c.fallback ? (paramValue(c.fallback) as string) : null,
    params: Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, paramValue(v)])),
  }))
}

/** Which role each hard-coded model constant serves. A new constant must be added here. */
export const ROLE_OF_CONSTANT: Record<string, string> = {
  GEMINI_MODEL: 'chain.google',
  ORACLE_FALLBACK_MODEL: 'chain.oracle',
  OPENROUTER_FREE_FALLBACK_MODEL: 'chain.openrouter',
  LOOKUP_MODEL: 'grounded_date',
  RESEARCH_VERDICT_MODEL: 'research_verdict',
  DEFAULT_EXPENSIVE_MODEL: 'evidence_second_opinion',
  VERTEX_PANEL_MODEL: 'panel.vertex',
  EMBEDDING_MODEL: 'embedding',
}

/** SEAM — the model each role uses, by role. */
export function effectiveModelRoles(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of scanSource().constants) {
    const role = ROLE_OF_CONSTANT[c.name]
    if (!role) throw new Error(`model constant ${c.name} (${c.file}) has no role in ROLE_OF_CONSTANT`)
    out[role] = c.value
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}
