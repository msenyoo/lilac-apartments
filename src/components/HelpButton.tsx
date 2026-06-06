import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { CircleHelp } from 'lucide-react'
import HelpCenter from '@/components/help/HelpCenter'

export default function HelpButton() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.key === '/' || e.key === '?') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open help center"
        className="fixed bottom-20 right-4 z-50 lg:bottom-6 lg:right-6
                   w-11 h-11 rounded-full bg-violet-600 text-white shadow-lg
                   flex items-center justify-center
                   hover:bg-violet-700 active:scale-95
                   transition-all duration-150 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
      >
        <CircleHelp size={20} strokeWidth={2} />
      </button>

      <HelpCenter
        open={open}
        onOpenChange={setOpen}
        initialRoute={location.pathname}
      />
    </>
  )
}
