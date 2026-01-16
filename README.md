# 📚 LibRead Ereader

A beautiful, functional web-based ereader application that pulls content directly from libread.com. Features an immersive reading experience with elegant typography, theme switching, and responsive design.

## ✨ Features

- **Live Content Integration**: Pulls novels, chapters, and metadata directly from libread.com
- **Elegant Reading Experience**: Beautiful typography with Cormorant Garamond font
- **Dark/Light Theme**: Toggle between warm cream and sophisticated dark themes
- **Customizable Font Size**: Adjust reading text size with slider or buttons
- **Smart Navigation**: Browse by latest, popular, completed, or genre
- **Search Functionality**: Search novels by title, author, or keywords
- **Chapter Management**: Easy chapter-by-chapter reading with navigation
- **Responsive Design**: Works beautifully on desktop, tablet, and mobile
- **Persistent Settings**: Theme and font size preferences saved locally

## 🎨 Design Philosophy

This ereader embraces **intentional minimalism** with:
- Warm, paper-inspired color palette (cream, gold, terracotta)
- Elegant serif typography for reading (Cormorant Garamond)
- Clean sans-serif for UI elements (Inter)
- Sophisticated display headings (Playfair Display)
- Subtle noise texture overlay for depth
- Smooth animations and micro-interactions

## 🚀 Getting Started

### Prerequisites

- Node.js installed on your system
- npm (comes with Node.js)

### Quick Start

1. **Install dependencies**:
```bash
cd /home/darvondoom/libread-ereader
npm install
```

2. **Start the proxy server**:
```bash
npm start
```

3. **Open in your browser**:
```
http://localhost:3001
```

### Using the Application

1. **Welcome Page**: Click "Get Started" or use the search bar
2. **Browse Novels**: Grid view with cover images, ratings, and genres
3. **Read Chapters**: Click any novel to see chapters, then click to read
4. **Navigation**: Use Previous/Next buttons or chapter list to navigate
5. **Theme Toggle**: Click the theme button in the header to switch dark/light mode

### Available Scripts

- `npm start` - Start the proxy server on port 3001
- `npm run dev` - Start with auto-reload (requires nodemon)

Then open `http://localhost:8000` in your browser.

## 📖 Usage

### Browsing Novels

1. **Home Page**: Browse latest novels on the home page
2. **Sidebar Navigation**: 
   - Click "Latest Novels", "Most Popular", "Completed", or "Latest Updates"
   - Filter by genre (Fantasy, Action, Romance, etc.)
3. **Search**: Use the search bar to find specific novels
4. **Click a Novel Card**: Opens the novel detail view

### Reading Chapters

1. **Novel View**: See novel information and chapter list
2. **Select Chapter**: Click any chapter from the list to start reading
3. **Navigate**: Use Previous/Next buttons to move between chapters
4. **Customize Reading**:
   - Click **A-** / **A+** to adjust font size
   - Use the slider in the right sidebar for fine control
   - Toggle 🌙 for dark/light theme

## 🔧 Technical Details

### Architecture

- **Vanilla JavaScript**: No frameworks or dependencies
- **QuickNovel-Inspired API Integration**: Uses libread.com's hidden API endpoints
- **Smart Fallback System**: API-first with HTML parsing fallback
- **DOMParser**: Parses HTML responses from the source
- **LocalStorage**: Persists user preferences

### Data Flow

```
User Action → POST to /api/chapterlist.php → Parse Chapters → Display UI
              ↓ (fallback)
         Parse HTML from page → Extract Data → Display UI
```

### Key Improvements from QuickNovel Analysis

After analyzing [QuickNovel](https://github.com/LagradOst/QuickNovel)'s LibReadProvider, this ereader now uses:

1. **Hidden API Endpoint** (`/api/chapterlist.php`):
   - Much faster chapter loading
   - Returns all chapters at once in a clean format
   - Reduces server load and parsing time

2. **Smart Article ID Extraction**:
   - Extracts `aid` from image URLs (pattern: `[0-9]+s.jpg`)
   - More reliable than URL parsing

3. **Proper POST Search**:
   - Uses the same headers and approach as QuickNovel
   - More reliable search results

4. **Content Cleaning**:
   - Removes obfuscated domain references
   - Cleans up scripts and unwanted HTML elements

### Key Components

1. **API Functions** (`fetchFromAPI`, `parseHTML`)
2. **Parsing Functions** (`parseNovelsFromPage`, `parseChapterContent`)
3. **Display Functions** (`displayNovels`, `displayChapter`)
4. **State Management** (global `state` object)
5. **Event Handlers** (navigation, search, settings)

## 🌐 Browser Compatibility

- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Opera

**Note**: Requires a modern browser with ES6+ support and Fetch API.

## ⚠️ CORS Notice

Due to browser security restrictions (CORS), direct requests to libread.com may be blocked when running from a local file (`file://`).

**Solutions**:

1. **Use a CORS Proxy** (modify `API_BASE` in `app.js`):
   ```javascript
   const API_BASE = 'https://cors-anywhere.herokuapp.com/https://libread.com';
   ```

2. **Use a Browser Extension**: 
   - Install a CORS bypass extension for development
   - Enable it when using the ereader

3. **Run with a Local Server**: 
   - Some servers handle CORS differently
   - Try different local server options

4. **Deploy to Web Host**: 
   - Deploy to GitHub Pages, Netlify, or Vercel
   - Configure proper CORS headers

## 📁 Project Structure

```
libread-ereader/
├── index.html          # Main HTML structure
├── app.js              # Application logic
├── README.md           # This file
└── styles/             # (CSS is embedded in index.html for portability)
```

## 🎯 Future Enhancements

Possible improvements:
- [ ] Add bookmarks/save reading progress
- [ ] Implement offline caching with Service Workers
- [ ] Add library/favorites management
- [ ] Support for multiple novel sources
- [ ] Reading statistics and tracking
- [ ] Export/download chapters
- [ ] Keyboard shortcuts for navigation
- [ ] Text-to-speech integration
- [ ] Multiple language support

## 🤝 Contributing

Feel free to fork, modify, and enhance this ereader for your needs!

## 📄 License

This project is open source and available for personal and educational use.

## ⚠️ Disclaimer

This application is for personal use only. Please respect the terms of service of libread.com and copyright holders. This tool does not store or distribute content—it only provides a convenient reading interface for publicly available web content.

## 🙏 Acknowledgments

- Content source: [libread.com](https://libread.com)
- Typography: Google Fonts (Cormorant Garamond, Inter, Playfair Display)
- Design inspiration: Modern ereader interfaces and editorial design

---

**Happy Reading! 📖✨**
