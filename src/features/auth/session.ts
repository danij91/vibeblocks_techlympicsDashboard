import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../../lib/firebase'

export function isRealUser(user: User | null): user is User {
  return Boolean(user && !user.isAnonymous)
}

export function userLabel(user: User | null): string {
  if (!user) return 'Signed out'
  return user.displayName || user.email || 'Signed in'
}

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(auth.currentUser)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })
  }, [])

  return { user, loading, isSignedIn: isRealUser(user) }
}
