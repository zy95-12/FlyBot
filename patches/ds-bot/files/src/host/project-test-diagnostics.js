// Model-visible diagnostics are bounded data, never proof that verification passed.
export function testFailureExcerpt(output, env = {}) {
  let safe = String(output)
  const secrets = Object.entries(env).filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key) && typeof value === 'string' && value.length >= 8).map(([, value]) => value).sort((a, b) => b.length - a.length)
  for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]')
  safe = safe.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
  const lines = safe.split(/\r?\n/), selected = []
  for (let i = 0; i < lines.length && selected.length < 72; i++) {
    if (!/^\s*(?:not ok\b|✖|(?:Assertion)?Error:|error:)/.test(lines[i])) continue
    selected.push(...lines.slice(Math.max(0, i - 1), i + 19))
    i += 18
  }
  selected.push(...lines.slice(-16))
  return selected.map(line => line.slice(0, 300)).join('\n').slice(0, 6000)
}
