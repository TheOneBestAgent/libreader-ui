# Netlify Deployment Guide

## Deploy Your LibRead Ereader to Netlify (Free & No CORS Issues!)

### Why Deploy to Netlify?
- **Free hosting** with SSL certificates
- **No CORS issues** in production (server-side routing)
- **Global CDN** for fast loading worldwide
- **Automatic deploys** from Git
- **Custom domains** supported

---

## Quick Deploy (5 Minutes)

### Step 1: Create GitHub Repository
```bash
cd /home/darvondoom/libread-ereader

# Initialize git (if not already done)
git init

# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.DS_Store
npm-debug.log
EOF

# Commit all files
git add .
git commit -m "Initial commit: LibRead Ereader with proxy server"

# Create repository on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/libread-ereader.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy to Netlify

**Option A: Via CLI (Recommended)**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod

# Follow the prompts to create a new site
```

**Option B: Via Netlify Dashboard**
1. Go to [app.netlify.com](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect to GitHub
4. Select your `libread-ereader` repository
5. **Important**: Keep build settings empty (we're using a static site)
6. Click "Deploy site"

### Step 3: Configure Site Settings

After deployment:

1. **Go to Site Settings** → **Functions**
2. Set **Node Version** to `16`
3. Save changes

### Step 4: Test Your Site!

Visit your new URL: `https://your-site-name.netlify.app`

---

## Alternative: Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

---

## Alternative: Deploy to GitHub Pages

### Step 1: Update `app.js` for GitHub Pages

Replace the proxy detection logic:

```javascript
// In app.js, find the PROXY_BASE definition and replace with:
const PROXY_BASE = window.location.hostname.includes('github.io')
    ? 'https://your-proxy-server.com/api'  // You'll need an external proxy
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api'
        : '/api');
```

### Step 2: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under **Source**, select `main` branch
4. Click **Save**
5. Visit `https://YOUR_USERNAME.github.io/libread-ereader`

**Note**: GitHub Pages doesn't support server-side code, so you'll need an external proxy service.

---

## Environment Variables (Optional)

If you want to configure the API base URL dynamically:

### On Netlify:
1. Go to **Site Settings** → **Environment variables**
2. Add variable: `API_BASE_URL` = `https://libread.com`
3. Add variable: `PROXY_ENABLED` = `true`

### Update `app.js` to use environment variables:

```javascript
const PROXY_BASE = process.env.API_BASE_URL || 
    (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');
```

---

## Custom Domain Setup

### On Netlify:
1. Go to **Domain Settings**
2. Click **Add custom domain**
3. Enter your domain (e.g., `reader.yourdomain.com`)
4. Update DNS records as instructed by Netlify

### Free Domain Options:
- [Freenom](https://www.freenom.com) - Free .tk, .ml, .ga domains
- [EU.org](https://nic.eu.org) - Free domains (requires approval)

---

## Troubleshooting

### Issue: "Function not found" error
**Solution**: Make sure `server.js` is committed to Git and `netlify.toml` is properly configured.

### Issue: CORS errors still occurring
**Solution**: Check that:
- Proxy server is running (check Netlify Functions logs)
- `PROXY_BASE` is correctly detecting the hostname
- API routes are properly mapped in `netlify.toml`

### Issue: Images not loading
**Solution**: LibRead images may have hotlink protection. Consider:
- Using a different image CDN
- Implementing image proxy in `server.js`
- Using placeholder images

### Issue: Deploy failed
**Solution**: Check Netlify deploy logs for specific errors. Common issues:
- Missing `package.json` dependencies
- Node version mismatch
- File size limits (Netlify Functions have limits)

---

## Performance Optimization

### Enable Caching
Add to `netlify.toml`:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/api/*"
  [headers.values]
    Cache-Control = "public, max-age=3600"
```

### Enable Compression
Netlify automatically gzips all files.

### CDN Distribution
Netlify automatically distributes your site globally via their CDN.

---

## Monitoring & Analytics

### Netlify Analytics (Paid)
Go to **Site Settings** → **Analytics** → Enable

### Free Alternatives:
- **Google Analytics** - Add to `index.html` `<head>`
- **Plausible** - Privacy-friendly analytics
- **Umami** - Self-hosted analytics

---

## Updates & Maintenance

### Updating Your Site
```bash
# Make changes to code
git add .
git commit -m "Update: description of changes"
git push

# Netlify auto-deploys on push!
```

### Rollback
If something breaks:
1. Go to Netlify **Deploys** tab
2. Find the last working deploy
3. Click **Publish deploy**

---

## Cost Summary

| Platform | Cost | Features |
|----------|------|----------|
| **Netlify** | **FREE** | 100GB bandwidth/month, 300 min build time |
| **Vercel** | **FREE** | 100GB bandwidth/month, unlimited sites |
| **GitHub Pages** | **FREE** | 1GB storage, 100GB bandwidth/month |
| **Railway** | $5/mo | Full Node.js server support |
| **Heroku** | $5/mo | Full app hosting |

---

## Security Considerations

1. **API Rate Limiting**: LibRead may rate-limit requests. Consider:
   - Implementing caching
   - Adding request delays
   - Using multiple proxy servers

2. **Content Scraping**: Respect libread.com's terms of service

3. **User Data**: No user accounts = no GDPR concerns!

---

## Next Steps

1. ✅ Deploy to Netlify
2. ✅ Test all features
3. ✅ Share your site!
4. ✅ Consider adding features like:
   - Bookmarks
   - Reading history
   - Dark mode toggle (already implemented!)
   - Font family options

---

## Support

If you encounter issues:
- Check Netlify [deploy logs](https://app.netlify.com/sites/your-site/deploys)
- Review [Netlify Functions docs](https://docs.netlify.com/functions/)
- Join [Netlify Community](https://community.netlify.com/)

Happy reading! 📚✨
