import { extOf } from './lang';

/** Memoises an async loader so resources are fetched at most once. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}

// Prettier v3 moved parsers under `prettier/plugins/*`; each module's named
// exports (`parsers`/`printers`) ARE the plugin object — no default export.
const loadPrettier = once(async () => {
  const [prettier, babel, estree, typescript, postcss, html, markdown, yaml] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/html'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/yaml'),
  ]);
  return { prettier, babel, estree, typescript, postcss, html, markdown, yaml };
});

/** Which languages prettier can format. */
export function canFormat(filename: string): boolean {
  const ext = extOf(filename);
  return /^(js|jsx|ts|tsx|mjs|cjs|json|jsonc|css|scss|less|html|htm|md|markdown|yaml|yml)$/.test(ext);
}

/** Format code using prettier. Returns formatted code or throws. */
export async function formatCode(filename: string, code: string): Promise<string> {
  const { prettier, babel, estree, typescript, postcss, html, markdown, yaml } = await loadPrettier();
  const ext = extOf(filename);

  let parser: string;
  let plugins: unknown[];

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      parser = 'babel';
      plugins = [babel, estree];
      break;
    case 'ts':
    case 'tsx':
      parser = 'typescript';
      plugins = [typescript, estree];
      break;
    case 'json':
      parser = 'json';
      plugins = [babel, estree];
      break;
    case 'jsonc':
      parser = 'jsonc';
      plugins = [babel, estree];
      break;
    case 'css':
      parser = 'css';
      plugins = [postcss];
      break;
    case 'scss':
      parser = 'scss';
      plugins = [postcss];
      break;
    case 'less':
      parser = 'less';
      plugins = [postcss];
      break;
    case 'html':
    case 'htm':
      parser = 'html';
      plugins = [html];
      break;
    case 'md':
    case 'markdown':
      parser = 'markdown';
      plugins = [markdown];
      break;
    case 'yaml':
    case 'yml':
      parser = 'yaml';
      plugins = [yaml];
      break;
    default:
      throw new Error(`No parser for ${ext}`);
  }

  return prettier.format(code, { parser, plugins: plugins as never });
}
