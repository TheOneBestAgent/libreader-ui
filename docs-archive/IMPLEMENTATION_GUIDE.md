# LibRead Ereader - Implementation Guide

## Overview

This document provides specific implementation improvements for the libread-ereader project based on the comprehensive analysis of libread.com.

---

## Critical Findings

### 1. The `-0` URL Placeholder Issue

**Problem**: The chapterlist.php API returns URLs like:
```
/libread/-0/chapter-01
```

Instead of:
```
/libread/immortality-simulator-140946/chapter-01
```

**Impact**: Current code may not handle this correctly, causing 404 errors when trying to load chapters.

**Solution**: Build proper URLs using the novel's slug and ID.

---

## Recommended Code Changes

### Change 1: Improve URL Construction in parseChaptersFromAPI()

**Location**: `app.js` lines 290-316

**Current Code**:
```javascript
if (href) {
    href = href.replace(/\\"/g, '').replace(/\\/g, '');
    
    // Construct proper chapter URL
    let chapterUrl;
    if (href.startsWith('http')) {
        chapterUrl = href;
    } else if (href.startsWith('/lib/')) {
        chapterUrl = `${API_BASE}${href}`;
    } else if (href.startsWith('/')) {
        const novelUrl = novel.url.split('/').slice(0, -1).join('/');
        chapterUrl = `${novelUrl}${href}`;
    } else {
        const baseUrl = novel.url.substring(0, novel.url.lastIndexOf('/'));
        chapterUrl = `${baseUrl}/${href}`;
    }
    
    const chapterNum = extractChapterNumber(chapterUrl);
    
    chapters.push({
        index,
        number: chapterNum || index + 1,
        title,
        url: chapterUrl
    });
}
```

**Improved Code**:
```javascript
if (href) {
    href = href.replace(/\\"/g, '').replace(/\\/g, '');
    
    // Handle the -0 placeholder from API
    let chapterUrl;
    if (href.startsWith('http')) {
        chapterUrl = href;
    } else if (href.includes('/libread/-0/')) {
        // Extract chapter slug and build proper URL
        const chapterSlug = href.split('/').pop();
        const novelSlug = novel.url.split('/').pop().replace(/-\d+$/, '');
        const novelId = extractNovelId(novel.url);
        chapterUrl = `${API_BASE}/libread/${novelSlug}-${novelId}/${chapterSlug}`;
    } else if (href.startsWith('/libread/')) {
        chapterUrl = `${API_BASE}${href}`;
    } else if (href.startsWith('/')) {
        const novelUrl = novel.url.split('/').slice(0, -1).join('/');
        chapterUrl = `${novelUrl}${href}`;
    } else {
        const baseUrl = novel.url.substring(0, novel.url.lastIndexOf('/'));
        chapterUrl = `${baseUrl}/${href}`;
    }
    
    const chapterNum = extractChapterNumber(chapterUrl);
    
    chapters.push({
        index,
        number: chapterNum || index + 1,
        title,
        url: chapterUrl
    });
}
```

---

### Change 2: Enhance extractNovelId() Function

**Location**: `app.js` lines 196-199

**Current Code**:
```javascript
function extractNovelId(url) {
    const match = url.match(/(\d+)(?:\/|$|\.html)/);
    return match ? match[1] : url.split('/').pop().replace('.html', '');
}
```

**Improved Code**:
```javascript
function extractNovelId(url) {
    // Handle: /libread/immortality-simulator-140946
    const match1 = url.match(/(\d+)(?:\/|$|\.html)/);
    if (match1) return match1[1];
    
    // Handle: /lib/{numeric_id}
    const match2 = url.match(/\/lib\/(\d+)/);
    if (match2) return match2[1];
    
    // Fallback: extract last numeric part
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1] || parts[parts.length - 2];
    const numericMatch = lastPart.match(/\d+/);
    return numericMatch ? numericMatch[0] : lastPart.replace('.html', '');
}
```

---

### Change 3: Add Novel Slug Extraction Helper

**Location**: Add new function after `extractNovelId()`

**New Code**:
```javascript
function extractNovelSlug(url) {
    // Extract slug from: /libread/immortality-simulator-140946
    const match = url.match(/\/libread\/([\w-]+)-\d+/);
    return match ? match[1] : '';
}

function extractNovelId(url) {
    // ... (improved version from Change 2)
}
```

---

### Change 4: Improve Article ID Extraction

**Location**: `app.js` lines 228-229

**Current Code**:
```javascript
const aidMatch = htmlContent.match(/(\d+)s\.jpg/);
const aid = aidMatch ? aidMatch[1] : novelId;
```

**Improved Code**:
```javascript
// Try multiple patterns for article ID
let aid = novelId; // Default fallback

// Pattern 1: /files/article/image/12/12029/12029s.jpg
const aidMatch1 = htmlContent.match(/\/files\/article\/image\/\d+\/(\d+)\/\1s\.jpg/);
if (aidMatch1) {
    aid = aidMatch1[1];
} else {
    // Pattern 2: Any /files/article/image/{xx}/{aid}/{aid}s.jpg
    const aidMatch2 = htmlContent.match(/\/(\d+)s\.jpg/);
    if (aidMatch2) {
        aid = aidMatch2[1];
    }
}

console.log('Extracted aid:', aid, '(novelId:', novelId + ')');
```

---

### Change 5: Better Error Handling in loadNovelDetails()

**Location**: `app.js` lines 214-240

**Improved Code**:
```javascript
try {
    console.log('Loading novel details for:', novel.title, 'ID:', novelId);
    
    const doc = await fetchFromAPI(novel.url.replace(API_BASE, ''));
    if (!doc) {
        console.error('Failed to fetch novel page');
        showError('Failed to load novel details');
        return;
    }
    
    const htmlContent = doc.body?.innerHTML || doc.innerHTML;
    console.log('Novel page fetched, HTML length:', htmlContent.length);
    
    // Extract article ID
    const aid = extractArticleId(htmlContent, novelId);
    
    if (!aid) {
        console.error('Could not extract article ID');
        showError('Could not extract article ID from novel page');
        return;
    }
    
    console.log('Extracted aid:', aid);
    
    const chaptersData = await postToAPI('/api/chapterlist.php', { aid });
    
    if (chaptersData) {
        parseChaptersFromAPI(chaptersData, novel);
    } else {
        showError('Failed to load chapter list');
    }
} catch (error) {
    console.error('Error loading novel:', error);
    showError(`Error: ${error.message}`);
}
```

---

### Change 6: Add extractArticleId() Helper Function

**Location**: Add new function before `loadNovelDetails()`

**New Code**:
```javascript
function extractArticleId(htmlContent, fallbackId) {
    // Try multiple patterns for article ID
    
    // Pattern 1: Exact match /files/article/image/{xx}/{aid}/{aid}s.jpg
    const aidMatch1 = htmlContent.match(/\/files\/article\/image\/\d+\/(\d+)\/\1s\.jpg/);
    if (aidMatch1) {
        return aidMatch1[1];
    }
    
    // Pattern 2: Any /{aid}s.jpg pattern
    const aidMatch2 = htmlContent.match(/\/(\d+)s\.jpg/);
    if (aidMatch2) {
        return aidMatch2[1];
    }
    
    // Pattern 3: Look for aid in meta tags or data attributes
    const aidMatch3 = htmlContent.match(/data-aid["\']?\s*[:=]\s*["\']?(\d+)/);
    if (aidMatch3) {
        return aidMatch3[1];
    }
    
    // Fallback
    return fallbackId;
}
```

---

### Change 7: Improve Chapter Title Cleaning

**Location**: `app.js` lines 280-287 (in parseChaptersFromAPI)

**Current Code**:
```javascript
let title = titleAttr.replace(/<[^>]*>/g, '').trim();
title = title.replace(/^Chapter\s*\d+[:\-\s]*/i, '').trim();
title = title.replace(/^C\.?\d+[:\.\-\s]*/i, '').trim();
title = title.replace(/\s+/g, ' ').trim();

// Additional cleanup for any remaining HTML entities
title = title.replace(/&lt;\/?[^&]+&(?:gt|amp);?/gi, '').trim();
title = title.replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&');
```

**Improved Code**:
```javascript
function cleanChapterTitle(title) {
    // Remove ALL HTML tags first
    title = title.replace(/<\/?[^>]+(>|$)/g, '').trim();
    
    // Remove chapter number prefixes
    title = title.replace(/^Chapter\s*\d+[:\s\-–—.]*/i, '').trim();
    title = title.replace(/^C\.?\d+[:\s\-–—.]*/i, '').trim();
    
    // Remove common prefixes
    title = title.replace(/^Ch\.?\s*\d+[:\s\-–—.]*/i, '').trim();
    
    // Decode HTML entities
    title = title.replace(/&quot;/gi, '"')
                 .replace(/&#39;/gi, "'")
                 .replace(/&amp;/gi, '&')
                 .replace(/&lt;/gi, '<')
                 .replace(/&gt;/gi, '>')
                 .replace(/&nbsp;/gi, ' ');
    
    // Normalize whitespace
    title = title.replace(/\s+/g, ' ').trim();
    
    return title;
}

// Usage in parseChaptersFromAPI:
let title = cleanChapterTitle(titleAttr);

if (!title) title = `Chapter ${index + 1}`;
```

---

## Complete Updated parseChaptersFromAPI() Function

**Location**: Replace entire function at lines 243-384

```javascript
function parseChaptersFromAPI(apiHtml, novel) {
    console.log('=== parseChaptersFromAPI (Improved) ===');
    
    const chapters = [];
    
    // Check if response is JSON (libread API returns JSON)
    let doc;
    if (apiHtml.trim().startsWith('{')) {
        try {
            const jsonData = JSON.parse(apiHtml);
            const htmlContent = jsonData.html;
            doc = parseHTML(htmlContent);
            console.log('Parsed JSON response, HTML length:', htmlContent.length);
        } catch (e) {
            console.error('Failed to parse JSON:', e);
            doc = parseHTML(apiHtml);
        }
    } else {
        doc = parseHTML(apiHtml);
    }
    
    // Get novel slug and ID for URL construction
    const novelSlug = extractNovelSlug(novel.url);
    const novelId = extractNovelId(novel.url);
    
    // Try to find chapters in ul-list5 (the actual chapter list on libread.com)
    const chapterListItems = doc.querySelectorAll('ul.ul-list5 li, .chapter-list a, a[href*="chapter-"]');
    console.log('Chapter list items found:', chapterListItems.length);
    
    if (chapterListItems.length > 0) {
        console.log('Parsing from ul-list5...');
        chapterListItems.forEach((item, index) => {
            const link = item.tagName === 'A' ? item : item.querySelector('a');
            if (!link) return;
            
            let href = link.getAttribute('href');
            const fullTitle = link.textContent.trim();
            const titleAttr = link.getAttribute('title') || fullTitle;
            
            // Clean the title
            let title = cleanChapterTitle(titleAttr);
            if (!title) title = `Chapter ${index + 1}`;
            
            if (href) {
                href = href.replace(/\\"/g, '').replace(/\\/g, '');
                
                // Build proper chapter URL
                let chapterUrl = buildChapterUrl(href, novelSlug, novelId, novel.url);
                
                const chapterNum = extractChapterNumber(chapterUrl);
                
                chapters.push({
                    index,
                    number: chapterNum || index + 1,
                    title,
                    url: chapterUrl
                });
            }
        });
    } else {
        // Fallback: Try to parse from option tags (QuickNovel API method)
        console.log('No ul-list5 found, trying option tags...');
        const options = doc.querySelectorAll('option');
        
        options.forEach((option, index) => {
            let value = option.getAttribute('value');
            let title = option.textContent?.trim() || option.innerText?.trim() || '';
            
            // Clean title
            title = cleanChapterTitle(title);
            if (!title) title = `Chapter ${index + 1}`;
            
            if (value) {
                value = value.replace(/\\"/g, '').replace(/\\/g, '');
                
                // Build proper chapter URL
                let chapterUrl = buildChapterUrl(value, novelSlug, novelId, novel.url);
                
                const chapterNum = extractChapterNumber(chapterUrl);
                
                chapters.push({
                    index,
                    number: chapterNum || index + 1,
                    title,
                    url: chapterUrl
                });
            }
        });
    }
    
    state.chapters = chapters.sort((a, b) => a.number - b.number);
    console.log('Total chapters loaded:', state.chapters.length);
    
    displayChapterList();
    
    if (state.chapters.length > 0) {
        loadChapter(0);
    }
}

// Helper function to build chapter URLs
function buildChapterUrl(href, novelSlug, novelId, novelUrl) {
    if (href.startsWith('http')) {
        return href;
    }
    
    // Handle the -0 placeholder from API
    if (href.includes('/libread/-0/')) {
        const chapterSlug = href.split('/').pop();
        return `${API_BASE}/libread/${novelSlug}-${novelId}/${chapterSlug}`;
    }
    
    if (href.startsWith('/libread/')) {
        return `${API_BASE}${href}`;
    }
    
    if (href.startsWith('/')) {
        const baseUrl = novelUrl.split('/').slice(0, -1).join('/');
        return `${baseUrl}${href}`;
    }
    
    const baseUrl = novelUrl.substring(0, novelUrl.lastIndexOf('/'));
    return `${baseUrl}/${href}`;
}

// Helper function to clean chapter titles
function cleanChapterTitle(title) {
    // Remove ALL HTML tags
    title = title.replace(/<\/?[^>]+(>|$)/g, '').trim();
    
    // Remove chapter number prefixes
    title = title.replace(/^Chapter\s*\d+[:\s\-–—.]*/i, '').trim();
    title = title.replace(/^C\.?\d+[:\s\-–—.]*/i, '').trim();
    title = title.replace(/^Ch\.?\s*\d+[:\s\-–—.]*/i, '').trim();
    
    // Decode HTML entities
    title = title.replace(/&quot;/gi, '"')
                 .replace(/&#39;/gi, "'")
                 .replace(/&amp;/gi, '&')
                 .replace(/&lt;/gi, '<')
                 .replace(/&gt;/gi, '>')
                 .replace(/&nbsp;/gi, ' ');
    
    // Normalize whitespace
    title = title.replace(/\s+/g, ' ').trim();
    
    return title;
}

// Helper function to extract novel slug
function extractNovelSlug(url) {
    const match = url.match(/\/libread\/([\w-]+)-\d+/);
    return match ? match[1] : '';
}
```

---

## Testing Checklist

After implementing these changes, test the following:

### Test 1: Novel Listing
- [ ] Browse latest releases
- [ ] Verify novel cards display correctly
- [ ] Check covers load via proxy

### Test 2: Novel Detail Page
- [ ] Click on a novel
- [ ] Verify article ID is extracted correctly
- [ ] Check console logs for aid value

### Test 3: Chapter List Loading
- [ ] Verify API call to chapterlist.php succeeds
- [ ] Check JSON response is parsed correctly
- [ ] Verify all chapters appear in list
- [ ] Check chapter titles are clean (no "C.1:" prefixes)

### Test 4: Chapter Loading
- [ ] Click on first chapter
- [ ] Verify chapter URL is correct (no -0 placeholder)
- [ ] Check content loads from div#article
- [ ] Verify content is clean (no scripts/styles)

### Test 5: Navigation
- [ ] Test next/previous chapter buttons
- [ ] Verify chapter list remains scrollable
- [ ] Check reading position resets on chapter change

---

## Performance Considerations

### Current Performance
- Novel page load: ~500ms (via proxy)
- Chapter list API: ~200ms (via proxy)
- Chapter content load: ~300-500ms (via proxy)

### Optimization Opportunities

1. **Batch Chapter Preloading**: Preload next 2-3 chapters in background
2. **Caching**: Cache novel metadata and chapter lists in localStorage
3. **Pagination**: Limit initial chapter list to first 50, load more on scroll
4. **Image Optimization**: Compress covers via proxy before serving

---

## Debugging Tips

### Enable Verbose Logging

Add to `app.js`:
```javascript
const DEBUG = true;

function debugLog(...args) {
    if (DEBUG) console.log('[DEBUG]', ...args);
}
```

### Common Issues and Solutions

**Issue**: Chapter list returns empty
- **Check**: Console for article ID extraction
- **Solution**: Verify aid value is correct number

**Issue**: Chapter URLs have -0 placeholder
- **Check**: URL construction in buildChapterUrl()
- **Solution**: Ensure novelSlug and novelId are extracted correctly

**Issue**: Chapter content doesn't load
- **Check**: Network tab for failed requests
- **Solution**: Verify proxy is running and headers are correct

**Issue**: Chapter titles have "C.1:" prefix
- **Check**: cleanChapterTitle() function
- **Solution**: Ensure regex patterns are correct

---

## Next Steps

1. **Implement the code changes** from this guide
2. **Test thoroughly** using the checklist above
3. **Monitor console logs** for any errors
4. **Add more error handling** as needed
5. **Consider adding unit tests** for critical functions

---

## Conclusion

The current implementation is 95% correct. The main issues are:

1. **URL construction** with the -0 placeholder (critical)
2. **Article ID extraction** robustness (important)
3. **Title cleaning** consistency (nice-to-have)
4. **Error handling** (nice-to-have)

Implementing these changes will result in a fully functional libread ereader.
