// Chief SDKs return scoped action proposals; generic runtime tools are denied before use.
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Use FlyBot scoped action proposals only' } }) + '\n')
process.exitCode = 2
