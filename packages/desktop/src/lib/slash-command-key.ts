export function buildSlashCommandsKey(cwd: string, provider: string, profile?: string): string {
  return `${provider}::${profile ?? ""}::${cwd}`;
}
