/** Display the primary modifier by its platform-specific name. */
export function formatShortcut(text: string, platform = window.api.platform): string {
  const modifier = platform === 'darwin' ? 'Command' : 'Ctrl'
  return text.replace(/\b(?:CommandOrControl|CmdOrCtrl|Control|Ctrl)(?=\+)/g, modifier)
}
