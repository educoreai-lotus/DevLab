import { apiClient } from './client.js'

export const competitionsAIAPI = {
  async getAuthContext() {
    const response = await apiClient.get('/auth/context')
    if (response?.success && response?.data) {
      return response.data
    }
    return response
  },

  async getPendingCompetitionsForMe() {
    const response = await apiClient.get('/competitions/pending/me')
    return response?.data || []
  },

  async getPendingCompetitions(learnerId) {
    if (!learnerId) {
      return []
    }

    const response = await apiClient.get(`/competitions/pending/${learnerId}`)
    return response?.data || []
  },

  async createCompetition(payload) {
    const response = await apiClient.post('/competitions/create', payload)
    return response
  },

  async startCompetition(competitionId) {
    if (!competitionId) {
      throw new Error('competitionId is required')
    }

    return apiClient.post(`/competitions/start/${competitionId}`)
  },

  async submitAnswer(competitionId, payload) {
    if (!competitionId) {
      throw new Error('competitionId is required')
    }

    return apiClient.post(`/competitions/${competitionId}/answer`, payload)
  },

  async completeCompetition(competitionId) {
    if (!competitionId) {
      throw new Error('competitionId is required')
    }

    return apiClient.post(`/competitions/${competitionId}/complete`)
  }
}


