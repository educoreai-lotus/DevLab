import { UserProfileModel } from '../models/User.js'
import { postgres, getSupabaseTables } from '../config/database.js'
import { CompetitionAIModel } from '../models/CompetitionAI.js'
import { competitionAIService } from '../services/competitionAIService.js'
import { getFetch } from '../utils/http.js'
import { postToCoordinator } from '../infrastructure/coordinatorClient/coordinatorClient.js'
import { generateQueryFromRequest } from '../services/analyticsQueryService.js'

const tables = getSupabaseTables()
const courseCompletionsTable = postgres.quoteIdentifier(tables.courseCompletions || 'course_completions')
const QUESTION_DURATION_SECONDS = 10 * 60

const isValidUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value
  )

const competitionAuthDisabled =
  !process.env.DISABLE_COMPETITION_AUTH ||
  process.env.DISABLE_COMPETITION_AUTH === 'true'

const getPlatformLearnerId = (req) => req.user?.directoryUserId || null

const assertCompetitionOwnership = (competition, req, res) => {
  if (competitionAuthDisabled) {
    return true
  }

  const learnerId = getPlatformLearnerId(req)
  if (!learnerId) {
    res.status(401).json({
      success: false,
      error: 'Platform authentication required'
    })
    return false
  }

  if (competition.learner_id !== learnerId) {
    res.status(403).json({
      success: false,
      error: 'This competition does not belong to the authenticated learner'
    })
    return false
  }

  return true
}

const ensureUserProfile = async (learnerId, learnerName = null) => {
  if (!learnerId) {
    throw new Error('learnerId is required to upsert user profile')
  }

  const existing = await UserProfileModel.findById(learnerId)
  if (existing) {
    return existing
  }

  try {
    const name =
      typeof learnerName === 'string' && learnerName.trim().length
        ? learnerName.trim()
        : `Learner ${learnerId.slice(0, 8)}`
    return await UserProfileModel.create({
      learner_id: learnerId,
      learner_name: name
    })
  } catch (error) {
    if (error.code === '23505') {
      return UserProfileModel.findById(learnerId)
    }
    throw error
  }
}

const getTotalQuestions = (competition) => competition?.questions?.length || 0

const buildAiAnswersFromQuestions = (questions = []) =>
  questions
    .map((question) => {
      const answer = question?.state?.ai_answer
      if (!answer || !question?.question_id) {
    return null
  }
      return {
        question_id: question.question_id,
        answer
      }
    })
    .filter(Boolean)

const buildLearnerAnswersFromQuestions = (questions = []) =>
  questions
    .map((question) => {
      const answer = question?.state?.learner_answer
      if (answer === undefined || answer === null || !question?.question_id) {
    return null
  }
      return {
        question_id: question.question_id,
        answer
      }
    })
    .filter(Boolean)

const getCurrentQuestionIndex = (competition) =>
  Math.max(0, competition?.current_question_index ?? 0)

const getQuestionByIndex = (competition, index) => competition?.questions?.[index] || null

const questionHasExpired = (question) => {
  const expiresAt = question?.state?.expires_at
  if (!expiresAt) {
    return false
  }
  return Date.now() >= Date.parse(expiresAt)
}

const evaluateCompetitionOutcome = async (competition) => {
  if (
    !competition ||
    !Array.isArray(competition.questions) ||
    !Array.isArray(competition.ai_answers) ||
    !Array.isArray(competition.learner_answers) ||
    !competition.questions.length ||
    !competition.ai_answers.length ||
    !competition.learner_answers.length
  ) {
    return competition
  }

  try {
    const evaluation = await competitionAIService.evaluateCompetition({
      questions: competition.questions,
      aiAnswers: competition.ai_answers,
      learnerAnswers: competition.learner_answers
    })

    return CompetitionAIModel.saveEvaluation(competition.competition_id, evaluation)
  } catch (error) {
    console.error('⚠️ [competitions] Evaluation failed:', error.message)
    return competition
  }
}

const sendCompetitionSummaryToCoordinator = async (competition) => {
  if (!competition || competition.status !== 'completed') {
    return
  }

  try {
    const envelope = {
      requester_service: 'devlab',
      payload: {
        action: 'competition_summary',
        competition_id: competition.competition_id,
        learner_id: competition.learner_id,
        course_id: competition.course_id,
        winner: competition.winner || null,
        score: competition.score || null,
        created_at: competition.created_at || null,
        updated_at: competition.updated_at || null,
        status: competition.status,
        timer_seconds: competition.timer_seconds || null,
        started_at: competition.started_at || null,
        completed_at: competition.completed_at || null
      },
      response: {
        acknowledged: false
      }
    }

    await postToCoordinator(envelope, {
      endpoint: '/api/fill-content-metrics/'
    })

    console.log('✅ [competitions] Competition summary sent to Coordinator successfully', {
      competition_id: competition.competition_id,
      learner_id: competition.learner_id
    })
  } catch (error) {
    // Log error but don't break the competition completion flow
    console.error('❌ [competitions] Failed to send competition summary to Coordinator:', {
      competition_id: competition?.competition_id,
      error: error.message,
      status: error.response?.status,
      responseData: error.response?.data
    })
  }
}

const finalizeCompetitionAndEvaluate = async (competition) => {
  if (!competition) {
    return null
  }

  const learnerAnswers = buildLearnerAnswersFromQuestions(competition.questions)
  const aiAnswers = buildAiAnswersFromQuestions(competition.questions)

  const finalized = await CompetitionAIModel.finalizeCompetition(competition.competition_id, {
    learnerAnswers,
    aiAnswers
  })

  const evaluated = await evaluateCompetitionOutcome(finalized)

  // Note: Competition summary is no longer automatically sent to Coordinator.
  // It must be requested via POST /api/external/competition/send-summary endpoint.

  return evaluated
}

const startQuestion = async (competition, questionIndex) => {
  const question = getQuestionByIndex(competition, questionIndex)
  if (!question) {
    return finalizeCompetitionAndEvaluate(competition)
  }

  const state = question.state || {}
  if (state.status === 'active') {
    return competition
  }

  const aiAnswer = await competitionAIService.generateAIAnswerForQuestion({
    courseName: competition.course_name,
    question
  })

  const startedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + QUESTION_DURATION_SECONDS * 1000).toISOString()

  question.state = {
    ...state,
    status: 'active',
    started_at: startedAt,
    expires_at: expiresAt,
    ai_answer: aiAnswer,
    learner_answer: state.learner_answer || null
  }

  const timerSeconds = QUESTION_DURATION_SECONDS * getTotalQuestions(competition)

  return CompetitionAIModel.updateById(competition.competition_id, {
    questions: competition.questions,
    status: 'in_progress',
    started_at: competition.started_at || startedAt,
    timer_seconds: timerSeconds,
    current_question_index: questionIndex,
    ai_answers: buildAiAnswersFromQuestions(competition.questions)
  })
}

const completeQuestion = async (competition, questionIndex, answer, { timedOut = false } = {}) => {
  const question = getQuestionByIndex(competition, questionIndex)
  if (!question) {
    return competition
  }

  const state = question.state || {}
  question.state = {
    ...state,
    status: 'completed',
    completed_at: new Date().toISOString(),
    learner_answer: answer ?? '',
    timed_out: timedOut
  }

  const learnerAnswers = buildLearnerAnswersFromQuestions(competition.questions)

  return CompetitionAIModel.updateById(competition.competition_id, {
    questions: competition.questions,
    in_progress_answers: learnerAnswers,
    ai_answers: buildAiAnswersFromQuestions(competition.questions)
  })
}

const advanceCompetition = async (competition) => {
  if (!competition || competition.status === 'completed') {
    return competition
  }

  const nextIndex = getCurrentQuestionIndex(competition) + 1
  const total = getTotalQuestions(competition)

  if (nextIndex >= total) {
    return finalizeCompetitionAndEvaluate(competition)
  }

  const updated = await CompetitionAIModel.updateById(competition.competition_id, {
    current_question_index: nextIndex
  })

  return startQuestion(updated, nextIndex)
}

const ensureActiveQuestion = async (competition) => {
  if (!competition) {
    return null
  }

  if (competition.status === 'completed') {
    return competition
  }

  const total = getTotalQuestions(competition)
  if (!total) {
    return finalizeCompetitionAndEvaluate(competition)
  }

  let index = Math.min(getCurrentQuestionIndex(competition), total - 1)
  let question = getQuestionByIndex(competition, index)

  if (!question) {
    return finalizeCompetitionAndEvaluate(competition)
  }

  if (!question.state || question.state.status === 'pending') {
    return startQuestion(competition, index)
  }

  if (question.state.status === 'active') {
    if (questionHasExpired(question)) {
      const completed = await completeQuestion(
            competition,
        index,
        question.state.learner_answer || '',
        { timedOut: true }
      )
      return advanceCompetition(completed)
    }
    return competition
  }

  if (question.state.status === 'completed') {
    const updated = await CompetitionAIModel.updateById(competition.competition_id, {
      current_question_index: index + 1
    })
    return ensureActiveQuestion(updated)
  }

  return competition
}

const buildSessionPayload = (competition) => {
  const totalQuestions = getTotalQuestions(competition)
  const completed = competition.status === 'completed'
  const index = Math.min(
    getCurrentQuestionIndex(competition),
    Math.max(totalQuestions - 1, 0)
  )
  const question = !completed && totalQuestions ? getQuestionByIndex(competition, index) : null
  const state = question?.state || {}

  return {
    competition_id: competition.competition_id,
    status: competition.status,
    totalQuestions,
    questionIndex: question ? index + 1 : totalQuestions,
    question: question
      ? {
          question_id: question.question_id,
          question: question.question
        }
      : null,
    timer_seconds: QUESTION_DURATION_SECONDS,
    started_at: state.started_at || null,
    expires_at: state.expires_at || null,
    answers: buildLearnerAnswersFromQuestions(competition.questions),
    completed,
    winner: competition.winner || null,
    score: competition.score || null,
    summary: completed
      ? {
          winner: competition.winner,
          score: competition.score,
          learner_answers: buildLearnerAnswersFromQuestions(competition.questions),
          ai_answers: buildAiAnswersFromQuestions(competition.questions)
        }
      : null
  }
}

export const competitionController = {
  async recordCourseCompletion(req, res) {
    console.log('[recordCourseCompletion] START:', req.body)
    try {
      const { learner_id, learner_name, course_id, course_name } = req.body || {}
      const learnerId = String(learner_id || '').trim()

      console.log('[recordCourseCompletion] Validation step reached: checking required fields')
      if (!learnerId || !course_id) {
        return res.status(400).json({
          success: false,
          error: 'learner_id and course_id are required'
        })
      }

      console.log('[recordCourseCompletion] Validation step reached: checking UUID format')
      if (!isValidUuid(learnerId)) {
        console.log('[recordCourseCompletion] UUID validation FAILED for learnerId:', learnerId)
        return res.status(400).json({
          success: false,
          error: 'learner_id must be a valid UUID'
        })
      }

      console.log('[recordCourseCompletion] UUID validation PASSED')
      console.log('[recordCourseCompletion] Validation passed, proceeding to business logic')
      console.log('[recordCourseCompletion] Payload values:', { learnerId, course_id, course_name, learner_name })
      
      // Convert course_id to bigint if it's a UUID string
      // Extract numeric value from UUID (use first 8 hex digits as base-10 number)
      let courseIdNumeric = course_id
      if (typeof course_id === 'string' && course_id.includes('-')) {
        // It's a UUID, convert to numeric
        const hexPart = course_id.replace(/-/g, '').substring(0, 15) // Take first 15 hex chars to fit in bigint
        courseIdNumeric = parseInt(hexPart, 16)
        console.log('[recordCourseCompletion] Converted course_id from UUID to numeric:', { original: course_id, numeric: courseIdNumeric })
      } else {
        // Try to parse as number
        courseIdNumeric = Number(course_id)
        if (isNaN(courseIdNumeric)) {
          return res.status(400).json({
            success: false,
            error: 'course_id must be a valid number or UUID'
          })
        }
      }
      
      const payload = req.body

      const competitionsApiUrl = process.env.COMPETITIONS_API_URL
      let upstreamStatus = null
      let upstreamBody = null

      // Only check SERVICE_API_KEYS if upstream forwarding is configured
      if (!competitionsApiUrl) {
        console.log('[recordCourseCompletion] COMPETITIONS_API_URL not set; skipping upstream forwarding')
      } else {
        console.log('[recordCourseCompletion] COMPETITIONS_API_URL configured; checking SERVICE_API_KEYS for upstream forwarding')
        const serviceApiKeys = (process.env.SERVICE_API_KEYS || '')
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)

        if (!serviceApiKeys.length) {
          console.error('❌ [competitions] SERVICE_API_KEYS missing but COMPETITIONS_API_URL is set')
          return res.status(500).json({
            success: false,
            error: 'Service authentication misconfigured: SERVICE_API_KEYS required when COMPETITIONS_API_URL is set'
          })
        }

        const selectedKey = serviceApiKeys[Math.floor(Math.random() * serviceApiKeys.length)]
        const serviceId = process.env.SERVICE_API_ID || 'devlab-competitions'

        console.log('[recordCourseCompletion] Forwarding to upstream competitions API')
        try {
          const fetchFn = await getFetch()
          const forwardResponse = await fetchFn(competitionsApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': selectedKey,
              'x-service-id': serviceId
            },
            body: JSON.stringify(payload)
          })

          upstreamStatus = forwardResponse.status
          const text = await forwardResponse.text()
          upstreamBody = text

          if (!forwardResponse.ok) {
            const authFailure = forwardResponse.status === 401 || forwardResponse.status === 403
            if (authFailure) {
              console.error(
                `❌ [competitions] Authentication failed when forwarding course completion (status ${forwardResponse.status})`
              )
            } else {
              console.error(
                `⚠️ [competitions] Upstream competitions API responded with status ${forwardResponse.status}`
              )
            }
          }
        } catch (error) {
          console.error('❌ [competitions] Failed to forward course completion:', error.message)
        }
      }

      console.log('[recordCourseCompletion] Upstream forwarding completed (or skipped)')

      console.log('[recordCourseCompletion] Running DB operation: ensureUserProfile')
      await ensureUserProfile(learnerId, learner_name || course_name)
      console.log('[recordCourseCompletion] DB result: ensureUserProfile completed')

      console.log('[recordCourseCompletion] Running DB operation: SELECT course_completions')
      const { rows } = await postgres.query(
        `
        SELECT 1
        FROM ${courseCompletionsTable}
        WHERE "learner_id" = $1 AND "course_id" = $2
        LIMIT 1
        `,
        [learnerId, courseIdNumeric]
      )
      console.log('[recordCourseCompletion] DB result: SELECT course_completions', { rowCount: rows.length })

      let alreadyRecorded = Boolean(rows.length)
      if (!alreadyRecorded) {
        console.log('[recordCourseCompletion] Running DB operation: INSERT course_completions')
        await postgres.query(
          `
          INSERT INTO ${courseCompletionsTable} (
            "learner_id",
            "course_id",
            "course_name",
            "completed_at"
          )
          VALUES ($1, $2, $3, now())
          `,
          [learnerId, courseIdNumeric, course_name || null]
        )
        console.log('[recordCourseCompletion] DB result: INSERT course_completions completed')
      }

      let competition = null

      try {
        console.log('[recordCourseCompletion] Running DB operation: CompetitionAIModel.findByLearnerAndCourse')
        competition = await CompetitionAIModel.findByLearnerAndCourse(
          learnerId,
          String(course_id)
        )
        console.log('[recordCourseCompletion] DB result: CompetitionAIModel.findByLearnerAndCourse', { competition: competition ? 'found' : 'not found' })
    } catch (error) {
        console.error('❌ [competitions] Failed to query existing competition:', error)
      }

      if (!competition) {
        try {
          console.log('[recordCourseCompletion] Running DB operation: competitionAIService.generateCompetitionSetup')
          const { questions } = await competitionAIService.generateCompetitionSetup({
            courseName: course_name
          })
          console.log('[recordCourseCompletion] DB result: competitionAIService.generateCompetitionSetup', { questionsCount: questions?.length || 0 })

          console.log('[recordCourseCompletion] Running DB operation: CompetitionAIModel.create')
          competition = await CompetitionAIModel.create({
            learnerId,
            learnerName: learner_name || null,
            courseId: String(course_id),
            courseName: course_name,
            questions
          })
          console.log('[recordCourseCompletion] DB result: CompetitionAIModel.create', { competitionId: competition?._id || competition?.id || 'unknown' })
        } catch (creationError) {
          console.error('❌ [competitions] Failed to create competition during course completion:', creationError)
          throw new Error('Unable to generate competition for this course completion')
        }
      }

      const responseBody = {
        success: true,
        learner_id: learnerId,
        course_id,
        course_name: course_name || null,
        alreadyRecorded,
        upstreamStatus,
        upstreamBody,
        competition
      }
      console.log('[recordCourseCompletion] SUCCESS:', responseBody)
      return res.status(202).json(responseBody)
    } catch (error) {
      console.error('[recordCourseCompletion] ERROR:', error)
      console.error('❌ [competitions] Course completion handling failed:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to record course completion'
      })
    }
  },

  async createAICompetition(req, res) {
    try {
      const { learner_id, learner_name, course_id, course_name } = req.body || {}

      if (!learner_id || !course_id || !course_name) {
        return res.status(400).json({
          success: false,
          error: 'learner_id, course_id, and course_name are required'
        })
      }

      const courseIdText = String(course_id)
      const existingCompetition = await CompetitionAIModel.findByLearnerAndCourse(learner_id, courseIdText)
      if (existingCompetition) {
        return res.status(200).json({
          success: true,
          competition: existingCompetition,
          alreadyExists: true
        })
      }

      const { questions } = await competitionAIService.generateCompetitionSetup({
        courseName: course_name
      })

      const competition = await CompetitionAIModel.create({
        learnerId: learner_id,
        learnerName: learner_name || null,
        courseId: courseIdText,
        courseName: course_name,
        questions,
        aiAnswers: [] // AI answers will be generated per question as the competition runs
      })

      return res.status(201).json({
        success: true,
        competition,
        alreadyExists: false
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to create AI competition:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to create AI competition',
        message: error.message
      })
    }
  },

  async getPendingAICompetitions(req, res) {
    try {
      const { learnerId } = req.params

      if (!learnerId) {
        return res.status(400).json({
          success: false,
          error: 'learnerId is required'
        })
      }

      const pendingCourses = await CompetitionAIModel.getPendingCourses(learnerId)
      return res.json({
        success: true,
        data: pendingCourses
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to fetch pending competitions:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch pending competitions',
        message: error.message
      })
    }
  },

  async getPendingAICompetitionsForMe(req, res) {
    try {
      const directoryUserId = getPlatformLearnerId(req)

      if (!directoryUserId) {
        return res.status(401).json({
          success: false,
          error: 'Platform user identity required'
        })
      }

      const pendingCourses = await CompetitionAIModel.getPendingCourses(directoryUserId)
      return res.json({
        success: true,
        data: pendingCourses
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to fetch pending competitions for authenticated user:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch pending competitions',
        message: error.message
      })
    }
  },

  async startAICompetition(req, res) {
    try {
      const { competitionId } = req.params

      if (!competitionId) {
        return res.status(400).json({
          success: false,
          error: 'competitionId is required'
        })
      }

      const competition = await CompetitionAIModel.findById(competitionId)
      if (!competition) {
        return res.status(404).json({
          success: false,
          error: 'Competition not found'
        })
      }

      if (!assertCompetitionOwnership(competition, req, res)) {
        return
      }

      const updated = await ensureActiveQuestion(competition)
      return res.json({
        success: true,
        session: buildSessionPayload(updated)
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to start AI competition:', error)
      const status = Number.isInteger(error.status) ? error.status : 500
      return res.status(status).json({
        success: false,
        error: 'Failed to start AI competition',
        message: error.message
      })
    }
  },

  async recordAICompetitionAnswer(req, res) {
    try {
      const { competitionId } = req.params
      const { question_id, answer } = req.body || {}

      if (!question_id) {
        return res.status(400).json({
          success: false,
          error: 'question_id is required'
        })
      }

      const submission = typeof answer === 'string' ? answer : ''

      const competition = await CompetitionAIModel.findById(competitionId)
      if (!competition) {
        return res.status(404).json({
          success: false,
          error: 'Competition not found'
        })
      }

      if (!assertCompetitionOwnership(competition, req, res)) {
        return
      }

      let workingCompetition = await ensureActiveQuestion(competition)

      if (workingCompetition.status === 'completed') {
      return res.json({
        success: true,
          session: buildSessionPayload(workingCompetition)
        })
      }

      const currentIndex = getCurrentQuestionIndex(workingCompetition)
      const currentQuestion = getQuestionByIndex(workingCompetition, currentIndex)

      if (!currentQuestion || currentQuestion.question_id !== question_id) {
        return res.status(400).json({
          success: false,
          error: 'Question mismatch or no active question available'
        })
      }

      if (!currentQuestion.state || currentQuestion.state.status !== 'active') {
        workingCompetition = await ensureActiveQuestion(workingCompetition)
        return res.json({
          success: true,
          session: buildSessionPayload(workingCompetition)
        })
      }

      const expired = questionHasExpired(currentQuestion)
      const answeredCompetition = await completeQuestion(
        workingCompetition,
        currentIndex,
        expired ? currentQuestion.state.learner_answer || '' : submission,
        { timedOut: expired }
      )

      const progressed = await advanceCompetition(answeredCompetition)

      return res.json({
        success: true,
        session: buildSessionPayload(progressed)
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to record learner answer:', error)
      const status = Number.isInteger(error.status) ? error.status : 500
      return res.status(status).json({
        success: false,
        error: 'Failed to record learner answer',
        message: error.message
      })
    }
  },

  async completeAICompetition(req, res) {
    try {
      const { competitionId } = req.params

      const competition = await CompetitionAIModel.findById(competitionId)
      if (!competition) {
        return res.status(404).json({
          success: false,
          error: 'Competition not found'
        })
      }

      if (!assertCompetitionOwnership(competition, req, res)) {
        return
      }

      let workingCompetition = await ensureActiveQuestion(competition)

      if (workingCompetition.status !== 'completed') {
        let tempCompetition = workingCompetition
        while (tempCompetition && tempCompetition.status !== 'completed') {
          const total = getTotalQuestions(tempCompetition)
          if (!total) {
            tempCompetition = await finalizeCompetitionAndEvaluate(tempCompetition)
            break
          }

          const index = Math.min(getCurrentQuestionIndex(tempCompetition), total - 1)
          const currentQuestion = getQuestionByIndex(tempCompetition, index)

          if (!currentQuestion) {
            tempCompetition = await finalizeCompetitionAndEvaluate(tempCompetition)
            break
          }

          if (currentQuestion.state?.status !== 'completed') {
            tempCompetition = await completeQuestion(
              tempCompetition,
              index,
              currentQuestion.state?.learner_answer || '',
              { timedOut: false }
            )
          }

          tempCompetition = await advanceCompetition(tempCompetition)
        }

        workingCompetition = tempCompetition
      }

      return res.json({
        success: true,
        session: buildSessionPayload(workingCompetition)
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to finalize competition:', error)
      const status = Number.isInteger(error.status) ? error.status : 500
      return res.status(status).json({
        success: false,
        error: 'Failed to finalize competition',
        message: error.message
      })
    }
  },

  /**
   * Handle Coordinator request to send competition summary
   * This endpoint is called by the Coordinator (pull model) instead of automatically pushing
   */
  async sendCompetitionSummary(req, res) {
    try {
      const { competition_id } = req.body || {}

      if (!competition_id) {
        return res.status(400).json({
          success: false,
          error: 'competition_id is required'
        })
      }

      // Fetch the competition from database
      const competition = await CompetitionAIModel.findById(competition_id)

      if (!competition) {
        return res.status(404).json({
          success: false,
          error: 'Competition not found'
        })
      }

      if (competition.status !== 'completed') {
        return res.status(400).json({
          success: false,
          error: 'Competition must be completed before summary can be sent'
        })
      }

      // Send the summary using the existing function
      await sendCompetitionSummaryToCoordinator(competition)

      return res.status(202).json({
        success: true,
        message: 'Competition summary sent to Coordinator',
        metadata: {
          competition_id: competition.competition_id
        }
      })
    } catch (error) {
      console.error('❌ [competitions] Failed to send competition summary:', {
        error: error.message,
        stack: error.stack
      })
      return res.status(500).json({
        success: false,
        error: 'Failed to send competition summary',
        message: error.message
      })
    }
  },

  /**
   * Handle Coordinator request to query analytics data (Pull Model)
   * Learning Analytics → Coordinator → Our backend
   * Uses OpenAI to generate structured queries from natural language requests
   */
  async queryAnalyticsData(req, res) {
    try {
      const payload = req.body || {}

      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Request body is required'
        })
      }

      // Step 1: Generate structured query using OpenAI
      let structuredQuery
      try {
        structuredQuery = await generateQueryFromRequest(payload)
      } catch (openAIError) {
        console.error('❌ [analytics-query] OpenAI query generation failed:', {
          error: openAIError.message
        })
        return res.status(500).json({
          success: false,
          error: 'Failed to generate query from request',
          message: openAIError.message
        })
      }

      // Step 2: Validate the query
      if (!structuredQuery || typeof structuredQuery !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Invalid query structure generated'
        })
      }

      if (structuredQuery.collection !== 'competitions') {
        return res.status(400).json({
          success: false,
          error: 'Only "competitions" collection is allowed'
        })
      }

      // Validate allowed fields
      const allowedFields = [
        'learner_id',
        'course_id',
        'status',
        'competition_id',
        'created_at',
        'updated_at',
        'started_at',
        'completed_at'
      ]

      const filter = structuredQuery.filter || {}
      const filterFields = Object.keys(filter)
      const invalidFields = filterFields.filter((field) => {
        // Allow operators like $gte, $lte, etc. in nested objects
        if (field.startsWith('$')) {
          return false
        }
        // Check if it's a nested comparison operator object
        if (typeof filter[field] === 'object' && filter[field] !== null && !Array.isArray(filter[field])) {
          return false // It's a comparison operator like { $gte: ... }
        }
        return !allowedFields.includes(field)
      })

      if (invalidFields.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid filter fields: ${invalidFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`
        })
      }

      // Step 3: Convert JSON query to PostgreSQL query
      const competitionsVsAiTable = postgres.quoteIdentifier('competitions_vs_ai')
      const conditions = []
      const values = []
      let paramIndex = 1

      // Build WHERE conditions
      for (const [field, value] of Object.entries(filter)) {
        if (field.startsWith('$')) {
          continue // Skip operators at top level
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Handle comparison operators: $gte, $lte, $gt, $lt, $eq, $ne, $in
          for (const [op, opValue] of Object.entries(value)) {
            if (op === '$gte') {
              conditions.push(`"${field}" >= $${paramIndex}`)
              values.push(opValue)
              paramIndex++
            } else if (op === '$lte') {
              conditions.push(`"${field}" <= $${paramIndex}`)
              values.push(opValue)
              paramIndex++
            } else if (op === '$gt') {
              conditions.push(`"${field}" > $${paramIndex}`)
              values.push(opValue)
              paramIndex++
            } else if (op === '$lt') {
              conditions.push(`"${field}" < $${paramIndex}`)
              values.push(opValue)
              paramIndex++
            } else if (op === '$eq') {
              conditions.push(`"${field}" = $${paramIndex}`)
              values.push(opValue)
              paramIndex++
            } else if (op === '$ne') {
              conditions.push(`"${field}" != $${paramIndex}`)
              values.push(opValue)
              paramIndex++
            } else if (op === '$in') {
              if (Array.isArray(opValue) && opValue.length > 0) {
                const placeholders = opValue.map(() => `$${paramIndex++}`).join(', ')
                conditions.push(`"${field}" = ANY(ARRAY[${placeholders}])`)
                values.push(...opValue)
              }
            }
          }
        } else if (Array.isArray(value)) {
          // Handle $in operator (array value)
          if (value.length > 0) {
            const placeholders = value.map(() => `$${paramIndex++}`).join(', ')
            conditions.push(`"${field}" = ANY(ARRAY[${placeholders}])`)
            values.push(...value)
          }
        } else {
          // Direct equality match
          if (field === 'learner_id' || field === 'competition_id') {
            conditions.push(`"${field}" = $${paramIndex}::uuid`)
          } else {
            conditions.push(`"${field}" = $${paramIndex}`)
          }
          values.push(value)
          paramIndex++
        }
      }

      // Build SELECT clause (projection)
      let selectClause = '*'
      if (structuredQuery.projection && typeof structuredQuery.projection === 'object') {
        const projectionFields = Object.entries(structuredQuery.projection)
          .filter(([_, include]) => include === 1 || include === true)
          .map(([field, _]) => `"${field}"`)
        if (projectionFields.length > 0) {
          selectClause = projectionFields.join(', ')
        }
      }

      // Build the query
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const query = `
        SELECT ${selectClause}
        FROM ${competitionsVsAiTable}
        ${whereClause}
        ORDER BY "created_at" DESC
      `

      // Step 4: Execute the query
      const { rows } = await postgres.query(query, values)

      // Step 5: Parse JSON fields (same as CompetitionAIModel does)
      const parseJsonField = (value) => {
        if (!value) return []
        if (Array.isArray(value)) return value
        try {
          return JSON.parse(value)
        } catch {
          return []
        }
      }

      const results = rows.map((row) => ({
        ...row,
        questions: parseJsonField(row.questions),
        ai_answers: parseJsonField(row.ai_answers),
        learner_answers: parseJsonField(row.learner_answers),
        in_progress_answers: parseJsonField(row.in_progress_answers)
      }))

      // Step 6: Return response in the required format
      return res.status(202).json({
        answer: results
      })
    } catch (error) {
      console.error('❌ [analytics-query] Query execution failed:', {
        error: error.message,
        stack: error.stack
      })
      return res.status(500).json({
        success: false,
        error: 'Failed to execute analytics query',
        message: error.message
      })
    }
  }
}
