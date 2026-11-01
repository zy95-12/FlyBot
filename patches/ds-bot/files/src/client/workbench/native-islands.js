// Preserve native roots in place: detaching even a focused ancestor loses browser
// focus. Only ancestors containing retained roots are reconciled; ordinary forms
// are replaced whole so their event closures still reference their own nodes.
export function createNativeIslands(root, load, onError) {
  const active = new Map()
  let desired = new Map(), disposed = false
  const keys = node => node.nodeType === 1 ? [node.dataset.nativeIsland, ...[...node.querySelectorAll('[data-native-island]')].map(child => child.dataset.nativeIsland)].filter(Boolean) : []
  const release = record => {
    record.retired = true
    const handle = record.handle
    record.handle = record.options = record.identity = null
    handle?.()
  }
  function reconcile(previous, next, retained) {
    const direct = next.nodeType === 1 && retained.get(next.dataset.nativeIsland)
    if (direct) return direct.node
    if (previous.nodeType !== 1 || next.nodeType !== 1 || previous.tagName !== next.tagName || !keys(next).some(key => retained.has(key))) return next
    const oldChildren = [...previous.childNodes]
    const children = [...next.childNodes].map(child => {
      const key = keys(child).find(value => retained.has(value))
      const old = key && oldChildren.find(candidate => keys(candidate).includes(key))
      return old ? reconcile(old, child, retained) : child
    })
    for (const attribute of [...previous.attributes]) if (!next.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name)
    for (const attribute of [...next.attributes]) previous.setAttribute(attribute.name, attribute.value)
    for (const child of oldChildren) if (!children.includes(child)) child.remove()
    children.forEach((child, index) => { if (previous.childNodes[index] !== child) previous.insertBefore(child, previous.childNodes[index] ?? null) })
    return previous
  }
  return {
    begin() { desired = new Map() },
    register(node, key, identity, mount, options) {
      node.dataset.nativeIsland = key
      desired.set(key, { node, key, identity, mount, options })
    },
    commit(shell) {
      const retained = new Map()
      for (const [key, record] of active) {
        const next = desired.get(key)
        if (next && next.identity === record.identity && record.node.isConnected) {
          retained.set(key, record)
          record.options = next.options
        } else { release(record); active.delete(key) }
      }
      const previous = root.firstElementChild
      const result = previous ? reconcile(previous, shell, retained) : shell
      if (previous !== result) root.replaceChildren(result)
      for (const [key, spec] of desired) {
        const existing = retained.get(key)
        if (existing) { existing.handle?.update?.(existing.options); continue }
        const record = { ...spec, retired: false }
        active.set(key, record)
        void load().then(() => {
          if (disposed || record.retired || active.get(key) !== record || !record.node.isConnected) return
          record.node.replaceChildren()
          record.handle = record.mount(record.node, record.options)
        }).catch(error => { if (!disposed && !record.retired && active.get(key) === record) onError(error, record.node) })
      }
    },
    dispose() { disposed = true; for (const record of active.values()) release(record); active.clear(); desired.clear() },
  }
}
