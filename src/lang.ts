import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/** Grammars missing from @codemirror/language-data. */
const EXTRA = [
  LanguageDescription.of({
    name: 'Terraform',
    extensions: ['tf', 'tfvars', 'hcl', 'nomad'],
    load: () => import('codemirror-lang-hcl').then((m) => m.hcl()),
  }),
];

const ALL = [...EXTRA, ...languages];

/** Which deep linter (if any) applies to a file. */
export type LintKind = 'js' | 'ts' | 'json' | 'css' | 'html' | 'yaml' | 'markdown' | 'none';

const BY_EXT: Record<string, LintKind> = {
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  vue: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
};

export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i < 0 ? '' : filename.slice(i + 1).toLowerCase();
}

export function lintKind(filename: string): LintKind {
  return BY_EXT[extOf(filename)] ?? 'none';
}

/** Lezer grammar for a file, or null when the extension has no known mode. */
export function describeLanguage(filename: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(ALL, filename);
}

export function languageName(filename: string): string {
  return describeLanguage(filename)?.name ?? (extOf(filename) || 'Plain Text').toUpperCase();
}
