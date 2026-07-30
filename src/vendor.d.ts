declare module 'eslint-linter-browserify' {
  export interface LintMessage {
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    severity: 1 | 2;
    message: string;
    ruleId: string | null;
  }
  export class Linter {
    verify(code: string, config: unknown): LintMessage[];
  }
}

declare module 'htmlhint' {
  export interface HintMessage {
    line: number;
    col: number;
    message: string;
    raw?: string;
    type: 'error' | 'warning' | 'info';
    rule: { id: string };
  }
  export const HTMLHint: {
    verify(html: string, rules: Record<string, boolean>): HintMessage[];
  };
}

declare module '@eslint/js' {
  const js: { configs: { recommended: { rules: Record<string, unknown> } } };
  export default js;
}
