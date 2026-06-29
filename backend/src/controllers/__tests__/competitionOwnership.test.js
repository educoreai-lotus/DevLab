/**
 * @jest-environment node
 */

import { jest } from '@jest/globals'

const originalDisableAuth = process.env.DISABLE_COMPETITION_AUTH

describe('competition ownership enforcement', () => {
  let competitionController
  let CompetitionAIModel

  beforeAll(async () => {
    process.env.DISABLE_COMPETITION_AUTH = 'false'

    jest.unstable_mockModule('../../config/database.js', () => ({
      postgres: {
        query: jest.fn(),
        quoteIdentifier: jest.fn((value) => `"${value}"`)
      },
      getSupabaseTables: jest.fn(() => ({
        courseCompletions: 'course_completions',
        competitionsVsAi: 'competitions_vs_ai'
      }))
    }))

    CompetitionAIModel = {
      findById: jest.fn(),
      getPendingCourses: jest.fn()
    }

    jest.unstable_mockModule('../../models/CompetitionAI.js', () => ({
      CompetitionAIModel
    }))

    jest.unstable_mockModule('../../services/competitionAIService.js', () => ({
      competitionAIService: {
        generateAIAnswerForQuestion: jest.fn(),
        evaluateCompetition: jest.fn()
      }
    }))

    ;({ competitionController } = await import('../../controllers/competitionController.js'))
  })

  afterAll(() => {
    process.env.DISABLE_COMPETITION_AUTH = originalDisableAuth
  })

  beforeEach(() => {
    CompetitionAIModel.findById.mockReset()
    CompetitionAIModel.getPendingCourses.mockReset()
  })

  const createRes = () => {
    const res = {}
    res.status = jest.fn(() => res)
    res.json = jest.fn(() => res)
    return res
  }

  it('getPendingAICompetitionsForMe uses authenticated directoryUserId', async () => {
    CompetitionAIModel.getPendingCourses.mockResolvedValue([{ competition_id: 'c-1' }])

    const req = { user: { directoryUserId: 'dir-123' } }
    const res = createRes()

    await competitionController.getPendingAICompetitionsForMe(req, res)

    expect(CompetitionAIModel.getPendingCourses).toHaveBeenCalledWith('dir-123')
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ competition_id: 'c-1' }]
    })
  })

  it('startAICompetition returns 403 when competition belongs to another learner', async () => {
    CompetitionAIModel.findById.mockResolvedValue({
      competition_id: 'c-1',
      learner_id: 'dir-owner'
    })

    const req = {
      params: { competitionId: 'c-1' },
      user: { directoryUserId: 'dir-other' }
    }
    const res = createRes()

    await competitionController.startAICompetition(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'This competition does not belong to the authenticated learner'
    })
  })
})
