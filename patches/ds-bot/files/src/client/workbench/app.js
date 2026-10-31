// The shared entry uses only Project-scoped APIs. Never bootstrap from the owner roster.
export function mountWorkbench(root, api, { pollMs = 4000 } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView
  let bootstrap, mode, selected = '', tab = 'board', taskId = '', detail, resources, agents, members, history, taskDetail, workflowState
  let epoch = 0, controller, error = '', notice = '', timer, disposed = false, busy = false
  const drafts = new Map()
  let runtimeTerminal, terminalTimer, terminalPolling = false
  async function closeTerminal() {
    const terminal = runtimeTerminal; runtimeTerminal = null; win.clearInterval(terminalTimer)
    if (terminal) await api.call('project-terminal-close', { terminalId: terminal.terminalId }).catch(() => {}) // Revoked sessions may already have closed the server PTY.
  }
  async function openTerminal(resourceId, harness, role) {
    await closeTerminal()
    const projectId = selected, captured = epoch
    const opened = await scoped('project-terminal-open', { resourceId, harness, role })
    if (captured !== epoch || projectId !== selected || disposed) { await api.call('project-terminal-close', { terminalId: opened.terminalId }); return }
    runtimeTerminal = { ...opened, projectId, screen: '', seq: 0 }
    terminalTimer = win.setInterval(async () => {
      if (!runtimeTerminal || terminalPolling) return
      const terminal = runtimeTerminal; terminalPolling = true
      try {
        const value = await api.call('project-terminal-poll', { terminalId: terminal.terminalId, since: terminal.seq })
        if (terminal !== runtimeTerminal) return
        terminal.seq = value.seq
        terminal.screen = (terminal.screen + (value.output ?? []).map(row => row.text).join('')).slice(-60000)
        terminal.closed = value.closed; terminal.reason = value.reason
        if (value.closed) win.clearInterval(terminalTimer)
        render()
      } catch { if (terminal === runtimeTerminal) { await closeTerminal(); error = 'Configuration terminal ended or access was revoked'; render() } }
      finally { terminalPolling = false }
    }, 500)
    render()
  }
  const el = (tag, text, cls) => { const node = doc.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node }
  const button = (text, action, disabled = false) => { const node = el('button', text); node.type = 'button'; node.disabled = disabled; node.onclick = action; return node }
  const link = (text, url, allowLoopback = false) => { const node = el('a', text); try { const parsed = new URL(url); if (parsed.protocol === 'https:' || allowLoopback && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) { node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer' } } catch { /* Invalid external evidence URL remains plain text. */ } return node }
  const box = (title, ...children) => { const node = el('section', null, 'card'); node.append(el('h2', title), ...children.filter(Boolean)); return node }
  const json = value => el('pre', JSON.stringify(value, null, 2))
  const route = (id, next = 'board', task = '') => { win.location.hash = `/projects/${encodeURIComponent(id)}/${next}${task ? `/${encodeURIComponent(task)}` : ''}` }
  function form(name, fields, submit, label = 'Save') {
    const node = el('form'), key = `${selected}:${tab}:${name}`
    const saved = drafts.get(key) ?? {}
    for (const [field, title, type = 'text', options, initial] of fields) {
      if (type === 'checkboxes') {
        const group = el('fieldset'); group.append(el('legend', title))
        for (const option of options ?? []) {
          const wrapper = el('label', option, 'choice'), input = el('input')
          input.type = 'checkbox'; input.name = field; input.value = option; input.checked = (saved[field] ?? initial ?? []).includes(option)
          input.oninput = () => { const values = drafts.get(key) ?? {}; values[field] = [...group.querySelectorAll('input:checked')].map(row => row.value); drafts.set(key, values) }
          wrapper.prepend(input); group.append(wrapper)
        }
        node.append(group); continue
      }
      const wrapper = el('label', title)
      const input = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input')
      if (options) for (const option of options) { const row = el('option', option || 'No repository'); row.value = option; input.append(row) }
      else if (type !== 'textarea') input.type = type
      input.setAttribute('aria-label', title)
      input.name = field; input.id = `${name}-${field}`; input.value = saved[field] ?? initial ?? (options?.[0] ?? ''); input.required = type !== 'optional' && !options
      if (type === 'optional') input.type = 'text'
      input.oninput = () => { const values = drafts.get(key) ?? {}; values[field] = input.value; drafts.set(key, values) }
      wrapper.append(input); node.append(wrapper)
    }
    node.append(button(label, () => {}, busy))
    node.lastChild.type = 'submit'
    node.onsubmit = event => { event.preventDefault(); const data = new win.FormData(node), values = Object.fromEntries(data); for (const [field, , type] of fields) if (type === 'checkboxes') values[field] = data.getAll(field); void act(async () => { await submit(values); drafts.delete(key) }) }
    return node
  }
  async function act(action) {
    if (busy) return
    const captured = epoch
    busy = true; error = ''; render()
    try { await action(); if (captured === epoch) await refresh() }
    catch (failure) { if (captured === epoch) error = failure.message }
    finally { busy = false; if (!disposed) render() }
  }
  const scoped = (endpoint, body = {}) => api.call(endpoint, { projectId: selected, ...body })
  async function refresh() {
    const current = ++epoch
    controller?.abort(); controller = new AbortController()
    const id = selected, section = tab, tid = taskId
    try {
      const state = await api.call('workbench-state', {}, controller.signal)
      if (current !== epoch || disposed) return
      bootstrap = state
      if (!id) { render(); return }
      if (!state.projects.some(project => project.id === id)) throw new Error('Project access was removed or the Project is unavailable')
      const calls = ['project-detail', 'project-resources', 'project-agents', 'project-members'].map(endpoint => api.call(endpoint, { projectId: id }, controller.signal))
      const extra = section === 'private' || section === 'bots' ? api.call('project-agent-history', { projectId: id, visibility: section === 'private' ? 'private' : 'public' }, controller.signal) : null
      const task = tid ? api.call('project-task-detail', { taskId: tid }, controller.signal) : null
      const values = await Promise.all([...calls, extra, task, api.call('project-workflow', { projectId: id, operation: 'state' }, controller.signal)])
      if (values[5] && values[5].task.projectId !== id) throw new Error('Task belongs to another Project')
      if (current !== epoch || disposed) return
      ;[detail, resources, agents, members, history, taskDetail, workflowState] = values
      error = ''; render()
    } catch (failure) {
      if (current !== epoch || disposed || failure.name === 'AbortError') return
      detail = resources = agents = members = history = taskDetail = workflowState = null
      error = failure.message; render()
    }
  }
  function changeRoute() {
    void closeTerminal()
    const match = win.location.hash.match(/^#\/projects\/([^/]+)\/(board|tasks|members|bots|resources|private)(?:\/([^/]+))?$/)
    try { selected = match ? decodeURIComponent(match[1]) : ''; tab = match?.[2] ?? 'board'; taskId = match?.[3] ? decodeURIComponent(match[3]) : '' } catch { selected = ''; tab = 'board'; taskId = '' }
    ++epoch; controller?.abort(); detail = resources = agents = members = history = taskDetail = workflowState = null; error = ''; notice = ''
    render(); void refresh()
  }
  function taskPanel(task) {
    const node = el('article', null, 'task')
    const run = (workflowState?.workflows ?? []).flatMap(row => row.runs ?? []).find(row => row.task?.id === task.id)
    const phase = Object.entries(run?.nodeStatus ?? {}).filter(([, status]) => status === 'running').map(([role]) => role).join(', ')
    const queued = resources.queue.some(row => row.taskId === task.id && row.status === 'waiting')
    node.append(button(task.title, () => route(selected, 'tasks', task.id)), el('small', `${task.priority ?? 'normal'} · ${task.status} · ${phase || (queued ? 'waiting for quota' : task.requesterId)}`))
    return node
  }
  function attemptsPanel() {
    const task = taskDetail.task, canWrite = detail.permissions.configure || task.requesterId === bootstrap.self.memberId
    const node = box(task.title, el('p', task.criteria ?? 'No acceptance criteria'), el('p', task.note ?? 'No additional context'), el('p', `Priority: ${task.priority ?? 'normal'} · status: ${task.status}`))
    if (Number.isFinite(task.createdAt)) node.append(el('p', `Task age: ${Math.max(0, Math.round((Date.now() - task.createdAt) / 60000))} min, including waiting`))
    if (task.target?.href) node.append(link('Source Issue / PR', task.target.href))
    if (task.status === 'blocked') node.append(box('Waiting for input / approval', json({ waitingFor: task.waitingFor, input: task.inputRequest, approvalId: task.approvalId })))
    if (task.waitingFor === 'input' && task.requesterId === bootstrap.self.memberId && !task.approvalId && !task.inputApprovalIds?.length) node.append(form('answer', [['answer', 'Answer current question', 'textarea']], values => scoped('task-answer-input', { id: task.id, questionId: task.inputRequest.id, ...values }), 'Answer'))
    const activeAttempt = taskDetail.attempts.some(attempt => ['preparing', 'running', 'waiting-acceptance'].includes(attempt.status))
    node.append(button('Run / retry', () => act(() => scoped('project-task-run', { taskId: task.id, requestId: win.crypto.randomUUID() })), !canWrite || !resources.repository.configured || activeAttempt || ['accepted', 'cancelled'].includes(task.status) || busy))
    for (const attempt of taskDetail.attempts) {
      const card = box(`Attempt · ${attempt.status}`, el('code', attempt.id), el('p', attempt.candidateSha ?? 'No candidate commit'), json(attempt.evidence ?? {}))
      if (attempt.failure?.message) card.append(box('Failure / requested changes', el('p', attempt.failure.message)))
      const ended = attempt.acceptedAt ?? attempt.failure?.at
      card.append(el('p', `Attempt elapsed: ${Math.max(0, Math.round(((ended ?? Date.now()) - attempt.createdAt) / 1000))} sec (includes preparation and waiting)`))
      const workflow = workflowState?.workflows?.find(row => row.id === attempt.workflowId)
      const run = [...(workflow?.runs ?? []), workflow?.run].find(row => row?.id === attempt.runId)
      card.append(box('Role progress and workspaces', json({ roles: run?.nodeStatus ?? {}, workspaces: attempt.workspaces, models: attempt.agentDefinitions?.roles?.map(row => ({ role: row.role, model: row.model })) ?? [] })))
      if (attempt.pr?.url) card.append(link('Open pull request', attempt.pr.url))
      card.append(button('Test log', () => act(async () => { const log = await scoped('project-attempt-log', { attemptId: attempt.id }); notice = log.text ?? log.reason })))
      if (detail.permissions.accept && attempt.status === 'waiting-acceptance') {
        card.append(button('Accept this commit', () => act(() => scoped('project-task-accept', { attemptId: attempt.id, sha: attempt.candidateSha })), busy))
        card.append(form(`reject-${attempt.id}`, [['reason', 'Requested changes', 'textarea']], values => scoped('project-task-reject', { attemptId: attempt.id, ...values }), 'Request changes'))
      }
      for (const [role, evidence] of Object.entries(attempt.evidence?.execution ?? {})) card.append(el('p', `${role}: ${evidence.harness} ${evidence.sdkVersion} · resource ${evidence.resourceId} · Session ${evidence.sessionId}`), button(`Read ${role} execution evidence`, () => act(async () => { notice = (await scoped('project-attempt-log', { attemptId: attempt.id, role })).text ?? 'No execution log'; })))
      if (detail.permissions.configure) card.append(button('Stop execution', () => act(() => scoped('project-attempt-stop', { attemptId: attempt.id })), busy), button('Clean workspaces', () => act(() => scoped('project-attempt-cleanup', { attemptId: attempt.id })), busy))
      node.append(card)
    }
    return node
  }
  function boardPanel() {
    const node = el('div')
    const metrics = resources.metrics
    const stats = el('div', null, 'stats')
    for (const [label, value] of [['Accepted / 7 days', metrics.acceptedTasks], ['Active slots', `${resources.activeSlots}/${resources.quota.maxConcurrent}`], ['Waiting', resources.queue.filter(row => row.status === 'waiting').length], ['Median delivery', metrics.duration.medianMs == null ? 'No samples' : `${Math.round(metrics.duration.medianMs / 60000)} min`]]) stats.append(box(label, el('strong', value)))
    node.append(stats, el('p', 'Delivery duration: Task creation to human acceptance, including queue and human wait.'))
    const columns = el('div', null, 'columns')
    const groups = [['Open', task => !['working', 'result-ready', 'accepted', 'cancelled', 'failed'].includes(task.status)], ['In progress', task => ['working', 'result-ready'].includes(task.status)], ['Completed', task => ['accepted', 'cancelled', 'failed'].includes(task.status)]]
    for (const [label, predicate] of groups) columns.append(box(label, ...(detail.tasks ?? []).filter(predicate).sort((a, b) => ['urgent', 'high', 'normal', 'low'].indexOf(a.priority ?? 'normal') - ['urgent', 'high', 'normal', 'low'].indexOf(b.priority ?? 'normal')).map(taskPanel)))
    node.append(columns)
    if (detail.permissions.create) node.append(box('Create Task', form('task', [['title', 'Requirement'], ['criteria', 'Acceptance criteria', 'textarea'], ['note', 'Context', 'optional'], ['priority', 'Priority', 'text', ['normal', 'high', 'urgent', 'low']], ['target', 'Source Issue / PR (optional)', 'optional']], values => scoped('task-create', { ...values, botId: agents.public.botId }), 'Create Task')))
    return node
  }
  function membersPanel() {
    const node = box('Project members')
    for (const member of members.members) {
      const row = el('div', null, 'row'); row.append(el('span', `${member.displayName} · ${member.role}`))
      if (member.role !== 'owner' && detail.permissions.configure) row.append(button('Remove', () => act(() => scoped('project-member-remove', { memberId: member.memberId })), busy))
      if (member.role !== 'owner' && detail.permissions.manage) row.append(button(member.role === 'maintainer' ? 'Make Member' : 'Make Maintainer', () => act(() => scoped('project-role', { id: selected, memberId: member.memberId, role: member.role === 'maintainer' ? 'member' : 'maintainer' })), busy))
      node.append(row)
    }
    if (detail.permissions.configure) node.append(button('Create one-use Project invitation', () => act(async () => { const invite = await scoped('project-invite'); notice = `Project invitation (expires ${new Date(invite.expiresAt).toLocaleString()}): ${invite.token}` }), busy))
    return node
  }
  function agentsPanel() {
    const privateView = tab === 'private', visibility = privateView ? 'private' : 'public'
    const node = box(privateView ? 'My Project agent' : 'Public Chief', el('p', privateView ? 'Your conversation, notes and unpublished proposals are private to this Project and account.' : 'This conversation is shared with current Project members.'))
    for (const message of history?.messages ?? []) node.append(box(message.role ?? message.kind ?? 'Message', el('p', message.text ?? message.content ?? '')))
    node.append(form('message', [['text', 'Message', 'textarea']], values => scoped('project-agent-message', { ...values, visibility }), history?.busy ? 'Agent busy' : 'Send'))
    if (privateView) {
      node.append(box('Private notes', ...agents.privateMemory.map(note => el('p', note.text)), form('memory', [['text', 'Remember privately', 'textarea']], values => scoped('project-agent-memory-write', values))))
      for (const proposal of agents.proposals) node.append(box('Unpublished proposal', json(proposal.fields), button(proposal.taskId ? 'Published' : 'Publish as shared Task', () => act(() => scoped('project-agent-proposal-apply', { proposalId: proposal.id })), Boolean(proposal.taskId) || busy)))
    } else {
      for (const role of agents.definitions.roles) {
        const card = box(role.role, el('p', `Model: ${role.model ?? 'Project default'} · revision ${role.revision ?? agents.definitions.revision}`), el('p', role.instructions))
        if (detail.permissions.configure) {
          card.append(el('p', 'Saving checks each selected resource with one bounded connection probe; a configured provider may charge for the small inference. Running Sessions retain their saved revision.'))
          const available = (resources.executionResources ?? []).map(row => row.id)
          card.append(form(`role-${role.role}`, [
            ['instructions', 'Instructions', 'textarea', null, role.instructions], ['model', 'Native model identifier', 'optional', null, role.model ?? ''],
            ['skills', 'Skills (comma separated)', 'optional', null, (role.skills ?? []).join(', ')], ['memoryRefs', 'Published role memory IDs', 'optional', null, (role.memoryRefs ?? []).join(', ')],
            ['harness', 'Execution Harness', 'text', ['flybot', 'codex', 'claude-agent'], role.execution?.harness ?? 'flybot'],
            ['sdkModel', 'SDK model identifier', 'optional', null, role.execution?.model ?? ''],
            ['resourceIds', 'Candidate execution resources', 'checkboxes', available, role.execution?.resourceIds ?? []],
            ['maxConcurrent', 'Concurrent Sessions for this role', 'number', null, role.execution?.maxConcurrent ?? 1],
          ], async values => {
            const split = text => text.split(',').map(value => value.trim()).filter(Boolean)
            await scoped('project-agent-definition', { role: role.role, instructions: values.instructions, model: values.model, skills: split(values.skills), memoryRefs: split(values.memoryRefs),
              execution: { harness: values.harness, model: values.sdkModel, resourceIds: values.resourceIds, maxConcurrent: Number(values.maxConcurrent) } })
            await Promise.allSettled(values.resourceIds.map(resourceId => scoped('project-runtime-check', { resourceId, harness: values.harness, role: role.role })))
          }))
          card.append(form(`role-memory-${role.role}`, [['text', 'Publish verified role memory', 'textarea'], ['reference', 'Source / evidence reference']], async values => {
            const saved = await scoped('project-role-memory-write', { role: role.role, text: values.text, source: { kind: 'human', reference: values.reference } })
            await scoped('project-agent-definition', { role: role.role, memoryRefs: [...(role.memoryRefs ?? []), saved.memory.id] })
          }, 'Publish and attach memory'))
        }
        node.append(card)
      }
      node.append(box('Shared knowledge', ...agents.knowledge.map(row => el('p', row.text))))
    }
    return node
  }
  function resourcesPanel() {
    const node = box('Execution resources', el('p', `Concurrency ${resources.activeSlots}/${resources.quota.maxConcurrent}. Repository ${resources.repository.configured ? 'provisioned' : 'not provisioned by operator'}.`))
    if (detail.permissions.configure) node.append(form('quota', [['maxConcurrent', 'Concurrent Runs (1–32)', 'number']], values => scoped('project-quota', { maxConcurrent: Number(values.maxConcurrent) })))
    for (const resource of resources.executionResources ?? []) {
      const row = box(resource.id, el('p', `${resource.type} · slots ${resource.capacity.occupied}/${resource.capacity.configured} · environment ${resource.health.status}`))
      for (const status of resource.harnessStatus ?? []) {
        row.append(el('p', `${status.harness}: ${status.status}${status.sdkVersion ? ` · SDK ${status.sdkVersion}` : status.harness === 'flybot' ? '' : ' · SDK not detected'}${status.reason ? ` · ${status.reason}` : ''}${status.at ? ` · checked ${new Date(status.at).toLocaleTimeString()}` : ''}`))
        if (detail.permissions.configure) row.append(button(`Check ${status.harness} connection`, () => act(() => scoped('project-runtime-check', { resourceId: resource.id, harness: status.harness })), busy))
        if (resource.canManage && detail.permissions.configure) row.append(button(`Open ${status.harness} configuration terminal`, () => act(() => openTerminal(resource.id, status.harness)), busy))
      }
      node.append(row)
    }
    for (const worker of resources.harnessWorkers ?? []) {
      const row = box(`${worker.role} · ${worker.harness}`, el('p', `${worker.status} · ${worker.resourceId} · ${worker.backendSessionId ?? 'Session pending'}`))
      if (worker.pending?.kind === 'permission' && detail.permissions.configure) row.append(json(worker.pending.request), button('Allow requested action', () => act(() => scoped('project-execution-input', { workerId: worker.id, generation: worker.generation, requestId: worker.pending.id, allow: true })), busy), button('Deny requested action', () => act(() => scoped('project-execution-input', { workerId: worker.id, generation: worker.generation, requestId: worker.pending.id, allow: false })), busy))
      else if (worker.pending) row.append(el('p', worker.pending.text), form(`execution-${worker.id}`, [['text', 'Continue the same execution Session', 'textarea']], values => scoped('project-execution-input', { workerId: worker.id, generation: worker.generation, text: values.text })))
      node.append(row)
    }
    for (const entry of resources.queue) {
      const row = box(`Queued Task ${entry.taskId}`, el('p', `${entry.status} · ${entry.reason ?? ''}`))
      if (['waiting', 'blocked'].includes(entry.status) && (detail.permissions.configure || entry.memberId === bootstrap.self.memberId)) row.append(button('Cancel queue request', () => act(() => scoped('project-queue-cancel', { queueId: entry.id })), busy))
      node.append(row)
    }
    node.append(box('Workers and workspaces', json({ workers: resources.workers, workspaces: resources.workspaces })), box('Shared host process', el('p', `RSS ${Math.round(resources.host.rssBytes / 1048576)} MiB · CPU ${resources.host.cpuPercent == null ? 'not sampled' : `${resources.host.cpuPercent.toFixed(1)}%`}`), el('p', resources.host.reason)), box('My platform instance', el('p', 'Account instance from control-plane; separate from the shared execution host.'), json(resources.platformInstance ?? { status: 'Unavailable' })))
    return node
  }
  function render() {
    const terminalInputValue = doc.getElementById('runtime-terminal-input')?.value ?? ''
    if (disposed) return
    const active = doc.activeElement, focus = active?.id, start = active?.selectionStart, end = active?.selectionEnd
    root.replaceChildren()
    const shell = el('div', null, 'shell'), sidebar = el('aside'), main = el('main')
    sidebar.append(el('h1', 'FlyBot'), el('p', 'Project workbench'))
    if (!bootstrap) {
      main.append(box('Sign in', el('p', mode?.mode === 'platform' ? 'Use your existing control-plane account.' : 'Use an operator-issued member invitation.'), form('login', mode?.mode === 'platform' ? [['email', 'Email', 'email'], ['password', 'Password', 'password']] : [['token', 'Member invitation'], ['displayName', 'Display name']], async values => { const result = await api.call(mode?.mode === 'platform' ? 'platform-login' : 'auth-redeem', values); api.setToken(result.sessionToken); bootstrap = await api.call('workbench-state') }, 'Sign in')))
    } else {
      sidebar.append(el('p', bootstrap.self.displayName))
      if (bootstrap.demoMode) main.append(el('p', bootstrap.demoMode === 'deterministic-fixture' ? 'Demo: deterministic model fixture. Delivery requires real evidence; this is not real-model acceptance.' : 'Demo: configured real model provider. Inspect delivery evidence before acceptance.'))
      const picker = el('select'); picker.setAttribute('aria-label', 'Project'); picker.append(el('option', 'Choose Project'))
      for (const project of bootstrap.projects) { const option = el('option', project.name); option.value = project.id; option.selected = project.id === selected; picker.append(option) }
      picker.onchange = () => route(picker.value); sidebar.append(picker)
      for (const [key, title] of [['board', 'Task board'], ['members', 'Members'], ['bots', 'Public Bots'], ['resources', 'Resources'], ['private', 'My Project agent']]) sidebar.append(button(title, () => route(selected, key), !selected))
      sidebar.append(button('All Projects', () => { win.location.hash = '' }), button('Sign out', () => act(async () => { await closeTerminal(); await api.call('auth-revoke'); api.setToken(''); drafts.clear(); notice = ''; bootstrap = null; selected = ''; ++epoch; detail = resources = agents = members = history = taskDetail = workflowState = null })))
      if (!selected) {
        main.append(el('h1', 'Projects'), ...bootstrap.projects.map(project => box(project.name, el('p', `${project.role} · ${project.status}`), button('Open Project', () => route(project.id)))))
        main.append(box('New Project', form('project', [['name', 'Project name'], ['repository', 'Provisioned repository', 'text', ['', ...bootstrap.repositories]]], async values => { const result = await api.call('project-create', values); route(result.project.id) }, 'Create Project')), box('Join shared Project', form('join', [['token', 'Project invitation']], async values => { const result = await api.call('project-join', values); route(result.project.id) }, 'Join')))
      } else if (detail) {
        main.append(el('h1', detail.project.name), el('p', `${detail.project.role} · ${detail.project.status} · ${detail.project.repository ?? 'No repository'}`))
        main.append(taskDetail ? attemptsPanel() : tab === 'members' ? membersPanel() : ['bots', 'private'].includes(tab) ? agentsPanel() : tab === 'resources' ? resourcesPanel() : boardPanel())
      } else main.append(el('p', error ? 'Project unavailable. Select another Project or refresh.' : 'Loading Project…'))
    }
    if (mode?.panelUrl) sidebar.append(link('Control-plane account panel', mode.panelUrl, true))
    if (error) { const alert = el('p', error, 'error'); alert.setAttribute('role', 'alert'); main.prepend(alert) }
    if (notice) main.prepend(box('Result', el('pre', notice)))
    if (runtimeTerminal?.projectId === selected) {
      const terminal = runtimeTerminal
      const screen = el('pre', terminal.screen.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''), 'terminal-screen')
      const pane = box(`${terminal.resourceId} · ${terminal.harness} private configuration`, el('p', terminal.instructions), screen)
      if (terminal.closed) pane.append(el('p', terminal.reason ?? 'Configuration terminal ended'))
      if (!terminal.closed) {
        const input = el('input'); input.id = 'runtime-terminal-input'; input.type = 'password'; input.value = terminalInputValue; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Private terminal input (not saved)')
        const send = () => { const text = input.value; input.value = ''; void api.call('project-terminal-input', { terminalId: terminal.terminalId, text: text + '\n' }).catch(() => closeTerminal()) }
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); send() } }
        pane.append(input, button('Send to terminal', send), button('Interrupt', () => api.call('project-terminal-input', { terminalId: terminal.terminalId, text: '\x03' })))
      }
      pane.append(button('Close and recheck configuration', () => act(closeTerminal))); main.append(pane)
    }
    shell.append(sidebar, main); root.append(shell)
    if (focus) { const target = doc.getElementById(focus); if (target) { target.focus(); if (typeof start === 'number' && target.setSelectionRange && !['number', 'email'].includes(target.type)) target.setSelectionRange(start, end) } }
  }
  async function start() {
    try { mode = await api.call('auth-mode'); try { bootstrap = await api.call('workbench-state') } catch { /* An expired or absent member session displays the sign-in form. */ } }
    catch (failure) { error = failure.message }
    if (disposed) return
    changeRoute(); timer = win.setInterval(() => { if (bootstrap && !busy && !doc.hidden) void refresh() }, pollMs)
  }
  win.addEventListener('hashchange', changeRoute)
  render(); void start()
  return { refresh, dispose() { void closeTerminal(); disposed = true; ++epoch; controller?.abort(); win.clearInterval(timer); win.removeEventListener('hashchange', changeRoute); root.replaceChildren(); drafts.clear() } }
}
