import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMock = vi.fn()

vi.mock('../api/client.js', () => ({
  apiClient: {
    get: getMock,
    post: vi.fn()
  }
}))

describe('competitionsAIAPI pending/me', () => {
  beforeEach(() => {
    vi.resetModules()
    getMock.mockReset()
  })

  it('calls /competitions/pending/me for authenticated pending list', async () => {
    getMock.mockResolvedValue({ data: [{ competition_id: 'c-1' }] })

    const { competitionsAIAPI } = await import('../api/competitionsAI.js')
    const result = await competitionsAIAPI.getPendingCompetitionsForMe()

    expect(getMock).toHaveBeenCalledWith('/competitions/pending/me')
    expect(result).toEqual([{ competition_id: 'c-1' }])
  })
})
