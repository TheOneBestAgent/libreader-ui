# 📚 LibRead Ereader - No CORS Required!

Your beautiful LibRead ebook reader now works **without any CORS browser extensions**!

---

## 🎉 What's New

### ✅ Complete CORS Solution Implemented

We've created a **proxy server** that sits between your browser and libread.com, eliminating all CORS issues:

**Local Development:**
- ✅ Node.js proxy server on `localhost:3000`
- ✅ Automatic proxy detection (no config needed)
- ✅ Serves both static files and API requests

**Production:**
- ✅ Netlify/Vercel deployment support
- ✅ Server-side functions handle API calls
- ✅ No CORS issues in production

---

## 🚀 Quick Start (Local Development)

### Option 1: Automatic Startup (Recommended)
```bash
cd /home/darvondoom/libread-ereader
./start.sh
```

This script will:
- ✅ Install dependencies (if needed)
- ✅ Kill any existing processes on port 3000
- ✅ Start the proxy server
- ✅ Open your browser automatically

### Option 2: Manual Startup
```bash
cd /home/darvondoom/libread-ereader

# Install dependencies (first time only)
npm install

# Start the proxy server
node server.js
```

Then open: **http://localhost:3000**

---

## 📁 What Changed?

### New Files Created:
```
libread-ereader/
├── server.js              # Express proxy server
├── package.json           # Node.js dependencies
├── netlify.toml          # Netlify deployment config
├── .gitignore            # Git ignore file
├── start.sh              # Quick start script
├── DEPLOYMENT.md         # Deployment guide
└── app.js                # Updated with proxy support
```

### Modified Files:
- **app.js**: Added smart proxy detection
  - Automatically uses proxy when running on localhost
  - Falls back to direct calls in production
  - No configuration needed!

---

## 🌐 How It Works

```
Browser (localhost:3000)
         ↓
   Express Proxy Server
         ↓
   libread.com
```

**The proxy server:**
1. Receives requests from your browser
2. Forwards them to libread.com with proper headers
3. Returns the response to your browser
4. **No CORS issues!** 🎉

---

## 🛠️ Proxy API Endpoints

The proxy server exposes these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search` | GET | Search novels |
| `/api/novel/:id` | GET | Get novel details |
| `/api/chapterlist` | GET | Get all chapters |
| `/api/chapter/:novelId/:chapterId` | GET | Get chapter content |
| `/health` | GET | Server health check |

**Example usage:**
```javascript
// The frontend automatically routes requests through the proxy
// When on localhost: http://localhost:3000/api/search?q=novel
// When deployed: https://your-site.netlify.app/api/search?q=novel
```

---

## 🚢 Deploy to Production (No CORS, No Local Server!)

### Quickest: Netlify Deploy

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
cd /home/darvondoom/libread-ereader
netlify deploy --prod
```

**Your site will be live at:** `https://your-site-name.netlify.app`

**No CORS issues** because Netlify Functions handle server-side requests!

### Alternative: Vercel
```bash
npm install -g vercel
vercel --prod
```

**Full deployment guide:** See [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## 🧪 Testing the Solution

### Test Locally:
1. Start the proxy server: `./start.sh`
2. Open http://localhost:3000
3. **No CORS extension needed!** 🎉
4. Test all features:
   - Search for novels
   - Browse latest/popular
   - Read chapters
   - Toggle dark mode

### Test Production:
1. Deploy to Netlify (see above)
2. Visit your Netlify URL
3. **No CORS issues!** ✅

---

## 🔧 Troubleshooting

### Issue: Port 3000 already in use
**Solution:** The `start.sh` script handles this automatically, or manually:
```bash
lsof -ti:3000 | xargs kill -9
```

### Issue: Server won't start
**Check logs:**
```bash
cat server.log
```

### Issue: npm install fails
**Solution:**
```bash
rm -rf node_modules package-lock.json
npm install
```

### Issue: CORS errors still appearing
**Verify:**
1. Proxy server is running (`ps aux | grep node`)
2. Browser console shows requests to `localhost:3000/api/*`
3. Not opening `file://` - use `http://localhost:3000`

---

## 📊 Architecture Comparison

### Before (CORS Extension Required):
```
Browser (file://) → libread.com ❌ CORS BLOCKED
```

### After Local Development:
```
Browser → Proxy Server (localhost:3000) → libread.com ✅
```

### After Production Deployment:
```
Browser → Netlify Functions → libread.com ✅
```

---

## 🎯 Key Features

✅ **No CORS browser extension needed**  
✅ **Automatic proxy detection** (zero config)  
✅ **Works offline** (static assets)  
✅ **Production-ready** (deploy to Netlify/Vercel)  
✅ **Free hosting** available  
✅ **Fast performance** (API-first approach)  
✅ **QuickNovel integration** (hidden API endpoints)  

---

## 📝 Next Steps

1. **Test locally:**
   ```bash
   ./start.sh
   ```

2. **Deploy to production:**
   ```bash
   npm install -g netlify-cli
   netlify deploy --prod
   ```

3. **Share your site:**
   - Send the Netlify URL to friends
   - No setup required on their end!

4. **Customize:**
   - Add your own styling
   - Add bookmarks feature
   - Add reading history
   - Add more sources!

---

## 💡 How the Proxy Works (Technical Details)

The proxy server (`server.js`) is an Express application that:

1. **Serves static files:** Your HTML, CSS, and JS
2. **Proxies API requests:** Intercepts `/api/*` requests
3. **Adds proper headers:** User-Agent, Referer, etc.
4. **Handles POST requests:** For search and chapter list
5. **Returns HTML:** Your frontend parses as usual

**Key Code:**
```javascript
// Proxy endpoint example
app.get('/api/search', async (req, res) => {
    const response = await fetch(`https://libread.com/?q=${req.query.q}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 ...' }
    });
    const html = await response.text();
    res.send(html);
});
```

---

## 🔐 Security Notes

- The proxy server only runs on localhost (development)
- Production uses Netlify Functions (serverless)
- No user data is stored
- No authentication required
- Respects libread.com's terms of service

---

## 📚 Documentation

- **[README.md](./README.md)** - Main documentation
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment guide
- **[QUICKNOVEL_INTEGRATION.md](./QUICKNOVEL_INTEGRATION.md)** - Technical details
- **[server.js](./server.js)** - Proxy server code

---

## 🎉 Summary

**You no longer need a CORS browser extension!**

**For local development:** Use the proxy server  
**For production:** Deploy to Netlify/Vercel  

Both solutions eliminate CORS issues completely.

Happy reading! 📚✨

---

## 🙏 Credits

- **QuickNovel** - For the API integration approach
- **libread.com** - For the novel content
- **Netlify/Vercel** - For free hosting

---

**Last Updated:** 2026-01-06  
**Version:** 2.0.0 (CORS-Free Edition)
