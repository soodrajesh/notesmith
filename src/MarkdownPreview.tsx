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
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // GFM task-list checkboxes are read-only; without a label a screen reader announces a bare "checkbox".
        input: ({ node: _node, ...props }) =>
          props.type === 'checkbox' ? (
            <input {...props} aria-label={props.checked ? 'Completed task' : 'Incomplete task'} />
          ) : (
            <input {...props} />
          ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
