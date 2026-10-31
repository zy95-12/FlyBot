(() => {
  // src/client/workbench/api.js
  function createApi({ request = fetch, storage = sessionStorage } = {}) {
    let token = storage.getItem("flybot.member") ?? "";
    return {
      setToken(value) {
        token = value ?? "";
        if (token) storage.setItem("flybot.member", token);
        else storage.removeItem("flybot.member");
      },
      async call(endpoint, payload = {}, signal) {
        const response = await request("/api/bot", { method: "POST", headers: { "content-type": "application/json", ...token ? { "x-flybot-member-session": token } : {} }, body: JSON.stringify({ endpoint, payload }), signal });
        if (!response.ok) throw new Error("Workbench connection failed");
        const result = await response.json();
        if (!result.ok) throw Object.assign(new Error(result.error?.message ?? result.error ?? "Request refused"), { code: result.code ?? result.error?.code });
        return result.value;
      }
    };
  }

  // src/client/workbench/app.js
  function mountWorkbench(root, api, { pollMs = 4e3 } = {}) {
    const doc = root.ownerDocument, win = doc.defaultView;
    let bootstrap, mode, selected = "", tab = "board", taskId = "", detail, resources, agents, members, history, taskDetail, workflowState;
    let epoch = 0, controller, error = "", notice = "", timer, disposed = false, busy = false;
    const drafts = /* @__PURE__ */ new Map();
    const el = (tag, text, cls) => {
      const node = doc.createElement(tag);
      if (text != null) node.textContent = String(text);
      if (cls) node.className = cls;
      return node;
    };
    const button = (text, action, disabled = false) => {
      const node = el("button", text);
      node.type = "button";
      node.disabled = disabled;
      node.onclick = action;
      return node;
    };
    const link = (text, url, allowLoopback = false) => {
      const node = el("a", text);
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || allowLoopback && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
          node.href = parsed.href;
          node.target = "_blank";
          node.rel = "noopener noreferrer";
        }
      } catch {
      }
      return node;
    };
    const box = (title, ...children) => {
      const node = el("section", null, "card");
      node.append(el("h2", title), ...children.filter(Boolean));
      return node;
    };
    const json = (value) => el("pre", JSON.stringify(value, null, 2));
    const route = (id, next = "board", task = "") => {
      win.location.hash = `/projects/${encodeURIComponent(id)}/${next}${task ? `/${encodeURIComponent(task)}` : ""}`;
    };
    function form(name, fields, submit, label = "Save") {
      const node = el("form"), key = `${selected}:${tab}:${name}`;
      const saved = drafts.get(key) ?? {};
      for (const [field, title, type = "text", options] of fields) {
        const wrapper = el("label", title);
        const input = el(options ? "select" : type === "textarea" ? "textarea" : "input");
        if (options) for (const option of options) {
          const row = el("option", option || "No repository");
          row.value = option;
          input.append(row);
        }
        else if (type !== "textarea") input.type = type;
        input.setAttribute("aria-label", title);
        input.name = field;
        input.id = `${name}-${field}`;
        input.value = saved[field] ?? "";
        input.required = type !== "optional" && !options;
        if (type === "optional") input.type = "text";
        input.oninput = () => {
          const values = drafts.get(key) ?? {};
          values[field] = input.value;
          drafts.set(key, values);
        };
        wrapper.append(input);
        node.append(wrapper);
      }
      node.append(button(label, () => {
      }, busy));
      node.lastChild.type = "submit";
      node.onsubmit = (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new win.FormData(node));
        void act(async () => {
          await submit(values);
          drafts.delete(key);
        });
      };
      return node;
    }
    async function act(action) {
      if (busy) return;
      const captured = epoch;
      busy = true;
      error = "";
      render();
      try {
        await action();
        if (captured === epoch) await refresh();
      } catch (failure) {
        if (captured === epoch) error = failure.message;
      } finally {
        busy = false;
        if (!disposed) render();
      }
    }
    const scoped = (endpoint, body = {}) => api.call(endpoint, { projectId: selected, ...body });
    async function refresh() {
      const current = ++epoch;
      controller?.abort();
      controller = new AbortController();
      const id = selected, section = tab, tid = taskId;
      try {
        const state = await api.call("workbench-state", {}, controller.signal);
        if (current !== epoch || disposed) return;
        bootstrap = state;
        if (!id) {
          render();
          return;
        }
        if (!state.projects.some((project) => project.id === id)) throw new Error("Project access was removed or the Project is unavailable");
        const calls = ["project-detail", "project-resources", "project-agents", "project-members"].map((endpoint) => api.call(endpoint, { projectId: id }, controller.signal));
        const extra = section === "private" || section === "bots" ? api.call("project-agent-history", { projectId: id, visibility: section === "private" ? "private" : "public" }, controller.signal) : null;
        const task = tid ? api.call("project-task-detail", { taskId: tid }, controller.signal) : null;
        const values = await Promise.all([...calls, extra, task, api.call("project-workflow", { projectId: id, operation: "state" }, controller.signal)]);
        if (values[5] && values[5].task.projectId !== id) throw new Error("Task belongs to another Project");
        if (current !== epoch || disposed) return;
        [detail, resources, agents, members, history, taskDetail, workflowState] = values;
        error = "";
        render();
      } catch (failure) {
        if (current !== epoch || disposed || failure.name === "AbortError") return;
        detail = resources = agents = members = history = taskDetail = workflowState = null;
        error = failure.message;
        render();
      }
    }
    function changeRoute() {
      const match = win.location.hash.match(/^#\/projects\/([^/]+)\/(board|tasks|members|bots|resources|private)(?:\/([^/]+))?$/);
      try {
        selected = match ? decodeURIComponent(match[1]) : "";
        tab = match?.[2] ?? "board";
        taskId = match?.[3] ? decodeURIComponent(match[3]) : "";
      } catch {
        selected = "";
        tab = "board";
        taskId = "";
      }
      ++epoch;
      controller?.abort();
      detail = resources = agents = members = history = taskDetail = workflowState = null;
      error = "";
      notice = "";
      render();
      void refresh();
    }
    function taskPanel(task) {
      const node = el("article", null, "task");
      const run = (workflowState?.workflows ?? []).flatMap((row) => row.runs ?? []).find((row) => row.task?.id === task.id);
      const phase = Object.entries(run?.nodeStatus ?? {}).filter(([, status]) => status === "running").map(([role]) => role).join(", ");
      const queued = resources.queue.some((row) => row.taskId === task.id && row.status === "waiting");
      node.append(button(task.title, () => route(selected, "tasks", task.id)), el("small", `${task.status} · ${phase || (queued ? "waiting for quota" : task.requesterId)}`));
      return node;
    }
    function attemptsPanel() {
      const task = taskDetail.task, canWrite = detail.permissions.configure || task.requesterId === bootstrap.self.memberId;
      const node = box(task.title, el("p", task.criteria ?? "No acceptance criteria"));
      node.append(button("Run / retry", () => act(() => scoped("project-task-run", { taskId: task.id, requestId: win.crypto.randomUUID() })), !canWrite || !resources.repository.configured || busy));
      for (const attempt of taskDetail.attempts) {
        const card = box(`Attempt · ${attempt.status}`, el("code", attempt.id), el("p", attempt.candidateSha ?? "No candidate commit"), json(attempt.evidence ?? {}));
        const workflow = workflowState?.workflows?.find((row) => row.id === attempt.workflowId);
        const run = [...workflow?.runs ?? [], workflow?.run].find((row) => row?.id === attempt.runId);
        card.append(box("Role progress and workspaces", json({ roles: run?.nodeStatus ?? {}, workspaces: attempt.workspaces, models: attempt.agentDefinitions?.roles?.map((row) => ({ role: row.role, model: row.model })) ?? [] })));
        if (attempt.pr?.url) card.append(link("Open pull request", attempt.pr.url));
        card.append(button("Test log", () => act(async () => {
          const log = await scoped("project-attempt-log", { attemptId: attempt.id });
          notice = log.text ?? log.reason;
        })));
        if (detail.permissions.accept && attempt.status === "waiting-acceptance") {
          card.append(button("Accept this commit", () => act(() => scoped("project-task-accept", { attemptId: attempt.id, sha: attempt.candidateSha })), busy));
          card.append(form(`reject-${attempt.id}`, [["reason", "Requested changes", "textarea"]], (values) => scoped("project-task-reject", { attemptId: attempt.id, ...values }), "Request changes"));
        }
        if (detail.permissions.configure) card.append(button("Stop execution", () => act(() => scoped("project-attempt-stop", { attemptId: attempt.id })), busy), button("Clean workspaces", () => act(() => scoped("project-attempt-cleanup", { attemptId: attempt.id })), busy));
        node.append(card);
      }
      return node;
    }
    function boardPanel() {
      const node = el("div");
      const metrics = resources.metrics;
      const stats = el("div", null, "stats");
      for (const [label, value] of [["Accepted / 7 days", metrics.acceptedTasks], ["Active slots", `${resources.activeSlots}/${resources.quota.maxConcurrent}`], ["Waiting", resources.queue.filter((row) => row.status === "waiting").length], ["Median delivery", metrics.duration.medianMs == null ? "No samples" : `${Math.round(metrics.duration.medianMs / 6e4)} min`]]) stats.append(box(label, el("strong", value)));
      node.append(stats, el("p", "Delivery duration: Task creation to human acceptance, including queue and human wait."));
      const columns = el("div", null, "columns");
      const groups = [["Open", (task) => !["working", "result-ready", "accepted", "cancelled", "failed"].includes(task.status)], ["In progress", (task) => ["working", "result-ready"].includes(task.status)], ["Completed", (task) => ["accepted", "cancelled", "failed"].includes(task.status)]];
      for (const [label, predicate] of groups) columns.append(box(label, ...(detail.tasks ?? []).filter(predicate).map(taskPanel)));
      node.append(columns);
      if (detail.permissions.create) node.append(box("Create Task", form("task", [["title", "Requirement"], ["criteria", "Acceptance criteria", "textarea"], ["note", "Context", "optional"]], (values) => scoped("task-create", { ...values, botId: agents.public.botId }), "Create Task")));
      return node;
    }
    function membersPanel() {
      const node = box("Project members");
      for (const member of members.members) {
        const row = el("div", null, "row");
        row.append(el("span", `${member.displayName} · ${member.role}`));
        if (member.role !== "owner" && detail.permissions.configure) row.append(button("Remove", () => act(() => scoped("project-member-remove", { memberId: member.memberId })), busy));
        if (member.role !== "owner" && detail.permissions.manage) row.append(button(member.role === "maintainer" ? "Make Member" : "Make Maintainer", () => act(() => scoped("project-role", { id: selected, memberId: member.memberId, role: member.role === "maintainer" ? "member" : "maintainer" })), busy));
        node.append(row);
      }
      if (detail.permissions.configure) node.append(button("Create one-use Project invitation", () => act(async () => {
        const invite = await scoped("project-invite");
        notice = `Project invitation (expires ${new Date(invite.expiresAt).toLocaleString()}): ${invite.token}`;
      }), busy));
      return node;
    }
    function agentsPanel() {
      const privateView = tab === "private", visibility = privateView ? "private" : "public";
      const node = box(privateView ? "My Project agent" : "Public Chief", el("p", privateView ? "Your conversation, notes and unpublished proposals are private to this Project and account." : "This conversation is shared with current Project members."));
      for (const message of history?.messages ?? []) node.append(box(message.role ?? message.kind ?? "Message", el("p", message.text ?? message.content ?? "")));
      node.append(form("message", [["text", "Message", "textarea"]], (values) => scoped("project-agent-message", { ...values, visibility }), history?.busy ? "Agent busy" : "Send"));
      if (privateView) {
        node.append(box("Private notes", ...agents.privateMemory.map((note) => el("p", note.text)), form("memory", [["text", "Remember privately", "textarea"]], (values) => scoped("project-agent-memory-write", values))));
        for (const proposal of agents.proposals) node.append(box("Unpublished proposal", json(proposal.fields), button(proposal.taskId ? "Published" : "Publish as shared Task", () => act(() => scoped("project-agent-proposal-apply", { proposalId: proposal.id })), Boolean(proposal.taskId) || busy)));
      } else {
        for (const role of agents.definitions.roles) {
          const card = box(role.role, el("p", `Model: ${role.model ?? "Project default"} · revision ${role.revision ?? agents.definitions.revision}`), el("p", role.instructions));
          if (detail.permissions.configure) card.append(form(`role-${role.role}`, [["instructions", "Instructions", "textarea"], ["model", "Model identifier", "optional"]], (values) => scoped("project-agent-definition", { role: role.role, ...values })));
          node.append(card);
        }
        node.append(box("Shared knowledge", ...agents.knowledge.map((row) => el("p", row.text))));
      }
      return node;
    }
    function resourcesPanel() {
      const node = box("Execution resources", el("p", `Concurrency ${resources.activeSlots}/${resources.quota.maxConcurrent}. Repository ${resources.repository.configured ? "provisioned" : "not provisioned by operator"}.`));
      if (detail.permissions.configure) node.append(form("quota", [["maxConcurrent", "Concurrent Runs (1–32)", "number"]], (values) => scoped("project-quota", { maxConcurrent: Number(values.maxConcurrent) })));
      for (const entry of resources.queue) {
        const row = box(`Queued Task ${entry.taskId}`, el("p", `${entry.status} · ${entry.reason ?? ""}`));
        if (["waiting", "blocked"].includes(entry.status) && (detail.permissions.configure || entry.memberId === bootstrap.self.memberId)) row.append(button("Cancel queue request", () => act(() => scoped("project-queue-cancel", { queueId: entry.id })), busy));
        node.append(row);
      }
      node.append(box("Workers and workspaces", json({ workers: resources.workers, workspaces: resources.workspaces })), box("Shared host process", el("p", `RSS ${Math.round(resources.host.rssBytes / 1048576)} MiB · CPU ${resources.host.cpuPercent == null ? "not sampled" : `${resources.host.cpuPercent.toFixed(1)}%`}`), el("p", resources.host.reason)), box("My platform instance", el("p", "Account instance from control-plane; separate from the shared execution host."), json(resources.platformInstance ?? { status: "Unavailable" })));
      return node;
    }
    function render() {
      if (disposed) return;
      const active = doc.activeElement, focus = active?.id, start2 = active?.selectionStart, end = active?.selectionEnd;
      root.replaceChildren();
      const shell = el("div", null, "shell"), sidebar = el("aside"), main = el("main");
      sidebar.append(el("h1", "FlyBot"), el("p", "Project workbench"));
      if (!bootstrap) {
        main.append(box("Sign in", el("p", mode?.mode === "platform" ? "Use your existing control-plane account." : "Use an operator-issued member invitation."), form("login", mode?.mode === "platform" ? [["email", "Email", "email"], ["password", "Password", "password"]] : [["token", "Member invitation"], ["displayName", "Display name"]], async (values) => {
          const result = await api.call(mode?.mode === "platform" ? "platform-login" : "auth-redeem", values);
          api.setToken(result.sessionToken);
          bootstrap = await api.call("workbench-state");
        }, "Sign in")));
      } else {
        sidebar.append(el("p", bootstrap.self.displayName));
        if (bootstrap.demoMode) main.append(el("p", bootstrap.demoMode === "deterministic-fixture" ? "Demo: deterministic model fixture. Delivery requires real evidence; this is not real-model acceptance." : "Demo: configured real model provider. Inspect delivery evidence before acceptance."));
        const picker = el("select");
        picker.setAttribute("aria-label", "Project");
        picker.append(el("option", "Choose Project"));
        for (const project of bootstrap.projects) {
          const option = el("option", project.name);
          option.value = project.id;
          option.selected = project.id === selected;
          picker.append(option);
        }
        picker.onchange = () => route(picker.value);
        sidebar.append(picker);
        for (const [key, title] of [["board", "Task board"], ["members", "Members"], ["bots", "Public Bots"], ["resources", "Resources"], ["private", "My Project agent"]]) sidebar.append(button(title, () => route(selected, key), !selected));
        sidebar.append(button("All Projects", () => {
          win.location.hash = "";
        }), button("Sign out", () => act(async () => {
          await api.call("auth-revoke");
          api.setToken("");
          drafts.clear();
          notice = "";
          bootstrap = null;
          selected = "";
          ++epoch;
          detail = resources = agents = members = history = taskDetail = workflowState = null;
        })));
        if (!selected) {
          main.append(el("h1", "Projects"), ...bootstrap.projects.map((project) => box(project.name, el("p", `${project.role} · ${project.status}`), button("Open Project", () => route(project.id)))));
          main.append(box("New Project", form("project", [["name", "Project name"], ["repository", "Provisioned repository", "text", ["", ...bootstrap.repositories]]], async (values) => {
            const result = await api.call("project-create", values);
            route(result.project.id);
          }, "Create Project")), box("Join shared Project", form("join", [["token", "Project invitation"]], async (values) => {
            const result = await api.call("project-join", values);
            route(result.project.id);
          }, "Join")));
        } else if (detail) {
          main.append(el("h1", detail.project.name), el("p", `${detail.project.role} · ${detail.project.status} · ${detail.project.repository ?? "No repository"}`));
          main.append(taskDetail ? attemptsPanel() : tab === "members" ? membersPanel() : ["bots", "private"].includes(tab) ? agentsPanel() : tab === "resources" ? resourcesPanel() : boardPanel());
        } else main.append(el("p", error ? "Project unavailable. Select another Project or refresh." : "Loading Project…"));
      }
      if (mode?.panelUrl) sidebar.append(link("Control-plane account panel", mode.panelUrl, true));
      if (error) {
        const alert = el("p", error, "error");
        alert.setAttribute("role", "alert");
        main.prepend(alert);
      }
      if (notice) main.prepend(box("Result", el("pre", notice)));
      shell.append(sidebar, main);
      root.append(shell);
      if (focus) {
        const target = doc.getElementById(focus);
        if (target) {
          target.focus();
          if (typeof start2 === "number" && target.setSelectionRange && !["number", "email"].includes(target.type)) target.setSelectionRange(start2, end);
        }
      }
    }
    async function start() {
      try {
        mode = await api.call("auth-mode");
        try {
          bootstrap = await api.call("workbench-state");
        } catch {
        }
      } catch (failure) {
        error = failure.message;
      }
      if (disposed) return;
      changeRoute();
      timer = win.setInterval(() => {
        if (bootstrap && !busy && !doc.hidden) void refresh();
      }, pollMs);
    }
    win.addEventListener("hashchange", changeRoute);
    render();
    void start();
    return { refresh, dispose() {
      disposed = true;
      ++epoch;
      controller?.abort();
      win.clearInterval(timer);
      win.removeEventListener("hashchange", changeRoute);
      root.replaceChildren();
      drafts.clear();
    } };
  }

  // src/client/workbench/entry.js
  mountWorkbench(document.getElementById("workbench-root"), createApi());
})();
