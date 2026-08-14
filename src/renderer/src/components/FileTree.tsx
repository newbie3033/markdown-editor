import { useState } from 'react'
import type { FileEntry } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'

interface FileTreeProps {
  tree: FileEntry[]
  activePath: string | null
  onOpenFile: (path: string) => void
}

function TreeItem({
  entry,
  activePath,
  onOpenFile,
  depth
}: {
  entry: FileEntry
  activePath: string | null
  onOpenFile: (path: string) => void
  depth: number
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)

  if (entry.type === 'directory') {
    return (
      <div>
        <button
          className="tree-row tree-dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setExpanded((v) => !v)}
          title={entry.path}
        >
          <span className="tree-chevron">{expanded ? '▾' : '▸'}</span>
          <span className="tree-icon">📁</span>
          <span className="tree-name">{entry.name}</span>
        </button>
        {expanded && entry.children && (
          <div>
            {entry.children.map((child) => (
              <TreeItem
                key={child.path}
                entry={child}
                activePath={activePath}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const active = activePath === entry.path
  return (
    <button
      className={`tree-row tree-file${active ? ' active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 + 14 }}
      onClick={() => onOpenFile(entry.path)}
      title={entry.path}
    >
      <span className="tree-icon">📄</span>
      <span className="tree-name">{entry.name}</span>
    </button>
  )
}

export function FileTree({ tree, activePath, onOpenFile }: FileTreeProps): React.JSX.Element {
  const { t } = useI18n()
  if (tree.length === 0) {
    return <div className="tree-empty">{t('files.noMarkdown')}</div>
  }
  return (
    <div className="tree">
      {tree.map((entry) => (
        <TreeItem key={entry.path} entry={entry} activePath={activePath} onOpenFile={onOpenFile} depth={0} />
      ))}
    </div>
  )
}
