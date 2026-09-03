"""Load secrets from the .env files into os.environ.

Two files, both git-ignored:
  <repo>/.env          ANTHROPIC_API_KEY
  <repo>/backend/.env  ACOUSTID_API_KEY

Real environment variables win over the files, so a key set in the shell
is never overwritten. Call load_env() once, before reading any key.
"""

from pathlib import Path

from dotenv import load_dotenv

_BACKEND = Path(__file__).parent
_ENV_FILES = [_BACKEND.parent / ".env", _BACKEND / ".env"]


def load_env():
    for path in _ENV_FILES:
        if path.exists():
            load_dotenv(path, override=False)
