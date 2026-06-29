import { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { competitionsAIAPI } from '../../services/api/competitionsAI.js'
import { apiClient } from '../../services/api/client.js'
import { getDevLearnerOverrideId, hasAuthToken } from '../../auth/platformAuth.js'
import { Trophy, Rocket, Star, Flame, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext.jsx'

export default function CompetitionIntro() {
  const { competitionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { theme } = useTheme()
  const isDark = theme === 'night-mode'

  const devLearnerOverride = getDevLearnerOverrideId()
  const platformMode = import.meta.env.PROD || hasAuthToken()
  const canAccessCompetition = platformMode ? hasAuthToken() : Boolean(hasAuthToken() || devLearnerOverride)

  const initialCompetition = location.state?.competition || null

  const [competition, setCompetition] = useState(initialCompetition)
  const [loadingCompetition, setLoadingCompetition] = useState(!initialCompetition)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [learnerProfile, setLearnerProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [userInteracted, setUserInteracted] = useState(false)
  const audioRef = useRef(null)

  // Audio setup
  useEffect(() => {
    const audio = new Audio('/assets/sfx/game-development-intro-logo-316783.mp3')
    audio.loop = true
    audio.volume = 0.3

    // Add error handling and logging
    audio.addEventListener('canplaythrough', () => {
      console.log('✅ [CompetitionIntro] Audio file loaded successfully')
    })

    audio.addEventListener('error', (e) => {
      console.error('❌ [CompetitionIntro] Audio error:', e)
      console.error('   Error code:', audio.error?.code)
      console.error('   Error message:', audio.error?.message)
      console.error('   Audio source:', audio.src)
      console.warn('⚠️ [CompetitionIntro] Audio file may not be available or accessible')
    })

    audio.addEventListener('loadstart', () => {
      console.log('🔄 [CompetitionIntro] Audio loading started:', audio.src)
    })

    audio.addEventListener('loadeddata', () => {
      console.log('✅ [CompetitionIntro] Audio data loaded')
    })

    audioRef.current = audio

    return () => {
      audio.removeEventListener('canplaythrough', () => {})
      audio.removeEventListener('error', () => {})
      audio.removeEventListener('loadstart', () => {})
      audio.removeEventListener('loadeddata', () => {})
      audio.pause()
      audio.currentTime = 0
      audioRef.current = null
    }
  }, [])

  // Control audio playback based on soundEnabled and user interaction
  useEffect(() => {
    if (!audioRef.current) return

    if (soundEnabled && userInteracted) {
      audioRef.current.play().catch((error) => {
        console.error('❌ [CompetitionIntro] Failed to play audio:', error)
        console.warn('⚠️ [CompetitionIntro] Audio play failed - may be blocked by browser autoplay policy or file not loaded')
      })
    } else {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }, [soundEnabled, userInteracted])

  useEffect(() => {
    if (!canAccessCompetition) {
      return
    }

    let isMounted = true
    setProfileError(null)

    ;(async () => {
      try {
        if (hasAuthToken()) {
          const context = await competitionsAIAPI.getAuthContext()
          if (!isMounted) return
          if (context?.directoryUserId) {
            const profile = await apiClient.get(`/user-profiles/${context.directoryUserId}`)
            if (!isMounted) return
            setLearnerProfile(profile?.data || profile || null)
          }
          return
        }

        if (devLearnerOverride) {
          const profile = await apiClient.get(`/user-profiles/${devLearnerOverride}`)
          if (!isMounted) return
          setLearnerProfile(profile?.data || profile || null)
        }
      } catch (profileFetchError) {
        console.error('[CompetitionIntro] Failed to load learner profile:', profileFetchError)
        if (isMounted) {
          setProfileError('Unable to load learner profile.')
        }
      }
    })()

    return () => {
      isMounted = false
    }
  }, [canAccessCompetition, devLearnerOverride])

  useEffect(() => {
    if (competition || !canAccessCompetition || !competitionId) {
      return
    }

    let isMounted = true
    setLoadingCompetition(true)
    setError(null)

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
        if (!found) {
          setError('Competition not found or already completed.')
        }
      } catch (fetchError) {
        console.error('[CompetitionIntro] Failed to fetch competition:', fetchError)
        if (isMounted) {
          const status = fetchError?.response?.status
          setError(
            status === 401 || status === 403
              ? 'Your session is invalid or expired. Open DevLab from Directory again.'
              : 'Unable to load competition details. Please try again.'
          )
        }
      } finally {
        if (isMounted) {
          setLoadingCompetition(false)
        }
      }
    })()

    return () => {
      isMounted = false
    }
  }, [competition, canAccessCompetition, competitionId, devLearnerOverride])

  const handleStartCompetition = async () => {
    if (!competitionId) {
      return
    }

    setStarting(true)
    setError(null)
    try {
      const response = await competitionsAIAPI.startCompetition(competitionId)
      const session = response?.session || response
      if (!session) {
        throw new Error('Invalid competition session response.')
      }

      navigate(`/competitions/${competitionId}/play`, {
        state: {
          competition,
          session
        },
        replace: true
      })
    } catch (startError) {
      console.error('[CompetitionIntro] Failed to start competition:', startError)
      const message = startError?.response?.data?.error || startError.message || 'Unable to start competition.'
      setError(message)
    } finally {
      setStarting(false)
    }
  }

  const renderContent = () => {
    if (!canAccessCompetition) {
      return (
        <p className={`text-center font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          Sign in through Directory to access this competition.
        </p>
      )
    }

    if (loadingCompetition) {
      return (
        <p className={`text-center ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          Loading competition…
        </p>
      )
    }

    if (error) {
      return (
        <div className="space-y-4 text-center">
          <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className={`bg-transparent border rounded-lg px-4 py-2 font-semibold transition-all focus:ring-2 focus:ring-emerald-500/60 focus:outline-none ${
              isDark
                ? 'border-slate-800 text-slate-300 hover:bg-slate-800/50'
                : 'border-slate-400 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Back to Dashboard
          </button>
        </div>
      )
    }

    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${
              isDark
              ? 'bg-slate-900/70 border-slate-800 shadow-black/30'
              : 'bg-white/80 backdrop-blur border-slate-300 shadow-xl'
          } border rounded-xl shadow-lg p-6 space-y-4 hover:shadow-[0_0_20px_rgba(16,185,129,0.12)] transition-shadow`}
        >
          <p
            className={`text-xs uppercase tracking-[0.4em] font-medium ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}
          >
            Competition
          </p>
          <h2 className={`text-3xl font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            {competition?.course_name}
          </h2>
          <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
            You'll face three sequential coding questions generated specifically for this course. Each
            question unlocks only after you finish (or time out) the previous one.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={`${
              isDark
                ? 'bg-slate-900/70 border-slate-800 shadow-black/30'
                : 'bg-white/80 backdrop-blur border-slate-300 shadow-xl'
            } border rounded-xl shadow-lg p-4 hover:shadow-[0_0_20px_rgba(16,185,129,0.12)] transition-shadow`}
          >
            <p
              className={`text-xs uppercase tracking-[0.3em] font-medium ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              Format
            </p>
            <ul
              className={`list-disc list-inside mt-2 space-y-1 text-sm ${
                isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              <li>3 coding questions, 10 minutes each.</li>
              <li>No skipping or jumping ahead.</li>
              <li>AI opponent answers simultaneously.</li>
            </ul>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={`${
              isDark
                ? 'bg-slate-900/70 border-slate-800 shadow-black/30'
                : 'bg-white/80 backdrop-blur border-slate-300 shadow-xl'
            } border rounded-xl shadow-lg p-4 hover:shadow-[0_0_20px_rgba(16,185,129,0.12)] transition-shadow`}
          >
            <p
              className={`text-xs uppercase tracking-[0.3em] font-medium ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              Scoring
            </p>
            <ul
              className={`list-disc list-inside mt-2 space-y-1 text-sm ${
                isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              <li>Quality, correctness, and clarity matter.</li>
              <li>AI vs. learner evaluated at the end.</li>
              <li>Winner + learner score saved to your record.</li>
            </ul>
          </motion.div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => navigate('/dashboard')}
            className={`bg-transparent border rounded-lg px-4 py-2 font-semibold transition-all focus:ring-2 focus:ring-emerald-500/60 focus:outline-none ${
              isDark
                ? 'border-slate-800 text-slate-300 hover:bg-slate-800/50'
                : 'border-slate-400 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Back to Dashboard
          </button>
          <button
            onClick={handleStartCompetition}
            disabled={starting}
            className="bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg px-6 py-3 font-semibold transition-all hover:scale-105 active:scale-95 focus:ring-2 focus:ring-emerald-500/60 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {starting ? 'Starting…' : 'Start Competition'}
          </button>
        </div>
      </>
    )
  }

  const displayName = learnerProfile?.learner_name || 'Learner'

  return (
    <div
      className={`relative min-h-screen px-4 py-10 overflow-hidden ${
        isDark
          ? 'bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100'
          : 'bg-gradient-to-br from-white via-slate-100 to-slate-200 text-slate-900'
      }`}
      onClick={() => {
        setUserInteracted(true)
        // Try to play directly on user click (required by browser policies)
        if (audioRef.current && soundEnabled) {
          audioRef.current.play().catch((error) => {
            console.error('❌ [CompetitionIntro] Failed to play audio on click:', error)
          })
        }
      }}
      onKeyDown={() => {
        setUserInteracted(true)
        // Try to play directly on key press
        if (audioRef.current && soundEnabled) {
          audioRef.current.play().catch((error) => {
            console.error('❌ [CompetitionIntro] Failed to play audio on keydown:', error)
          })
        }
      }}
    >
      {/* Sound Toggle (theme is controlled globally from the header) */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <button
          onClick={() => {
            const newState = !soundEnabled
            setSoundEnabled(newState)
            setUserInteracted(true)

            // Try to play/stop directly in the toggle handler
            if (audioRef.current) {
              if (newState) {
                // Enable sound - play directly on toggle
                audioRef.current.play().catch((error) => {
                  console.error('❌ [CompetitionIntro] Failed to play audio on toggle:', error)
                  console.warn('⚠️ [CompetitionIntro] Check if audio file is loaded and accessible')
                })
              } else {
                // Disable sound
                audioRef.current.pause()
                audioRef.current.currentTime = 0
              }
            }
          }}
          className={`p-3 rounded-lg transition-all focus:ring-2 focus:ring-emerald-500/60 focus:outline-none ${
            isDark
              ? 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'bg-white/80 backdrop-blur border border-slate-300 text-slate-700 hover:bg-white shadow-lg'
          }`}
          aria-label="Toggle background sound"
          aria-pressed={soundEnabled}
        >
          {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </div>

      {/* Animated Background Icons */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <motion.div
          animate={{ y: [-12, 12], rotate: [0, 6, -6, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 left-8 text-yellow-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Trophy size={64} />
        </motion.div>
        <motion.div
          animate={{ y: [10, -10], rotate: [0, -15, 15, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 right-12 text-pink-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Sparkles size={50} />
        </motion.div>
        <motion.div
          animate={{ x: [-10, 10], y: [10, -10], rotate: [0, 15, -15, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-16 left-12 text-indigo-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Rocket size={58} />
        </motion.div>
        <motion.div
          animate={{ scale: [1, 1.15, 1], rotate: [0, 10, -10, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-1/3 right-20 text-amber-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Star size={50} />
        </motion.div>
        <motion.div
          animate={{ y: [-8, 8], scale: [1, 1.1, 1] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/2 left-20 text-orange-500/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Flame size={52} />
        </motion.div>
        <motion.div
          animate={{ y: [12, -12], rotate: [0, -12, 12, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-20 right-1/4 text-indigo-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Rocket size={55} />
        </motion.div>
        <motion.div
          animate={{ y: [-9, 9], rotate: [0, 15, -15, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-24 right-8 text-pink-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Sparkles size={58} />
        </motion.div>
        <motion.div
          animate={{ scale: [1, 1.12, 1], rotate: [0, -8, 8, 0] }}
          transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-2/3 left-1/4 text-amber-400/80 drop-shadow-[0_0_12px_rgba(0,0,0,0.15)]"
        >
          <Star size={48} />
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-3xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-2"
        >
          <p
            className={`text-xs uppercase tracking-[0.4em] font-medium ${
              isDark ? 'text-slate-400' : 'text-slate-600'
            }`}
          >
            Competition Briefing
          </p>
          <h1 className={`text-4xl font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
            Ready for the Arena, {displayName}?
            <div className="h-1 w-24 bg-emerald-500 mx-auto rounded-full mt-2"></div>
          </h1>
          <p className={isDark ? 'text-slate-300' : 'text-slate-700'}>
            Take a deep breath, review the rules, and start when you're ready. The AI opponent is waiting.
          </p>
          {profileError && (
            <p className={`text-xs font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              {profileError}
            </p>
          )}
        </motion.div>

        {renderContent()}
      </div>
    </div>
  )
}