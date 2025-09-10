import { WorkspaceList } from '@/components/workspace/WorkspaceList'
import { CreateWorkspaceButton } from '@/components/workspace/CreateWorkspaceButton'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function WorkspacesPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect('/auth/signin?callbackUrl=%2Fworkspace')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-6 border-b">
        <h1 className="text-2xl font-bold">Mes Workspaces</h1>
        <CreateWorkspaceButton />
      </div>
      
      <div className="flex-1 p-6">
        <WorkspaceList />
      </div>
    </div>
  )
}

import { WorkspaceList } from '@/components/workspace/WorkspaceList'
import { CreateWorkspaceButton } from '@/components/workspace/CreateWorkspaceButton'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function WorkspacesPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect('/auth/signin')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-6 border-b">
        <h1 className="text-2xl font-bold">Mes Workspaces</h1>
        <CreateWorkspaceButton />
      </div>
      
      <div className="flex-1 p-6">
        <WorkspaceList />
      </div>
    </div>
  )
}

import { WorkspaceList } from '@/components/workspace/WorkspaceList'
import { CreateWorkspaceButton } from '@/components/workspace/CreateWorkspaceButton'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function WorkspacesPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect('/auth/signin')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-6 border-b">
        <h1 className="text-2xl font-bold">Mes Workspaces</h1>
        <CreateWorkspaceButton />
      </div>
      
      <div className="flex-1 p-6">
        <WorkspaceList />
      </div>
    </div>
  )
}


