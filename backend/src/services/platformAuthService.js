import axios from 'axios'

const VALIDATION_ACTION =
  'Route this request to nAuth service only for access token validation and session continuity decision.'

const DEFAULT_RESPONSE_TEMPLATE = {
  valid: false,
  reason: '',
  auth_state: '',
  directory_user_id: '',
  organization_id: '',
  primary_role: '',
  is_system_admin: false,
  is_trainer: false,
  new_access_token: ''
}

/**
 * Course Builder-compatible Coordinator validation response extraction.
 * Priority:
 * 1. data.response
 * 2. data.data.response
 * 3. data.data if valid exists
 * 4. top-level data if valid exists
 * @param {unknown} data
 */
export function extractCoordinatorValidationResult(data) {
  if (!data || typeof data !== 'object') {
    return null
  }

  const root = /** @type {Record<string, unknown>} */ (data)

  if (root.response && typeof root.response === 'object' && 'valid' in root.response) {
    return root.response
  }

  if (
    root.data &&
    typeof root.data === 'object' &&
    root.data.response &&
    typeof root.data.response === 'object' &&
    'valid' in root.data.response
  ) {
    return root.data.response
  }

  if (root.data && typeof root.data === 'object' && 'valid' in root.data) {
    return root.data
  }

  if ('valid' in root) {
    return root
  }

  return null
}

/**
 * Validate platform JWT via unsigned Coordinator POST /request.
 * @param {string} accessToken
 * @param {{ route?: string, method?: string }} [options]
 */
export async function validatePlatformAccessToken(accessToken, options = {}) {
  if (!accessToken || typeof accessToken !== 'string') {
    throw Object.assign(new Error('Access token required'), { status: 401 })
  }

  const coordinatorBase =
    process.env.COORDINATOR_API_URL || process.env.COORDINATOR_URL

  if (!coordinatorBase) {
    throw Object.assign(new Error('Platform authentication is not configured'), {
      status: 503
    })
  }

  const url = `${coordinatorBase.replace(/\/+$/, '')}/request`
  const timeout = Number(process.env.AUTH_VALIDATION_TIMEOUT_MS || 30000)
  const requesterService =
    process.env.AUTH_REQUESTER_SERVICE || process.env.SERVICE_NAME || 'devlab-service'

  const body = {
    requester_service: requesterService,
    payload: {
      action: VALIDATION_ACTION,
      access_token: accessToken,
      route: options.route || '',
      method: options.method || ''
    },
    response: { ...DEFAULT_RESPONSE_TEMPLATE }
  }

  let response
  try {
    response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout,
      validateStatus: () => true
    })
  } catch {
    throw Object.assign(new Error('Platform authentication is unavailable'), { status: 503 })
  }

  if (!response || response.status >= 500) {
    throw Object.assign(new Error('Platform authentication is unavailable'), { status: 503 })
  }

  const validation = extractCoordinatorValidationResult(response.data)

  if (!validation || validation.valid !== true) {
    const reason =
      typeof validation?.reason === 'string' && validation.reason.trim()
        ? validation.reason.trim()
        : 'Invalid or expired token'
    throw Object.assign(new Error(reason), { status: 401 })
  }

  const directoryUserId =
    validation.directory_user_id || validation.directoryUserId

  if (!directoryUserId) {
    throw Object.assign(new Error('Platform user identity not available'), { status: 401 })
  }

  return validation
}
