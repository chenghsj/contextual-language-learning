export function exportMarkdown(markdown: string, title: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
