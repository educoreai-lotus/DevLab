import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const routesSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../competitionRoutes.js'),
  'utf8'
)

describe('competition service routes', () => {
  it('keeps course-completion on service-facing route without platform learner auth', () => {
    expect(routesSource).toContain("router.post('/course-completion', competitionController.recordCourseCompletion)")
    expect(routesSource).not.toContain("router.post('/course-completion', authenticatePlatformUser")
  })

  it('registers authenticated pending/me endpoint', () => {
    expect(routesSource).toContain("router.get('/pending/me', authenticatePlatformUser")
  })
})
