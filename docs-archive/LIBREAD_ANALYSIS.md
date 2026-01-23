# LibRead.com Analysis - Complete Data Retrieval Flow

## Executive Summary

This document provides a comprehensive analysis of how libread.com retrieves and displays chapter data, including all API endpoints, HTML structure patterns, and implementation details needed for the libread-ereader project.

---

## 1. Site Architecture Overview

### Base URL
- **Primary Domain**: `https://libread.com`
- **Static Assets**: `/static/libread/`
- **Cover Images**: `/files/article/image/{path}/{id}/{id}s.jpg`

### URL Patterns

#### Novel List Pages
```
/sort/latest-release              - Latest releases
/sort/latest-novels               - Latest novels
/sort/most-popular                - Most popular
/sort/completed-novels            - Completed novels
/genre/{GenreName}                - By genre
```

#### Novel Detail Pages
```
/libread/{slug}-{id}              - Novel main page
Example: /libread/immortality-simulator-140946
```

#### Chapter Pages
```
/libread/{slug}-{id}/chapter-{number}
Example: /libread/immortality-simulator-140946/chapter-01
```

---

## 2. Data Retrieval Flow

### Step 1: Browse/Discover Novels

**Endpoint**: GET `/sort/latest-release` (or any list page)

**HTML Structure**:
```html
<div class="ul-list1">
  <div class="li-row">
    <div class="li">
      <div class="pic">
        <a href="/libread/immortality-simulator-140946">
          <img src="/files/article/image/12/12029/12029s.jpg">
        </a>
      </div>
      <div class="txt">
        <h3 class="tit">
          <a href="/libread/immortality-simulator-140946" title="Novel Title">
            Novel Title
          </a>
        </h3>
        <div class="desc">
          <!-- Genre, rating, chapter count -->
        </div>
      </div>
    </div>
  </div>
</div>
```

**Key Selectors**:
- Novel cards: `.ul-list1 .li, .ul-list2 .li, .li-row`
- Title link: `h3.tit a, .tit a`
- Cover image: `div.pic a img`
- Novel URL: Extracted from `href` attribute

**Extract Novel ID**:
```javascript
// From URL: /libread/immortality-simulator-140946
const match = url.match(/(\d+)(?:\/|$|\.html)/);
// Returns: "140946"
```

---

### Step 2: Fetch Novel Detail Page

**Endpoint**: GET `/libread/{slug}-{id}`

**Key Data Points**:

1. **Article ID (aid)** - Found in image URL pattern:
```html
<img src="/files/article/image/12/12029/12029s.jpg">
<!-- Pattern: /files/article/image/{xx}/{aid}/{aid}s.jpg -->
```

Extraction:
```javascript
const aidMatch = htmlContent.match(/(\d+)s\.jpg/);
const aid = aidMatch ? aidMatch[1] : novelId;
```

2. **Novel Metadata**:
```html
<div class="m-book1">
  <div class="txt">
    <div class="item">
      <span>Alternative names</span>
      <div class="right"><span>...</span></div>
    </div>
    <div class="item">
      <span>Author</span>
      <div class="right"><a href="/author/...">Author Name</a></div>
    </div>
    <div class="item">
      <span>Genre</span>
      <div class="right">
        <a href="/genre/Action">Action</a>, <a href="/genre/Adventure">Adventure</a>
      </div>
    </div>
  </div>
</div>
```

---

### Step 3: Fetch Chapter List via API

**Endpoint**: POST `https://libread.com/api/chapterlist.php`

**Request Headers**:
```
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
Referer: https://libread.com/
Origin: https://libread.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
```

**Request Body**:
```
aid=12029
```

**Response Format**: JSON with HTML content
```json
{
  "html": "<option value=\"/libread/-0/chapter-01\">C.1: Chapter Title</option><option value=\"...\">...</option>"
}
```

**Response Structure**:
- Returns HTML `<option>` tags
- Each option contains:
  - `value`: Relative URL to chapter (e.g., `/libread/-0/chapter-01`)
  - Text content: Chapter number and title (e.g., "C.1: Where Do Immortals Come From?")

**Parsing the Response**:
```javascript
// The API returns JSON
const jsonData = JSON.parse(apiHtml);
const htmlContent = jsonData.html;

// Parse the HTML to extract options
const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
const options = doc.querySelectorAll('option');

options.forEach((option, index) => {
  const value = option.getAttribute('value');  // /libread/-0/chapter-01
  const title = option.textContent;             // C.1: Where Do Immortals Come From?
  
  // Clean title
  title = title.replace(/^C\.?\d+[:\.\-\s]*/i, '').trim();
  // Result: "Where Do Immortals Come From?"
  
  // Build full URL
  const chapterUrl = `https://libread.com${value}`;
});
```

**Important Notes**:
- The API returns `/libread/-0/chapter-{number}` (note the `-0` instead of novel slug)
- These URLs still work and redirect to the actual chapter pages
- Chapter titles are prefixed with "C.{number}:" format
- Response contains ALL chapters in one call (up to 120+ chapters seen)

---

### Step 4: Fetch Chapter Content

**Endpoint**: GET `/libread/{slug}-{id}/chapter-{number}`

**HTML Structure**:
```html
<div class="txt" style="font-family:;font-size:18px;line-height:1.6;">
  <div id="article">
    <h4>Chapter 1: Where Do Immortals Come From?</h4>
    <p><i>Great Xuan, Xuanjing, the Grand Preceptor's estate.</i></p>
    <p>Li Fan held a wine cup, surveying the hall...</p>
    <p>Nearly all the high-ranking ministers...</p>
    <!-- More paragraphs -->
  </div>
</div>
```

**Key Selectors**:
- Primary: `div#article`
- Fallback: `div.txt`
- Other selectors: `.chapter-content`, `#chapter-content`, `.novel-content`

**Content Extraction**:
```javascript
const contentElement = doc.querySelector('div#article, div.txt, .chapter-content');
let content = contentElement.innerHTML;

// Clean up content
content = content.replace(/<script[^>]*>.*?<\/script>/gis, '');      // Remove scripts
content = content.replace(/<style[^>]*>.*?<\/style>/gis, '');        // Remove styles
content = content.replace(/<!--.*?-->/gs, '');                        // Remove comments
content = content.replace(/\s{2,}/g, ' ');                           // Normalize whitespace
```

---

## 3. Alternative Method: Parsing from Novel Page

Some novels also display chapter lists directly on the novel page:

**HTML Structure**:
```html
<h3 class="tit">Chapter List</h3>
<ul class="ul-list5">
  <li>
    <span class="glyphicon glyphicon-book"></span>
    <a href="/libread/immortality-simulator-140946/chapter-01" 
       title="Chapter 1: Where Do Immortals Come From?">
      Chapter 1: Where Do Immortals Come From?
    </a>
  </li>
  <!-- More chapters -->
</ul>
```

**Selector**: `ul.ul-list5 li a[href*="chapter-"]`

This is useful as a fallback if the API fails, but the API is more reliable.

---

## 4. Key Implementation Details

### Article ID (aid) Extraction

The `aid` parameter is critical for fetching chapter lists. It's embedded in the cover image URL:

```javascript
// Pattern: /files/article/image/12/12029/12029s.jpg
// Extract: 12029

function extractArticleId(htmlContent) {
  const match = htmlContent.match(/(\d+)s\.jpg/);
  return match ? match[1] : null;
}
```

**Fallback**: If the image pattern isn't found, use the novel ID from the URL.

### Chapter Number Extraction

```javascript
function extractChapterNumber(url) {
  const match = url.match(/chapter-?(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}
```

### Title Cleaning

Chapter titles from the API need cleaning:

```javascript
function cleanChapterTitle(title) {
  return title
    .replace(/^C\.?\d+[:\.\-\s]*/i, '')      // Remove "C.1:" prefix
    .replace(/^Chapter\s*\d+[:\-\s]*/i, '')   // Remove "Chapter 1:" prefix
    .replace(/\s+/g, ' ')                     // Normalize whitespace
    .trim();
}
```

---

## 5. CORS Considerations

LibRead.com blocks direct browser requests via CORS. The solution is a proxy server:

### Proxy Endpoints (Current Implementation)

```javascript
// Novel page proxy
GET /api/novel/:id

// Chapter list API proxy
GET /api/chapterlist?aid=12345
  → POST https://libread.com/api/chapterlist.php

// Chapter page proxy
GET /api/chapter/:novelId/:chapterId
  → GET https://libread.com/lib/{novelId}/{chapterId}

// Generic proxy
GET /api/proxy?url={encoded_url}
```

### Proxy Headers

Required headers for successful requests:
```javascript
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive'
}
```

For the chapterlist API specifically:
```javascript
{
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://libread.com/',
  'Origin': 'https://libread.com'
}
```

---

## 6. Complete Data Flow Example

```
User searches "Immortality Simulator"
    ↓
GET /sort/latest-release (or POST /search)
    ↓
Parse novel list, extract: immortality-simulator-140946
    ↓
GET /libread/immortality-simulator-140946
    ↓
Extract article ID: 12029 (from /files/article/image/12/12029/12029s.jpg)
    ↓
POST /api/chapterlist.php with aid=12029
    ↓
Receive JSON: {"html": "<option>...</option>"}
    ↓
Parse 120 chapters from HTML options
    ↓
User clicks "Chapter 1"
    ↓
GET /libread/immortality-simulator-140946/chapter-01
    ↓
Parse content from <div id="article">
    ↓
Display cleaned content to user
```

---

## 7. Comparison with Current Implementation

### What's Working ✓

1. **Basic proxy structure** - server.js handles CORS correctly
2. **Novel listing** - parseNovelsFromPage() works well
3. **Chapter fetching** - parseChapterContent() handles multiple selectors
4. **Image proxying** - proxifyImage() bypasses CORS for images

### What Needs Improvement ⚠

1. **Article ID extraction** - Current regex `/(\d+)s\.jpg/` is correct but could be more robust
2. **API response parsing** - parseChaptersFromAPI() handles JSON correctly
3. **URL construction** - The `-0` in API responses (`/libread/-0/chapter-01`) needs handling
4. **Error handling** - More graceful fallbacks needed

### Recommended Changes

1. **Update extractNovelId()** to handle both URL patterns:
```javascript
function extractNovelId(url) {
  // Handle: /libread/immortality-simulator-140946
  const match1 = url.match(/(\d+)(?:\/|$|\.html)/);
  if (match1) return match1[1];
  
  // Handle: /lib/{numeric_id}
  const match2 = url.match(/\/lib\/(\d+)/);
  if (match2) return match2[1];
  
  return url.split('/').pop();
}
```

2. **Improve URL construction in parseChaptersFromAPI()**:
```javascript
// The API returns URLs like /libread/-0/chapter-01
// These need to be converted to full URLs with the novel slug
function buildChapterUrl(apiValue, novelSlug, novelId) {
  if (apiValue.startsWith('/libread/-0/')) {
    // Replace -0 with actual slug
    const chapterPart = apiValue.split('/').pop();
    return `https://libread.com/libread/${novelSlug}-${novelId}/${chapterPart}`;
  }
  return `https://libread.com${apiValue}`;
}
```

---

## 8. Testing Results

### Tested Endpoints

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| /sort/latest-release | GET | ✓ Working | Returns novel list |
| /libread/immortality-simulator-140946 | GET | ✓ Working | Returns novel page with aid in image URL |
| /api/chapterlist.php | POST | ✓ Working | Returns JSON with HTML options |
| /libread/immortality-simulator-140946/chapter-01 | GET | ✓ Working | Returns chapter content in div#article |

### Sample Data

**Novel**: Immortality Simulator
- **Novel ID**: 140946
- **Article ID (aid)**: 12029
- **Total Chapters**: 120
- **API Response**: 120 `<option>` tags
- **Content Selector**: `div#article` within `div.txt`

---

## 9. Summary

LibRead.com uses a straightforward architecture:

1. **Static HTML pages** for novel browsing and details
2. **Single AJAX endpoint** (`/api/chapterlist.php`) for fetching all chapters
3. **Article ID system** extracted from image URLs
4. **Simple chapter URL structure** based on novel slug and chapter number
5. **Clean HTML structure** for chapter content in `div#article`

The current libread-ereader implementation is **very close** to working correctly. The main areas needing attention are:

1. Proper handling of the `-0` placeholder in API-returned URLs
2. More robust article ID extraction
3. Better error handling for edge cases

All core functionality is in place and functioning correctly.
