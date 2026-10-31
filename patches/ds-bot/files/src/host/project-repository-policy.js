// A repository runtime is an operator capability, not granted by typing its name.
import { isAbsolute } from 'node:path'
import { ownEntry } from './store.js'
export const repositoryAllowed = (settings, memberId) => Array.isArray(settings?.allowedProjectOwnerIds)
  ? settings.allowedProjectOwnerIds.includes(memberId) : memberId === 'owner-1'
export function repositorySettings(rt, project) {
  const settings = ownEntry(rt.config.projectRepositories ?? {}, project.repository)
  if (!settings || !repositoryAllowed(settings, project.ownerUserId) || !isAbsolute(settings.path ?? '') || !Array.isArray(settings.testCommand) || !settings.testCommand.length || settings.testCommand.some(arg => typeof arg !== 'string')) {
    throw Object.assign(new Error('Project repository/test capability is not provisioned for this owner'), { code: 'bot/delivery' })
  }
  return settings
}
