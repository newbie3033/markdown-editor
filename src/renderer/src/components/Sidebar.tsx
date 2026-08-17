import type { FileEntry, SearchFlags } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'
import { fileNameFromPath } from '../lib/markdown'
import { FileTree } from './FileTree'
import { SearchPanel } from './SearchPanel'

export type SidebarTab = 'files' | 'search'

export interface FolderState {
  path: string
  tree: FileEntry[]
}

interface SidebarProps {
  width: number
  onResizeStart: (event: React.MouseEvent, direction: 1 | -1) => void
  onResetWidth: () => void
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  folders: FolderState[]
  openFiles: string[]
  activePath: string | null
  onOpenFile: (path: string) => void
  onOpenFolder: () => void
  onCloseFolder: (path: string) => void
  onCloseFile: (path: string) => void
  onOpenSearchResult: (path: string, matchIndex: number, query: string, flags: SearchFlags) => void
  onSearchError: (error: unknown) => void
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const { t } = useI18n()
  const folderName = (path: string): string => path.split(/[\\/]/).pop() ?? path

  return (
    <aside className="sidebar" style={{ width: props.width }}>
      <div className="sidebar-tabs">
        <button
          className={`tab${props.tab === 'files' ? ' active' : ''}`}
          onClick={() => props.onTabChange('files')}
        >
          {t('tabs.files')}
        </button>
        <button
          className={`tab${props.tab === 'search' ? ' active' : ''}`}
          onClick={() => props.onTabChange('search')}
        >
          {t('tabs.search')}
        </button>
      </div>

      {props.tab === 'files' ? (
        <>
          <div className="sidebar-toolbar">
            <button className="open-folder-btn" onClick={props.onOpenFolder}>
              📂 {t('files.openFolder')}
            </button>
          </div>
          <div className="sidebar-scroll">
            {props.openFiles.length > 0 && (
              <div className="loose-files">
                <div className="section-label">{t('files.openFiles')}</div>
                {props.openFiles.map((path) => (
                  <div
                    key={path}
                    className={`loose-row${props.activePath === path ? ' active' : ''}`}
                    title={path}
                  >
                    <button className="loose-open" onClick={() => props.onOpenFile(path)}>
                      <span className="tree-icon">📄</span>
                      <span className="tree-name">{fileNameFromPath(path)}</span>
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => props.onCloseFile(path)}
                      title={t('files.closeFile')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {props.folders.map((folder) => (
              <div key={folder.path} className="folder-root">
                <div className="folder-header" title={folder.path}>
                  <span className="folder-icon">📂</span>
                  <span className="folder-name">{folderName(folder.path)}</span>
                  <button
                    className="icon-btn"
                    onClick={() => props.onCloseFolder(folder.path)}
                    title={t('files.closeFolder')}
                  >
                    ✕
                  </button>
                </div>
                <FileTree
                  tree={folder.tree}
                  activePath={props.activePath}
                  onOpenFile={props.onOpenFile}
                />
              </div>
            ))}

            {props.openFiles.length === 0 && props.folders.length === 0 && (
              <div className="tree-empty">{t('files.empty')}</div>
            )}
          </div>
        </>
      ) : (
        <SearchPanel
          folderPaths={props.folders.map((f) => f.path)}
          onOpenResult={props.onOpenSearchResult}
          onError={props.onSearchError}
        />
      )}
      <div
        className="resize-handle right"
        onMouseDown={(event) => props.onResizeStart(event, 1)}
        onDoubleClick={props.onResetWidth}
        title={t('status.toggleSidebar')}
      />
    </aside>
  )
}
