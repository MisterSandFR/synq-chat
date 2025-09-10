import SignInClient from './SignInClient'
import { Suspense } from 'react'

export default function SignInPage({ searchParams }: { searchParams?: { callbackUrl?: string } }) {
  const callbackUrl = (searchParams?.callbackUrl as string) || '/workspace'
  return (
    <Suspense>
      <SignInClient callbackUrl={callbackUrl} />
    </Suspense>
  )
}


