# Notes for branch `lessons-gltf-web-export`

This branch adds glTF web-export and MAXScript lessons to `skills/3dsmax-mcp-dev/SKILL.md`, plus the helper `skills/3dsmax-mcp-dev/gltf_postprocess.mjs`. It also changes `scripts/build_skill.py` so that `*.mjs` files are packaged.

**The installed skill is a copy.** `python scripts/build_skill.py` writes to:

- `~/.claude/skills/3dsmax-mcp-dev/`
- `~/.agents/skills/3dsmax-mcp-dev/`
- `.agents/skills/3dsmax-mcp-dev/`
- `3dsmax-mcp-dev.skill`
- `AGENTS.md`

If you rebuild from a checkout that doesn't contain this branch (for example plain `master` after a pull), the lessons and `gltf_postprocess.mjs` disappear from the installed copy. Rebuild from this branch, or from this branch after rebasing it onto a newer `master`, until the changes are merged upstream.

Note that the build copies files without deleting anything, so an old `gltf_postprocess.mjs` may survive a rebuild from `master` even after SKILL.md has lost its sections.
