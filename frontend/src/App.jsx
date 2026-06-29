import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import SimpleQuestionPage from './pages/SimpleQuestionPage'
import Dashboard from './pages/learner/Dashboard'
import CompetitionIntro from './pages/competitions/CompetitionIntro.jsx'
import CompetitionPlay from './pages/competitions/CompetitionPlay.jsx'
import AssessmentPreview from './pages/AssessmentPreview.jsx'
import ContentStudioPreview from './pages/ContentStudioPreview.jsx'
import CodeContentStudioPreview from './pages/CodeContentStudioPreview.jsx'
import ValidateQuestionPreview from './pages/ValidateQuestionPreview.jsx'
import { useAuthStore } from './store/authStore.js'
import { getAuthToken } from './auth/platformAuth.js'
import './styles/theme-transitions.css'

function App() {
  const { user } = useAuthStore()
  
  // Expose user data to window for bot initialization (HTML script handles initialization)
  useEffect(() => {
    const token = getAuthToken() || ''
    window.APP_USER = {
      id: user?.id || 'anonymous',
      token: token,
      tenantId: user?.tenantId || 'devlab'
    }
  }, [user])

  console.log('VITE_API_URL =', import.meta.env.VITE_API_URL)
  console.log('🚀 Frontend app initializing - Vercel deployment trigger', new Date().toISOString())
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/competitions/:competitionId/intro" element={<CompetitionIntro />} />
          <Route path="/competitions/:competitionId/play" element={<CompetitionPlay />} />
          <Route path="/assessment-preview" element={<AssessmentPreview />} />
          <Route
            path="/code-content-studio-preview"
            element={<CodeContentStudioPreview />}
          />
          <Route
            path="/validate-question-preview"
            element={<ValidateQuestionPreview />}
          />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App