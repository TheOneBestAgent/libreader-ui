# LibRead.com Quick Reference

## One-Page Summary

### URL Patterns
```
Novel Lists:
  /sort/latest-release
  /sort/most-popular
  /genre/{GenreName}

Novel Details:
  /libread/{slug}-{id}
  Example: /libread/immortality-simulator-140946

Chapters:
  /libread/{slug}-{id}/chapter-{number}
  Example: /libread/immortality-simulator-140946/chapter-01
```

### API Endpoint
```
POST https://libread.com/api/chapterlist.php
Body: aid=12029
Response: {"html": "<option>...</option>"}
```

### Article ID Extraction
```javascript
// From image URL: /files/article/image/12/12029/12029s.jpg
const aidMatch = htmlContent.match(/(\d+)s\.jpg/);
const aid = aidMatch ? aidMatch[1] : novelId;
```

### Critical: The `-0` Placeholder
API returns: `/libread/-0/chapter-01`
Must convert to: `/libread/immortality-simulator-140946/chapter-01`

```javascript
if (href.includes('/libread/-0/')) {
    const chapterSlug = href.split('/').pop();
    const novelSlug = extractNovelSlug(novel.url);
    const novelId = extractNovelId(novel.url);
    chapterUrl = `${API_BASE}/libread/${novelSlug}-${novelId}/${chapterSlug}`;
}
```

### HTML Selectors
```javascript
// Novel list
.novel cards: '.ul-list1 .li, .ul-list2 .li, .li-row'
title: 'h3.tit a'
cover: 'div.pic a img'

// Novel page
article ID: '/(\d+)s\.jpg/' in image URLs
metadata: '.m-book1 .txt'

// Chapter content (priority order)
'div#article'
'div.txt'
'.chapter-content'
```

### Data Flow
```
1. Browse → GET /sort/latest-release
2. Parse novel list → Extract: slug + ID
3. Novel page → GET /libread/{slug}-{id}
4. Extract aid → From /files/article/image/.../{aid}/{aid}s.jpg
5. Chapter list → POST /api/chapterlist.php with aid
6. Parse JSON → Extract all <option> tags
7. Fix URLs → Replace -0 with actual slug
8. Load chapter → GET /libread/{slug}-{id}/chapter-{n}
9. Parse content → From <div id="article">
```

### Current Status
✓ Working: Novel listing, proxy, content parsing
⚠ Needs: URL construction fix, better aid extraction

### Main Fix Required
In `parseChaptersFromAPI()`, add `-0` placeholder handling:
```javascript
function buildChapterUrl(href, novelSlug, novelId, novelUrl) {
    if (href.includes('/libread/-0/')) {
        const chapterSlug = href.split('/').pop();
        return `${API_BASE}/libread/${novelSlug}-${novelId}/${chapterSlug}`;
    }
    // ... rest of function
}
```

---

## Files Created
1. `LIBREAD_ANALYSIS.md` - Complete technical analysis
2. `IMPLEMENTATION_GUIDE.md` - Step-by-step implementation steps
3. `QUICK_REFERENCE.md` - This quick reference guide

## Next Actions
1. Apply changes from IMPLEMENTATION_GUIDE.md
2. Test with sample novel: immortality-simulator-140946
3. Verify chapter URLs don't contain -0 placeholder
4. Check console for article ID extraction logs
