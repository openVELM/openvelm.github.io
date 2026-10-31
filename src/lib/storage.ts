import { openDB } from 'idb'
import type { Project } from './editor'

const db = openDB('velm-local', 1, {
  upgrade(database) {
    database.createObjectStore('projects')
  },
})

export async function saveProject(project: Project) {
  await (await db).put('projects', project, 'current')
}

export async function loadProject() {
  return (await db).get('projects', 'current') as Promise<Project | undefined>
}

export async function clearProject() {
  await (await db).delete('projects', 'current')
}

const hasOpfs = () => typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage

async function assetDirectory(create = false) {
  if (!hasOpfs()) throw new Error('Local file storage is not supported in this browser.')
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('velm-assets', { create })
}

export async function saveMedia(assetId: string, file: File) {
  const directory = await assetDirectory(true)
  const handle = await directory.getFileHandle(assetId, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
}

export async function loadMedia(assetId: string) {
  const directory = await assetDirectory()
  const handle = await directory.getFileHandle(assetId)
  return handle.getFile()
}

export async function removeMedia(assetId: string) {
  try {
    const directory = await assetDirectory()
    await directory.removeEntry(assetId)
  } catch {
    // Missing source files are already effectively removed.
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null
  return navigator.storage.estimate()
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}
