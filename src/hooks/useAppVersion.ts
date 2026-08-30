// Build metadata injected at build time by vite.config.ts's `define`, sourced from
// Vercel's env vars — see that file for how each value is derived.
export interface AppVersion {
  build: string
  commit: string
  shortCommit: string
  branch: string
  env: string
  builtAt: Date
  isLocal: boolean
}

export function useAppVersion(): AppVersion {
  return {
    build: __APP_BUILD__,
    commit: __APP_COMMIT__,
    shortCommit: __APP_COMMIT__ ? __APP_COMMIT__.slice(0, 7) : 'local',
    branch: __APP_BRANCH__,
    env: __APP_ENV__,
    builtAt: new Date(__APP_BUILT_AT__),
    isLocal: !__APP_COMMIT__,
  }
}
