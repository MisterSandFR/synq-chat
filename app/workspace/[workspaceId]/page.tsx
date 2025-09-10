import { ChannelList } from '@/components/workspace/ChannelList'
import { WelcomeMessage } from '@/components/workspace/WelcomeMessage'

interface WorkspacePageProps {
  params: {
    workspaceId: string
  }
}

export default function WorkspacePage({ params }: WorkspacePageProps) {
  return (
    <div className="flex h-full">
      <div className="w-64 border-r bg-gray-50">
        <ChannelList workspaceId={params.workspaceId} />
      </div>
      
      <div className="flex-1 flex items-center justify-center">
        <WelcomeMessage workspaceId={params.workspaceId} />
      </div>
    </div>
  )
}


