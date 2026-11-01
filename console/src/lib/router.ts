import { useEffect, useState } from "react"

export type Page = "overview" | "alerts" | "events" | "detections" | "vulnerabilities" | "pipeline"
export const PAGES: Page[] = ["overview", "alerts", "events", "detections", "vulnerabilities", "pipeline"]

/** Hash routes: #/alerts or #/alerts/<id> to open one item. */
export function parseHash(hash: string): { page: Page; id?: string } {
  const [page, ...rest] = hash.replace(/^#\/?/, "").split("/")
  return {
    page: PAGES.includes(page as Page) ? (page as Page) : "overview",
    id: rest.length ? decodeURIComponent(rest.join("/")) : undefined,
  }
}

export function href(page: Page, id?: string) {
  return `#/${page}${id ? `/${encodeURIComponent(id)}` : ""}`
}

export function navigate(page: Page, id?: string) {
  window.location.hash = href(page, id)
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash))
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return route
}
