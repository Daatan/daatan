/**
 * Static golden of every LLM call site's request params, by stage (daatan#2287).
 *
 * For each `generateContent({ … })` in src/ (staged via `...forStage('x')` or not), records every property
 * besides the prompt and the abort signal, as source text: `temperature: "0"`,
 * `schema: "claimDefinednessSchema"`, `thinkingBudget: "0"`. Plus every direct
 * `stageModel()` read and every module-level `const *MODEL* = '<id>'`.
 *
 * Read statically on purpose: the call sites need prisma, auth and search mocks to
 * run, and what the registry refactor moves is exactly these literals. When a param
 * moves into the registry, this test must compute the same effective value from
 * there — the golden itself stays unchanged.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { LLM_STAGES } from '../stageModels'
import { expectGolden } from './goldens/golden'

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

interface StageCall {
  stage: string
  file: string
  fallback: string | null
  params: Record<string, string>
}
interface StageModelRead {
  stage: string
  file: string
  fallback: string | null
}
interface ModelConstant {
  name: string
  file: string
  value: string
}

function isCall(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
}

function scan() {
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

describe('LLM request goldens — call sites (daatan#2287)', () => {
  const { calls, reads, constants } = scan()

  it('every stage in LLM_STAGES has a call site', () => {
    const seen = new Set([...calls.map((c) => c.stage), ...reads.map((r) => r.stage)])
    expect(LLM_STAGES.filter((s) => !seen.has(s))).toEqual([])
  })

  it('call-site params per stage are unchanged', () => {
    expectGolden('stage-call-sites', calls)
  })

  it('direct stageModel() reads are unchanged', () => {
    expectGolden('stage-model-reads', reads)
  })

  it('module-level model id constants are unchanged', () => {
    expectGolden('model-constants', constants)
  })
})
