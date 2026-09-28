// tsdown inlines the version from package.json at build time.
import pkg from '../package.json' with { type: 'json' }

export const VERSION: string = pkg.version
