import { logout as performPlatformLogout } from '../../auth/logout.js'
import { LogOut } from 'lucide-react'
import Button from '../ui/Button.jsx'
import ThemeToggle from '../ThemeToggle.jsx'
import { useTheme } from '../../contexts/ThemeContext.jsx'

export default function Header() {
  const { theme } = useTheme()

  const handleLogout = () => {
    void performPlatformLogout()
  }

  const logoUrl = theme === 'day-mode' ? '/light-logo.jpeg' : '/dark-logo.jpeg'
  console.log('[Header] logoUrl:', logoUrl)

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 w-full border-b shadow-lg h-20 backdrop-blur-md ${theme === 'day-mode' ? 'bg-white/95 border-gray-200' : 'bg-slate-900/95 border-gray-600'}`}
    >
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* DEVLAB Logo */}
          <div className="flex items-center space-x-4">
            <div className="flex-shrink-0 h-12 w-12 rounded-lg flex items-center justify-center">
              <img
                src={logoUrl}
                alt="DEVLAB Logo"
                className="h-12 w-12 rounded-lg object-cover"
                onError={(e) => {
                  // Prevent infinite loop
                  e.currentTarget.onerror = null

                  // Try a fallback path if the image isn't served from public root
                  e.currentTarget.src = theme === 'day-mode'
                    ? '/assets/light-logo.jpeg'
                    : '/assets/dark-logo.jpeg'
                }}
              />
            </div>
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
          </div>
          
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
