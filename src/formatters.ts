import { extOf } from './lang';

/** Memoises an async loader so resources are fetched at most once. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}

const loadPrettier = once(async () => {
  const [prettier, babel, typescript, css, html, markdown, yaml] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/parser-babel'),
    import('prettier/parser-typescript'),
    import('prettier/parser-postcss'),
    import('prettier/parser-html'),
    import('prettier/parser-markdown'),
    import('prettier/parser-yaml'),
  ]);
  return { prettier, babel, typescript, css, html, markdown, yaml };
});

/** Which languages prettier can format. */
export function canFormat(filename: string): boolean {
  const ext = extOf(filename);
  return /^(js|jsx|ts|tsx|mjs|cjs|json|css|scss|less|html|htm|md|markdown|yaml|yml)$/.test(ext);
}

/** Format code using prettier. Returns formatted code or throws. */
export async function formatCode(filename: string, code: string): Promise<string> {
  const { prettier, babel, typescript, css, html, markdown, yaml } = await loadPrettier();
  const ext = extOf(filename);

  let parser: string;
  let plugins: any[] = [];

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      parser = 'babel';
      plugins = [(babel as any).default];
      break;
    case 'ts':
    case 'tsx':
      parser = 'typescript';
      plugins = [(typescript as any).default];
      break;
    case 'json':
    case 'jsonc':
      parser = 'json';
      plugins = [(babel as any).default];
      break;
    case 'css':
    case 'scss':
    case 'less':
      parser = 'scss';
      plugins = [(css as any).default];
      break;
    case 'html':
    case 'htm':
      parser = 'html';
      plugins = [(html as any).default];
      break;
    case 'md':
    case 'markdown':
      parser = 'markdown';
      plugins = [(markdown as any).default];
      break;
    case 'yaml':
    case 'yml':
      parser = 'yaml';
      plugins = [(yaml as any).default];
      break;
    default:
      throw new Error(`No parser for ${ext}`);
  }

  return (prettier as any).format(code, { parser, plugins });
}
