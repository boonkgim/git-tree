import { describe, expect, it } from 'vitest'
import { allDirPaths, ancestorDirPaths, buildFileTreeRows } from '@shared/filetree'
import type { ChangedFile } from '@shared/types'

function file(path: string): ChangedFile {
  return { path, status: 'modified', insertions: 1, deletions: 1, binary: false }
}

/** `kind:label` per row, indented by depth, which is what the panel draws. */
function shape(rows: ReturnType<typeof buildFileTreeRows>): string[] {
  return rows.map((row) =>
    row.kind === 'dir'
      ? `${'  '.repeat(row.depth)}[${row.label}]${row.collapsed ? ` +${row.fileCount}` : ''}`
      : `${'  '.repeat(row.depth)}${row.name}`
  )
}

describe('buildFileTreeRows', () => {
  it('nests files under their directories, directories first', () => {
    const rows = buildFileTreeRows([
      file('README.md'),
      file('src/main.ts'),
      file('src/util/format.ts'),
      file('package.json')
    ])
    expect(shape(rows)).toEqual([
      '[src]',
      '  [util]',
      '    format.ts',
      '  main.ts',
      'README.md',
      'package.json'
    ])
  })

  it('folds a chain of single-child directories into one row', () => {
    const rows = buildFileTreeRows([file('src/renderer/components/FilesPanel.tsx')])
    expect(shape(rows)).toEqual(['[src/renderer/components]', '  FilesPanel.tsx'])
    expect(rows[0]).toMatchObject({ kind: 'dir', path: 'src/renderer/components', depth: 0 })
  })

  it('stops folding where a directory holds more than the next level', () => {
    const rows = buildFileTreeRows([
      file('src/renderer/App.tsx'),
      file('src/renderer/components/FilesPanel.tsx')
    ])
    expect(shape(rows)).toEqual(['[src/renderer]', '  [components]', '    FilesPanel.tsx', '  App.tsx'])
  })

  it('omits the contents of a collapsed directory and counts them instead', () => {
    const files = [file('src/a.ts'), file('src/deep/b.ts'), file('README.md')]
    const rows = buildFileTreeRows(files, new Set(['src']))
    expect(shape(rows)).toEqual(['[src] +2', 'README.md'])
  })

  it('collapses only the directory named, not one that shares its prefix', () => {
    const rows = buildFileTreeRows([file('src/a.ts'), file('srcx/b.ts')], new Set(['src']))
    expect(shape(rows)).toEqual(['[src] +1', '[srcx]', '  b.ts'])
  })

  it('sorts independently of the order git reported', () => {
    const forward = buildFileTreeRows([file('a/one.ts'), file('a/two.ts'), file('b/three.ts')])
    const reversed = buildFileTreeRows([file('b/three.ts'), file('a/two.ts'), file('a/one.ts')])
    expect(shape(forward)).toEqual(shape(reversed))
  })

  it('keeps the whole file for a rename, so the panel can show both paths', () => {
    const renamed: ChangedFile = {
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
      status: 'renamed',
      score: 98,
      insertions: 0,
      deletions: 0,
      binary: false
    }
    const rows = buildFileTreeRows([renamed])
    expect(rows[1]).toMatchObject({ kind: 'file', name: 'new.ts', file: renamed })
  })

  it('returns nothing for no files', () => {
    expect(buildFileTreeRows([])).toEqual([])
  })
})

describe('allDirPaths', () => {
  it('names every directory, including the ones inside a fold', () => {
    expect(allDirPaths([file('src/renderer/App.tsx'), file('src/main/index.ts')])).toEqual([
      'src',
      'src/main',
      'src/renderer'
    ])
  })
})

describe('ancestorDirPaths', () => {
  it('names the rows that have to be open for a file to be visible', () => {
    const files = [file('src/renderer/App.tsx'), file('src/main/index.ts')]
    expect(ancestorDirPaths(files, 'src/renderer/App.tsx')).toEqual(['src', 'src/renderer'])
  })

  it('uses the folded key rather than every level it stands for', () => {
    const files = [file('src/renderer/components/FilesPanel.tsx')]
    expect(ancestorDirPaths(files, 'src/renderer/components/FilesPanel.tsx')).toEqual([
      'src/renderer/components'
    ])
  })

  it('is empty for a file at the top level', () => {
    expect(ancestorDirPaths([file('README.md')], 'README.md')).toEqual([])
  })
})

describe('ignored directories', () => {
  const ignored = (path: string): ChangedFile => ({
    path,
    status: 'ignored',
    insertions: null,
    deletions: null,
    binary: false
  })

  it('marks a directory whose files are all ignored', () => {
    const rows = buildFileTreeRows([
      ignored('node_modules/react/index.js'),
      ignored('node_modules/react/package.json'),
      file('src/main.ts')
    ])
    const dirs = rows.flatMap((row) => (row.kind === 'dir' ? [[row.label, row.ignored]] : []))
    expect(dirs).toEqual([
      ['node_modules/react', true],
      ['src', false]
    ])
  })

  it('does not mark a directory that holds one tracked file among ignored ones', () => {
    const rows = buildFileTreeRows([ignored('build/out.js'), file('build/keep.ts')])
    const dir = rows.find((row) => row.kind === 'dir')
    expect(dir).toMatchObject({ label: 'build', ignored: false })
  })

  it('marks a folded chain of directories that is ignored throughout', () => {
    const rows = buildFileTreeRows([ignored('a/b/c/x.js')])
    expect(rows[0]).toMatchObject({ kind: 'dir', label: 'a/b/c', ignored: true })
  })
})
