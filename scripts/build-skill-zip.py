#!/usr/bin/env python3
"""Build a reproducible zip from the one canonical skill directory."""
from pathlib import Path
import sys
import zipfile
from io import BytesIO
root = Path(__file__).resolve().parent.parent
skill = root / 'skills' / 'gismap'
out = root / 'skills' / 'gismap.zip'
buffer = BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(skill.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts or path.suffix == '.pyc': continue
        info = zipfile.ZipInfo('gismap/' + path.relative_to(skill).as_posix(), (2020, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
data = buffer.getvalue()
if '--check' in sys.argv:
    if not out.exists() or out.read_bytes() != data:
        print('Skill ZIP is missing or out of date', file=sys.stderr); sys.exit(1)
    print('Skill ZIP verified')
else:
    out.write_bytes(data)
    print('Built', out)
