import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  body: string;
}

// Split into its own module so App.tsx can lazy-load it — react-markdown +
// remark-gfm only matter for the markdown preview pane, but were previously
// statically imported into the main bundle even for sessions that never
// open a markdown file.
export default function MarkdownPreview({ body }: Props) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>;
}
