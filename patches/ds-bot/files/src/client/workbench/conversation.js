// Safe document rendering for the standalone entry, which has no Harness module loader.
// Never interpolate HTML or automatically load a remote image from model content.
export function conversationText(doc, text) {
  const root = doc.createElement('div'); root.className = 'conversation-text'
  function inline(parent, value) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g
    let offset = 0
    for (const match of value.matchAll(pattern)) {
      parent.append(doc.createTextNode(value.slice(offset, match.index)))
      const token = match[0]; let node
      if (token.startsWith('`')) { node = doc.createElement('code'); node.textContent = token.slice(1, -1) }
      else if (token.startsWith('**')) { node = doc.createElement('strong'); node.textContent = token.slice(2, -2) }
      else {
        const [, label, url] = token.match(/^\[(.*)\]\((.*)\)$/)
        node = doc.createElement('span'); node.textContent = label
        try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) { node = doc.createElement('a'); node.textContent = label; node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer' } } catch { /* Invalid model links stay text. */ }
      }
      parent.append(node); offset = match.index + token.length
    }
    parent.append(doc.createTextNode(value.slice(offset)))
  }
  let code, list
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('```')) {
      if (code) code = null
      else { const pre = doc.createElement('pre'); code = doc.createElement('code'); pre.append(code); root.append(pre) }
      list = null; continue
    }
    if (code) { code.append(doc.createTextNode(line + '\n')); continue }
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)
    if (item) { if (!list) { list = doc.createElement('ul'); root.append(list) } const row = doc.createElement('li'); inline(row, item[1]); list.append(row); continue }
    list = null
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    const node = doc.createElement(heading ? `h${heading[1].length + 2 > 6 ? 6 : heading[1].length + 2}` : 'p')
    inline(node, heading ? heading[2] : line); root.append(node)
  }
  return root
}
