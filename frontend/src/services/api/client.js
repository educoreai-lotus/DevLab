import axios from 'axios'
import toast from 'react-hot-toast'
import { clearAuthToken, getAuthToken, setAuthToken } from '../../auth/platformAuth.js'

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://devlab-backend-production-0bcb.up.railway.app/api' : 'http://localhost:3001/api'),
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.setupInterceptors()
  }

  setupInterceptors() {
    this.client.interceptors.request.use(
      (config) => {
        const token = getAuthToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }

        const serviceApiKey = import.meta.env.VITE_SERVICE_API_KEY
        const serviceId = import.meta.env.VITE_SERVICE_ID || 'devlab-frontend'

        if (serviceApiKey) {
          config.headers['x-api-key'] = serviceApiKey
        }
        if (serviceId) {
          config.headers['x-service-id'] = serviceId
        }

        return config
      },
      (error) => Promise.reject(error)
    )

    this.client.interceptors.response.use(
      (response) => {
        const rotatedToken = response.headers?.['x-new-access-token']
        if (rotatedToken) {
          setAuthToken(rotatedToken)
        }
        return response
      },
      (error) => {
        if (error.response?.status === 401) {
          clearAuthToken()
        }

        if (error.response?.status >= 500) {
          toast.error('Server error. Please try again later.')
        }

        return Promise.reject(error)
      }
    )
  }

  async get(url, config) {
    const response = await this.client.get(url, config)
    return response.data
  }

  async post(url, data, config) {
    const response = await this.client.post(url, data, config)
    return response.data
  }

  async put(url, data, config) {
    const response = await this.client.put(url, data, config)
    return response.data
  }

  async delete(url, config) {
    const response = await this.client.delete(url, config)
    return response.data
  }

  async patch(url, data, config) {
    const response = await this.client.patch(url, data, config)
    return response.data
  }
}

export const apiClient = new ApiClient()
