import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '../.env.local') })

// Deployment trigger: refresh backend service after platform logout update.
console.log('🚀 Backend server initializing - Railway deployment trigger', new Date().toISOString())

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { config } from './config/environment.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'

// Global error handlers to catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [GLOBAL] Unhandled Rejection at:', promise)
  console.error('   Reason:', reason)
  if (reason instanceof Error) {
    console.error('   Error stack:', reason.stack)
  }
})

process.on('uncaughtException', (error) => {
  console.error('❌ [GLOBAL] Uncaught Exception:', error)
  console.error('   Error stack:', error.stack)
  // Don't exit in production, let the error handler deal with it
})

// Import routes
import authRoutes from './routes/auth/authRoutes.js'
import questionRoutes from './routes/questions/questionRoutes.js'
import sessionRoutes from './routes/sessions/sessionRoutes.js'
import analyticsRoutes from './routes/analytics/analyticsRoutes.js'
import dataRequestRoutes from './routes/dataRequestRoutes.js'
import userProfileRoutes from './routes/userProfiles/userProfileRoutes.js'
import { authenticateService } from './middleware/auth.js'

// Gemini AI routes
import geminiRoutes from './routes/gemini.js'
import geminiTestRoutes from './routes/gemini-test.js'
import geminiQuestionRoutes from './routes/gemini-question-generation.js'

// Judge0 routes
import judge0Routes from './routes/judge0.js'
import legacyCompetitionRoutes from './routes/competitions.js'
import competitionRoutes from './routes/competitions/competitionRoutes.js'

// External service routes
import assessmentRoutes from './routes/external/assessmentRoutes.js'
import contentStudioRoutes from './routes/external/contentStudioRoutes.js'
import contentStudioPreviewRoutes from './routes/contentStudio/contentStudioPreviewRoutes.js'
import learningAnalyticsRoutes from './routes/external/learningAnalyticsRoutes.js'
import courseBuilderRoutes from './routes/external/courseBuilderRoutes.js'
import competitionExternalRoutes from './routes/external/competitionRoutes.js'
import competitionQueryRoutes from './routes/external/competitionQueryRoutes.js'
import { initializeDatabases } from './config/initDatabase.js'
import { postgres } from './config/database.js'
import { registerService } from './registration/register.js'
import grpcServer from './grpc/server.js'

const app = express()

const logDatabaseEnvStatus = () => {
  if (config.nodeEnv !== 'development') {
    return
  }

  const envFlags = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    MONGO_URL: Boolean(process.env.MONGO_URL)
  }

  const status = Object.entries(envFlags)
    .map(([key, present]) => `${present ? '✅' : '⚠️'} ${key}`)
    .join('  ')

  console.log(`🔍 ENV CHECK: ${status}`)
}

logDatabaseEnvStatus()

// ---------------------------------------------------------------------------
// CORS CONFIGURATION (must be registered before any other middleware/routes)
// ---------------------------------------------------------------------------
const allowedOrigins = [
  'https://dev-lab-phi.vercel.app', // production frontend
  'https://dev-lab-nu.vercel.app',
  'https://dev-lab-three.vercel.app',
  'https://dev-lab-frontend.vercel.app',
  'https://dev-lab-git-main-sabeels-projects-5df24825.vercel.app',
  'https://dev-jsj0ymr4z-sabeels-projects-5df24825.vercel.app',
  'https://dev-fm3lkx884-sabeels-projects-5df24825.vercel.app',
  'https://dev-gisy8vuij-sabeels-projects-5df24825.vercel.app',
  'https://dev-2mxmqs8jc-sabeels-projects-5df24825.vercel.app',
  'https://assessment-seven-liard.vercel.app', // assessment service
  'https://course-builder-alpha-nine.vercel.app', // course builder
  'http://localhost:3000', // local dev
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:5173',
  ...(config.security?.corsOrigins || [])
];

// Enhanced CORS configuration
const corsOptions = {
  origin: function(origin, callback) {
    console.log('🌐 CORS: Request from origin:', origin);
    console.log('🌐 CORS: Allowed origins:', allowedOrigins);
    // Allow requests with no origin (like Postman, mobile apps, curl)
    if (!origin) {
      console.log('✅ CORS: No origin, allowing');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('✅ CORS: Origin allowed:', origin);
      return callback(null, true);
    } else {
      console.log('❌ CORS: Origin not allowed:', origin);
      console.log('📋 CORS: Allowed origins:', allowedOrigins);
      return callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept', 
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'x-api-key',
    'x-service-id',
    'X-API-Key',
    'X-Service-Id'
  ],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  optionsSuccessStatus: 200,
  preflightContinue: false
};

// Register CORS globally before any other middleware/routes
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Serve static assets (e.g., CodeMirror bundle) after CORS so headers apply
app.use('/static', express.static(path.join(__dirname, '../public')))

// ---------------------------------------------------------------------------
// Request logging (runs after CORS so preflights also get headers applied)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  try {
    console.log('🚨 [REQUEST] Method:', req.method, 'URL:', req.originalUrl, 'IP:', req.ip)
    console.log('🚨 [REQUEST] Headers:', JSON.stringify(req.headers, null, 2))
    next()
  } catch (err) {
    console.error('❌ [REQUEST] Logging error:', err)
    res.status(500).json({
      success: false,
      error: 'Internal server error in request processing',
      message: err.message
    })
  }
})

// Trust proxy for Railway deployment (required for express-rate-limit)
app.set('trust proxy', 1)

// Simple health check endpoint for Railway (before any middleware)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  })
})

// Temporary test endpoint to verify Supabase data access - MUST be registered early, before middleware
app.get('/api/test-supabase', async (req, res) => {
  console.log('🧪 [test-supabase] Route hit!', req.method, req.url, req.originalUrl)
  try {
    // Test 1: Check if we can connect
    console.log('🧪 [test] Testing Supabase connection...')
    await postgres.query('SELECT 1 as test')
    console.log('✅ [test] Connection successful')
    
    // Test 2: Get all competitions
    console.log('🧪 [test] Querying competitions table...')
    const { rows: allCompetitions } = await postgres.query(
      'SELECT competition_id, course_name, course_id, status FROM competitions LIMIT 10'
    )
    console.log('✅ [test] Found', allCompetitions.length, 'competitions')
    
    // Test 3: Try to find the specific competition
    console.log('🧪 [test] Looking for competition 1c8fe3d5-6b80-417f-a1aa-d3694d84d6ec...')
    const { rows: specificCompetition } = await postgres.query(
      'SELECT * FROM competitions WHERE competition_id = $1',
      ['1c8fe3d5-6b80-417f-a1aa-d3694d84d6ec']
    )
    console.log('✅ [test] Specific competition found:', specificCompetition.length > 0)
    
    res.json({
      success: true,
      connection: 'working',
      totalCompetitions: allCompetitions.length,
      allCompetitions: allCompetitions,
      specificCompetitionFound: specificCompetition.length > 0,
      specificCompetition: specificCompetition.length > 0 ? specificCompetition[0] : null
    })
  } catch (error) {
    console.error('❌ [test] Error:', error)
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    })
  }
})
console.log('✅ Registered test endpoint: GET /api/test-supabase')

// Endpoint to automatically add a competition using existing users
app.post('/api/add-competition', async (req, res) => {
  console.log('🧪 [add-competition] Route hit!')
  try {
    // Get existing users
    const { rows: users } = await postgres.query(
      'SELECT "learner_id", "learner_name" FROM "userProfiles" ORDER BY "created_at" LIMIT 10'
    )
    
    if (users.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Need at least 2 users in userProfiles to create a competition',
        availableUsers: users.length
      })
    }

    const learner1 = users[0]
    const learner2 = users[1]

    // Create competition data
    const competitionData = {
      course_name: 'JavaScript Fundamentals Showdown',
      course_id: 123,
      learner1_id: learner1.learner_id,
      learner2_id: learner2.learner_id,
      status: 'active',
      question_count: 3,
      time_limit: 1800,
      questions: JSON.stringify([
        {
          id: 'q1',
          title: 'Array Manipulation Challenge',
          points: 100,
          testCases: [
            { input: '[1, 3, 2, 4, 5]', expected: 4 },
            { input: '[5, 4, 3, 2, 1]', expected: 1 },
            { input: '[1, 2, 3, 4, 5]', expected: 5 }
          ],
          timeLimit: 600,
          difficulty: 'medium',
          description: 'Write a function that finds the longest increasing subsequence in an array. Return the length of the subsequence.',
          starterCode: 'function longestIncreasingSubsequence(arr) {\n  // TODO: implement dynamic programming solution\n  return 0;\n}'
        },
        {
          id: 'q2',
          title: 'String Processing',
          points: 80,
          testCases: [
            { input: '"A man a plan a canal Panama"', expected: true },
            { input: '"race a car"', expected: false },
            { input: '"Madam"', expected: true }
          ],
          timeLimit: 420,
          difficulty: 'easy',
          description: 'Implement a function that checks if a string is a palindrome, ignoring case and non-alphanumeric characters.',
          starterCode: 'function isPalindrome(s) {\n  // TODO: normalize the string and check for palindrome\n  return false;\n}'
        },
        {
          id: 'q3',
          title: 'Dynamic Programming',
          points: 150,
          testCases: [
            { input: '[2, 7, 9, 3, 1]', expected: 12 },
            { input: '[1, 2, 3, 1]', expected: 4 },
            { input: '[2, 1, 1, 2]', expected: 4 }
          ],
          timeLimit: 540,
          difficulty: 'hard',
          description: 'Solve the classic "House Robber" problem. Return the maximum amount you can rob without alerting the police.',
          starterCode: 'function rob(nums) {\n  // TODO: use memoization or tabulation\n  return 0;\n}'
        }
      ]),
      learner1_answers: JSON.stringify([]),
      learner2_answers: JSON.stringify([]),
      learner1_score: 0,
      learner2_score: 0
    }

    console.log(`📝 Creating competition between ${learner1.learner_name} and ${learner2.learner_name}`)

    // Insert competition
    const insertQuery = `
      INSERT INTO "competitions" (
        "course_name",
        "course_id",
        "learner1_id",
        "learner2_id",
        "status",
        "question_count",
        "time_limit",
        "questions",
        "learner1_answers",
        "learner2_answers",
        "learner1_score",
        "learner2_score"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12
      )
      RETURNING "competition_id", "course_name", "learner1_id", "learner2_id", "status", "created_at"
    `

    const { rows } = await postgres.query(insertQuery, [
      competitionData.course_name,
      competitionData.course_id,
      competitionData.learner1_id,
      competitionData.learner2_id,
      competitionData.status,
      competitionData.question_count,
      competitionData.time_limit,
      competitionData.questions,
      competitionData.learner1_answers,
      competitionData.learner2_answers,
      competitionData.learner1_score,
      competitionData.learner2_score
    ])

    const competition = rows[0]
    
    // Verify it was added
    const { rows: verifyRows } = await postgres.query(
      'SELECT "competition_id" FROM "competitions" WHERE "competition_id" = $1',
      [competition.competition_id]
    )

    console.log(`✅ Competition created: ${competition.competition_id}`)
    console.log(`✅ Verification: Found ${verifyRows.length} competition(s) with this ID`)

    res.json({
      success: true,
      message: 'Competition added successfully',
      competition: {
        competition_id: competition.competition_id,
        course_name: competition.course_name,
        learner1_id: competition.learner1_id,
        learner2_id: competition.learner2_id,
        status: competition.status,
        created_at: competition.created_at
      },
      verification: {
        found: verifyRows.length > 0,
        competition_id: competition.competition_id
      }
    })
  } catch (error) {
    console.error('❌ [add-competition] Error:', error)
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    })
  }
})
console.log('✅ Registered endpoint: POST /api/add-competition')

// CORS test endpoint
app.get('/cors-test', (req, res) => {
  console.log('🧪 CORS Test: Request received');
  console.log('🌐 CORS Test: Origin:', req.header('Origin'));
  console.log('🌐 CORS Test: Headers:', req.headers);
  
  res.status(200).json({
    success: true,
    message: 'CORS test successful',
    origin: req.header('Origin'),
    timestamp: new Date().toISOString(),
    headers: req.headers
  })
})

// Security middleware with CORS-friendly configuration
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}))

// Rate limiting with logging
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.error('❌ [RATE-LIMIT] Rate limit exceeded for:', req.ip, req.originalUrl)
    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.'
    })
  }
})
app.use((req, res, next) => {
  console.log('🔍 [RATE-LIMIT] Checking rate limit for:', req.method, req.originalUrl, req.ip)
  limiter(req, res, next)
})

// Top-level request logger - logs ALL requests BEFORE any other processing
app.use((req, res, next) => {
  console.log('🌐 [TOP-LEVEL] Incoming request:', req.method, req.originalUrl, req.path)
  console.log('🌐 [TOP-LEVEL] Request headers:', JSON.stringify(req.headers, null, 2))
  next()
})

// Body parsing middleware with error handling
const jsonParser = express.json({ limit: '10mb' })
app.use((req, res, next) => {
  jsonParser(req, res, (err) => {
    if (err) {
      console.error('❌ [DEBUG] JSON body parsing error:', err.message)
      console.error('   Error stack:', err.stack)
      console.error('   Request URL:', req.originalUrl)
      console.error('   Request method:', req.method)
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in request body',
        message: err.message
      })
    }
    next()
  })
})

app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Compression middleware
app.use(compression())

// Logging middleware
app.use(morgan('combined'))

// Apply service authentication to all /api routes in production
// Skip for /api/auth routes (login, register, etc.) and /health endpoint
const isProduction = config.nodeEnv === 'production'
const hasServiceApiKeys = config.security.apiKeys && config.security.apiKeys.trim().length > 0
const requireServiceAuth = isProduction || hasServiceApiKeys

if (requireServiceAuth) {
  console.log('🔒 [app] Service authentication enabled for /api routes')
  console.log('   Environment:', config.nodeEnv)
  console.log('   SERVICE_API_KEYS configured:', hasServiceApiKeys)
  
  // Apply service auth to all /api routes except /api/auth and public frontend endpoints
  app.use('/api', (req, res, next) => {
    try {
      console.log('🔍 [auth-middleware] Request received:', req.method, req.path, req.originalUrl)
      // Skip authentication for:
      // - Auth routes (login, register, etc.)
      // - Health checks
      // - Test endpoints
      // - Gemini question generation endpoints (used by frontend at dev-lab-three.vercel.app)
      // - Judge0 endpoints (used by frontend for code execution)
      // - Content Studio preview endpoints (used by frontend code preview UI)
      if (
        req.path.startsWith('/auth') || 
        req.path === '/health' || 
        req.path === '/test-supabase' ||
        req.path.startsWith('/gemini-questions') || // Frontend calls this without service auth
        req.path.startsWith('/gemini-test') || // Frontend test endpoints
        req.path.startsWith('/judge0') || // Frontend calls this without service auth
        req.path.startsWith('/content-studio') // Frontend calls this without service auth
      ) {
        console.log('🔓 [auth] Skipping service auth for:', req.path)
        return next()
      }
      // Apply service authentication
      console.log('🔒 [auth] Applying service auth for:', req.path)
      return authenticateService(req, res, next)
    } catch (authError) {
      console.error('❌ [auth-middleware] Error in auth middleware:', authError)
      console.error('   Error message:', authError.message)
      console.error('   Error stack:', authError.stack)
      return res.status(500).json({
        success: false,
        error: 'Authentication middleware error',
        message: authError.message
      })
    }
  })
} else {
  console.log('🔓 [app] Service authentication disabled (development mode)')
  console.log('   Environment:', config.nodeEnv)
  console.log('   SERVICE_API_KEYS configured:', hasServiceApiKeys)
}

// Add request logging for all /api routes to debug routing
app.use('/api', (req, res, next) => {
  try {
    console.log('\n' + '='.repeat(80))
    console.log('[DEBUG] API router middleware reached')
    console.log('='.repeat(80))
    console.log('🔍 [api-router] Incoming request:', req.method, req.path, req.originalUrl)
    console.log('🔍 [api-router] Request body exists:', !!req.body)
    console.log('🔍 [api-router] Request body type:', typeof req.body)
    if (req.path.includes('gemini-questions')) {
      console.log('[DEBUG] Request is for gemini-questions route')
      console.log('[DEBUG] Full path:', req.path)
      console.log('[DEBUG] Full originalUrl:', req.originalUrl)
      if (req.body) {
        console.log('[DEBUG] Request body keys:', Object.keys(req.body))
        console.log('[DEBUG] Request body:', JSON.stringify(req.body, null, 2))
      }
    }
    console.log('='.repeat(80) + '\n')
    next()
  } catch (apiRouterError) {
    console.error('[ERROR] API router middleware error:', apiRouterError)
    console.error('   Error message:', apiRouterError.message)
    console.error('   Error stack:', apiRouterError.stack)
    next(apiRouterError)
  }
})

// Error catching middleware for all /api routes
app.use('/api', (err, req, res, next) => {
  if (err) {
    console.error('\n' + '='.repeat(80))
    console.error('❌ [api-router] Error caught in API middleware:')
    console.error('='.repeat(80))
    console.error('   Error name:', err.name || 'N/A')
    console.error('   Error message:', err.message || 'N/A')
    console.error('   Error stack:', err.stack || 'N/A')
    console.error('   Request URL:', req.originalUrl)
    console.error('   Request method:', req.method)
    console.error('   Request path:', req.path)
    if (req.body) {
      console.error('   Request body:', JSON.stringify(req.body, null, 2))
    }
    console.error('='.repeat(80) + '\n')
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Internal server error',
      errorName: err.name || 'Error'
    })
  }
  next()
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/questions', questionRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/user-profiles', userProfileRoutes)
// Log registered user profile routes
try {
  const userProfileRouteSummaries = userProfileRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: `/api/user-profiles${layer.route.path === '/' ? '' : layer.route.path}`,
      methods: Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase())
    }))
  console.log('✅ Registered user-profile routes:', userProfileRouteSummaries)
} catch (error) {
  console.warn('⚠️ Unable to list user-profile routes:', error.message)
}

// Add logging middleware for competitions routes
app.use('/api/competitions', (req, res, next) => {
  console.log('🚦 [competitions] Incoming request:', req.method, req.path, req.originalUrl)
  next()
}, competitionRoutes)
try {
  const competitionRouteSummaries = competitionRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: `/api/competitions${layer.route.path === '/' ? '' : layer.route.path}`,
      methods: Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase())
    }))
  console.log('✅ Registered competition routes:', competitionRouteSummaries)
} catch (error) {
  console.warn('⚠️ Unable to list competition routes:', error.message)
}

app.use('/api/competitions-mock', legacyCompetitionRoutes)
app.use('/api/analytics', analyticsRoutes)

// Gemini AI routes
app.use('/api/gemini', geminiRoutes)
app.use('/api/gemini-test', geminiTestRoutes)
console.log('🔍 [app] Registering gemini-questions routes...')
app.use('/api/gemini-questions', geminiQuestionRoutes)
console.log('✅ [app] gemini-questions routes registered')

// Content Studio HTML preview routes (OpenAI-backed, no gemini naming)
app.use('/api/content-studio', contentStudioPreviewRoutes)

// List all registered routes in gemini-questions router
try {
  const geminiQuestionRouteSummaries = geminiQuestionRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: `/api/gemini-questions${layer.route.path === '/' ? '' : layer.route.path}`,
      methods: Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase())
    }))
  console.log('✅ [app] Registered gemini-questions routes:', geminiQuestionRouteSummaries)
} catch (error) {
  console.warn('⚠️ Unable to list gemini-questions routes:', error.message)
}
app.use('/api', dataRequestRoutes)

// Judge0 routes
app.use('/api/judge0', judge0Routes)

// External service routes (for microservice communication)
app.use('/api/external/assessment', assessmentRoutes)
app.use('/api/external/content-studio', contentStudioRoutes)
app.use('/api/external/analytics', learningAnalyticsRoutes)
app.use('/api/external/course-builder', courseBuilderRoutes)
app.use('/api/external/competition', competitionExternalRoutes)
app.use('/api/external/competition', competitionQueryRoutes)

// Global error handler - catches ALL unhandled errors
app.use((err, req, res, next) => {
  console.error('\n' + '='.repeat(80))
  console.error('[GLOBAL ERROR HANDLER] Unhandled error caught')
  console.error('='.repeat(80))
  console.error('   Error name:', err?.name || 'N/A')
  console.error('   Error message:', err?.message || 'N/A')
  console.error('   Error code:', err?.code || 'N/A')
  console.error('   Request URL:', req?.originalUrl || 'N/A')
  console.error('   Request method:', req?.method || 'N/A')
  console.error('   Request path:', req?.path || 'N/A')
  if (err?.stack) {
    console.error('   Error stack:', err.stack)
  }
  if (err?.cause) {
    console.error('   Error cause:', err.cause)
  }
  console.error('='.repeat(80) + '\n')
  
  // Don't send response if already sent
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      success: false,
      message: 'Internal Server Error',
      error: err.message || 'Unknown error occurred',
      errorName: err.name || 'Error'
    })
  }
})

// Error handling middleware
app.use(notFound)
app.use(errorHandler)

// Start server
const PORT = process.env.PORT || 3001
const HOST = '0.0.0.0'

let server

const startServer = async () => {
  try {
    await initializeDatabases()
  } catch (error) {
    console.error('❌ Database initialization failed during startup:', error)
  }

  // Register with Coordinator on startup (non-blocking)
  // DISABLED: Registration already completed successfully. Service has a valid serviceId.
  // To re-enable automatic registration, set ENABLE_AUTO_REGISTRATION=true in environment variables.
  // The registration code remains available in ./registration/register.js
  if (process.env.ENABLE_AUTO_REGISTRATION === 'true') {
    console.log('🔄 Auto-registration enabled via ENABLE_AUTO_REGISTRATION flag');
    registerService().catch(error => {
      console.error('Registration error (non-blocking):', error.message);
    });
  } else {
    console.log('⏭️  Auto-registration skipped (already registered). Set ENABLE_AUTO_REGISTRATION=true to enable.');
  }

  // Start GRPC server
  try {
    await grpcServer.start()
  } catch (error) {
    console.error('❌ GRPC server startup failed:', error)
    // Don't exit - HTTP server can still work
  }

  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 DEVLAB Backend running on ${HOST}:${PORT}`)
    console.log(`📊 Environment: ${config.nodeEnv}`)
    console.log(`🔗 API Base URL: http://${HOST}:${PORT}/api`)
    console.log(`🏥 Health Check: http://${HOST}:${PORT}/health`)
    console.log(`🔧 Process.env.PORT: ${process.env.PORT}`)
    console.log(`🔧 Config.port: ${config.port}`)
    console.log(`🚂 Railway deployment triggered - ${new Date().toISOString()}`)
  })

  server.on('error', (error) => {
    console.error('❌ Server error:', error)
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use`)
    }
  })

  const shutdown = async () => {
    console.log('🛑 Shutdown signal received, shutting down gracefully')
    
    // Shutdown GRPC server
    try {
      await grpcServer.shutdown()
    } catch (error) {
      console.error('❌ Error shutting down GRPC server:', error)
    }

    // Shutdown HTTP server
    server.close(() => {
      console.log('✅ HTTP Server closed')
      process.exit(0)
    })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

startServer()

export default app