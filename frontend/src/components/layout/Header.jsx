import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { logout as performPlatformLogout } from '../../auth/logout.js'
import { Code2, LogOut } from 'lucide-react'
import Button from '../ui/Button.jsx'
import ThemeToggle from '../ThemeToggle.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import logoLight from '../../assets/images/logo-light.jpg'
import logoDark from '../../assets/images/logo-dark.jpg'

export default function Header() {
  const { theme } = useTheme()
  const [logoError, setLogoError] = useState(false)

  const logo = theme === 'night-mode' ? logoDark : logoLight
  const showLogo = logo && !logoError

  useEffect(() => {
    setLogoError(false)
  }, [theme])

  const handleLogout = () => {
    void performPlatformLogout()
  }

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 w-full border-b shadow-lg h-20 backdrop-blur-md ${theme === 'day-mode' ? 'bg-white/95 border-gray-200' : 'bg-slate-900/95 border-gray-600'}`}
    >
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link to="/dashboard" className="flex items-center gap-3 no-underline">
            {showLogo ? (
              <img
                src={logo}
                alt="EDUCORE AI Logo"
                className="h-14 w-auto"
                onError={() => setLogoError(true)}
              />
            ) : (
              <Code2
                className={`h-10 w-10 ${theme === 'day-mode' ? 'text-emerald-600' : 'text-emerald-400'}`}
                aria-hidden="true"
              />
            )}

            <div>
              <h1 
                className="text-2xl font-bold"
                style={{ 
                  background: 'var(--gradient-primary)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}
              >
                DEVLAB
              </h1>
              <span className={`text-xs ${theme === 'day-mode' ? 'text-gray-600' : 'text-gray-400'}`}>
                AI-Powered Learning Platform
              </span>
            </div>
          </Link>
          
          <div className="flex items-center space-x-4">
            <ThemeToggle />

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className={`transition-all duration-300 hover:scale-110 ${theme === 'day-mode' ? 'text-gray-400 hover:text-gray-600' : 'text-gray-400 hover:text-gray-300'}`}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
