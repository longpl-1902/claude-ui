export interface DirEntry {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

export interface ReadFs {
  /** utf8; rejects with ENOENT when missing */
  readFile(path: string): Promise<string>
  readdir(path: string): Promise<DirEntry[]>
  exists(path: string): Promise<boolean>
  /** null when missing */
  mtimeMs(path: string): Promise<number | null>
}

export interface WriteFs extends ReadFs {
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** recursive */
  mkdir(path: string): Promise<void>
}

export interface HostEnv {
  home: string
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  appData?: string
}

export interface DisplayFields {
  signedIn: boolean
  email?: string
  org?: string
  missing?: boolean
  unreadable?: boolean
}
