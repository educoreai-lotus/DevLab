import { apiClient } from './client'
import { clearAuthToken, setAuthToken } from '../../auth/platformAuth.js'

export const authApi = {
  async login(email, password) {
    const response = await apiClient.post('/auth/login', {
      email,
      password,
    })
    
    if (response.user) {
      setAuthToken(response.token || 'mock-jwt-token')
    }
    
    return response
  },

  async register(userData) {
    const response = await apiClient.post('/auth/register', userData)
    
    if (response.user) {
      setAuthToken(response.token || 'mock-jwt-token')
    }
    
    return response
  },

  async validateToken(token) {
    return await apiClient.post('/auth/validate', { token })
  },

  async refreshToken() {
    return await apiClient.post('/auth/refresh')
  },

  async logout() {
    await apiClient.post('/auth/logout')
    clearAuthToken()
  },

  async getProfile() {
    return await apiClient.get('/auth/profile')
  },

  async updateProfile(profileData) {
    return await apiClient.put('/auth/profile', profileData)
  }
}


