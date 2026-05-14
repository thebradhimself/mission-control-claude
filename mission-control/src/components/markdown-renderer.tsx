"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="text-lg font-semibold mt-6 mb-3 first:mt-0">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="text-base font-semibold mt-5 mb-2 first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-sm font-semibold mt-4 mb-2 first:mt-0">{children}</h4>
          ),
          h4: ({ children }) => (
            <h5 className="text-sm font-medium mt-3 mb-1.5 first:mt-0">{children}</h5>
          ),
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2.5 ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2.5 ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ href, children }) => {
            const isExternal = typeof href === "string" && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="text-primary underline-offset-2 hover:underline"
              >
                {children}
              </a>
            );
          },
          code: ({ className: codeClass, children }) => {
            const isBlock = typeof codeClass === "string" && codeClass.startsWith("language-");
            if (isBlock) {
              return (
                <code className={cn("font-mono text-xs", codeClass)}>{children}</code>
              );
            }
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
          th: ({ children }) => (
            <th className="border px-2.5 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border px-2.5 py-1.5">{children}</td>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
