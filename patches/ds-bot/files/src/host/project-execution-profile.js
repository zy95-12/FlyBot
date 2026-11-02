// Execution trust is operator configuration, separate from actor/role authorization.
export const TRUST_PROFILE = 'trusted-private-single-host/v1'
export function executionProfile(config) {
  if (config.projectExecutionProfile !== undefined && config.projectExecutionProfile !== TRUST_PROFILE) throw Object.assign(new Error('Unsupported Project execution trust profile; this service supports trusted private execution only'), { code: 'bot/execution-profile' })
  return { id: TRUST_PROFILE, status: 'supported', defaulted: config.projectExecutionProfile === undefined,
    hostileCodeIsolation: false, perBotOsIdentityRequired: false,
    humanAuthority: 'current Project principal and delegation', roleAuthority: 'host-validated Bot contract',
    harnessCapability: 'explicitly provisioned resources and profiles', osBoundary: 'operator-managed trusted service account; shared UID is not hostile-code isolation' }
}
