/**
 * Mirrors `format_assistant_markdown` in app.py so the React UI matches Streamlit.
 */
export function formatAssistantMarkdown(text: string): string {
  if (!text || !String(text).trim()) return text || "";
  let t = String(text).trim();
  t = t.replace(/([:：])\s+\*\s+/g, "$1\n\n* ");
  t = t.replace(/(?<!\n)\s+\*\s+(\*\*)/g, "\n\n* $1");
  t = t.replace(/(\*\*[^*]+\*\*:[^\n]*?)\s+-\s+/g, "$1\n  - ");
  t = t.replace(/(?<!\n)\s+-\s+(?=\*\*|[A-Za-z(])/g, "\n  - ");
  t = t.replace(/\)\s+([A-Z])/g, ")\n\n$1");
  t = t.replace(
    /([.!?])\s+([A-Z][a-z]+\s+(offer|also|additionally|finally)\b)/g,
    "$1\n\n$2",
  );
  t = t.replace(
    /(?<!\n---\n)\n*\s*(\*\*?\s*You might also ask\s*\*?\s*:?)/gi,
    "\n\n---\n\n$1",
  );
  t = t.replace(
    /(?<!\n---\n)\n*\s*(\*\*?\s*Related questions\s*\*?\s*:?)/gi,
    "\n\n---\n\n$1",
  );
  t = t.replace(
    /(?<!\n---\n)\n*\s*(\*\*?\s*قد تسأل أيضًا\s*\*?\s*:?)/g,
    "\n\n---\n\n$1",
  );
  t = t.replace(
    /(?<!\n---\n)\n*\s*(\*\*?\s*Want to go deeper\??\s*\*?\s*:?)/gi,
    "\n\n---\n\n$1",
  );
  t = t.replace(
    /(?<!\n---\n)\n*\s*(\*\*?\s*هل تود معرفة المزيد؟\s*\*?\s*:?)/g,
    "\n\n---\n\n$1",
  );
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
