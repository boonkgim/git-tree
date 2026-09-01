#!/bin/sh
# Install git-tree for the current user, without root.
#
# The .deb is the conventional Linux install, but it needs a password, so it
# cannot be run unattended (by CI, or by an agent working in this repo). This
# script puts the same pieces under $XDG_DATA_HOME and ~/.local instead:
#
#   ~/.local/lib/git-tree/git-tree      the AppImage, standing in for /opt/git-tree/git-tree
#   ~/.local/lib/git-tree/bin/git-tree  the launcher the package installs, verbatim
#   ~/.local/bin/git-tree               the command, linked to that launcher
#   .../applications/git-tree.desktop   the launcher entry, so it shows up in Show Applications
#   .../icons/hicolor/*/apps/git-tree.png
#
# The layout under lib/ mirrors the package's own, which is what lets the
# launcher find the binary at ../git-tree exactly as it does when installed
# from the .deb.
#
# Usage: scripts/install-user.sh [path/to/AppImage]
# With no argument the newest AppImage in release/ is used.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
data=${XDG_DATA_HOME:-$HOME/.local/share}
lib=$HOME/.local/lib/git-tree
bin=$HOME/.local/bin

appimage=${1:-}
if [ -z "$appimage" ]; then
  appimage=$(ls -t "$root"/release/*.AppImage 2>/dev/null | head -1 || true)
fi
if [ -z "$appimage" ] || [ ! -f "$appimage" ]; then
  echo "install-user: no AppImage found; run 'npm run build:linux' first" >&2
  exit 1
fi

mkdir -p "$lib/bin" "$bin" "$data/applications"

# Written beside the live file and moved into place, so a running copy is never
# rewritten underneath itself.
cp "$appimage" "$lib/git-tree.new"
chmod +x "$lib/git-tree.new"
mv -f "$lib/git-tree.new" "$lib/git-tree"

cp "$root/build/linux/git-tree-launcher" "$lib/bin/git-tree"
chmod +x "$lib/bin/git-tree"
ln -sf "$lib/bin/git-tree" "$bin/git-tree"

for icon in "$root"/build/icons/*.png; do
  size=$(basename "$icon" .png)
  case $size in
    *x*) ;;
    *) continue ;;
  esac
  mkdir -p "$data/icons/hicolor/$size/apps"
  cp "$icon" "$data/icons/hicolor/$size/apps/git-tree.png"
done

# The package's own entry, with Exec pointing into ~/.local rather than /opt.
# The path is spelled out because a desktop session does not necessarily have
# ~/.local/bin on its PATH, even when an interactive shell does. Keep the entry
# in step with the packaged one, which electron-builder generates from the
# linux.desktop block in electron-builder.yml.
cat > "$data/applications/git-tree.desktop" <<DESKTOP
[Desktop Entry]
Name=git-tree
Exec=$lib/bin/git-tree %U
Terminal=false
Type=Application
Icon=git-tree
StartupWMClass=git-tree
Keywords=git;diff;commit;history;repository;
Comment=A view-only desktop viewer for the history and diffs of a local Git repository. Four panels — commit graph, changed files, commit metadata and diff. It never writes to your working tree, index or object store.
Categories=Development;
DESKTOP

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$data/applications" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$data/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "installed $(basename "$appimage") to $lib"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "note: $bin is not on your PATH" >&2 ;;
esac
