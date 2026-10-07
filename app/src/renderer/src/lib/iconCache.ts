// Icons read from the user's computer, asked for once per program.
export const iconCache = new Map<string, string | null>()

/** Drop a cached "no icon" so a freshly remembered icon is picked up. */
export const forgetIcon = (proc: string): void => void iconCache.delete(proc)
