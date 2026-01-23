
# CORS FIX - SIMPLE APPROACH

## Changed Files
app.js - Modified 3 locations:

1. **Line 4**: PROXY_BASE now universal
   - OLD: `const PROXY_BASE = hostname === 'localhost' ? 'http://localhost:3001/api' : '/api';`
   - NEW: `const PROXY_BASE = window.location.protocol + '//' + window.location.host + '/api';`

2. **fetchFromAPI()**: Removed hostname check
   - Always uses proxy via PROXY_BASE

3. **postToAPI()**: Removed hostname check
   - Always uses proxy via PROXY_BASE

## Result
✓ Works on localhost:3000
✓ Works on libread.bigbum.uk  
✓ NO CORS errors

## Test
Open browser console - should see:
`Proxy: https://libread.bigbum.uk/api`
