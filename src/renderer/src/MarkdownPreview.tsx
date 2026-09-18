// A deliberately non-HTML preview: untrusted instructions never become executable markup.
export default function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="markdown-preview">
      {text.split(/\n\s*\n/).map((block, i) => {
        const heading = /^(#{1,6}) (.*)$/.exec(block);
        if (heading) return <h3 key={i}>{heading[2]}</h3>;
        if (block.startsWith("```"))
          return <pre key={i}>{block.replace(/^```[^\n]*\n|\n```$/g, "")}</pre>;
        return (
          <p key={i} style={{ whiteSpace: "pre-wrap" }}>
            {block}
          </p>
        );
      })}
    </div>
  );
}
