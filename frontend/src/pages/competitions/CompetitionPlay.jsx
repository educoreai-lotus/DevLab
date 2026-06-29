import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { competitionsAIAPI } from '../../services/api/competitionsAI.js'
import { getDevLearnerOverrideId, hasAuthToken } from '../../auth/platformAuth.js'
import { Code, Sparkles, Terminal, Cpu, Trophy, Bot, Smile } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext.jsx'

const QUESTIONS_PER_COMPETITION = 3
const QUESTION_TIMER_SECONDS = 10 * 60 // 10 minutes per question
const TOTAL_COMPETITION_SECONDS = QUESTION_TIMER_SECONDS * QUESTIONS_PER_COMPETITION // 30 minutes total
const TOTAL_COMPETITION_MINUTES = TOTAL_COMPETITION_SECONDS / 60

const calculateRemainingSeconds = (expiresAt, fallbackSeconds = QUESTION_TIMER_SECONDS) => {
  if (expiresAt) {
    const diff = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)
    return diff > 0 ? diff : 0
  }
  return fallbackSeconds
}

export default function CompetitionPlay() {
  const { competitionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { theme } = useTheme()
  const isDark = theme === 'night-mode'

  const devLearnerOverride = getDevLearnerOverrideId()
  const platformMode = import.meta.env.PROD || hasAuthToken()
  const canAccessCompetition = platformMode ? hasAuthToken() : Boolean(hasAuthToken() || devLearnerOverride)

  const [competition, setCompetition] = useState(location.state?.competition || null)
  const [session, setSession] = useState(location.state?.session || null)
  const [loadingSession, setLoadingSession] = useState(!location.state?.session)
  const [error, setError] = useState(null)
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [answerSubmitting, setAnswerSubmitting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(null)

  const startAttemptedRef = useRef(Boolean(location.state?.session))
  const autoSubmitRef = useRef(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mediaQuery.matches)
    
    const handleChange = (e) => setPrefersReducedMotion(e.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])


  useEffect(() => {
    if (competition || !canAccessCompetition || !competitionId) {
      return
    }

    let isMounted = true

    ;(async () => {
      try {
        const pending = hasAuthToken()
          ? await competitionsAIAPI.getPendingCompetitionsForMe()
          : await competitionsAIAPI.getPendingCompetitions(devLearnerOverride)
        if (!isMounted) {
          return
        }
        const found = pending.find((item) => item.competition_id === competitionId)
        setCompetition(found || null)
      } catch (fetchError) {
        console.error('[CompetitionPlay] Failed to load competition:', fetchError)
      }
    })()

    return () => {
      isMounted = false
    }
  }, [competition, canAccessCompetition, competitionId, devLearnerOverride])

  const fetchSession = useCallback(async () => {
    if (!competitionId || startAttemptedRef.current) {
      return
    }

    startAttemptedRef.current = true
    setLoadingSession(true)
    setError(null)

    try {
      const response = await competitionsAIAPI.startCompetition(competitionId)
      const sessionPayload = response?.session || response
      if (!sessionPayload) {
        throw new Error('Invalid competition session response.')
      }
      setSession(sessionPayload)
    } catch (fetchError) {
      console.error('[CompetitionPlay] Failed to start competition:', fetchError)
      const message =
        fetchError?.response?.data?.error || fetchError.message || 'Unable to start competition.'
      setError(message)
      startAttemptedRef.current = false
    } finally {
      setLoadingSession(false)
    }
  }, [competitionId])

  useEffect(() => {
    if (!session && competitionId && canAccessCompetition) {
      fetchSession()
    }
  }, [session, competitionId, fetchSession, canAccessCompetition])

  const handleRetryStart = useCallback(() => {
    startAttemptedRef.current = false
    fetchSession()
  }, [fetchSession])

  useEffect(() => {
    if (!session || session.completed) {
      setRemainingSeconds(null)
      autoSubmitRef.current = false
      return
    }

    const seconds = calculateRemainingSeconds(session.expires_at, session.timer_seconds)
    setRemainingSeconds(seconds)

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        const next = prev === null ? seconds : prev - 1
        return next > 0 ? next : 0
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [session?.competition_id, session?.question?.question_id, session?.expires_at, session?.completed, session?.timer_seconds])

  useEffect(() => {
    setCurrentAnswer('')
    autoSubmitRef.current = false
  }, [session?.question?.question_id])

  // Compute time-based AI presence level (purely cosmetic, no real AI data)
  const aiPresenceLevel = useMemo(() => {
    if (!session || session.completed || !session.question || remainingSeconds === null) {
      return 'idle'
    }
    
    const timerSeconds = session.timer_seconds || QUESTION_TIMER_SECONDS
    const progress = 1 - (remainingSeconds / timerSeconds)
    
    if (progress < 0.33) {
      return 'idle'
    } else if (progress < 0.75) {
      return 'thinking'
    } else {
      return 'intense'
    }
  }, [session, remainingSeconds])

  const handleSubmitAnswer = useCallback(
    async (isTimeout = false) => {
      if (!session || session.completed || !session.question) {
        return
      }

      // Allow empty answer on timeout
      if (!isTimeout && !currentAnswer.trim()) {
        return
      }

      setAnswerSubmitting(true)
      
      // Don't show error messages for timeout submissions
      if (!isTimeout) {
        setError(null)
      }

      try {
        const payload = {
          question_id: session.question.question_id,
          answer: isTimeout ? '' : currentAnswer.trim()
        }
        const response = await competitionsAIAPI.submitAnswer(competitionId, payload)
        const updatedSession = response?.session || response
        if (!updatedSession) {
          throw new Error('Invalid competition session response.')
        }
        setSession(updatedSession)
        setCurrentAnswer('')
        // Clear any previous errors on successful submission
        setError(null)
      } catch (submitError) {
        // For timeout submissions, don't show error messages to the user
        if (isTimeout) {
          console.log('[CompetitionPlay] Timeout submission completed silently')
          // Still try to update session if possible
          try {
            // If there's a session update in the error response, use it
            const errorSession = submitError?.response?.data?.session
            if (errorSession) {
              setSession(errorSession)
            }
          } catch (e) {
            // Ignore errors during timeout submission
          }
        } else {
          // For manual submissions, show errors normally
          console.error('[CompetitionPlay] Failed to submit answer:', submitError)
          const message =
            submitError?.response?.data?.error ||
            submitError.message ||
            'Unable to submit answer. Please try again.'
          setError(message)
        }
      } finally {
        setAnswerSubmitting(false)
        autoSubmitRef.current = false
      }
    },
    [session, currentAnswer, competitionId]
  )

  useEffect(() => {
    if (!session || session.completed) {
      autoSubmitRef.current = false
      return
    }

    if (remainingSeconds === 0 && !autoSubmitRef.current && session.question) {
      autoSubmitRef.current = true
      handleSubmitAnswer(true)
    }
  }, [remainingSeconds, session, handleSubmitAnswer])

  const handleCompleteCompetition = async () => {
    if (!session || session.completed) {
      return
    }

    setCompleting(true)
    setError(null)
    try {
      const response = await competitionsAIAPI.completeCompetition(competitionId)
      const updatedSession = response?.session || response
      setSession(updatedSession)
    } catch (completeError) {
      console.error('[CompetitionPlay] Failed to complete competition:', completeError)
      const message =
        completeError?.response?.data?.error ||
        completeError.message ||
        'Unable to finalize competition.'
      setError(message)
    } finally {
      setCompleting(false)
    }
  }

  // AI Avatar animation variants (purely cosmetic, time-based only)
  const aiAvatarVariants = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        idle: { scale: 1, opacity: 0.65 },
        thinking: { scale: 1, opacity: 0.75 },
        intense: { scale: 1, opacity: 0.85 }
      }
    }
    return {
      idle: {
        scale: [1, 1.05, 1],
        opacity: [0.6, 0.7, 0.6],
        transition: {
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }
      },
      thinking: {
        scale: [1, 1.08, 1],
        opacity: [0.7, 0.85, 0.7],
        rotate: [0, 5, -5, 0],
        transition: {
          duration: 2.5,
          repeat: Infinity,
          ease: "easeInOut"
        }
      },
      intense: {
        scale: [1, 1.1, 1],
        opacity: [0.8, 0.95, 0.8],
        rotate: [0, 8, -8, 0],
        transition: {
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }
      }
    }
  }, [prefersReducedMotion])

  // AI Avatar glow variants
  const aiGlowVariants = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        idle: { opacity: 0.25, scale: 1 },
        thinking: { opacity: 0.4, scale: 1 },
        intense: { opacity: 0.5, scale: 1 }
      }
    }
    return {
      idle: {
        opacity: [0.2, 0.3, 0.2],
        scale: [1, 1.1, 1],
        transition: {
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }
      },
      thinking: {
        opacity: [0.3, 0.5, 0.3],
        scale: [1, 1.15, 1],
        transition: {
          duration: 2.5,
          repeat: Infinity,
          ease: "easeInOut"
        }
      },
      intense: {
        opacity: [0.4, 0.6, 0.4],
        scale: [1, 1.2, 1],
        transition: {
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }
      }
    }
  }, [prefersReducedMotion])

  const renderActiveQuestion = () => {
    if (!session || session.completed) {
      return null
    }

    if (!session.question) {
      return (
        <p className={`text-center ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          Preparing your next challenge…
        </p>
      )
    }

    const questionPosition = session.questionIndex || 1
    const totalQuestions = session.totalQuestions || QUESTIONS_PER_COMPETITION
    const perQuestionTimer = session.timer_seconds || QUESTION_TIMER_SECONDS

    const questionProgress =
      totalQuestions > 0 ? ((questionPosition - 1) / totalQuestions) * 100 : 0
    const timerPercent = Math.max(
      0,
      Math.min(
        100,
        ((remainingSeconds ?? perQuestionTimer) / perQuestionTimer) * 100
      )
    )
    const questionsRemainingAfterThis = Math.max(totalQuestions - questionPosition, 0)
    const totalRemainingSeconds =
      questionsRemainingAfterThis * perQuestionTimer + (remainingSeconds ?? perQuestionTimer)
    const totalTimerPercent = Math.max(
      0,
      Math.min(
        100,
        (totalRemainingSeconds / (perQuestionTimer * totalQuestions)) * 100
      )
    )

    return (
      <>
        <div className="relative">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`${
                  isDark
                    ? 'bg-slate-900/70 border-slate-800'
                    : 'bg-white/80 backdrop-blur border-slate-300'
                } border-2 rounded-xl shadow-lg p-5 min-h-[200px] transition-all relative overflow-hidden`}
                style={{
                  boxShadow: isDark
                    ? '0 0 20px rgba(16, 185, 129, 0.15), 0 8px 40px rgba(16, 185, 129, 0.08)'
                    : '0 0 20px rgba(16, 185, 129, 0.1), 0 8px 40px rgba(16, 185, 129, 0.05)',
                  borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.2)'
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/5 to-emerald-500/0 animate-pulse-slow pointer-events-none"></div>
                <p className={`text-xs uppercase tracking-[0.3em] font-medium relative z-10 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Current Challenge
                </p>
                <p className={`mt-3 text-lg leading-relaxed whitespace-pre-line relative z-10 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {session.question.question}
                </p>
              </motion.div>
              <textarea
                className={`w-full border-2 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/60 transition-all ${
                  isDark
                    ? 'bg-slate-900/70 border-slate-800 text-slate-100 placeholder:text-slate-400'
                    : 'bg-white/80 backdrop-blur border-slate-300 text-slate-900 placeholder:text-slate-500'
                }`}
                style={{
                  borderColor: isDark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.15)'
                }}
                rows={6}
                placeholder="Write your code solution here"
                value={currentAnswer}
                onChange={(event) => {
                  setCurrentAnswer(event.target.value)
                }}
              />
            </div>
            <div className="flex flex-col items-center justify-center space-y-6">
              <motion.div
                animate={{
                  scale: [1, 1.02, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="relative w-32 h-32"
              >
                <div
                  className="absolute inset-0 rounded-full opacity-80"
                  style={{
                    background: `conic-gradient(#10b981 ${timerPercent}%, rgba(255,255,255,0.15) ${timerPercent}% 100%)`,
                    filter: 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.4))'
                  }}
                />
                <div className={`absolute inset-2 rounded-full flex flex-col items-center justify-center shadow-lg ${
                  isDark ? 'bg-gray-900 shadow-black/40' : 'bg-white shadow-black/20'
                }`}>
                  <span className={`text-[10px] uppercase tracking-[0.3em] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Timer
                  </span>
                  <span className={`text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                    {remainingSeconds === null ? '--:--' : `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`}
                  </span>
                  <span className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {Math.floor(perQuestionTimer / 60)} min limit
                  </span>
                </div>
              </motion.div>
              <div className="text-center">
                <p className={`text-xs uppercase tracking-[0.3em] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Progress
                </p>
                <p className={`text-3xl font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {questionPosition} / {totalQuestions}
                </p>
              </div>
            </div>
          </div>

          {/* AI Thinking Avatar - Purely cosmetic, time-based animation */}
          <motion.div
            className="hidden md:flex absolute top-1/2 -right-24 -translate-y-1/2 flex-col items-center gap-2 pointer-events-none"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="relative"
              variants={aiAvatarVariants}
              animate={aiPresenceLevel}
              style={{
                filter: 'drop-shadow(0 0 12px rgba(16, 185, 129, 0.3))'
              }}
            >
              {/* Glow effect */}
              <motion.div
                className={`absolute inset-0 rounded-full ${
                  isDark ? 'bg-emerald-500/20' : 'bg-emerald-400/30'
                } blur-xl`}
                variants={aiGlowVariants}
                animate={aiPresenceLevel}
              />
              {/* Avatar container */}
              <div className={`relative w-20 h-20 rounded-full flex items-center justify-center ${
                isDark
                  ? 'bg-slate-800/80 border-2 border-emerald-500/40'
                  : 'bg-white/90 border-2 border-emerald-400/50'
              } shadow-lg backdrop-blur-sm`}>
                <Bot className={`w-10 h-10 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`} />
              </div>
            </motion.div>
            <p className={`text-xs font-medium whitespace-nowrap ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}>
              AI is thinking…
            </p>
          </motion.div>

          {/* Mobile AI Avatar - shown below content */}
          <motion.div
            className="md:hidden flex flex-col items-center gap-2 mt-6 pt-6 border-t border-slate-300/20"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="relative"
              variants={aiAvatarVariants}
              animate={aiPresenceLevel}
              style={{
                filter: 'drop-shadow(0 0 12px rgba(16, 185, 129, 0.3))'
              }}
            >
              {/* Glow effect */}
              <motion.div
                className={`absolute inset-0 rounded-full ${
                  isDark ? 'bg-emerald-500/20' : 'bg-emerald-400/30'
                } blur-xl`}
                variants={aiGlowVariants}
                animate={aiPresenceLevel}
              />
              {/* Avatar container */}
              <div className={`relative w-16 h-16 rounded-full flex items-center justify-center ${
                isDark
                  ? 'bg-slate-800/80 border-2 border-emerald-500/40'
                  : 'bg-white/90 border-2 border-emerald-400/50'
              } shadow-lg backdrop-blur-sm`}>
                <Bot className={`w-8 h-8 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`} />
              </div>
            </motion.div>
            <p className={`text-xs font-medium ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}>
              AI is thinking…
            </p>
          </motion.div>
        </div>

        <div className="space-y-3">
          <div className={`h-3 rounded-full overflow-hidden ${
            isDark ? 'bg-slate-800' : 'bg-slate-200'
          }`}>
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-transparent transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, questionProgress))}%` }}
            />
          </div>
          <p className={`text-xs text-right ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            No skipping — the next challenge appears when this timer expires or you submit.
          </p>
          <div className={`h-1.5 rounded-full overflow-hidden ${
            isDark ? 'bg-slate-800' : 'bg-slate-200'
          }`}>
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-transparent transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, totalTimerPercent))}%` }}
            />
          </div>
          <p className={`text-[11px] text-right ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Total competition time remaining: {Math.max(0, Math.floor(totalRemainingSeconds / 60))}m {Math.max(0, totalRemainingSeconds % 60)}s
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <button
            onClick={() => {
              handleSubmitAnswer(false)
            }}
            disabled={answerSubmitting || !currentAnswer.trim()}
            className="bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg px-6 py-3 font-semibold transition-all hover:scale-105 active:scale-95 focus:ring-2 focus:ring-emerald-500/60 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 w-full md:w-auto shadow-lg shadow-emerald-500/30"
          >
            {answerSubmitting ? 'Submitting…' : 'Submit Answer'}
          </button>
          <button
            onClick={handleCompleteCompetition}
            disabled={completing}
            className={`border rounded-lg px-6 py-3 font-semibold transition-all hover:scale-105 active:scale-95 focus:ring-2 focus:ring-emerald-500/60 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 w-full md:w-auto ${
              isDark
                ? 'bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800/50'
                : 'bg-transparent border-slate-400 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {completing ? 'Saving…' : 'Finish Competition'}
          </button>
        </div>
      </>
    )
  }

  const renderSummary = () => {
    if (!session || !session.completed) {
      return null
    }

    const winner = session.summary?.winner
    const isLearnerWinner = winner === 'learner'
    const isAIWinner = winner === 'ai'
    const isTie = winner !== 'learner' && winner !== 'ai'

    return (
      <div className="space-y-6">
        {isLearnerWinner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6, type: "spring" }}
            className="text-center"
          >
            <motion.div
              animate={{
                scale: [1, 1.1, 1],
                rotate: [0, 5, -5, 0]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="inline-block mb-4"
            >
              <Trophy className="w-20 h-20 text-emerald-500 mx-auto drop-shadow-lg" />
            </motion.div>
            <h2 className={`text-4xl font-bold mb-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              Congratulations!
            </h2>
            <div className="flex justify-center gap-2 mt-4">
              {[...Array(5)].map((_, i) => (
                <motion.span
                  key={i}
                  animate={{
                    scale: [1, 1.3, 1],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut"
                  }}
                  className="text-2xl"
                >
                  🎉
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}

        {isAIWinner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={`
              p-6 rounded-2xl backdrop-blur-md shadow-lg border 
              ${isDark ? "border-red-900/40 bg-red-900/10" : "border-red-300/60 bg-red-50/60"}
            `}
          >
            <motion.div
              initial={{ y: -10 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Bot
                className="w-20 h-20 text-red-500 mx-auto mb-3 drop-shadow-[0_0_12px_rgba(255,0,0,0.55)]"
              />
            </motion.div>

            <p
              className={`
                text-xl font-semibold text-center tracking-wide
                bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent
              `}
            >
              Oops!… AI got you this time 🤭!
            </p>
          </motion.div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className={`${
            isDark
              ? 'bg-slate-900/70 border-slate-800'
              : 'bg-white/80 backdrop-blur border-slate-300'
          } border-2 rounded-xl shadow-lg p-4 text-center hover:shadow-[0_8px_40px_rgba(16,185,129,0.08)] transition-all`}
          style={{
            borderColor: isLearnerWinner 
              ? 'rgba(16, 185, 129, 0.4)' 
              : isAIWinner 
              ? 'rgba(239, 68, 68, 0.3)'
              : isDark ? 'rgba(148, 163, 184, 0.3)' : 'rgba(148, 163, 184, 0.2)'
          }}>
            <p className={`text-xs uppercase tracking-[0.3em] font-medium ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Winner
            </p>
            <div className="flex items-center justify-center gap-2 mt-2">
              {isAIWinner && <Bot className="w-6 h-6 text-red-500" />}
              {isLearnerWinner && <Trophy className="w-6 h-6 text-emerald-500" />}
              {isTie && <Smile className="w-6 h-6 text-yellow-500" />}
              <p className={`text-3xl font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                {isLearnerWinner
                  ? 'You'
                  : isAIWinner
                  ? 'AI'
                  : 'Tie'}
              </p>
            </div>
          </div>
          <div className={`${
            isDark
              ? 'bg-slate-900/70 border-slate-800'
              : 'bg-white/80 backdrop-blur border-slate-300'
          } border-2 rounded-xl shadow-lg p-4 text-center hover:shadow-[0_8px_40px_rgba(16,185,129,0.08)] transition-all`}
          style={{
            borderColor: isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.2)'
          }}>
            <p className={`text-xs uppercase tracking-[0.3em] font-medium ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Your Score
            </p>
            <p className={`text-3xl font-semibold mt-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
              {typeof session.summary?.score === 'number' ? session.summary.score : 'Pending'}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <button
            onClick={() => navigate('/dashboard')}
            className={`border rounded-lg px-4 py-2 font-semibold transition-all focus:ring-2 focus:ring-emerald-500/60 focus:outline-none ${
              isDark
                ? 'bg-transparent border-slate-800 text-slate-300 hover:bg-slate-800/50'
                : 'bg-transparent border-slate-400 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Back to Dashboard
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg px-6 py-3 font-semibold transition-all hover:scale-105 active:scale-95 focus:ring-2 focus:ring-emerald-500/60 focus:outline-none"
          >
            View More Competitions
          </button>
        </div>
      </div>
    )
  }

  if (!canAccessCompetition) {
    return (
      <div className={`min-h-screen flex items-center justify-center px-4 ${
        isDark
          ? 'bg-slate-950 text-slate-100'
          : 'bg-gradient-to-br from-white via-slate-100 to-slate-200 text-slate-900'
      }`}>
        <p className={`text-center font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          Sign in through Directory to access this competition.
        </p>
      </div>
    )
  }

  return (
    <div 
      className={`relative min-h-screen px-4 py-10 overflow-hidden ${
        isDark
          ? 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100'
          : 'bg-gradient-to-br from-white via-slate-100 to-slate-200 text-slate-900'
      }`}
    >
      {/* Scanline Overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[5] opacity-30"
        style={{
          background: 'linear-gradient(transparent 50%, rgba(255,255,255,0.02) 50%)',
          backgroundSize: '100% 4px',
          animation: 'scanline 8s linear infinite'
        }}
      />

      {/* Animated Background Icons */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <motion.div
          animate={{ y: [-10, 10], rotate: [0, 10, -10, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute top-10 left-8 ${isDark ? 'text-emerald-500/10' : 'text-emerald-400/12'}`}
          style={{ willChange: 'transform' }}
        >
          <Code size={60} />
        </motion.div>
        <motion.div
          animate={{ y: [10, -10], rotate: [0, -15, 15, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute top-1/4 right-12 ${isDark ? 'text-emerald-500/10' : 'text-emerald-400/12'}`}
          style={{ willChange: 'transform' }}
        >
          <Sparkles size={50} />
        </motion.div>
        <motion.div
          animate={{ y: [-8, 8], rotate: [0, 12, -12, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute bottom-16 left-12 ${isDark ? 'text-emerald-500/10' : 'text-emerald-400/12'}`}
          style={{ willChange: 'transform' }}
        >
          <Terminal size={55} />
        </motion.div>
        <motion.div
          animate={{ y: [8, -8], rotate: [0, -10, 10, 0] }}
          transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute bottom-1/3 right-20 ${isDark ? 'text-emerald-500/10' : 'text-emerald-400/12'}`}
          style={{ willChange: 'transform' }}
        >
          <Cpu size={48} />
        </motion.div>
        <motion.div
          animate={{ y: [-12, 12], rotate: [0, 8, -8, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute top-1/2 left-20 ${isDark ? 'text-emerald-500/10' : 'text-emerald-400/12'}`}
          style={{ willChange: 'transform' }}
        >
          <Code size={45} />
        </motion.div>
        <motion.div
          animate={{ y: [12, -12], rotate: [0, -12, 12, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute top-20 right-1/4 ${isDark ? 'text-emerald-500/10' : 'text-emerald-400/12'}`}
          style={{ willChange: 'transform' }}
        >
          <Terminal size={52} />
        </motion.div>
      </div>

      {/* HUD */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <div className={`px-3 py-1 rounded-lg text-sm font-semibold ${
          isDark
            ? 'bg-slate-800/60 text-slate-300'
            : 'bg-white/60 backdrop-blur text-slate-700'
        }`}>
          {session ? `${session.questionIndex || 1}/${session.totalQuestions || 3}` : '—/—'}
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-2"
        >
          <p className={`text-xs uppercase tracking-[0.4em] font-medium ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            AI Arena
          </p>
          <h1 className={`text-4xl font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            {competition?.course_name || 'Competition In Progress'}
            <div className="h-1 w-28 mx-auto rounded-full bg-emerald-500/80 mt-3 shadow-[0_6px_30px_rgba(16,185,129,0.12)]"></div>
          </h1>
          <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
            Each question unlocks one at a time, with {TOTAL_COMPETITION_MINUTES} minutes total to outsmart the AI opponent.
          </p>
        </motion.div>

        {error && (
          <div className={`border rounded-xl p-4 text-center space-y-3 ${
            isDark
              ? 'bg-red-500/10 border-red-500/40 text-red-300'
              : 'bg-red-50 border-red-300 text-red-700'
          }`}>
            <p>{error}</p>
            <button
              onClick={handleRetryStart}
              className={`border rounded-lg px-4 py-2 text-sm font-semibold transition-all focus:ring-2 focus:ring-emerald-500/60 focus:outline-none ${
                isDark
                  ? 'bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800/50'
                  : 'bg-transparent border-slate-400 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Retry
            </button>
          </div>
        )}

        {loadingSession ? (
          <p className={`text-center ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Loading competition session…
          </p>
        ) : (
          <div className={`${
            isDark
              ? 'bg-slate-900/70 border-slate-800'
              : 'bg-white/80 backdrop-blur border-slate-300'
          } border rounded-3xl shadow-2xl p-6 space-y-6 hover:shadow-[0_8px_40px_rgba(16,185,129,0.08)] transition-all`}>
            {!session && !error && (
              <p className={`text-center ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Unable to load the competition session.
              </p>
            )}

            {session && !session.completed && renderActiveQuestion()}
            {session && session.completed && renderSummary()}
          </div>
        )}
      </div>

      <style>{`
        @keyframes scanline {
          0% { background-position: 0 0; }
          100% { background-position: 0 100%; }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          * { 
            animation-duration: 0.01ms !important; 
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>
    </div>
  )
}
