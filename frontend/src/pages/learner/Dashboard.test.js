import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dashboardSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../pages/learner/Dashboard.jsx'),
  'utf8'
)

describe('Dashboard learner identity', () => {
  it('does not use a hardcoded default learner UUID', () => {
    expect(dashboardSource).not.toContain('50a630f4-826e-45aa-8f70-653e5e592fc3')
    expect(dashboardSource).not.toContain('DEFAULT_FORCED_LEARNER_ID')
  })

  it('uses pending/me API helper for platform-authenticated competition loading', () => {
    expect(dashboardSource).toContain('getPendingCompetitionsForMe')
  })
})
