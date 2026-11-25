# Makes node reachable from hooks run outside a login shell.
#
# GUI git clients — VS Code, JetBrains, Tower, Fork — do not inherit the PATH your terminal
# has, so `npx` is simply missing and every hook dies with "command not found (code 127)".
# The same hook works fine from the terminal, which is what makes this confusing to diagnose.
#
# Prepend the usual install locations, then honour a version manager if one is present.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

# nvm and fnm install node outside those directories, so ask them where it is.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" --no-use >/dev/null 2>&1 && nvm use --silent default >/dev/null 2>&1
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)" >/dev/null 2>&1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "husky: npx is not on PATH."
  echo "  Your git client is not running with node available."
  echo "  PATH was: $PATH"
  echo "  Commit from a terminal, or add your node bin directory to .husky/_/path.sh"
  exit 127
fi
