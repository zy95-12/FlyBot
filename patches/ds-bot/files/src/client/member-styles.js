export const MEMBER_CSS = `
.bt-mw-dock-stack{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:var(--dsh-chat-content-width,min(960px,100%));margin:0 auto 6px;pointer-events:none}
.bt-mw-row{pointer-events:auto;display:flex;align-items:center;gap:10px;min-width:0;max-width:calc(100% + 6px);height:32px;margin-inline-start:-6px;padding:0 12px 0 6px;border:0;border-radius:16px;background:none;color:var(--bt-ink-2);font:inherit;font-size:14px;cursor:pointer;animation:bt-mw-in .32s cubic-bezier(.23,1,.32,1) backwards;transition:background-color .16s ease-out}
.bt-mw-row:hover{background:var(--bt-hover)}
.bt-mw-row>.bt-mark{flex:none}
.bt-mw-row-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-mw-row-time{flex:none;font-size:12px;color:var(--bt-ink-3);white-space:nowrap}
.bt-mw-work{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bt-mw-stop{flex:none;height:22px;padding:0 10px;border:1px solid var(--bt-line,rgba(0,0,0,.12));border-radius:11px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-mw-stop:hover{background:var(--bt-hover)}
.bt-mw-stop:disabled{opacity:.5;cursor:default}
.bt-mw-line{gap:8px}
.bt-mw-stack{display:inline-flex;align-items:center;flex:none;line-height:0}
.bt-mw-stack>*+*{margin-left:-4px}
.bt-mw-face{position:relative;display:inline-flex;flex:none;border-radius:50%}
.bt-mw-stack .bt-mw-face{box-shadow:0 0 0 1.5px var(--bt-main,#fff)}
.bt-mw-face[data-ask]::after{content:"";position:absolute;right:-2px;bottom:-2px;width:7px;height:7px;border-radius:50%;background:#e3a008;box-shadow:0 0 0 1.5px var(--bt-main,#fff)}
.bt-mw-ask{color:#b7791f;flex:none;white-space:nowrap}
body[data-ds-dark-theme] .bt-mw-ask{color:#f0b84a}
.bt-mw-member{padding:0 6px 8px 42px;display:flex;flex-direction:column;gap:6px}
.bt-mw-state{font-size:12px;line-height:16px;color:var(--bt-ink-2);margin-top:-4px}
.bt-mw-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;background:var(--bt-hover);font-size:12px;line-height:17px;color:var(--bt-ink-2)}
.bt-mw-tool{font-weight:600;color:var(--bt-ink)}
.bt-mw-text{color:var(--bt-ink);overflow-wrap:anywhere}
.bt-mw-reason{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bt-mw-code{display:block;font:11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-mw-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:4px}
.bt-mw-actions>button{height:28px;padding:0 12px;font-size:12px}
.bt-mw-actions>button:disabled{opacity:.5;cursor:default}
@keyframes bt-mw-in{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.bt-mw-row{animation:none}}
`
