import React, { type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
/** Shared reading security boundary: raw HTML and remote images never execute or load. */
export const SafeMarkdown = React.memo(function SafeMarkdown({
  markdown,
  imageBlocked,
  renderText,
}: {
  markdown: string;
  imageBlocked: string;
  renderText?: (children: ReactNode) => ReactNode;
}) {
  return (
    <ReactMarkdown
      skipHtml
      rehypePlugins={[rehypeSanitize]}
      urlTransform={url => (/^(https?:\/\/|mailto:|#)/i.test(url) ? url : "")}
      components={{
        ...Object.fromEntries(
          ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"].map(tag => [
            tag,
            ({ node: _node, children, ...props }: { node?: unknown; children?: ReactNode }) =>
              React.createElement(tag, props, renderText ? renderText(children) : children),
          ]),
        ),
        img: ({ alt }) => (
          <span className="text-xs text-muted-foreground">
            {imageBlocked}
            {alt ? ` · ${alt}` : ""}
          </span>
        ),
        a: ({ node: _node, ...props }) =>
          props.href ? (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ) : (
            <span>{props.children}</span>
          ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
});
