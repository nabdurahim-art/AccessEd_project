// Tiny Markdown renderer for lesson text: headings, bold, italic, bullet lists, images.
// It escapes everything first, so a lesson file can never inject HTML.
const inline = (s) => s
  .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img data-path="$2" alt="$1">')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>');

export function markdown(src, esc) {
  let html = '';
  let list = false;
  let para = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += '</ul>'; list = false; } };

  for (const line of esc(src).split(/\r?\n/)) {
    let m;
    if (!line.trim()) { flush(); closeList(); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      flush(); closeList();
      const level = m[1].length + 1; // # becomes h2, because the page title is h1
      html += `<h${level}>${inline(m[2])}</h${level}>`;
    } else if ((m = line.match(/^[-*]\s+(.*)/))) {
      flush();
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else { closeList(); para.push(line.trim()); }
  }
  flush(); closeList();
  return html;
}
