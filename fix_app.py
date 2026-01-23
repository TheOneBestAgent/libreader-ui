#!/usr/bin/env python3
import re

with open('app.js', 'r') as f:
    lines = f.readlines()

fixed_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Fix 1: Replace the broken PROXY_BASE (lines 4-7) with correct version
    if i == 3 and "PROXY_BASE" in line and "localhost" in line:
        fixed_lines.append("const PROXY_BASE = window.location.protocol + '//' + window.location.host + '/api';\n")
        # Skip the next broken lines
        i += 4
        continue
    
    # Fix 2: Force proxy usage in both functions
    if "const useProxy = window.location.hostname === 'localhost';" in line:
        fixed_lines.append("    const useProxy = true;\n")
        i += 1
        continue
    
    # Fix 3: Ensure novel fetch uses proxy
    if "const response = await fetch(novel.url);" in line and i > 190:
        fixed_lines.append("        const response = await fetch(`${PROXY_BASE}/proxy?url=${encodeURIComponent(novel.url)}`);\n")
        i += 1
        continue
    
    fixed_lines.append(line)
    i += 1

with open('app.js', 'w') as f:
    f.writelines(fixed_lines)

print("Fixed successfully")
