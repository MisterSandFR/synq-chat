import { ReactNode } from 'react'
import { WorkspaceSidebar } from '@/components/workspace/WorkspaceSidebar'
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader'

interface WorkspaceLayoutProps {
  children: ReactNode
  params: {
    workspaceId: string
  }
}

export default function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  return (
    <div className="flex h-full">
      <WorkspaceSidebar workspaceId={params.workspaceId} />
      
      <div className="flex-1 flex flex-col">
        <WorkspaceHeader workspaceId={params.workspaceId} />
        
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}


