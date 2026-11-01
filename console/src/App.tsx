import { Activity, AlertTriangle, Bird, Bug, FileCode2, Gauge, LayoutDashboard, Moon, RefreshCw, ScrollText, Sun, Workflow } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, RefreshContext, useApi, type FalconAlert, type Meta } from "@/lib/api"
import { href, useRoute, type Page } from "@/lib/router"
import { Alerts } from "@/pages/alerts"
import { Detections } from "@/pages/detections"
import { Events } from "@/pages/events"
import { Overview } from "@/pages/overview"
import { Pipeline } from "@/pages/pipeline"
import { ResourcesPage } from "@/pages/resources"
import { Rules } from "@/pages/rules"
import { Vulnerabilities } from "@/pages/vulnerabilities"

const NAV: { group: string; items: { page: Page; label: string; icon: typeof Activity }[] }[] = [
  {
    group: "Monitor",
    items: [
      { page: "overview", label: "Overview", icon: LayoutDashboard },
      { page: "resources", label: "Resources", icon: Gauge },
    ],
  },
  {
    group: "Detect",
    items: [
      { page: "alerts", label: "Alerts", icon: AlertTriangle },
      { page: "events", label: "Events", icon: Activity },
      { page: "detections", label: "Detections", icon: FileCode2 },
      { page: "rules", label: "Rules", icon: ScrollText },
      { page: "pipeline", label: "Pipeline", icon: Workflow },
    ],
  },
  { group: "Triage", items: [{ page: "vulnerabilities", label: "Vulnerabilities", icon: Bug }] },
]

// Every GCP refresh runs BigQuery queries, and those reads are themselves audit-logged
// into Falcon, so poll the cloud less often than the local stack.
const REFRESH_MS = { local: 15_000, gcp: 60_000 }

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("falcon-theme")
      if (saved) return saved === "dark"
    } catch {
      // storage unavailable
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try {
      localStorage.setItem("falcon-theme", dark ? "dark" : "light")
    } catch {
      // storage unavailable
    }
  }, [dark])
  return [dark, setDark] as const
}

export default function App() {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const [auto, setAuto] = useState(true)
  const [dark, setDark] = useTheme()

  const [source, setSource] = useState<Meta["source"]>("local")
  useEffect(() => {
    api<Meta>("meta").then((m) => setSource(m.source), () => {})
  }, [])
  useEffect(() => {
    if (!auto) return
    const id = setInterval(refresh, REFRESH_MS[source])
    return () => clearInterval(id)
  }, [auto, refresh, source])

  const ctx = useMemo(() => ({ tick, refresh }), [tick, refresh])
  return (
    <RefreshContext.Provider value={ctx}>
      <TooltipProvider>
        <SidebarProvider>
          <Shell auto={auto} setAuto={setAuto} dark={dark} setDark={setDark} refreshMs={REFRESH_MS[source]} />
        </SidebarProvider>
      </TooltipProvider>
    </RefreshContext.Provider>
  )
}

function Shell({ auto, setAuto, dark, setDark, refreshMs }: { auto: boolean; setAuto: (v: boolean) => void; dark: boolean; setDark: (v: boolean) => void; refreshMs: number }) {
  const { page, id } = useRoute()
  const meta = useApi<Meta>("meta")
  const alerts = useApi<FalconAlert[]>("alerts")
  const current = NAV.flatMap((g) => g.items).find((i) => i.page === page)

  useEffect(() => {
    document.title = `${current?.label ?? "Overview"} · Falcon`
  }, [current])

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <a href={href("overview")} className="flex items-center gap-2 px-2 py-1.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
              <Bird className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block font-semibold">Falcon</span>
              <span className="block text-xs text-sidebar-foreground/60">Security console</span>
            </span>
          </a>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((g) => (
            <SidebarGroup key={g.group}>
              <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((item) => (
                    <SidebarMenuItem key={item.page} data-section={item.page}>
                      <SidebarMenuButton asChild isActive={page === item.page} tooltip={item.label} className="data-[active=true]:shadow-[inset_3px_0_0_var(--section)]">
                        <a href={href(item.page)}>
                          <item.icon className="text-section" />
                          <span>{item.label}</span>
                        </a>
                      </SidebarMenuButton>
                      {item.page === "alerts" && !!alerts.data?.length && <SidebarMenuBadge className="text-sev-critical">{alerts.data.length}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="rounded-md border border-sidebar-border bg-sidebar-accent/50 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <span className={`size-2 rounded-full ${meta.error ? "bg-sev-critical" : meta.data?.source === "gcp" ? "bg-ok" : "bg-info"}`} />
              {meta.data?.source === "gcp" ? "Live GCP data" : meta.data ? "Local data" : "Connecting…"}
            </div>
            <div className="break-all text-sidebar-foreground/60">{meta.error ?? meta.data?.label}</div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header data-section={page} className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-1 h-4" />
          {current && <current.icon className="size-4 text-section" />}
          <span className="font-medium">{current?.label ?? "Overview"}</span>
          <div className="ml-auto flex items-center gap-2">
            {meta.data?.source === "gcp" && <Badge variant="outline" className="hidden lg:inline-flex">{meta.data.project} · {meta.data.region}</Badge>}
            <Button variant="ghost" size="sm" onClick={() => setAuto(!auto)} title={`Refresh every ${refreshMs / 1000} seconds`}>
              <RefreshCw className={auto ? "animate-[spin_3s_linear_infinite]" : ""} />
              <span className="hidden sm:inline">{auto ? "Live" : "Paused"}</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} title="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
          <span className="absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-section via-section/40 to-transparent" />
        </header>
        <div data-section={page} className="mx-auto w-full min-w-0 max-w-[1600px] p-4 md:p-6">
          {page === "overview" && <Overview />}
          {page === "resources" && <ResourcesPage />}
          {page === "alerts" && <Alerts openId={id} />}
          {page === "events" && <Events openId={id} />}
          {page === "detections" && <Detections openId={id} />}
          {page === "rules" && <Rules openId={id} />}
          {page === "vulnerabilities" && <Vulnerabilities openId={id} />}
          {page === "pipeline" && <Pipeline />}
        </div>
      </SidebarInset>
    </>
  )
}
