#!/bin/bash

# electron-builder's default after-install script (templates/linux/after-install.tpl),
# with one change: /usr/bin/${executable} is linked to bin/${executable}, the
# wrapper that detaches the GUI from the terminal, rather than to the binary
# itself. Keep the rest in step with upstream when electron-builder is updated.

chmod 0755 '/opt/${sanitizedProductName}/bin/${executable}' || true

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/bin/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/bin/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/bin/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
