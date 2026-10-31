export function createApi({ request = fetch, storage = sessionStorage } = {}) {
  let token = storage.getItem('flybot.member') ?? ''
  return {
    setToken(value) { token = value ?? ''; if (token) storage.setItem('flybot.member', token); else storage.removeItem('flybot.member') },
    async call(endpoint, payload = {}, signal) {
      const response = await request('/api/bot', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-flybot-member-session': token } : {}) }, body: JSON.stringify({ endpoint, payload }), signal })
      if (!response.ok) throw new Error('Workbench connection failed')
      const result = await response.json()
      if (!result.ok) throw Object.assign(new Error(result.error?.message ?? result.error ?? 'Request refused'), { code: result.code ?? result.error?.code })
      return result.value
    },
  }
}
