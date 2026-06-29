import express from 'express'
import { body } from 'express-validator'
import { authenticateToken } from '../../middleware/auth.js'
import { authenticatePlatformUser } from '../../middleware/platformAuth.js'
import { validateRequest } from '../../middleware/validateRequest.js'
import { authController } from '../../controllers/authController.js'
import { platformAuthController } from '../../controllers/platformAuthController.js'

const router = express.Router()

// Validation rules
const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
]

const registerValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['learner', 'trainer', 'admin']).withMessage('Invalid role'),
  body('organizationId').trim().notEmpty().withMessage('Organization ID is required'),
]

// Routes
router.get('/context', authenticatePlatformUser, platformAuthController.getAuthContext)

router.post('/login', loginValidation, validateRequest, authController.login)
router.post('/register', registerValidation, validateRequest, authController.register)
router.post('/validate', authController.validateToken)
router.post('/refresh', authController.refreshToken)
router.post('/logout', authenticateToken, authController.logout)
router.get('/profile', authenticateToken, authController.getProfile)
router.put('/profile', authenticateToken, authController.updateProfile)

export default router

