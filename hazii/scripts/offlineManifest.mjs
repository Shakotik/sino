// Build-time inventory, never a scan of the server filesystem. Only public
// emitted browser assets belong in an offline course; API/user data do not.
export function offlineManifest() {
  return {
    name: 'sino-offline-manifest',
    generateBundle(_options, bundle) {
      const core = ['/', '/site.webmanifest', '/sino-icon.svg']
      const courses = {}
      for (const output of Object.values(bundle)) {
        const course = output.type === 'chunk' && output.facadeModuleId?.match(/hsk([1-6])Vocabulary\.[jt]s$/u)
        if (course) courses[`hsk-${course[1]}`] = `/${output.fileName}`
        else if (!output.fileName.endsWith('.map')) core.push(`/${output.fileName}`)
      }
      this.emitFile({ type: 'asset', fileName: 'offline-manifest.json', source: JSON.stringify({ core, courses }) })
    },
  }
}
