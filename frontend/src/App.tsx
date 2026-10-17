import type { ReactNode } from 'react'
import { Shell } from './components/shell'
import { SignIn } from './components/sign-in'
import { SourceDrawer } from './components/source-drawer'
import { TooltipLayer } from './components/ui'
import { authRequired, session } from './lib/auth'
import { DataProvider } from './lib/data'
import { Link, usePath } from './lib/router'
import { RunProvider } from './lib/run'
import { StudioPage } from './pages/studio'
import { ReportPage, ReportsPage } from './pages/reports'
import { SourcesPage } from './pages/sources'

function Page() {
  const path = usePath()
  if (path === '/') return <StudioPage />
  if (path === '/reports' || path === '/reports/') return <ReportsPage />
  if (path.startsWith('/reports/')) return <ReportPage caseId={decodeURIComponent(path.slice('/reports/'.length))} />
  if (path === '/sources') return <SourcesPage />
  return (
    <div className="mx-auto max-w-xl px-5 py-20 text-center">
      <h1 className="display text-[1.8rem]">Page not found</h1>
      <p className="mt-3 text-ink-2">There is nothing at {path}.</p>
      <Link to="/" className="btn btn-primary mt-6 rounded-full">Start an assessment</Link>
    </div>
  )
}

/** While the backend asks for sign-in and there is no token, only the sign-in screen shows. */
function Gate({ children }: { children: ReactNode }) {
  const required = authRequired.use()
  const signedIn = session.use() !== null
  return required && !signedIn ? <SignIn /> : <>{children}</>
}

export default function App() {
  return (
    <DataProvider>
      <Gate>
        <RunProvider>
          <Shell>
            <Page />
          </Shell>
          <SourceDrawer />
          <TooltipLayer />
        </RunProvider>
      </Gate>
    </DataProvider>
  )
}
