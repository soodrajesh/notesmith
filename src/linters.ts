import { linter, type Diagnostic } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import type * as CssTree from 'css-tree';
import { lintKind } from './lang';

const MAX_DIAGNOSTICS = 200;

/** Memoises an async loader so each linter bundle is fetched at most once. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}

/** Clamp a range to the document, keeping it non-empty so the squiggle is visible. */
function span(doc: Text, from: number, to?: number) {
  const start = Math.max(0, Math.min(from, Math.max(0, doc.length - 1)));
  const end = Math.min(Math.max(start + 1, to ?? start + 1), doc.length);
  return { from: start, to: end };
}

/** 1-based line/column to a document offset. */
function posAt(doc: Text, line: number, col: number) {
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  return Math.min(l.from + Math.max(0, col - 1), l.to);
}

/* ── JavaScript ─────────────────────────────────────────────── */

/** ESLint is ~1.5MB; only pull it once a JS file is actually linted. */
const loadEslint = once(async () => {
  const [{ Linter }, eslintJs] = await Promise.all([
    import('eslint-linter-browserify'),
    import('@eslint/js'),
  ]);
  return {
    linter: new Linter(),
    config: {
      languageOptions: {
        ecmaVersion: 'latest' as const,
        sourceType: 'module' as const,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: { ...eslintJs.default.configs.recommended.rules, eqeqeq: 'warn' },
    },
  };
});

async function lintJs(doc: Text): Promise<Diagnostic[]> {
  let messages;
  try {
    const { linter: eslint, config } = await loadEslint();
    messages = eslint.verify(doc.toString(), config);
  } catch {
    return [];
  }
  return messages.slice(0, MAX_DIAGNOSTICS).map((m) => {
    const from = posAt(doc, m.line ?? 1, m.column ?? 1);
    const to = m.endLine ? posAt(doc, m.endLine, m.endColumn ?? 1) : from + 1;
    return {
      ...span(doc, from, to),
      severity: m.severity === 2 ? ('error' as const) : ('warning' as const),
      message: m.ruleId ? `${m.message} (${m.ruleId})` : m.message,
      source: 'eslint',
    };
  });
}

/* ── JSON ───────────────────────────────────────────────────── */

function lintJson(doc: Text): Diagnostic[] {
  const text = doc.toString();
  if (!text.trim()) return [];
  try {
    JSON.parse(text);
    return [];
  } catch (err) {
    const msg = (err as Error).message;
    // V8 reports either "at position N" or "at line L column C" depending on version.
    const byLine = /at line (\d+) column (\d+)/.exec(msg);
    const byPos = /at position (\d+)/.exec(msg);
    let from = 0;
    if (byLine) from = posAt(doc, Number(byLine[1]), Number(byLine[2]));
    else if (byPos) from = Number(byPos[1]);
    return [{ ...span(doc, from), severity: 'error', message: msg, source: 'json' }];
  }
}

/* ── YAML ───────────────────────────────────────────────────── */

interface YamlErr extends Error {
  mark?: { position?: number; line?: number; column?: number };
  reason?: string;
}

const loadYaml = once(() => import('js-yaml'));

async function lintYaml(doc: Text): Promise<Diagnostic[]> {
  let yaml;
  try {
    yaml = await loadYaml();
  } catch {
    return [];
  }
  try {
    yaml.loadAll(doc.toString());
    return [];
  } catch (err) {
    const e = err as YamlErr;
    const from =
      e.mark?.position ?? posAt(doc, (e.mark?.line ?? 0) + 1, (e.mark?.column ?? 0) + 1);
    return [
      { ...span(doc, from), severity: 'error', message: e.reason ?? e.message, source: 'yaml' },
    ];
  }
}

/* ── CSS ────────────────────────────────────────────────────── */

const loadCssTree = once(() => import('css-tree'));

async function lintCss(doc: Text): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  let csstree;
  try {
    csstree = await loadCssTree();
  } catch {
    return out;
  }

  let ast;
  try {
    ast = csstree.parse(doc.toString(), {
      positions: true,
      onParseError(err: { message: string; line?: number; column?: number }) {
        const from = posAt(doc, err.line ?? 1, err.column ?? 1);
        out.push({ ...span(doc, from), severity: 'error', message: err.message, source: 'css' });
      },
    });
  } catch {
    return out;
  }

  // Validate each declaration's property/value pair against the CSS spec.
  try {
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node: CssTree.Declaration) {
        const err = csstree.lexer.matchDeclaration(node).error;
        if (!err || !node.loc) return;
        out.push({
          ...span(doc, node.loc.start.offset, node.loc.end.offset),
          severity: 'warning',
          // Lexer mismatches are multi-line ASCII diagrams; keep the headline.
          message: err.message.split('\n')[0],
          source: 'css',
        });
      },
    });
  } catch {
    /* spec validation is best-effort */
  }
  return out.slice(0, MAX_DIAGNOSTICS);
}

/* ── HTML ───────────────────────────────────────────────────── */

const HTMLHINT_RULES = {
  'tagname-lowercase': true,
  'attr-lowercase': true,
  'tag-pair': true,
  'spec-char-escape': true,
  'id-unique': true,
  'src-not-empty': true,
  'attr-no-duplication': true,
  'alt-require': true,
};

const loadHtmlHint = once(() => import('htmlhint'));

async function lintHtml(doc: Text): Promise<Diagnostic[]> {
  let messages;
  try {
    const { HTMLHint } = await loadHtmlHint();
    messages = HTMLHint.verify(doc.toString(), HTMLHINT_RULES);
  } catch {
    return [];
  }
  return messages.slice(0, MAX_DIAGNOSTICS).map((m) => {
    const from = posAt(doc, m.line, m.col);
    return {
      ...span(doc, from, from + (m.raw?.length || 1)),
      severity: m.type === 'error' ? ('error' as const) : ('warning' as const),
      message: `${m.message} (${m.rule.id})`,
      source: 'htmlhint',
    };
  });
}

/* ── Markdown ───────────────────────────────────────────────── */

function lintMarkdown(doc: Text): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = doc.toString().split('\n');
  let fenceOpenLine = -1;
  let fenceChar = '';

  lines.forEach((line, i) => {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (fenceOpenLine < 0) {
        fenceOpenLine = i;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        fenceOpenLine = -1;
      }
      return;
    }
    if (fenceOpenLine >= 0) return;

    if (line.includes('\t')) {
      out.push({
        ...span(doc, posAt(doc, i + 1, line.indexOf('\t') + 1)),
        severity: 'warning',
        message: 'Hard tab — use spaces for Markdown indentation',
        source: 'markdown',
      });
    }
    // "](" with no "[" anywhere on the line is almost always a broken link.
    const broken = /\]\(/.exec(line);
    if (broken && !line.includes('[')) {
      out.push({
        ...span(doc, posAt(doc, i + 1, broken.index + 1)),
        severity: 'warning',
        message: 'Link is missing its opening [',
        source: 'markdown',
      });
    }
  });

  if (fenceOpenLine >= 0) {
    out.push({
      ...span(doc, posAt(doc, fenceOpenLine + 1, 1)),
      severity: 'error',
      message: 'Unclosed code fence',
      source: 'markdown',
    });
  }
  return out.slice(0, MAX_DIAGNOSTICS);
}

/* ── Wiring ─────────────────────────────────────────────────── */

const DEEP: Record<string, (doc: Text) => Diagnostic[] | Promise<Diagnostic[]>> = {
  js: lintJs,
  json: lintJson,
  css: lintCss,
  html: lintHtml,
  yaml: lintYaml,
  markdown: lintMarkdown,
};

export function hasDeepLinter(filename: string): boolean {
  return lintKind(filename) !== 'none';
}

/** Diagnostics from the dedicated linter for a file, if it has one. */
export function diagnosticsFor(
  filename: string,
  doc: Text,
): Diagnostic[] | Promise<Diagnostic[]> {
  return DEEP[lintKind(filename)]?.(doc) ?? [];
}

/**
 * Parse errors from whatever Lezer grammar is active, so languages without a
 * dedicated linter still get syntax diagnostics.
 */
function lintSyntax(view: EditorView): Diagnostic[] {
  const out: Diagnostic[] = [];
  const tree = syntaxTree(view.state);
  if (tree.length === 0) return out;

  tree.cursor().iterate((node) => {
    if (out.length >= MAX_DIAGNOSTICS) return false;
    if (!node.type.isError) return;
    out.push({
      ...span(view.state.doc, node.from, node.to),
      severity: 'error',
      message: 'Syntax error',
      source: 'syntax',
    });
  });
  return out;
}

export function lintExtension(filename: string): Extension {
  const source = hasDeepLinter(filename)
    ? (view: EditorView) => diagnosticsFor(filename, view.state.doc)
    : lintSyntax;
  return linter(source, { delay: 400 });
}
