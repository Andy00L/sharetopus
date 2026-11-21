import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT_PX = 768
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`

let mobileQueryList: MediaQueryList | null = null

function getMobileQueryList(): MediaQueryList {
  mobileQueryList ??= window.matchMedia(MOBILE_MEDIA_QUERY)
  return mobileQueryList
}

function subscribeToMobileQuery(onQueryChange: () => void) {
  const queryList = getMobileQueryList()
  queryList.addEventListener("change", onQueryChange)
  return () => queryList.removeEventListener("change", onQueryChange)
}

const readIsMobile = () => getMobileQueryList().matches

const readIsMobileOnServer = () => false

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToMobileQuery,
    readIsMobile,
    readIsMobileOnServer
  )
}
